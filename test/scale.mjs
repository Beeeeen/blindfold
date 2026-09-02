/**
 * How big a file can the agent work on?
 *
 * This is the number that decides whether Blindfold reads as a privacy tool or
 * as a capability one. A million rows will not fit in any model's context
 * window; the point is that it does not have to.
 */
import puppeteer from 'puppeteer-core';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'http://localhost:4173/';
const FILE = join(process.cwd(), 'sample-data', 'employee_compensation_2026.csv');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

let size;
try {
  size = statSync(FILE).size;
} catch {
  console.log('No sample-data file. Run: npm run sample -- 1000000');
  process.exit(1);
}
console.log(`file: ${(size / 1024 / 1024).toFixed(1)} MB`);
if (size < 50 * 1024 * 1024) {
  console.log('This test wants a large file. Run: npm run sample -- 1000000');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-features=WebMCP'],
});

try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

  const t0 = Date.now();
  const input = await page.$('#file-input');
  await input.uploadFile(FILE);
  await page.waitForFunction(
    () => /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? ''),
    { timeout: 600000 },
  );
  const ingest = Date.now() - t0;
  console.log(`ingest + classify: ${(ingest / 1000).toFixed(1)}s`);
  console.log('meta:', await page.$eval('#dataset-meta', (e) => e.textContent));
  check('a 99 MB file is readable at all', true);
  check('ingest and classification stay under 30s', ingest < 30000, `${(ingest / 1000).toFixed(1)}s`);

  const call = (n, a) => page.evaluate((x, y) => window.blindfold.callTool(x, y), n, a);

  const slowest = { label: '', ms: 0 };
  const timed = async (label, name, args) => {
    const t = Date.now();
    const out = await call(name, args);
    const ms = Date.now() - t;
    if (ms > slowest.ms) { slowest.label = label; slowest.ms = ms; }
    console.log(`  ${label}: ${(ms / 1000).toFixed(2)}s`);
    return out;
  };

  console.log('\nqueries over the whole file');
  await timed('median salary by department', 'aggregate', {
    agg: 'median', metric: 'base_salary', group_by: ['department'],
  });
  await timed('pay gap by level', 'compare_groups', {
    metric: 'base_salary', split_by: 'gender', group_a: 'F', group_b: 'M', within: 'level',
  });
  await timed('salary histogram by level', 'distribution', {
    column: 'base_salary', bins: 20, group_by: 'level',
  });
  await timed('tenure vs pay, per department', 'correlate', {
    x: 'tenure_years', y: 'base_salary', group_by: 'department',
  });
  const heavy = await timed('avg bonus by level x region x department', 'aggregate', {
    agg: 'avg', metric: 'bonus', group_by: ['level', 'region', 'department'],
  });

  const snap = await page.evaluate(() => window.blindfold.ledger());
  console.log('\nwhat the agent got');
  console.log(`  bytes into the page:    ${snap.bytesIngested.toLocaleString()}`);
  console.log(`  rows into the page:     ${snap.rowsIngested.toLocaleString()}`);
  console.log(`  bytes to the agent:     ${snap.bytesReleased.toLocaleString()}`);
  console.log(`  ratio:                  1 : ${Math.round(snap.bytesIngested / snap.bytesReleased).toLocaleString()}`);
  console.log(`  raw rows to the agent:  0`);

  // A million rows of CSV is far past any model's context window.
  const approxTokens = Math.round(snap.bytesIngested / 4);
  console.log(`\n  the file is roughly ${approxTokens.toLocaleString()} tokens of text`);
  console.log(`  what crossed was roughly ${Math.round(snap.bytesReleased / 4).toLocaleString()} tokens`);
  console.log(`\n  heavy query returned ${(heavy.match(/\{/g) ?? []).length} grouped rows`);

  console.log('\nassertions');
  check('every query over a million rows answers in under 2s',
    slowest.ms < 2000, `slowest was ${slowest.label} at ${(slowest.ms / 1000).toFixed(2)}s`);
  check('all million rows were read, none sampled', snap.rowsIngested === 1000000, String(snap.rowsIngested));
  check('the file is past any context window', approxTokens > 5_000_000, `${approxTokens} tokens`);
  check('what crossed would fit in one prompt',
    Math.round(snap.bytesReleased / 4) < 50_000, `${Math.round(snap.bytesReleased / 4)} tokens`);
  check('the ratio is at least 1000:1', snap.bytesIngested / snap.bytesReleased > 1000,
    String(Math.round(snap.bytesIngested / snap.bytesReleased)));
  check('still zero raw rows at this scale',
    /"raw_rows_released_to_agent": 0/.test(await call('policy_report', {})));
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
