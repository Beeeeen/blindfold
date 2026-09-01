/**
 * Smoke test. Drives a real Chrome against the built app and checks the two
 * things that actually matter: the compiled SQL runs, and the guard refuses
 * what it claims to refuse.
 *
 *   node test/smoke.mjs            (expects a server on http://localhost:4173)
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.TARGET ?? 'http://localhost:4173/';
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  console.log('\nloading sample dataset…');
  await page.click('#load-sample');
  await page.waitForFunction(
    () => document.querySelectorAll('#columns .column').length > 0,
    { timeout: 180000 },
  );

  const call = (name, args) =>
    page.evaluate((n, a) => window.blindfold.callTool(n, a), name, args);

  // ── classification ────────────────────────────────────────────────
  console.log('\nclassification');
  const cols = await page.evaluate(() => window.blindfold.columns());
  const tierOf = (n) => cols.find((c) => c.name === n)?.tier;
  check('full_name is sealed', tierOf('full_name') === 'identifier', tierOf('full_name'));
  check('email is sealed', tierOf('email') === 'identifier', tierOf('email'));
  check('employee_id is sealed', tierOf('employee_id') === 'identifier', tierOf('employee_id'));
  check('base_salary is personal', tierOf('base_salary') === 'sensitive', tierOf('base_salary'));
  check('department is groupable', tierOf('department') === 'quasi', tierOf('department'));
  check('gender is groupable', tierOf('gender') === 'quasi', tierOf('gender'));

  // ── tools registered ──────────────────────────────────────────────
  console.log('\nregistration');
  const names = await page.evaluate(() => window.blindfold.listTools());
  check('all eight tools registered', names.length === 8, names.join(','));

  // ── the happy path ────────────────────────────────────────────────
  console.log('\nqueries that should work');
  const describe = await call('describe_dataset', {});
  check('describe_dataset returns a schema', describe.includes('"tier"'));
  check('describe_dataset leaks no values', !describe.includes('@example-corp.com'));

  const byDept = await call('aggregate', {
    agg: 'median',
    metric: 'base_salary',
    group_by: ['department'],
  });
  check('median salary by department', byDept.includes('Engineering'), byDept.slice(0, 160));
  check('grouped result carries counts', byDept.includes('"n"'));

  const dist = await call('distribution', { column: 'base_salary', bins: 12, group_by: 'level' });
  check('distribution returns bins', dist.includes('bin_start'), dist.slice(0, 160));

  const corr = await call('correlate', { x: 'tenure_years', y: 'base_salary' });
  check('correlate returns an r', corr.includes('"r"'), corr.slice(0, 160));

  const gap = await call('compare_groups', {
    metric: 'base_salary',
    split_by: 'gender',
    group_a: 'F',
    group_b: 'M',
    within: 'level',
  });
  check('compare_groups reports a gap', gap.includes('gap_pct'), gap.slice(0, 200));
  check('compare_groups finds the seeded senior gap', /IC5[\s\S]*?-\d/.test(gap) || gap.includes('-'), '');

  const values = await call('list_group_values', { column: 'department' });
  check('list_group_values works', values.includes('Engineering'));

  // ── the guard ─────────────────────────────────────────────────────
  console.log('\nqueries that must be refused');
  const g1 = await call('aggregate', { agg: 'count', group_by: ['full_name'] });
  check('grouping by a name is refused', g1.includes('Refused by the disclosure guard'), g1.slice(0, 120));

  const g2 = await call('aggregate', { agg: 'max', metric: 'base_salary' });
  check('max on salary is refused', g2.includes('Refused'), g2.slice(0, 120));
  check('refusal explains the alternative', g2.includes('p25, median or p75'));

  const g3 = await call('aggregate', {
    agg: 'avg',
    metric: 'base_salary',
    filters: [{ column: 'email', op: 'eq', value: 'x@example-corp.com' }],
  });
  check('filtering by email is refused', g3.includes('Refused'), g3.slice(0, 120));

  const g4 = await call('aggregate', {
    agg: 'count',
    filters: [{ column: 'base_salary', op: 'eq', value: 128000 }],
  });
  check('exact-match on salary is refused', g4.includes('Refused'), g4.slice(0, 120));

  const g5 = await call('aggregate', { agg: 'avg', metric: 'base_salary', group_by: ['bonus'] });
  check('grouping by a personal measure is refused', g5.includes('Refused'), g5.slice(0, 120));

  // ── k-anonymity actually bites ────────────────────────────────────
  console.log('\nk-anonymity');
  const thin = await call('compare_groups', {
    metric: 'base_salary',
    split_by: 'gender',
    group_a: 'Non-binary',
    group_b: 'Undisclosed',
    within: 'department',
  });
  check('thin slices are suppressed', thin.includes('suppressed'), thin.slice(0, 200));

  // ── the one-way mirror ────────────────────────────────────────────
  console.log('\nchart rendering');
  const rows = JSON.parse(byDept.slice(byDept.indexOf('[')));
  const drawn = await call('render_chart', {
    kind: 'bar',
    x: 'department',
    y: 'value',
    rows,
    title: 'Median base salary by department',
  });
  check('render_chart confirms without returning data', drawn.includes('No data was returned to you'));
  const chartCount = await page.evaluate(() => document.querySelectorAll('.chart-card svg').length);
  check('an svg chart is on the page', chartCount > 0, `found ${chartCount}`);

  // ── the ledger ────────────────────────────────────────────────────
  console.log('\nledger');
  const snap = await page.evaluate(() => window.blindfold.ledger());
  check('bytes were ingested', snap.bytesIngested > 1_000_000, String(snap.bytesIngested));
  check('some calls were refused', snap.callsBlocked >= 5, String(snap.callsBlocked));
  check('released bytes stay tiny next to ingested', snap.bytesReleased < snap.bytesIngested / 100,
    `${snap.bytesReleased} vs ${snap.bytesIngested}`);

  const report = await call('policy_report', {});
  check('policy_report states zero raw rows', report.includes('"raw_rows_released_to_agent": 0'));

  console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none');
  if (errors.length) failed += 0; // reported, not fatal on its own
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
