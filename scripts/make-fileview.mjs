/**
 * Builds a standalone page that shows the raw file, so the opening shot does
 * not need a spreadsheet application.
 *
 *   npm run fileview        # → docs/.assembly/fileview.html
 *
 * It renders real rows from sample-data, because the point of the shot is that
 * the viewer sees names, emails and salaries — the thing you would otherwise be
 * uploading. The app itself can never show this: it sealed those columns before
 * the agent was told they existed.
 */
import { writeFileSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const FILE = join(ROOT, 'sample-data', 'employee_compensation_2026.csv');
const OUT_DIR = join(ROOT, 'docs', '.fileview');
const OUT = join(OUT_DIR, 'fileview.html');
const ROWS = 400;

const size = statSync(FILE).size;
// Read only the head of the file; a 99 MB read for 400 rows would be silly.
const buf = Buffer.alloc(Math.min(size, 200_000));
const fd = openSync(FILE, 'r');
readSync(fd, buf, 0, buf.length, 0);
closeSync(fd);

const lines = buf.toString('utf8').split('\n').slice(0, ROWS + 1);
const header = lines[0].split(',');
const rows = lines.slice(1).filter(Boolean).map((l) => l.split(','));

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const totalRows = 1_000_000;
const mb = (size / 1024 / 1024).toFixed(1);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT,
  `<!doctype html><meta charset="utf-8"><title>employee_compensation_2026.csv</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f7f6f2;color:#14181a;
       font:13px/1.4 ui-sans-serif,system-ui,'Segoe UI',sans-serif}
  .bar{position:sticky;top:0;z-index:2;display:flex;gap:16px;align-items:baseline;
       padding:12px 18px;background:#fff;border-bottom:1px solid #d8d7cf}
  .bar strong{font-size:14px}
  .bar span{color:#5a6467;font-size:13px}
  table{border-collapse:collapse;width:100%;font-family:ui-monospace,Consolas,monospace;font-size:12px}
  th{position:sticky;top:45px;background:#eceee9;text-align:left;font-weight:600;
     padding:7px 10px;border:1px solid #d8d7cf;white-space:nowrap;color:#3d4548}
  td{padding:6px 10px;border:1px solid #e6e5de;background:#fff;white-space:nowrap}
  tr:nth-child(even) td{background:#fbfbf9}
  .n{color:#8a9296;text-align:right;background:#f2f1ec!important}
</style>
<div class="bar">
  <strong>employee_compensation_2026.csv</strong>
  <span>${totalRows.toLocaleString()} rows &middot; ${header.length} columns &middot; ${mb} MB</span>
</div>
<table>
  <thead><tr><th class="n"></th>${header.map((h) => `<th>${esc(h.trim())}</th>`).join('')}</tr></thead>
  <tbody>
    ${rows
      .map((r, i) => `<tr><td class="n">${i + 2}</td>${r.map((c) => `<td>${esc(c.trim())}</td>`).join('')}</tr>`)
      .join('\n    ')}
  </tbody>
</table>
`,
  'utf8',
);

console.log(`${OUT}\n${rows.length} rows rendered, header: ${header.length} columns`);
