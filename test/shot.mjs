import puppeteer from 'puppeteer-core';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1680, height: 1050, deviceScaleFactor: 2 },
});
const p = await b.newPage();
await p.goto('http://localhost:4173/', { waitUntil: 'networkidle2', timeout: 120000 });
// Shoot the screenshot against the big file when it exists, so the ledger in
// the README shows the numbers the README quotes.
const big = join(process.cwd(), 'sample-data', 'employee_compensation_2026.csv');
if (existsSync(big) && statSync(big).size > 50 * 1024 * 1024) {
  const input = await p.$('#file-input');
  await input.uploadFile(big);
} else {
  await p.click('#load-sample');
}
await p.waitForFunction(() => /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? ''), { timeout: 600000 });

const call = (n, a) => p.evaluate((x, y) => window.blindfold.callTool(x, y), n, a);

// Play the demo script the video will follow.
await call('describe_dataset', {});
const gap = await call('compare_groups', {
  metric: 'base_salary',
  split_by: 'gender',
  group_a: 'F',
  group_b: 'M',
  within: 'level',
});
await call('aggregate', { agg: 'max', metric: 'base_salary' });
await call('aggregate', { agg: 'count', group_by: ['full_name'] });

const rows = JSON.parse(gap.slice(gap.indexOf('[')));
await call('render_chart', {
  kind: 'bar',
  x: 'level',
  y: 'gap_pct',
  rows,
  title: 'Gender pay gap by level (%)',
  x_label: 'Job level',
  y_label: 'Gap vs male peers (%)',
  caption: 'The gap is negligible at junior levels and opens sharply from IC4 upward.',
});

const byDept = await call('aggregate', { agg: 'median', metric: 'base_salary', group_by: ['department'] });
await call('render_chart', {
  kind: 'bar',
  x: 'department',
  y: 'value',
  rows: JSON.parse(byDept.slice(byDept.indexOf('['))),
  title: 'Median base salary by department',
  x_label: 'Department',
  y_label: 'Median base salary (USD)',
});

// Expand a refusal so the screenshot shows the verbatim payload, and run the
// exfiltration probe so the seal panel is populated.
await p.evaluate(() => window.blindfold.testSeal());
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('#feed .feed-item')];
  const refusal = rows.find((r) => r.dataset.verdict === 'blocked');
  (refusal ?? rows[0])?.click();
});
await new Promise((r) => setTimeout(r, 1200));
await p.screenshot({ path: 'docs/screenshot.png', fullPage: false });
console.log('wrote docs/screenshot.png');
await b.close();
