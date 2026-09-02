/**
 * Records the demo as one clip per narration beat, each held for exactly as
 * long as its voice clip runs.
 *
 *   npm run sample -- 1000000
 *   npm run voice            # writes voice/durations.json
 *   npm run record           # → docs/broll/02-load.webm, 03-grading.webm, …
 *
 * Editing then has no timing work in it: clip N goes under narration N.
 *
 * The tool calls run through the browser's real WebMCP API, so the execution is
 * genuine — but a script picks the calls, not a model. Beats 1, 4 and 5 are
 * deliberately absent: the spreadsheet, the tool list and the ChatGPT
 * conversation are yours to shoot, and the agent's reasoning is the part worth
 * showing for real.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, statSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'http://localhost:4173/';
const FILE = join(process.cwd(), 'sample-data', 'employee_compensation_2026.csv');
const OUT_DIR = join(process.cwd(), 'docs', 'broll');

if (!existsSync(FILE) || statSync(FILE).size < 50 * 1024 * 1024) {
  console.error('Need the big sample first:  npm run sample -- 1000000');
  process.exit(1);
}
let durations = {};
try {
  durations = JSON.parse(readFileSync(join(process.cwd(), 'voice', 'durations.json'), 'utf8'));
} catch {
  console.error('Run `npm run voice` first so the clips can match the narration.');
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

const beat = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false, // screencast needs a real window
  args: ['--no-sandbox', '--enable-features=WebMCP', '--window-size=1620,1020', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 }, // 16:9
});

try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

  // A visible pointer, so a viewer can follow what is being clicked.
  await page.evaluate(() => {
    const dot = document.createElement('div');
    dot.id = '__cursor';
    dot.style.cssText = [
      'position:fixed', 'z-index:99999', 'width:22px', 'height:22px',
      'margin:-11px 0 0 -11px', 'border-radius:50%',
      'background:rgba(31,111,74,.28)', 'border:2px solid #1f6f4a',
      'pointer-events:none', 'transition:all .5s cubic-bezier(.4,0,.2,1)',
      'opacity:0', 'left:50%', 'top:50%',
    ].join(';');
    document.body.appendChild(dot);
    window.__point = (x, y, show = true) => {
      const d = document.getElementById('__cursor');
      d.style.opacity = show ? '1' : '0';
      d.style.left = `${x}px`;
      d.style.top = `${y}px`;
    };
    window.__press = () => {
      const d = document.getElementById('__cursor');
      d.style.transform = 'scale(.6)';
      setTimeout(() => (d.style.transform = 'scale(1)'), 200);
    };
  });

  const pointAt = async (selector) => {
    const box = await page.$eval(selector, (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.evaluate((x, y) => window.__point(x, y), box.x, box.y);
    await beat(650);
    await page.evaluate(() => window.__press());
  };
  const hidePointer = () => page.evaluate(() => window.__point(0, 0, false));
  const call = (n, a) => page.evaluate((x, y) => window.blindfold.callTool(x, y), n, a);

  /**
   * Runs `action`, then pads until the clip has lasted the whole narration
   * line. If the action overruns, that is reported rather than silently
   * producing a clip too short to sit under its voiceover.
   */
  async function clip(id, action) {
    const target = durations[id];
    if (!target) throw new Error(`no measured duration for ${id}`);
    const out = join(OUT_DIR, `${id}.webm`);
    const started = Date.now();
    const recorder = await page.screencast({ path: out });
    await action();
    const used = Date.now() - started;
    const pad = Math.round(target * 1000) - used;
    if (pad > 0) await beat(pad);
    await recorder.stop();
    const actual = (Date.now() - started) / 1000;
    const flag = pad < 0 ? `  OVER by ${(-pad / 1000).toFixed(1)}s` : '';
    console.log(`  ${id.padEnd(14)} ${actual.toFixed(1)}s / ${target.toFixed(1)}s${flag}`);
  }

  console.log('recording clips →', OUT_DIR);

  // ── 02 · the file lands ──────────────────────────────────────────
  await clip('02-load', async () => {
    await beat(500);
    const input = await page.$('#file-input');
    await input.uploadFile(FILE);
    await page.waitForFunction(
      () => /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? ''),
      { timeout: 600000 },
    );
  });

  // ── 03 · the grading ─────────────────────────────────────────────
  await clip('03-grading', async () => {
    await beat(1200);
    for (const n of [1, 2, 3]) {
      await pointAt(`#columns .column:nth-child(${n}) .tier`); // the sealed three
      await beat(1900);
    }
    await pointAt('#columns .column:nth-child(4) .tier'); // a category one
    await beat(1400);
    await hidePointer();
  });

  // Charts have to exist before the later beats, but the agent doing this is
  // the viewer's own ChatGPT footage — so run it off camera.
  const gap = await call('compare_groups', {
    metric: 'base_salary', split_by: 'gender', group_a: 'F', group_b: 'M', within: 'level',
  });
  await call('render_chart', {
    kind: 'bar', x: 'level', y: 'gap_pct',
    rows: JSON.parse(gap.slice(gap.indexOf('['))),
    title: 'Gender pay gap by level (%)',
    x_label: 'Job level', y_label: 'Gap vs male peers (%)',
    caption: 'Around 3% at IC1–IC3, then 12–14% from IC4 upward.',
  });
  const dept = await call('aggregate', { agg: 'median', metric: 'base_salary', group_by: ['department'] });
  await call('render_chart', {
    kind: 'bar', x: 'department', y: 'value',
    rows: JSON.parse(dept.slice(dept.indexOf('['))),
    title: 'Median base salary by department',
    x_label: 'Department', y_label: 'Median base salary (USD)',
  });

  // ── 06 · it refuses ──────────────────────────────────────────────
  await clip('06-refusals', async () => {
    await page.evaluate(() => document.querySelector('.feed-wrap')?.scrollIntoView({ block: 'center' }));
    await beat(1400);
    await call('aggregate', { agg: 'count', group_by: ['full_name'] });
    await beat(4200);
    await call('aggregate', { agg: 'max', metric: 'base_salary' });
    await beat(4200);
    await pointAt('#feed .feed-item:nth-child(1) .feed-detail');
    await beat(2600);
    await hidePointer();
  });

  // ── 07 · the seal ────────────────────────────────────────────────
  await clip('07-seal', async () => {
    await page.evaluate(() => document.querySelector('#seal')?.scrollIntoView({ block: 'center' }));
    await beat(2400);
    await pointAt('#seal-test');
    await page.click('#seal-test');
    await page.waitForFunction(() => document.querySelectorAll('#seal-results li').length >= 5, { timeout: 30000 });
    await beat(3000);
    await hidePointer();
    await pointAt('.seal-verify');
    await beat(2000);
    await hidePointer();
  });

  // ── 08 · the verbatim payload ────────────────────────────────────
  await clip('08-verbatim', async () => {
    await page.evaluate(() => document.querySelector('.feed-wrap')?.scrollIntoView({ block: 'center' }));
    await beat(700);
    await pointAt('#feed .feed-item:nth-child(3)');
    await page.evaluate(() => document.querySelectorAll('#feed .feed-item')[2]?.click());
    await beat(600);
    await hidePointer();
  });

  // ── 09 · rest on the receipt ─────────────────────────────────────
  await clip('09-close', async () => {
    await page.evaluate(() => document.querySelector('.panel-ledger')?.scrollIntoView({ block: 'start' }));
  });

  const snap = await page.evaluate(() => window.blindfold.ledger());
  console.log(`\nledger: ${snap.bytesIngested.toLocaleString()} B in, ${snap.bytesReleased.toLocaleString()} B out`);
} finally {
  await browser.close();
}
