import { quoteIdent, quoteLiteral, rawQuery } from './db';
import type { ClassifiedColumn } from './classify';
import * as ledger from './ledger';

/**
 * The disclosure guard.
 *
 * The design rule is that a leak must be impossible to *express*, not merely
 * refused after the fact. Agents never write SQL here. They fill in narrow
 * structured specs, this module compiles them to SQL, and every result passes
 * through k-anonymity suppression before it is allowed to become a tool return
 * value.
 */

export const K_ANON = 5;
export const MAX_ROWS = 200;

export type Agg = 'count' | 'avg' | 'sum' | 'median' | 'p25' | 'p75' | 'stddev' | 'min' | 'max';

export interface Filter {
  column: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string | number | boolean;
}

export interface GuardContext {
  table: string;
  columns: ClassifiedColumn[];
  rowCount: number;
}

export class PolicyError extends Error {
  constructor(
    message: string,
    readonly remedy: string,
  ) {
    super(message);
  }
}

function column(ctx: GuardContext, name: string): ClassifiedColumn {
  const col = ctx.columns.find((c) => c.name === name);
  if (!col) {
    throw new PolicyError(
      `No column named "${name}".`,
      'Call describe_dataset to see the available columns.',
    );
  }
  return col;
}

/**
 * Names the arguments a tool is missing.
 *
 * An agent that guesses a parameter name lands in `column()` with undefined and
 * gets told there is no column called "undefined", which is true and useless.
 * Running a real model against these tools showed it retrying the same wrong
 * shape four times over. Saying which argument was expected ends that in one
 * turn, which is the whole point of returning refusals rather than throwing.
 */
function requireArgs<T extends object>(spec: T, tool: string, names: (keyof T & string)[]): void {
  const missing = names.filter((n) => spec[n] === undefined || spec[n] === null || spec[n] === '');
  if (!missing.length) return;
  const supplied = Object.keys(spec).filter((k) => (spec as unknown as Record<string, unknown>)[k] !== undefined);
  throw new PolicyError(
    `${tool} is missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` +
      (supplied.length ? ` You supplied: ${supplied.join(', ')}.` : ''),
    `${tool} takes exactly these arguments: ${names.join(', ')}` +
      `. Names must match; a differently named argument is ignored.`,
  );
}

/** Columns an agent may group or filter by without singling anyone out. */
function assertGroupable(col: ClassifiedColumn): void {
  if (col.tier === 'identifier') {
    throw new PolicyError(
      `"${col.name}" is a direct identifier and is sealed. It cannot be grouped, filtered, measured or returned.`,
      'Group by a category column instead - describe_dataset lists which ones qualify.',
    );
  }
  if (col.tier === 'sensitive') {
    throw new PolicyError(
      `"${col.name}" is a personal measurement, so grouping by it would create one group per person.`,
      'Use it as the metric of an aggregate, or bucket it with the distribution tool.',
    );
  }
}

function assertMeasurable(col: ClassifiedColumn, agg: Agg): void {
  if (col.tier === 'identifier') {
    throw new PolicyError(`"${col.name}" is a direct identifier and is sealed.`, 'Pick a numeric column to measure.');
  }
  if (col.type !== 'number' && agg !== 'count') {
    throw new PolicyError(
      `"${col.name}" is not numeric, so ${agg} is undefined for it.`,
      'Use agg "count", or choose a numeric column.',
    );
  }
  if (col.tier === 'sensitive' && (agg === 'min' || agg === 'max')) {
    throw new PolicyError(
      `min/max on "${col.name}" would return one real person's exact value.`,
      'Use p25, median or p75 - they describe the same shape without exposing an individual.',
    );
  }
}

function assertFilterable(col: ClassifiedColumn, op: Filter['op']): void {
  if (col.tier === 'identifier') {
    throw new PolicyError(
      `"${col.name}" is a direct identifier and cannot be filtered on.`,
      'Filtering by identity is how a cohort gets narrowed down to one person.',
    );
  }
  if (col.tier === 'sensitive' && (op === 'eq' || op === 'neq')) {
    throw new PolicyError(
      `An exact-match filter on "${col.name}" targets whoever holds that value.`,
      'Use a range filter (gt/gte/lt/lte) to describe a band instead.',
    );
  }
}

const AGG_SQL: Record<Agg, (expr: string) => string> = {
  count: () => 'COUNT(*)',
  avg: (e) => `AVG(${e})`,
  sum: (e) => `SUM(${e})`,
  median: (e) => `quantile_cont(${e}, 0.5)`,
  p25: (e) => `quantile_cont(${e}, 0.25)`,
  p75: (e) => `quantile_cont(${e}, 0.75)`,
  stddev: (e) => `stddev_samp(${e})`,
  min: (e) => `MIN(${e})`,
  max: (e) => `MAX(${e})`,
};

export function buildWhere(ctx: GuardContext, filters: Filter[] = []): string {
  if (!filters.length) return '';
  const ops: Record<Filter['op'], string> = {
    eq: '=',
    neq: '<>',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  };
  const clauses = filters.map((f) => {
    if (!(f.op in ops)) {
      throw new PolicyError(
        `"${f.op}" is not a filter operator this tool knows.`,
        `op must be one of: ${Object.keys(ops).join(', ')}.`,
      );
    }
    const col = column(ctx, f.column);
    assertFilterable(col, f.op);
    return `${quoteIdent(col.name)} ${ops[f.op]} ${quoteLiteral(f.value)}`;
  });
  return ` WHERE ${clauses.join(' AND ')}`;
}

export interface GuardedResult {
  rows: Record<string, unknown>[];
  groupsSuppressed: number;
  note: string;
}

/**
 * Post-hoc suppression. Every grouped result carries a hidden __n so that any
 * group thin enough to identify a person is dropped before the agent sees it.
 */
function suppress(rows: Record<string, unknown>[], grouped: boolean): GuardedResult {
  let suppressed = 0;
  const kept: Record<string, unknown>[] = [];
  for (const row of rows) {
    const n = Number(row.__n ?? Number.POSITIVE_INFINITY);
    if (grouped && n < K_ANON) {
      suppressed++;
      continue;
    }
    const { __n, ...rest } = row;
    kept.push(Number.isFinite(n) ? { ...rest, n } : rest);
  }
  const capped = kept.slice(0, MAX_ROWS);
  const notes: string[] = [];
  if (suppressed) notes.push(`${suppressed} group(s) held fewer than ${K_ANON} people and were suppressed`);
  if (kept.length > MAX_ROWS) notes.push(`showing the first ${MAX_ROWS} of ${kept.length} groups`);
  return {
    rows: capped,
    groupsSuppressed: suppressed,
    note: notes.join('; ') || `all groups cleared the k>=${K_ANON} threshold`,
  };
}

function assertBudget(): void {
  if (ledger.budgetRemaining() <= 0) {
    throw new PolicyError(
      `This session has released its full disclosure budget of ${ledger.snapshot().budgetCells} values.`,
      'A long series of narrow queries can reconstruct rows even when each answer looks harmless. Reload to start a new session.',
    );
  }
}

export interface AggregateSpec {
  agg: Agg;
  metric?: string;
  group_by?: string[];
  filters?: Filter[];
  sort?: 'value_desc' | 'value_asc' | 'group_asc';
  limit?: number;
}

export async function aggregate(ctx: GuardContext, spec: AggregateSpec): Promise<GuardedResult> {
  assertBudget();
  requireArgs(spec, 'aggregate', ['agg']);
  const agg = spec.agg;
  if (!(agg in AGG_SQL)) {
    throw new PolicyError(
      `"${agg}" is not an aggregate this tool knows.`,
      `agg must be one of: ${Object.keys(AGG_SQL).join(', ')}.`,
    );
  }
  const groupBy = Array.isArray(spec.group_by)
    ? spec.group_by
    : spec.group_by
      ? [spec.group_by as unknown as string]
      : [];

  let valueExpr: string;
  if (agg === 'count') {
    valueExpr = 'COUNT(*)';
  } else {
    if (!spec.metric) {
      const supplied = Object.keys(spec).filter((k) => (spec as unknown as Record<string, unknown>)[k] !== undefined);
      throw new PolicyError(
        `agg "${agg}" needs a column to measure, passed as "metric". You supplied: ${supplied.join(', ')}.`,
        'aggregate takes: agg, metric, group_by, filters, sort, limit. group_by is an array of column names.',
      );
    }
    const metricCol = column(ctx, spec.metric);
    assertMeasurable(metricCol, agg);
    valueExpr = AGG_SQL[agg](quoteIdent(metricCol.name));
  }

  const groupCols = groupBy.map((g) => {
    const col = column(ctx, g);
    assertGroupable(col);
    return col;
  });

  const selectParts = [
    ...groupCols.map((c) => quoteIdent(c.name)),
    `${valueExpr} AS value`,
    'COUNT(*) AS __n',
  ];
  const groupClause = groupCols.length
    ? ` GROUP BY ${groupCols.map((c) => quoteIdent(c.name)).join(', ')}`
    : '';
  const orderClause =
    spec.sort === 'value_asc'
      ? ' ORDER BY value ASC'
      : spec.sort === 'group_asc' && groupCols.length
        ? ` ORDER BY ${quoteIdent(groupCols[0].name)} ASC`
        : ' ORDER BY value DESC';
  const limit = Math.min(spec.limit ?? MAX_ROWS, MAX_ROWS);

  const sql =
    `SELECT ${selectParts.join(', ')} FROM ${quoteIdent(ctx.table)}` +
    buildWhere(ctx, spec.filters) +
    groupClause +
    (groupCols.length ? orderClause : '') +
    ` LIMIT ${limit + 1}`;

  const rows = await rawQuery(sql);

  /**
   * An ungrouped aggregate returns one row, so it used to skip the k-check that
   * every grouped result goes through — and filters could narrow the cohort to
   * one person without ever grouping. `avg` over a cohort of one is that
   * person's exact salary, reached entirely through permitted calls. The
   * min/max rule guarded the front door while this stood open beside it.
   *
   * A cohort of zero is refused in the same words as a cohort of four. Refusing
   * only 1-4 would answer "is anybody here?" by the shape of the response.
   */
  if (!groupCols.length) {
    const cohort = Number(rows[0]?.__n ?? 0);
    if (cohort < K_ANON) {
      throw new PolicyError(
        `Those filters describe fewer than ${K_ANON} people, so any figure over them would be about individuals.`,
        'Widen the filters, or group the query so each group can be checked on its own.',
      );
    }
  }

  return suppress(rows, groupCols.length > 0);
}

export interface DistributionSpec {
  column: string;
  bins?: number;
  group_by?: string;
  filters?: Filter[];
}

/** Histogram counts. Bin edges are released; the values inside them are not. */
export async function distribution(ctx: GuardContext, spec: DistributionSpec): Promise<GuardedResult> {
  assertBudget();
  requireArgs(spec, 'distribution', ['column']);
  const col = column(ctx, spec.column);
  if (col.tier === 'identifier') {
    throw new PolicyError(`"${col.name}" is sealed.`, 'Choose a numeric column.');
  }
  if (col.type !== 'number') {
    throw new PolicyError(`"${col.name}" is not numeric.`, 'Use aggregate with agg "count" to tally categories.');
  }
  const bins = Math.min(Math.max(spec.bins ?? 10, 2), 50);
  const groupCol = spec.group_by ? column(ctx, spec.group_by) : null;
  if (groupCol) assertGroupable(groupCol);

  const where = buildWhere(ctx, spec.filters);
  const bounds = await rawQuery(
    `SELECT MIN(${quoteIdent(col.name)}) AS lo, MAX(${quoteIdent(col.name)}) AS hi FROM ${quoteIdent(ctx.table)}${where}`,
  );
  const lo = Number(bounds[0]?.lo ?? 0);
  const hi = Number(bounds[0]?.hi ?? 0);
  const width = hi > lo ? (hi - lo) / bins : 1;

  // Everything is forced to DOUBLE. Left as literals, DuckDB reads these as
  // DECIMALs, and multiplying them compounds the scale until the result no
  // longer fits a JS number.
  const loD = `CAST(${lo} AS DOUBLE)`;
  const widthD = `CAST(${width} AS DOUBLE)`;
  const value = `CAST(${quoteIdent(col.name)} AS DOUBLE)`;
  const bucketExpr = `LEAST(CAST(FLOOR((${value} - ${loD}) / ${widthD}) AS INTEGER), ${bins - 1})`;
  const select = [
    ...(groupCol ? [quoteIdent(groupCol.name)] : []),
    `${bucketExpr} AS bucket`,
    `${loD} + ${bucketExpr} * ${widthD} AS bin_start`,
    `${loD} + (${bucketExpr} + 1) * ${widthD} AS bin_end`,
    'COUNT(*) AS __n',
  ];
  const groupKeys = [...(groupCol ? [quoteIdent(groupCol.name)] : []), 'bucket', 'bin_start', 'bin_end'];

  const rows = await rawQuery(
    `SELECT ${select.join(', ')} FROM ${quoteIdent(ctx.table)}${where}` +
      ` GROUP BY ${groupKeys.join(', ')} ORDER BY ${groupKeys.join(', ')} LIMIT ${MAX_ROWS + 1}`,
  );
  return suppress(rows, true);
}

export interface CorrelateSpec {
  x: string;
  y: string;
  group_by?: string;
  filters?: Filter[];
}

/** Pearson r plus the sample size. Two numbers per group; no rows. */
export async function correlate(ctx: GuardContext, spec: CorrelateSpec): Promise<GuardedResult> {
  assertBudget();
  requireArgs(spec, 'correlate', ['x', 'y']);
  for (const name of [spec.x, spec.y]) {
    const col = column(ctx, name);
    if (col.tier === 'identifier') throw new PolicyError(`"${col.name}" is sealed.`, 'Choose numeric columns.');
    if (col.type !== 'number') {
      throw new PolicyError(`"${col.name}" is not numeric.`, 'Correlation needs two numeric columns.');
    }
  }
  const groupCol = spec.group_by ? column(ctx, spec.group_by) : null;
  if (groupCol) assertGroupable(groupCol);

  const select = [
    ...(groupCol ? [quoteIdent(groupCol.name)] : []),
    `corr(${quoteIdent(spec.x)}, ${quoteIdent(spec.y)}) AS r`,
    'COUNT(*) AS __n',
  ];
  const rows = await rawQuery(
    `SELECT ${select.join(', ')} FROM ${quoteIdent(ctx.table)}` +
      buildWhere(ctx, spec.filters) +
      (groupCol ? ` GROUP BY ${quoteIdent(groupCol.name)} ORDER BY r DESC` : '') +
      ` LIMIT ${MAX_ROWS + 1}`,
  );
  return suppress(rows, true);
}

export interface CompareSpec {
  metric: string;
  split_by: string;
  group_a: string | number | boolean;
  group_b: string | number | boolean;
  within?: string;
  filters?: Filter[];
}

/**
 * The gap tool. Compares one measurement across two cohorts, optionally within
 * a third dimension, and reports the difference plus a standardised effect size.
 */
export async function compareGroups(ctx: GuardContext, spec: CompareSpec): Promise<GuardedResult> {
  assertBudget();
  requireArgs(spec, 'compare_groups', ['metric', 'split_by', 'group_a', 'group_b']);
  const metric = column(ctx, spec.metric);
  assertMeasurable(metric, 'avg');
  const split = column(ctx, spec.split_by);
  assertGroupable(split);
  const within = spec.within ? column(ctx, spec.within) : null;
  if (within) assertGroupable(within);

  const m = quoteIdent(metric.name);
  const s = quoteIdent(split.name);
  const a = quoteLiteral(spec.group_a);
  const b = quoteLiteral(spec.group_b);

  const select = [
    ...(within ? [quoteIdent(within.name)] : []),
    `AVG(CASE WHEN ${s} = ${a} THEN ${m} END) AS mean_a`,
    `AVG(CASE WHEN ${s} = ${b} THEN ${m} END) AS mean_b`,
    `COUNT(*) FILTER (WHERE ${s} = ${a}) AS n_a`,
    `COUNT(*) FILTER (WHERE ${s} = ${b}) AS n_b`,
    `stddev_samp(${m}) AS sd`,
    `COUNT(*) FILTER (WHERE ${s} IN (${a}, ${b})) AS __n`,
  ];

  const rows = await rawQuery(
    `SELECT ${select.join(', ')} FROM ${quoteIdent(ctx.table)}` +
      buildWhere(ctx, spec.filters) +
      (within ? ` GROUP BY ${quoteIdent(within.name)} ORDER BY ${quoteIdent(within.name)}` : '') +
      ` LIMIT ${MAX_ROWS + 1}`,
  );

  // Both cohorts must independently clear k, otherwise a "gap" is one person wide.
  let suppressed = 0;
  const kept = rows.filter((r) => {
    const ok = Number(r.n_a ?? 0) >= K_ANON && Number(r.n_b ?? 0) >= K_ANON;
    if (!ok) suppressed++;
    return ok;
  });

  const enriched = kept.map((r) => {
    const { __n, sd, ...rest } = r;
    const meanA = Number(r.mean_a ?? 0);
    const meanB = Number(r.mean_b ?? 0);
    const spread = Number(sd ?? 0);
    return {
      ...rest,
      gap: Number((meanA - meanB).toFixed(4)),
      gap_pct: meanB ? Number((((meanA - meanB) / meanB) * 100).toFixed(2)) : null,
      effect_size: spread ? Number(((meanA - meanB) / spread).toFixed(3)) : null,
    };
  });

  return {
    rows: enriched.slice(0, MAX_ROWS),
    groupsSuppressed: suppressed,
    note: suppressed
      ? `${suppressed} slice(s) had fewer than ${K_ANON} people on one side of the split and were suppressed`
      : `every slice cleared k>=${K_ANON} on both sides`,
  };
}

export async function groupValues(ctx: GuardContext, name: string): Promise<GuardedResult> {
  assertBudget();
  requireArgs({ column: name }, 'list_group_values', ['column']);
  const col = column(ctx, name);
  assertGroupable(col);
  const rows = await rawQuery(
    `SELECT ${quoteIdent(col.name)} AS value, COUNT(*) AS __n FROM ${quoteIdent(ctx.table)}` +
      ` GROUP BY 1 ORDER BY __n DESC LIMIT ${MAX_ROWS + 1}`,
  );
  return suppress(rows, true);
}
