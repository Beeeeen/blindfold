/**
 * The disclosure ledger. Every byte that becomes visible to the agent is
 * counted here, and every byte that does not is counted too. This is the
 * number on screen that makes the guarantee legible to a human.
 */

export type Verdict = 'released' | 'suppressed' | 'blocked';

export interface LedgerEntry {
  id: number;
  at: number;
  tool: string;
  verdict: Verdict;
  detail: string;
  cellsReleased: number;
  bytesReleased: number;
  groupsSuppressed: number;
  /** What the agent was asked for. */
  args: string;
  /**
   * The exact text handed back to the agent, character for character. A summary
   * would only be another claim; this is the thing itself, so a sceptic can
   * read every byte that crossed and check for themselves that no row is in it.
   */
  returned: string;
}

export interface LedgerSnapshot {
  entries: LedgerEntry[];
  bytesIngested: number;
  rowsIngested: number;
  bytesReleased: number;
  cellsReleased: number;
  callsBlocked: number;
  groupsSuppressed: number;
  budgetCells: number;
}

const BUDGET_CELLS = 2000;

let nextId = 1;
const entries: LedgerEntry[] = [];
let bytesIngested = 0;
let rowsIngested = 0;
const listeners = new Set<(s: LedgerSnapshot) => void>();

export function noteIngest(bytes: number, rows: number): void {
  bytesIngested = bytes;
  rowsIngested = rows;
  emit();
}

export interface RecordInput {
  tool: string;
  verdict: Verdict;
  detail: string;
  payload?: unknown;
  groupsSuppressed?: number;
  args?: string;
  returned?: string;
}

export function record({
  tool,
  verdict,
  detail,
  payload,
  groupsSuppressed = 0,
  args = '',
  returned = '',
}: RecordInput): LedgerEntry {
  const serialised = payload === undefined ? '' : JSON.stringify(payload);
  const cells = countCells(payload);
  const entry: LedgerEntry = {
    id: nextId++,
    at: Date.now(),
    tool,
    verdict,
    detail,
    cellsReleased: verdict === 'released' ? cells : 0,
    bytesReleased: verdict === 'released' ? new TextEncoder().encode(serialised).length : 0,
    groupsSuppressed,
    args,
    returned,
  };
  entries.push(entry);
  emit();
  return entry;
}

function countCells(payload: unknown): number {
  if (Array.isArray(payload)) {
    return payload.reduce<number>((sum, row) => sum + (row && typeof row === 'object' ? Object.keys(row).length : 1), 0);
  }
  if (payload && typeof payload === 'object') return Object.keys(payload).length;
  return payload === undefined ? 0 : 1;
}

export function snapshot(): LedgerSnapshot {
  return {
    entries: [...entries],
    bytesIngested,
    rowsIngested,
    bytesReleased: entries.reduce((s, e) => s + e.bytesReleased, 0),
    cellsReleased: entries.reduce((s, e) => s + e.cellsReleased, 0),
    callsBlocked: entries.filter((e) => e.verdict === 'blocked').length,
    groupsSuppressed: entries.reduce((s, e) => s + e.groupsSuppressed, 0),
    budgetCells: BUDGET_CELLS,
  };
}

export function budgetRemaining(): number {
  return BUDGET_CELLS - snapshot().cellsReleased;
}

export function subscribe(fn: (s: LedgerSnapshot) => void): () => void {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

function emit(): void {
  const s = snapshot();
  for (const fn of listeners) fn(s);
}

export function reset(): void {
  entries.length = 0;
  nextId = 1;
  emit();
}

/**
 * The whole session as plain text: every call, and verbatim, everything that
 * went back. Meant to be read by a person who does not believe the summary —
 * search it for a name or an email address and see that there is nothing there.
 */
export function transcript(): string {
  const s = snapshot();
  const lines = [
    'BLINDFOLD DISCLOSURE TRANSCRIPT',
    `Generated ${new Date().toISOString()}`,
    '',
    `Bytes read into the page:      ${s.bytesIngested.toLocaleString()}`,
    `Rows read into the page:       ${s.rowsIngested.toLocaleString()}`,
    `Bytes released to the agent:   ${s.bytesReleased.toLocaleString()}`,
    `Raw rows released:             0`,
    `Values released:               ${s.cellsReleased} of ${s.budgetCells} budget`,
    `Calls refused:                 ${s.callsBlocked}`,
    `Groups suppressed as too small:${s.groupsSuppressed}`,
    '',
    'Below is every tool call in order, and character for character everything',
    'the agent received back. Nothing is summarised. Search it yourself.',
    '',
  ];
  for (const e of s.entries) {
    lines.push(
      '─'.repeat(72),
      `#${e.id}  ${new Date(e.at).toISOString()}  ${e.tool}  [${e.verdict}]`,
      `ASKED:    ${e.args || '(no arguments)'}`,
      'RECEIVED:',
      e.returned || '(nothing)',
      '',
    );
  }
  return lines.join('\n');
}
