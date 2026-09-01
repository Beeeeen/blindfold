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

export function record(
  tool: string,
  verdict: Verdict,
  detail: string,
  payload?: unknown,
  groupsSuppressed = 0,
): LedgerEntry {
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
