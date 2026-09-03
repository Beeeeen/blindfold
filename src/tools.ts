import * as guard from './guard';
import { PolicyError, type GuardContext } from './guard';
import * as ledger from './ledger';
import { renderChart, type ChartSpec } from './chart';

/**
 * The WebMCP surface.
 *
 * Eight tools, all of them compiled queries rather than pass-through SQL. The
 * agent drives the analysis; the page performs it; only the answer crosses back.
 *
 * The toolset is re-registered every time a dataset is loaded, so the tool
 * descriptions the agent reads always name that file's real columns and tiers.
 * A tool that can only be described in terms of the loaded data is a tool that
 * cannot be called against data that is not there.
 */

type ToolDefinition = WebMCPToolDescriptor;
type ToolResult = WebMCPToolResult;

/**
 * The spec puts the registry on `document.modelContext`. Chromium carried it on
 * `navigator.modelContext` until 150 and some hosts may still, so both are
 * checked — document first, since that is where the standard landed.
 */
export function getModelContext(): ModelContext | null {
  if (typeof document.modelContext?.registerTool === 'function') return document.modelContext;
  if (typeof navigator.modelContext?.registerTool === 'function') return navigator.modelContext;
  return null;
}

/**
 * Registration, written as the spec writes it:
 *
 *   document.modelContext.registerTool({
 *     name: "search_products",
 *     description: "Search the product catalog",
 *     inputSchema: { ... },
 *     execute: async (input) => { ... }
 *   });
 *
 * The signal is what withdraws the tool later — Chrome 152 ships no
 * `unregisterTool`, so aborting the batch is the only way to replace a toolset
 * without colliding with the names already registered.
 */
async function registerWithHost(tool: ToolDefinition, signal: AbortSignal): Promise<void> {
  if (typeof document.modelContext?.registerTool === 'function') {
    await document.modelContext.registerTool(tool, { signal });
    return;
  }
  if (typeof navigator.modelContext?.registerTool === 'function') {
    await navigator.modelContext.registerTool(tool, { signal });
  }
}

export function isSupported(): boolean {
  return getModelContext() !== null;
}

function ok(summary: string, payload?: unknown): ToolResult {
  const text = payload === undefined ? summary : `${summary}\n\n${JSON.stringify(payload, null, 2)}`;
  return { content: [{ type: 'text', text }], structuredContent: payload };
}

let registered: string[] = [];
/**
 * Registration lifetime is governed by an AbortSignal, which is how the spec
 * withdraws a tool. Chrome 152 ships no unregisterTool at all, so aborting the
 * previous batch is the only way to re-offer a toolset without colliding with
 * the names already registered.
 */
let batch: AbortController | null = null;
/**
 * The same handlers the host calls, kept addressable from the page itself so
 * the workbench can be reviewed in a browser with no agent attached.
 */
const handlers = new Map<string, ToolDefinition>();
const listeners = new Set<(name: string, phase: 'call' | 'result', detail: string) => void>();

export function onToolActivity(fn: (name: string, phase: 'call' | 'result', detail: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(name: string, phase: 'call' | 'result', detail: string): void {
  for (const fn of listeners) fn(name, phase, detail);
}

/**
 * Wraps every handler so that a policy refusal is returned to the agent as a
 * usable answer rather than an exception. The agent is told what it may not
 * have and what to ask for instead, so it can correct itself in one turn.
 */
function guarded(
  name: string,
  handler: (input: Record<string, never>) => Promise<{ summary: string; payload?: unknown; suppressed?: number }>,
) {
  return async (raw: Record<string, never>): Promise<ToolResult> => {
    // Chrome hands execute() a parsed object. Not every host is obliged to, and
    // a string here would otherwise read as a call with no arguments at all.
    let input = raw ?? ({} as Record<string, never>);
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch {
        return {
          content: [{ type: 'text', text: `Arguments were not valid JSON: ${String(input).slice(0, 200)}` }],
        };
      }
    }
    const args = JSON.stringify(input);
    announce(name, 'call', args);
    try {
      const { summary, payload, suppressed = 0 } = await handler(input);
      const result = ok(summary, payload);
      // The ledger stores the outgoing text verbatim, not a description of it.
      ledger.record({
        tool: name,
        verdict: 'released',
        detail: summary,
        payload,
        groupsSuppressed: suppressed,
        args,
        returned: result.content.map((c) => c.text).join('\n'),
      });
      announce(name, 'result', summary);
      return result;
    } catch (err) {
      if (err instanceof PolicyError) {
        const text = `Refused by the disclosure guard.\n\n${err.message}\n\nWhat to do instead: ${err.remedy}`;
        ledger.record({ tool: name, verdict: 'blocked', detail: err.message, args, returned: text });
        announce(name, 'result', `blocked - ${err.message}`);
        return { content: [{ type: 'text', text }] };
      }
      const message = err instanceof Error ? err.message : String(err);
      const text = `The query could not be run: ${message}`;
      ledger.record({ tool: name, verdict: 'blocked', detail: message, args, returned: text });
      announce(name, 'result', `error - ${message}`);
      return { content: [{ type: 'text', text }] };
    }
  };
}

const FILTER_SCHEMA = {
  type: 'array',
  description:
    'Optional row filters, ANDed together. Identifier columns can never be filtered. Personal measurements accept range operators only.',
  items: {
    type: 'object',
    properties: {
      column: { type: 'string' },
      op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] },
      value: { type: ['string', 'number', 'boolean'] },
    },
    required: ['column', 'op', 'value'],
    additionalProperties: false,
  },
} as const;

export interface RegisterOptions {
  ctx: GuardContext;
  fileName: string;
}

export async function registerTools({ ctx, fileName }: RegisterOptions): Promise<string[]> {
  const mc = getModelContext();

  // Loading a second file, or reclassifying one column, must not leave the
  // previous toolset advertised — and must not collide with its names.
  await withdrawAll();
  batch = new AbortController();

  const groupable = ctx.columns.filter((c) => c.tier === 'quasi' || c.tier === 'safe').map((c) => c.name);
  const measurable = ctx.columns.filter((c) => c.type === 'number' && c.tier !== 'identifier').map((c) => c.name);
  const sealed = ctx.columns.filter((c) => c.tier === 'identifier').map((c) => c.name);

  const dataFacts =
    `Loaded dataset: "${fileName}", ${ctx.rowCount.toLocaleString()} rows. ` +
    `Groupable columns: ${groupable.join(', ') || 'none'}. ` +
    `Measurable columns: ${measurable.join(', ') || 'none'}. ` +
    `Sealed identifier columns that no tool will ever return: ${sealed.join(', ') || 'none'}.`;

  const defs: ToolDefinition[] = [
    {
      name: 'describe_dataset',
      description:
        'Start here. Returns the shape of the loaded dataset: row count, every column with its type and sensitivity tier, and the rules governing what may be asked of each one. Returns no data values whatsoever.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: guarded('describe_dataset', async () => ({
        summary: `${ctx.rowCount.toLocaleString()} rows, ${ctx.columns.length} columns. No values are included in this response.`,
        payload: {
          rows: ctx.rowCount,
          policy: {
            k_anonymity: guard.K_ANON,
            rule: `Any group describing fewer than ${guard.K_ANON} people is suppressed before you see it.`,
            sealed_columns: sealed,
            free_form_sql: 'not available by design - a leak must be impossible to express, not merely refused',
          },
          columns: ctx.columns.map((c) => ({
            name: c.name,
            type: c.type,
            tier: c.tier,
            distinct_values: c.distinctCount,
            why: c.reason,
            may_group_by: c.tier === 'quasi' || c.tier === 'safe',
            may_measure: c.type === 'number' && c.tier !== 'identifier',
          })),
        },
      })),
    },
    {
      name: 'list_group_values',
      description: `List the distinct values of a category column, with a count for each. ${dataFacts} Values whose group is smaller than the k-anonymity threshold are withheld.`,
      inputSchema: {
        type: 'object',
        properties: { column: { type: 'string', description: 'A groupable category column.' } },
        required: ['column'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: guarded('list_group_values', async (input) => {
        const { column } = input as unknown as { column: string };
        const res = await guard.groupValues(ctx, column);
        return {
          summary: `${res.rows.length} value(s) of ${column} released. ${res.note}.`,
          payload: res.rows,
          suppressed: res.groupsSuppressed,
        };
      }),
    },
    {
      name: 'aggregate',
      description:
        `The main analysis tool. Computes one aggregate of one column, optionally grouped and filtered, and returns only the aggregated numbers. ` +
        `Supported aggregates: count, avg, sum, median, p25, p75, stddev, min, max. min and max are refused on personal measurements because they return one real person's value. ${dataFacts}`,
      inputSchema: {
        type: 'object',
        properties: {
          agg: { type: 'string', enum: ['count', 'avg', 'sum', 'median', 'p25', 'p75', 'stddev', 'min', 'max'] },
          metric: { type: 'string', description: 'Numeric column to aggregate. Omit only when agg is "count".' },
          group_by: {
            type: 'array',
            items: { type: 'string' },
            description: 'Category columns to group by. Omit for a single overall figure.',
          },
          filters: FILTER_SCHEMA,
          sort: { type: 'string', enum: ['value_desc', 'value_asc', 'group_asc'] },
          limit: { type: 'integer', minimum: 1, maximum: guard.MAX_ROWS },
        },
        required: ['agg'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: guarded('aggregate', async (input) => {
        const spec = input as unknown as guard.AggregateSpec;
        const res = await guard.aggregate(ctx, spec);
        const what = spec.agg === 'count' ? 'count' : `${spec.agg} of ${spec.metric}`;
        return {
          summary: `${what}${spec.group_by?.length ? ` by ${spec.group_by.join(', ')}` : ''}: ${res.rows.length} row(s). ${res.note}.`,
          payload: res.rows,
          suppressed: res.groupsSuppressed,
        };
      }),
    },
    {
      name: 'distribution',
      description: `Bucket a numeric column into a histogram and return the count in each bucket, optionally split by a category. Bin edges are released; the values inside them are not. ${dataFacts}`,
      inputSchema: {
        type: 'object',
        properties: {
          column: { type: 'string', description: 'Numeric column to bucket.' },
          bins: { type: 'integer', minimum: 2, maximum: 50, default: 10 },
          group_by: { type: 'string', description: 'Optional category column to split the histogram by.' },
          filters: FILTER_SCHEMA,
        },
        required: ['column'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: guarded('distribution', async (input) => {
        const spec = input as unknown as guard.DistributionSpec;
        const res = await guard.distribution(ctx, spec);
        return {
          summary: `Histogram of ${spec.column} across ${res.rows.length} surviving bucket(s). ${res.note}.`,
          payload: res.rows,
          suppressed: res.groupsSuppressed,
        };
      }),
    },
    {
      name: 'correlate',
      description: `Return the Pearson correlation between two numeric columns, optionally per category. The response is a coefficient and a sample size - never a scatter of points. ${dataFacts}`,
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'string' },
          y: { type: 'string' },
          group_by: { type: 'string' },
          filters: FILTER_SCHEMA,
        },
        required: ['x', 'y'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: guarded('correlate', async (input) => {
        const spec = input as unknown as guard.CorrelateSpec;
        const res = await guard.correlate(ctx, spec);
        return {
          summary: `Correlation of ${spec.x} against ${spec.y}: ${res.rows.length} coefficient(s). ${res.note}.`,
          payload: res.rows,
          suppressed: res.groupsSuppressed,
        };
      }),
    },
    {
      name: 'compare_groups',
      description:
        `Measure the gap in one metric between two cohorts of a category column, optionally computed separately within a third dimension. ` +
        `Returns each cohort's mean, the raw and percentage gap, and a standardised effect size. A slice is suppressed unless BOTH cohorts independently clear the k-anonymity threshold. ${dataFacts}`,
      inputSchema: {
        type: 'object',
        properties: {
          metric: { type: 'string', description: 'Numeric column being compared.' },
          split_by: { type: 'string', description: 'Category column that defines the two cohorts.' },
          group_a: { type: ['string', 'number', 'boolean'] },
          group_b: { type: ['string', 'number', 'boolean'] },
          within: { type: 'string', description: 'Optional category column to compute the comparison separately within.' },
          filters: FILTER_SCHEMA,
        },
        required: ['metric', 'split_by', 'group_a', 'group_b'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: guarded('compare_groups', async (input) => {
        const spec = input as unknown as guard.CompareSpec;
        const res = await guard.compareGroups(ctx, spec);
        return {
          summary: `${spec.metric}: ${String(spec.group_a)} vs ${String(spec.group_b)}${spec.within ? ` within each ${spec.within}` : ''} across ${res.rows.length} slice(s). ${res.note}.`,
          payload: res.rows,
          suppressed: res.groupsSuppressed,
        };
      }),
    },
    {
      name: 'render_chart',
      description:
        'Draw a chart on the page for the human to look at. Supply the aggregated rows you already received from another tool. ' +
        'This is how you show a finding: the person in front of the screen sees the picture, and you receive only a confirmation that it was drawn. ' +
        'Use it whenever a result is easier to understand as a shape than as numbers. Rows are plotted in the order you supply them, so sort them first if the order carries meaning.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['bar', 'line', 'area', 'dot', 'histogram'] },
          x: { type: 'string', description: 'Field name in the supplied rows for the horizontal axis.' },
          y: { type: 'string', description: 'Field name in the supplied rows for the vertical axis.' },
          series: { type: 'string', description: 'Optional field name to colour by.' },
          rows: {
            type: 'array',
            description: 'The aggregated rows to plot, exactly as returned by a previous tool call.',
            items: { type: 'object', additionalProperties: true },
          },
          caption: { type: 'string', description: 'A sentence explaining what the reader should notice.' },
          x_label: { type: 'string', description: 'Axis label for a human. Defaults to the raw field name.' },
          y_label: { type: 'string', description: 'Axis label for a human. Defaults to the raw field name.' },
        },
        required: ['kind', 'x', 'y', 'rows'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: guarded('render_chart', async (input) => {
        const spec = input as unknown as ChartSpec;
        const count = renderChart(spec);
        return {
          summary: `Chart drawn on the page: a ${spec.kind} of ${spec.y} against ${spec.x} over ${count} point(s). The human can see it now. No data was returned to you.`,
        };
      }),
    },
    {
      name: 'policy_report',
      description:
        'Report what this session has actually disclosed: bytes ingested into the page versus bytes released to you, values released against the disclosure budget, calls refused, and groups suppressed for being too small. Use it to explain to the human what they did and did not reveal.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: guarded('policy_report', async () => {
        const s = ledger.snapshot();
        return {
          summary: `${s.bytesReleased} bytes released to the agent out of ${s.bytesIngested} bytes ingested into the page.`,
          payload: {
            bytes_ingested_into_page: s.bytesIngested,
            rows_ingested_into_page: s.rowsIngested,
            bytes_released_to_agent: s.bytesReleased,
            raw_rows_released_to_agent: 0,
            values_released: s.cellsReleased,
            disclosure_budget: s.budgetCells,
            calls_refused: s.callsBlocked,
            groups_suppressed: s.groupsSuppressed,
          },
        };
      }),
    },
  ];

  for (const def of defs) {
    handlers.set(def.name, def);
    if (mc) await registerWithHost(def, batch.signal);
    registered.push(def.name);
  }
  return registered;
}

export function registeredTools(): string[] {
  return [...registered];
}

/**
 * Withdraw everything currently on offer. Called before a new file is read, so
 * that a slow or failed load can never leave an agent holding tools that
 * describe data the page no longer has.
 */
export async function withdrawAll(): Promise<void> {
  const mc = getModelContext();
  if (mc?.unregisterTool) {
    for (const name of registered) {
      try {
        await mc.unregisterTool(name);
      } catch {
        /* the host may have dropped it already */
      }
    }
  }
  batch?.abort();
  batch = null;
  registered = [];
  handlers.clear();
}

/** The schema an agent would be shown, for the page's own tool runner. */
export function toolSchema(name: string): Record<string, unknown> | null {
  return handlers.get(name)?.inputSchema ?? null;
}

/** Invoke a tool exactly as a host would. Used by the no-agent fallback panel. */
export async function callTool(name: string, args: unknown): Promise<string> {
  const def = handlers.get(name);
  if (!def) throw new Error(`No tool named "${name}" is registered.`);
  const result = await def.execute((args ?? {}) as Record<string, never>);
  return result.content.map((c) => c.text).join('\n');
}
