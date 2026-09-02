/**
 * Records the demo as B-roll: every beat hit on time, nothing fumbled.
 *
 *   npm run sample -- 1000000
 *   npm run record
 *
 * The tool calls go through the browser's own WebMCP API, so what you see is
 * genuine WebMCP execution — but a script picks the calls, not a model. Cut
 * your ChatGPT footage over the beats where the agent's reasoning is the point,
 * and use this for the beats where the app is.
 *
 * Output: docs/demo-raw.webm
 */
import puppeteer from 'puppeteer-core';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'http://localhost:4173/';
const FILE = join(process.cwd(), 'sample-data', 'employee_compensation_2026.csv');
const OUT = join(process.cwd(), 'docs', 'demo-raw.webm');

if (!existsSync(FILE) || statSync(FILE).size < 50 * 1024 * 1024) {
  console.error('Need the big sample first:  npm run sample -- 1000000');
  process.exit(1);
}
mkdirSync(join(process.cwd(), 'docs'), { recursive: true });

const beat = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false, // screencast needs a real window
  // 1500 keeps the three-column layout but fills the frame, so the ledger
  // numbers are legible at 1080p instead of floating in whitespace.
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
      'pointer-events:none', 'transition:all .45s cubic-bezier(.4,0,.2,1)',
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
      setTimeout(() => (d.style.transform = 'scale(1)'), 180);
    };
  });

  const pointAt = async (selector) => {
    const box = await page.$eval(selector, (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.evaluate((x, y) => window.__point(x, y), box.x, box.y);
    await beat(600);
    await page.evaluate(() => window.__press());
    await beat(220);
  };

  const call = (n, a) => page.evaluate((x, y) => window.blindfold.callTool(x, y), n, a);

  console.log('recording →', OUT);
  const recorder = await page.screencast({ path: OUT });

  // ── 1. the file lands ────────────────────────────────────────────
  await beat(1400);
  const input = await page.$('#file-input');
  await input.uploadFile(FILE);
  await page.waitForFunction(
    () => /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? ''),
    { timeout: 600000 },
  );
  await beat(3200); // hold on "1,000,000 rows · 98.9 MB"

  // ── 2. the grading ───────────────────────────────────────────────
  await pointAt('#columns .column:nth-child(2) .tier'); // full_name → sealed
  await beat(1500);
  await pointAt('#columns .column:nth-child(3) .tier'); // email → sealed
  await beat(1800);

  // ── 3. the seal ──────────────────────────────────────────────────
  await page.evaluate(() => document.querySelector('#seal')?.scrollIntoView({ block: 'center' }));
  await beat(900);
  await pointAt('#seal-test');
  await page.click('#seal-test');
  await page.waitForFunction(() => document.querySelectorAll('#seal-results li').length >= 5, { timeout: 30000 });
  await beat(3800); // hold on five refusals

  // ── 4. real work, paced like an agent thinking ───────────────────
  await page.evaluate(() => window.__point(0, 0, false));
  await call('describe_dataset', {});
  await beat(1100);
  const gap = await call('compare_groups', {
    metric: 'base_salary', split_by: 'gender', group_a: 'F', group_b: 'M', within: 'level',
  });
  await beat(1100);
  await call('render_chart', {
    kind: 'bar', x: 'level', y: 'gap_pct',
    rows: JSON.parse(gap.slice(gap.indexOf('['))),
    title: 'Gender pay gap by level (%)',
    x_label: 'Job level', y_label: 'Gap vs male peers (%)',
    caption: 'Around 3% at IC1–IC3, then 12–14% from IC4 upward.',
  });
  await beat(2400);

  const dept = await call('aggregate', { agg: 'median', metric: 'base_salary', group_by: ['department'] });
  await beat(900);
  await call('render_chart', {
    kind: 'bar', x: 'department', y: 'value',
    rows: JSON.parse(dept.slice(dept.indexOf('['))),
    title: 'Median base salary by department',
    x_label: 'Department', y_label: 'Median base salary (USD)',
  });
  await beat(2400);

  // ── 5. it refuses ────────────────────────────────────────────────
  await call('aggregate', { agg: 'max', metric: 'base_salary' });
  await beat(1300);
  await call('aggregate', { agg: 'count', group_by: ['full_name'] });
  await beat(1800);

  // ── 6. the verbatim payload ──────────────────────────────────────
  await page.evaluate(() => document.querySelector('#feed')?.scrollIntoView({ block: 'center' }));
  await beat(800);
  await pointAt('#feed .feed-item:nth-child(2)');
  await page.evaluate(() => document.querySelectorAll('#feed .feed-item')[1]?.click());
  await beat(4200); // let the reader see there is no name in it

  // ── 7. rest on the receipt ───────────────────────────────────────
  await page.evaluate(() => window.__point(0, 0, false));
  await page.evaluate(() => document.querySelector('.panel-ledger')?.scrollIntoView({ block: 'start' }));
  await beat(4200);

  await recorder.stop();
  console.log('done');

  const snap = await page.evaluate(() => window.blindfold.ledger());
  console.log(`ledger: ${snap.bytesIngested.toLocaleString()} B in, ${snap.bytesReleased.toLocaleString()} B out`);
} finally {
  await browser.close();
}
