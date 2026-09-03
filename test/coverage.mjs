/**
 * Covers the paths the smoke test never touches: the other chart kinds, the
 * remaining refusal branches, the sort options, and — the one that actually
 * worried me — loading a file the user supplies rather than the generated
 * sample, in each format the README claims to accept.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'http://localhost:4173/';
const FIXTURES = join(process.cwd(), 'test', 'fixtures');

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

// ── fixtures a user might actually drop in ──────────────────────────
mkdirSync(FIXTURES, { recursive: true });

const people = [];
for (let i = 0; i < 400; i++) {
  people.push({
    patient_id: `P${1000 + i}`,
    full_name: `Person ${i}`,
    clinic: ['North', 'South', 'East', 'West'][i % 4],
    age_band: ['18-29', '30-44', '45-64', '65+'][i % 4],
    visits: (i % 9) + 1,
    cost: 100 + (i % 50) * 17,
  });
}
const header = Object.keys(people[0]).join(',');
writeFileSync(join(FIXTURES, 'clinic.csv'), [header, ...people.map((p) => Object.values(p).join(','))].join('\n'));
writeFileSync(join(FIXTURES, 'clinic.json'), JSON.stringify(people));
// A CSV with the awkward bits: quoted commas, an embedded quote, a blank value.
writeFileSync(
  join(FIXTURES, 'messy.csv'),
  ['name,dept,note,pay', '"Doe, Jane",Sales,"she said ""hi""",50000', 'Bob,Sales,,51000', 'Ann,Ops,,52000'].join('\n'),
);

// Parquet is in the README's accepted-formats list, so it needs a real
// Parquet file to be tested against, not a claim.
{
  // DuckDB's SQL string literals treat backslashes literally; forward slashes
  // work on Windows and avoid escaping the path into nonsense.
  const slash = (s) => s.split('\\').join('/');
  const out = slash(join(FIXTURES, 'clinic.parquet'));
  const csv = slash(join(FIXTURES, 'clinic.csv'));
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  await conn.run(`COPY (SELECT * FROM read_csv_auto('${csv}')) TO '${out}' (FORMAT PARQUET)`);
  conn.closeSync();
  console.log(existsSync(out) ? 'fixture: clinic.parquet written' : 'fixture: PARQUET WRITE FAILED');
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-features=WebMCP'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

  const call = (n, a) => page.evaluate((x, y) => window.blindfold.callTool(x, y), n, a);
  const columnsNow = () => page.evaluate(() => window.blindfold.columns());
  const chartCount = () => page.evaluate(() => document.querySelectorAll('.chart-card').length);
  const meta = () => page.$eval('#dataset-meta', (e) => e.textContent);

  async function settled(name) {
    await page.waitForFunction(
      (n) => {
        const nm = document.querySelector('#dataset-name')?.textContent ?? '';
        const t = document.querySelector('#dataset-meta')?.textContent ?? '';
        return nm === n && (/\d+ rows/.test(t) || /Could not read/.test(t));
      },
      { timeout: 180000 },
      name,
    );
  }

  async function loadSample() {
    await page.evaluate(() => {
      const d = document.querySelector('#dataset');
      if (!d.hidden) document.querySelector('#change-file').click();
    });
    await page.click('#load-sample');
    await settled('employee_compensation_2026.csv');
  }

  function rowsOf(text) {
    const i = text.indexOf('[');
    if (i < 0) throw new Error('tool returned no rows: ' + text.slice(0, 200));
    return JSON.parse(text.slice(i));
  }

  async function loadFixture(file) {
    await page.evaluate(() => {
      const d = document.querySelector('#dataset');
      if (!d.hidden) document.querySelector('#change-file').click();
    });
    const input = await page.$('#file-input');
    await input.uploadFile(join(FIXTURES, file));
    await settled(file);
  }

  // ── user-supplied files, per format ───────────────────────────────
  console.log('\nuser-supplied CSV');
  await loadFixture('clinic.csv');
  check('csv loads', /400 rows/.test(await meta()), await meta());
  let cols = await columnsNow();
  check('patient_id sealed', cols.find((c) => c.name === 'patient_id')?.tier === 'identifier');
  check('full_name sealed', cols.find((c) => c.name === 'full_name')?.tier === 'identifier');
  check('clinic groupable', cols.find((c) => c.name === 'clinic')?.tier === 'quasi');
  const csvAgg = await call('aggregate', { agg: 'avg', metric: 'cost', group_by: ['clinic'] });
  check('aggregate works on it', /North/.test(csvAgg), csvAgg.slice(0, 140));

  console.log('\nmessy CSV (quoted commas, escaped quotes, blank cell)');
  await loadFixture('messy.csv');
  check('messy csv parses to 3 rows', /3 rows/.test(await meta()), await meta());
  cols = await columnsNow();
  check('name column sealed', cols.find((c) => c.name === 'name')?.tier === 'identifier');
  const messy = await call('aggregate', { agg: 'count', group_by: ['dept'] });
  check('k-anonymity suppresses a 3-row file entirely', /suppressed/.test(messy) && /\[\s*\]/.test(messy),
    messy.slice(0, 160));

  console.log('\nuser-supplied Parquet');
  await loadFixture('clinic.parquet');
  check('parquet loads', /400 rows/.test(await meta()), await meta());
  const pqCols = await columnsNow();
  check('parquet types survive the round trip', pqCols.find((c) => c.name === 'cost')?.type === 'number',
    pqCols.find((c) => c.name === 'cost')?.type);
  const pqAgg = await call('aggregate', { agg: 'sum', metric: 'cost', group_by: ['clinic'] });
  check('aggregate works on parquet', /North/.test(pqAgg), pqAgg.slice(0, 140));

  console.log('\nuser-supplied JSON');
  await loadFixture('clinic.json');
  check('json loads', /400 rows/.test(await meta()), await meta());
  const jsonAgg = await call('aggregate', { agg: 'median', metric: 'visits', group_by: ['age_band'] });
  check('aggregate works on json', /18-29/.test(jsonAgg), jsonAgg.slice(0, 140));

  // ── back to the sample for the rest ───────────────────────────────
  console.log('\nsort options');
  await loadSample();

  const asc = await call('aggregate', { agg: 'median', metric: 'base_salary', group_by: ['department'], sort: 'value_asc' });
  const ascRows = rowsOf(asc);
  check('value_asc sorts ascending', ascRows[0].value <= ascRows[ascRows.length - 1].value,
    `${ascRows[0]?.value} .. ${ascRows[ascRows.length - 1]?.value}`);

  const galpha = await call('aggregate', { agg: 'count', group_by: ['department'], sort: 'group_asc' });
  const gRows = rowsOf(galpha);
  check('group_asc sorts by group name', gRows[0].department < gRows[gRows.length - 1].department,
    `${gRows[0]?.department} .. ${gRows[gRows.length - 1]?.department}`);

  console.log('\nremaining refusal branches');
  const r1 = await call('list_group_values', { column: 'email' });
  check('list_group_values on sealed refused', /Refused/.test(r1), r1.slice(0, 120));
  const r2 = await call('distribution', { column: 'department' });
  check('distribution on non-numeric refused', /not numeric/.test(r2), r2.slice(0, 120));
  const r3 = await call('distribution', { column: 'full_name' });
  check('distribution on sealed refused', /sealed/.test(r3), r3.slice(0, 120));
  const r4 = await call('correlate', { x: 'department', y: 'base_salary' });
  check('correlate on non-numeric refused', /not numeric/.test(r4), r4.slice(0, 120));
  const r5 = await call('compare_groups', { metric: 'email', split_by: 'gender', group_a: 'F', group_b: 'M' });
  check('compare_groups on sealed metric refused', /Refused/.test(r5), r5.slice(0, 120));
  const r6 = await call('aggregate', { agg: 'avg', metric: 'nonexistent_column' });
  check('unknown column gives a usable error', /No column named/.test(r6), r6.slice(0, 120));

  console.log('\nrefusals that name the argument');
  // Found by pointing a real model at these tools: it guessed parameter names,
  // got "No column named undefined" back, and retried the same wrong shape four
  // times over. A refusal that does not say what it wanted teaches nothing.
  const a1 = await call('aggregate', { aggregate: 'stddev', column: 'base_salary' });
  check('a misnamed agg argument is named back', /missing required argument: agg/.test(a1), a1.slice(0, 140));
  check('and the refusal lists what was supplied', /You supplied: aggregate, column/.test(a1), a1.slice(0, 160));

  const a2 = await call('aggregate', { agg: 'stddev', column: 'base_salary' });
  check('a missing metric names the argument', /passed as "metric"/.test(a2), a2.slice(0, 140));

  const a3 = await call('aggregate', { agg: 'variance', metric: 'base_salary' });
  check('an unknown agg lists the valid ones', /not an aggregate this tool knows/.test(a3), a3.slice(0, 140));
  check('and enumerates them', /count, avg, sum, median/.test(a3));

  const a4 = await call('compare_groups', { metric: 'base_salary', category: 'gender' });
  check('compare_groups names every missing argument',
    /missing required arguments: split_by, group_a, group_b/.test(a4), a4.slice(0, 160));

  const a5 = await call('aggregate', {
    agg: 'count', filters: [{ column: 'department', op: 'contains', value: 'Eng' }],
  });
  check('an unknown filter operator lists the valid ones',
    /not a filter operator this tool knows/.test(a5), a5.slice(0, 140));

  const a6 = await call('aggregate', { agg: 'median', metric: 'base_salary', group_by: 'department' });
  check('a string group_by is taken rather than crashing', /Engineering/.test(a6), a6.slice(0, 140));

  console.log('\ncorrelate with group_by');
  const cg = await call('correlate', { x: 'tenure_years', y: 'base_salary', group_by: 'department' });
  check('grouped correlation returns per-group r', /"r"/.test(cg) && /Engineering/.test(cg), cg.slice(0, 160));

  console.log('\nevery chart kind renders');
  const before = await chartCount();
  const dist = await call('distribution', { column: 'base_salary', bins: 14 });
  const distRows = rowsOf(dist);
  const hist = await call('render_chart', {
    kind: 'histogram', x: 'bin_start', y: 'n', rows: distRows, title: 'Salary distribution',
  });
  check('histogram renders', /Chart drawn/.test(hist), hist.slice(0, 120));

  const trend = await call('aggregate', { agg: 'avg', metric: 'base_salary', group_by: ['tenure_years'], sort: 'group_asc' });
  const trendRows = rowsOf(trend);
  for (const kind of ['line', 'area', 'dot']) {
    const res = await call('render_chart', { kind, x: 'tenure_years', y: 'value', rows: trendRows, title: `${kind} test` });
    check(`${kind} renders`, /Chart drawn/.test(res), res.slice(0, 120));
  }
  const seriesChart = await call('render_chart', {
    kind: 'bar', x: 'level', y: 'value', series: 'level', rows: trendRows.slice(0, 5), title: 'series test',
  });
  check('series/colour legend path renders', /Chart drawn/.test(seriesChart), seriesChart.slice(0, 120));
  check('all five charts reached the page', (await chartCount()) === before + 5, `${await chartCount()} vs ${before + 5}`);
  // A series chart emits a second svg for the colour legend; that is the tell
  // that the legend actually rendered rather than silently dropping.
  const svgs = await page.evaluate(() => document.querySelectorAll('.chart-card svg').length);
  check('series chart also renders a legend svg', svgs === (await chartCount()) + 1, `${svgs} svgs for ${await chartCount()} cards`);

  const bad = await call('render_chart', { kind: 'bar', x: 'nope', y: 'nope', rows: [{ a: 1 }] });
  check('unplottable rows give a clear error', /could not be run|plottable/.test(bad), bad.slice(0, 140));

  console.log('\ntier override changes what is allowed');
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#columns .column')];
    const target = rows.find((r) => r.querySelector('.column-name').textContent === 'department');
    target.querySelector('.tier').click(); // quasi -> safe
  });
  await new Promise((r) => setTimeout(r, 800));
  const afterOverride = await columnsNow();
  check('override changed the tier', afterOverride.find((c) => c.name === 'department')?.tier === 'safe',
    afterOverride.find((c) => c.name === 'department')?.tier);
  const desc = await call('describe_dataset', {});
  check('describe_dataset reflects the override', /"name": "department",\s*\n\s*"type": "string",\s*\n\s*"tier": "safe"/.test(desc),
    'tier not reflected');

  console.log('\npage errors:', errors.length ? errors.slice(0, 6) : 'none');
  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
