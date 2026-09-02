import './styles.css';
import { initDb, loadFile, type DatasetInfo } from './db';
import { classifyDataset, type ClassifiedColumn, type Tier } from './classify';
import type { GuardContext } from './guard';
import * as ledger from './ledger';
import * as tools from './tools';
import { mountCharts, clearCharts } from './chart';
import { sampleFile } from './sample';
import * as seal from './seal';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

const el = {
  status: $('#mcp-status'),
  statusText: $('#mcp-status .status-text'),
  dropzone: $('#dropzone'),
  fileInput: $<HTMLInputElement>('#file-input'),
  pickFile: $('#pick-file'),
  loadSample: $<HTMLButtonElement>('#load-sample'),
  changeFile: $('#change-file'),
  dataset: $('#dataset'),
  datasetName: $('#dataset-name'),
  datasetMeta: $('#dataset-meta'),
  columns: $('#columns'),
  charts: $('#charts'),
  feed: $('#feed'),
  rowsReleased: $('#rows-released'),
  bytesIn: $('#bytes-in'),
  bytesOut: $('#bytes-out'),
  callsBlocked: $('#calls-blocked'),
  groupsSuppressed: $('#groups-suppressed'),
  budgetText: $('#budget-text'),
  budgetFill: $('#budget-fill'),
  runnerTool: $<HTMLSelectElement>('#runner-tool'),
  runnerArgs: $<HTMLTextAreaElement>('#runner-args'),
  runnerGo: $<HTMLButtonElement>('#runner-go'),
  runnerOut: $<HTMLPreElement>('#runner-out'),
  seal: $('#seal'),
  sealTitle: $('#seal-title'),
  sealSub: $('#seal-sub'),
  sealTest: $<HTMLButtonElement>('#seal-test'),
  sealResults: $('#seal-results'),
  transcriptCopy: $<HTMLButtonElement>('#transcript-copy'),
};

let info: DatasetInfo | null = null;
let columns: ClassifiedColumn[] = [];

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ── WebMCP status ──────────────────────────────────────────────────── */

function paintStatus(toolCount = 0): void {
  if (!tools.isSupported()) {
    el.status.dataset.state = 'absent';
    el.statusText.textContent = 'No WebMCP host — open in ChatGPT, or enable chrome://flags#enable-webmcp-testing';
    el.status.title =
      'This page still works: use the "Run a tool without an agent" panel to exercise the same tools by hand.';
    return;
  }
  el.status.dataset.state = 'ready';
  el.statusText.textContent = toolCount
    ? `WebMCP connected — ${toolCount} tools offered`
    : 'WebMCP connected — load data to offer tools';
}

/* ── Columns ────────────────────────────────────────────────────────── */

const TIER_LABEL: Record<Tier, string> = {
  identifier: 'sealed',
  sensitive: 'personal',
  quasi: 'category',
  safe: 'safe',
};
const TIER_ORDER: Tier[] = ['identifier', 'sensitive', 'quasi', 'safe'];

function renderColumns(): void {
  el.columns.replaceChildren();
  for (const col of columns) {
    const li = document.createElement('li');
    li.className = 'column';

    const name = document.createElement('span');
    name.className = 'column-name';
    name.textContent = col.name;

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = `tier tier-${col.tier}`;
    badge.textContent = TIER_LABEL[col.tier];
    badge.title = 'Click to reclassify. The agent is re-offered tools immediately.';
    badge.addEventListener('click', () => {
      const next = TIER_ORDER[(TIER_ORDER.indexOf(col.tier) + 1) % TIER_ORDER.length];
      col.tier = next;
      col.overridden = true;
      col.reason = 'set by you';
      renderColumns();
      void offerTools();
    });

    const why = document.createElement('p');
    why.className = 'column-why';
    why.textContent = `${col.type} · ${col.distinctCount.toLocaleString()} distinct · ${col.reason}`;

    li.append(name, badge, why);
    el.columns.append(li);
  }
}

/* ── Ledger ─────────────────────────────────────────────────────────── */

/** Which feed rows are showing their verbatim payload. */
const expanded = new Set<number>();

ledger.subscribe((s) => {
  el.rowsReleased.textContent = '0';
  el.bytesIn.textContent = bytes(s.bytesIngested);
  el.bytesOut.textContent = bytes(s.bytesReleased);
  el.callsBlocked.textContent = String(s.callsBlocked);
  el.groupsSuppressed.textContent = String(s.groupsSuppressed);

  const pct = Math.min(100, (s.cellsReleased / s.budgetCells) * 100);
  el.budgetText.textContent = `${s.cellsReleased} / ${s.budgetCells}`;
  el.budgetFill.style.width = `${pct}%`;
  el.budgetFill.classList.toggle('is-high', pct >= 60 && pct < 100);
  el.budgetFill.classList.toggle('is-full', pct >= 100);

  renderFeed(s.entries);
});

/* ── Activity feed ──────────────────────────────────────────────────── */

/**
 * Rendered from the ledger rather than from live events, so what is on screen
 * is the same record the transcript exports. A feed that could drift from the
 * ledger would undermine the only thing this panel is for.
 */
function renderFeed(entries: ledger.LedgerEntry[]): void {
  if (!entries.length) {
    el.feed.replaceChildren(
      Object.assign(document.createElement('li'), { className: 'feed-empty', textContent: 'No tool calls yet.' }),
    );
    return;
  }

  const items = [...entries].reverse().map((e) => {
    const li = document.createElement('li');
    li.className = 'feed-item';
    li.dataset.verdict = e.verdict;
    li.tabIndex = 0;
    li.title = 'Click to see exactly what the agent received';

    const tool = document.createElement('span');
    tool.className = 'feed-tool';
    tool.textContent = e.tool;

    const time = document.createElement('span');
    time.className = 'feed-time';
    time.textContent = new Date(e.at).toLocaleTimeString();

    const args = document.createElement('p');
    args.className = 'feed-args';
    args.textContent = e.args && e.args !== '{}' ? e.args : '(no arguments)';

    const note = document.createElement('p');
    note.className = 'feed-detail';
    note.textContent = e.detail;

    li.append(tool, time, args, note);

    if (expanded.has(e.id)) {
      const label = document.createElement('p');
      label.className = 'feed-returned-label';
      label.textContent = `Received by the agent — ${e.bytesReleased} bytes`;
      const pre = document.createElement('pre');
      pre.className = 'feed-returned';
      pre.textContent = e.returned || '(nothing)';
      li.append(label, pre);
    }

    const toggle = () => {
      if (expanded.has(e.id)) expanded.delete(e.id);
      else expanded.add(e.id);
      renderFeed(ledger.snapshot().entries);
    };
    li.addEventListener('click', toggle);
    li.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') {
        ev.preventDefault();
        toggle();
      }
    });
    return li;
  });

  el.feed.replaceChildren(...items);
}

el.transcriptCopy.addEventListener('click', async () => {
  const text = ledger.transcript();
  try {
    await navigator.clipboard.writeText(text);
    el.transcriptCopy.textContent = 'Copied';
  } catch {
    // Clipboard permission can be refused; showing it is still better than nothing.
    el.runnerOut.hidden = false;
    el.runnerOut.textContent = text;
    el.transcriptCopy.textContent = 'Shown below';
  }
  setTimeout(() => {
    el.transcriptCopy.textContent = 'Copy full transcript';
  }, 2000);
});

/* ── The seal ───────────────────────────────────────────────────────── */

seal.subscribe((s) => {
  el.seal.dataset.sealed = String(s.sealed);
  el.sealTest.disabled = !s.sealed;
  if (!s.sealed) return;
  el.sealTitle.textContent = 'Page sealed';
  el.sealSub.textContent =
    s.violations > 0
      ? `The browser has refused ${s.violations} outbound request${s.violations === 1 ? '' : 's'} from this tab.`
      : 'The browser is now refusing every outbound request from this tab — fetch, XHR, WebSocket, beacons, pixels.';
});

el.sealTest.addEventListener('click', async () => {
  el.sealTest.disabled = true;
  el.sealTest.textContent = 'Trying…';
  const results = await seal.testSeal();
  el.sealResults.hidden = false;
  el.sealResults.replaceChildren(
    ...results.map((r) => {
      const li = document.createElement('li');
      li.dataset.blocked = String(r.blocked);
      li.textContent = `${r.channel} — ${r.blocked ? 'refused' : r.detail}`;
      return li;
    }),
  );
  el.sealTest.disabled = false;
  el.sealTest.textContent = 'Try again';
});

/* ── Tool offering ──────────────────────────────────────────────────── */

async function offerTools(): Promise<void> {
  if (!info) return;
  const ctx: GuardContext = { table: info.table, columns, rowCount: info.rowCount };
  let names: string[];
  try {
    names = await tools.registerTools({ ctx, fileName: info.fileName });
  } catch (err) {
    // A half-registered toolset is worse than a visibly broken one: the agent
    // would be offered stale tools describing a file that is no longer loaded.
    el.status.dataset.state = 'absent';
    el.statusText.textContent = `Tool registration failed — ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  paintStatus(names.length);

  el.runnerTool.replaceChildren();
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    el.runnerTool.append(opt);
  }
}

/* ── Loading ────────────────────────────────────────────────────────── */

async function ingest(file: File): Promise<void> {
  el.loadSample.disabled = true;
  el.datasetMeta.textContent = 'Reading into this tab…';
  el.dataset.hidden = false;
  el.dropzone.hidden = true;
  el.datasetName.textContent = file.name;

  // Tear the previous file down before touching the new one. If this load fails
  // or stalls, the worst case must be an empty workbench — never one still
  // showing the last file's columns while offering an agent tools that describe
  // data no longer in the page.
  info = null;
  columns = [];
  renderColumns();
  clearCharts();
  ledger.reset();
  el.runnerTool.replaceChildren();
  await tools.withdrawAll();
  paintStatus();

  try {
    await initDb();
    // Once the engine is up, nothing this app does ever needs the network
    // again -- so take it away, and let the browser be the one enforcing it.
    seal.seal();
    info = await loadFile(file);
    columns = classifyDataset(info);

    ledger.noteIngest(info.byteSize, info.rowCount);

    const sealed = columns.filter((c) => c.tier === 'identifier').length;
    el.datasetMeta.textContent =
      `${info.rowCount.toLocaleString()} rows · ${info.columns.length} columns · ${bytes(info.byteSize)} ` +
      `· ${sealed} column${sealed === 1 ? '' : 's'} sealed`;

    renderColumns();
    await offerTools();
  } catch (err) {
    el.datasetMeta.textContent = `Could not read that file: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    el.loadSample.disabled = false;
  }
}

/* ── Wiring ─────────────────────────────────────────────────────────── */

el.pickFile.addEventListener('click', (e) => {
  e.stopPropagation();
  el.fileInput.click();
});
el.dropzone.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') el.fileInput.click();
});
el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files?.[0];
  if (file) void ingest(file);
});

el.loadSample.addEventListener('click', (e) => {
  e.stopPropagation();
  el.loadSample.disabled = true;
  el.loadSample.textContent = 'Generating…';
  // Yield a frame so the button state paints before the generator blocks.
  setTimeout(() => {
    void ingest(sampleFile({ rows: 50000 })).finally(() => {
      el.loadSample.textContent = 'Use sample payroll';
    });
  }, 16);
});

el.changeFile.addEventListener('click', () => {
  el.dataset.hidden = true;
  el.dropzone.hidden = false;
});

for (const type of ['dragenter', 'dragover'] as const) {
  el.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    el.dropzone.classList.add('is-over');
  });
}
for (const type of ['dragleave', 'drop'] as const) {
  el.dropzone.addEventListener(type, () => el.dropzone.classList.remove('is-over'));
}
el.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file) void ingest(file);
});

el.runnerGo.addEventListener('click', async () => {
  const name = el.runnerTool.value;
  if (!name) return;
  el.runnerOut.hidden = false;
  el.runnerOut.textContent = 'Running…';
  try {
    const args = JSON.parse(el.runnerArgs.value || '{}');
    el.runnerOut.textContent = await tools.callTool(name, args);
  } catch (err) {
    el.runnerOut.textContent = `Could not run: ${err instanceof Error ? err.message : String(err)}`;
  }
});

el.runnerTool.addEventListener('change', () => {
  const schema = tools.toolSchema(el.runnerTool.value) as
    | { properties?: Record<string, unknown>; required?: string[] }
    | null;
  const required = schema?.required ?? [];
  const stub: Record<string, unknown> = {};
  for (const key of required) stub[key] = '';
  el.runnerArgs.value = JSON.stringify(stub, null, 2);
});

mountCharts(el.charts);
paintStatus();
void initDb();

/**
 * The same entry point the host uses, reachable from the console. Handy for
 * poking at the guard yourself, and it is what the smoke test drives.
 */
Object.defineProperty(window, 'blindfold', {
  value: {
    callTool: tools.callTool,
    listTools: tools.registeredTools,
    ledger: ledger.snapshot,
    transcript: ledger.transcript,
    testSeal: seal.testSeal,
    seal: seal.state,
    columns: () => columns.map((c) => ({ name: c.name, tier: c.tier, type: c.type, sqlType: c.sqlType })),
  },
  writable: false,
});
