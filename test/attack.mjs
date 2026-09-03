/**
 * Tries to get a row out.
 *
 *   npm run test:attack
 *
 * The claim this project makes is that a leak should be impossible to express,
 * not merely refused. That claim is worth nothing until someone has honestly
 * tried to break it, so this file is written from the attacker's side: each
 * case is an attempt to learn something about one identifiable person using
 * only calls the guard permits.
 *
 * A failure here is a real finding, not a broken test.
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'http://localhost:4173/';

let held = 0;
let leaked = 0;
const held_ = (name, detail = '') => { held++; console.log(`  held   ${name}${detail ? ` — ${detail}` : ''}`); };
const leak = (name, detail = '') => { leaked++; console.log(`  LEAK   ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-features=WebMCP'],
  protocolTimeout: 180000,
});

try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.click('#load-sample');
  await page.waitForFunction(
    () => /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? ''),
    { timeout: 180000 },
  );

  const call = (n, a) => page.evaluate((x, y) => window.blindfold.callTool(x, y), n, a);
  const refused = (t) => /Refused by the disclosure guard/.test(t);
  const rowsOf = (t) => { const i = t.indexOf('['); return i < 0 ? [] : JSON.parse(t.slice(i)); };

  // ── 1. Narrow a filter until one person is left ──────────────────
  // The classic differencing attack. Every one of these calls is legal on its
  // own; the question is whether the intersection is.
  console.log('\nnarrowing a cohort towards one person');
  // Facilities/M3/MENA/Non-binary is exactly one person in this sample. Before
  // the cohort-size check existed, avg over it returned 67,100 — that person's
  // salary, reached entirely through calls the guard permitted.
  const narrow = [
    { column: 'department', op: 'eq', value: 'Facilities' },
    { column: 'level', op: 'eq', value: 'M3' },
    { column: 'region', op: 'eq', value: 'MENA' },
    { column: 'gender', op: 'eq', value: 'Non-binary' },
  ];
  const counted = await call('aggregate', { agg: 'count', filters: narrow });
  const countRows = refused(counted) ? [] : rowsOf(counted);
  const n = Number(countRows[0]?.value ?? NaN);
  console.log(`       count over that cohort: ${refused(counted) ? 'refused' : n}`);

  if (refused(counted)) {
    held_('a cohort that thin will not even be counted');
  } else if (Number.isFinite(n) && n < 5) {
    leak('an exact count of a sub-k cohort was released', `n = ${n}`);
  } else {
    held_('the narrowed cohort still cleared k', `n = ${n}`);
  }

  // The payload: an average over one person is that person's salary.
  const avg = await call('aggregate', { agg: 'avg', metric: 'base_salary', filters: narrow });
  if (refused(avg)) {
    held_('no aggregate over a sub-k cohort');
  } else {
    const v = Number(rowsOf(avg)[0]?.value ?? NaN);
    const cohort = Number(rowsOf(avg)[0]?.n ?? NaN);
    if (Number.isFinite(v) && cohort < 5) {
      leak('an aggregate over a sub-k cohort revealed a value', `${cohort} people, value ${v}`);
    } else {
      held_('the aggregate covered enough people', `n = ${cohort}`);
    }
  }

  // ── 2. Differencing two legal aggregates ─────────────────────────
  // Subtracting a filtered sum from an unfiltered one isolates whoever the
  // filter excluded, without either call ever looking suspicious.
  console.log('\ndifferencing two permitted sums');
  const all = await call('aggregate', { agg: 'sum', metric: 'base_salary', filters: [
    { column: 'department', op: 'eq', value: 'Executive' },
    { column: 'level', op: 'eq', value: 'M3' },
  ] });
  const most = await call('aggregate', { agg: 'sum', metric: 'base_salary', filters: [
    { column: 'department', op: 'eq', value: 'Executive' },
    { column: 'level', op: 'eq', value: 'M3' },
    { column: 'region', op: 'neq', value: 'MENA' },
  ] });
  if (refused(all) || refused(most)) {
    held_('one side of the difference was refused');
  } else {
    const a = Number(rowsOf(all)[0]?.value ?? NaN);
    const b = Number(rowsOf(most)[0]?.value ?? NaN);
    const na = Number(rowsOf(all)[0]?.n ?? NaN);
    const nb = Number(rowsOf(most)[0]?.n ?? NaN);
    console.log(`       ${na} people vs ${nb} people; difference isolates ${na - nb}`);
    if (na - nb > 0 && na - nb < 5) {
      leak('differencing isolated a sub-k group', `${na - nb} people, ${a - b} in salary`);
    } else {
      held_('the difference does not isolate a small enough group', `${na - nb} people`);
    }
  }

  // ── 3. A range filter squeezed around one salary ─────────────────
  console.log('\nsqueezing a range filter');
  const squeeze = await call('aggregate', {
    agg: 'count',
    filters: [
      { column: 'base_salary', op: 'gt', value: 400000 },
      { column: 'base_salary', op: 'lt', value: 400100 },
    ],
  });
  const empty = await call('aggregate', {
    agg: 'count',
    filters: [...narrow.slice(0, 3), { column: 'gender', op: 'eq', value: 'Undisclosed' }],
  });
  if (refused(empty) && refused(counted)) {
    held_('an empty cohort and a one-person cohort are refused alike');
  } else {
    leak('the refusal distinguishes empty from small', 'that difference is an oracle');
  }

  if (refused(squeeze)) {
    held_('a hair-width salary band is refused');
  } else {
    const c = Number(rowsOf(squeeze)[0]?.value ?? NaN);
    if (Number.isFinite(c) && c > 0 && c < 5) leak('a hair-width salary band returned a count', `n = ${c}`);
    else held_('the band covers nobody or enough people', `n = ${c}`);
  }

  // ── 4. Sealed columns, every way in ──────────────────────────────
  console.log('\nreaching for sealed columns');
  for (const [label, args] of [
    ['group by a name', { agg: 'count', group_by: ['full_name'] }],
    ['average an id', { agg: 'avg', metric: 'employee_id' }],
    ['filter on an email', { agg: 'count', filters: [{ column: 'email', op: 'eq', value: 'x@example-corp.com' }] }],
    ['sort towards the top earner', { agg: 'max', metric: 'base_salary' }],
    ['list identifier values', null],
  ]) {
    const out = args ? await call('aggregate', args) : await call('list_group_values', { column: 'full_name' });
    if (refused(out)) held_(label);
    else leak(label, out.slice(0, 90));
  }

  // ── 5. The budget ────────────────────────────────────────────────
  // Enough harmless questions is the attack the k-check cannot see.
  console.log('\nspending the disclosure budget');
  let spent = 0;
  let stopped = null;
  for (let i = 0; i < 400 && !stopped; i++) {
    const r = await call('aggregate', { agg: 'avg', metric: 'base_salary', group_by: ['level'] });
    if (refused(r)) stopped = r;
    else spent++;
  }
  const snap = await page.evaluate(() => window.blindfold.ledger());
  console.log(`       ${spent} calls before it stopped; ${snap.cellsReleased}/${snap.budgetCells} values released`);
  if (stopped && /disclosure budget/.test(stopped)) held_('the budget closes the session', `${spent} calls`);
  else leak('the budget never engaged', `${spent} calls, ${snap.cellsReleased} values`);

  // ── 6. And after all that, still no rows ─────────────────────────
  const transcript = await page.evaluate(() => window.blindfold.transcript());
  console.log('\nafter every attempt above');
  // The only address in there is the one this file passed in as a filter value
  // on a call that was refused. Look for the shape the dataset actually holds.
  const fromData = transcript.match(/[a-z]+\.[a-z]+\d+@example-corp\.com/g) ?? [];
  if (fromData.length) leak('a dataset email reached the transcript', fromData[0]);
  else held_('no dataset email anywhere in the transcript');
  if (/\bE1\d{5}\b/.test(transcript)) leak('an employee id reached the transcript');
  else held_('no employee id anywhere in the transcript');
} finally {
  await browser.close();
}

console.log(`\n${held} held, ${leaked} leaked\n`);
process.exit(leaked ? 1 : 0);
