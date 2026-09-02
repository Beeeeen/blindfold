/**
 * Confirms the CSV written by `npm run sample` behaves identically to the
 * dataset the in-app button generates: same classification, same headline
 * finding. If these ever diverge, the demo script's quoted figures are wrong.
 */
import puppeteer from 'puppeteer-core';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'https://beeeeen.github.io/blindfold/';
const FILE = join(process.cwd(), 'sample-data', 'employee_compensation_2026.csv');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-features=WebMCP'],
});

try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

  const call = (n, a) => page.evaluate((x, y) => window.blindfold.callTool(x, y), n, a);
  const settled = () =>
    page.waitForFunction(
      () => /\d+ rows/.test(document.querySelector('#dataset-meta')?.textContent ?? ''),
      { timeout: 180000 },
    );

  console.log(`\ndropping ${FILE}`);
  const input = await page.$('#file-input');
  await input.uploadFile(FILE);
  await settled();

  const meta = await page.$eval('#dataset-meta', (e) => e.textContent);
  check('50,000 rows, 11 columns', /50,000 rows · 11 columns/.test(meta), meta);
  check('three columns sealed', /3 columns sealed/.test(meta), meta);

  const cols = await page.evaluate(() => window.blindfold.columns());
  const tierOf = (n) => cols.find((c) => c.name === n)?.tier;
  check('employee_id / full_name / email all sealed',
    ['employee_id', 'full_name', 'email'].every((n) => tierOf(n) === 'identifier'));
  check('base_salary is personal', tierOf('base_salary') === 'sensitive', tierOf('base_salary'));
  check('level is groupable', tierOf('level') === 'quasi', tierOf('level'));

  // The finding the demo script quotes out loud.
  const gap = await call('compare_groups', {
    metric: 'base_salary', split_by: 'gender', group_a: 'F', group_b: 'M', within: 'level',
  });
  const rows = JSON.parse(gap.slice(gap.indexOf('[')));
  const pct = Object.fromEntries(rows.map((r) => [r.level, r.gap_pct]));
  console.log('       gap_pct by level:', JSON.stringify(pct));

  const junior = ['IC1', 'IC2', 'IC3'].map((l) => pct[l]).filter((v) => v != null);
  const senior = ['IC4', 'IC5', 'M1', 'M2'].map((l) => pct[l]).filter((v) => v != null);
  check('junior levels sit near -2%', junior.every((v) => v > -5), JSON.stringify(junior));
  check('senior levels sit near -13%', senior.every((v) => v < -9), JSON.stringify(senior));
  check('the gap widens with seniority',
    Math.min(...junior) > Math.max(...senior),
    `junior min ${Math.min(...junior)} vs senior max ${Math.max(...senior)}`);
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
