/**
 * Tests the two claims a sceptical user would actually challenge:
 *
 *   1. "Nothing leaves this tab"  — is the browser enforcing that, or is the
 *      page just saying so? Checked by trying to exfiltrate for real.
 *   2. "The agent never saw a row" — checked by running a full analysis and
 *      then searching every byte the agent received for values that only exist
 *      in the raw data.
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'http://localhost:4173/';

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
  // A blocked attempt still fires `request`, so attempts prove nothing. What
  // matters is whether anything actually reached a third party and came back.
  const isOffsite = (u) =>
    !u.startsWith('data:') && !u.startsWith('blob:') && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u) &&
    !u.startsWith(URL);
  const reached = [];
  const refused = [];
  page.on('response', (r) => {
    if (isOffsite(r.url())) reached.push(`${r.status()} ${r.url().slice(0, 90)}`);
  });
  page.on('requestfailed', (r) => {
    if (isOffsite(r.url())) refused.push(`${r.url().slice(0, 70)} → ${r.failure()?.errorText}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

  console.log('\nbefore any data is loaded');
  check('not sealed yet', !(await page.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'))));

  await page.click('#load-sample');
  await page.waitForFunction(
    () =>
      /\d+ rows/.test(document.querySelector('#dataset-meta')?.textContent ?? '') &&
      (window.blindfold?.listTools()?.length ?? 0) > 0,
    { timeout: 180000 },
  );

  console.log('\nafter the engine boots');
  const policy = await page.evaluate(
    () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '',
  );
  check('a CSP is injected into the document', policy.length > 0, policy);
  check("connect-src is 'none'", /connect-src 'none'/.test(policy), policy);
  check("form-action is 'none'", /form-action 'none'/.test(policy));
  check('the panel says sealed', (await page.$eval('#seal', (e) => e.dataset.sealed)) === 'true');

  console.log('\ntrying to exfiltrate for real');
  const results = await page.evaluate(() => window.blindfold.testSeal());
  for (const r of results) check(`${r.channel} is refused`, r.blocked, r.detail);

  console.log('\na full analysis session');
  const call = (n, a) => page.evaluate((x, y) => window.blindfold.callTool(x, y), n, a);
  await call('describe_dataset', {});
  await call('list_group_values', { column: 'department' });
  await call('aggregate', { agg: 'median', metric: 'base_salary', group_by: ['department'] });
  await call('aggregate', { agg: 'avg', metric: 'bonus', group_by: ['level', 'region'] });
  await call('distribution', { column: 'base_salary', bins: 20, group_by: 'level' });
  await call('correlate', { x: 'tenure_years', y: 'base_salary', group_by: 'department' });
  await call('compare_groups', {
    metric: 'base_salary', split_by: 'gender', group_a: 'F', group_b: 'M', within: 'level',
  });
  await call('aggregate', { agg: 'max', metric: 'base_salary' });
  await call('policy_report', {});

  // Every byte the agent received, concatenated.
  const transcript = await page.evaluate(() => window.blindfold.transcript());
  console.log(`       transcript is ${transcript.length.toLocaleString()} chars over ${
    (await page.evaluate(() => window.blindfold.ledger().entries.length))} calls`);

  console.log('\nsearching the transcript for anything that identifies a person');
  check('no email address anywhere', !/@example-corp\.com/.test(transcript));
  check('no employee id anywhere', !/\bE1\d{5}\b/.test(transcript));
  // Real first/last names from the generator's pools.
  const names = ['Rosa Delgado', 'Elif Castillo', 'Bruno Bakker', 'Aria', 'Kowalski', 'Yilmaz'];
  const found = names.filter((n) => transcript.includes(n));
  check('no person name anywhere', found.length === 0, found.join(', '));
  check('the sealed column names never carry values',
    !/"full_name":\s*"[^"]/.test(transcript) && !/"email":\s*"[^"]/.test(transcript));

  console.log('\nwhat it does contain');
  check('aggregated department figures', /Engineering/.test(transcript));
  check('the refusal, verbatim', /Refused by the disclosure guard/.test(transcript));
  check('a byte accounting header', /Raw rows released:\s+0/.test(transcript));

  console.log('\nnetwork, observed from outside the page by the driver');
  check('nothing ever reached a third party', reached.length === 0, reached.slice(0, 3).join(' | '));
  check('the deliberate attempts were refused at the network layer', refused.length > 0,
    'expected the exfiltration probes to show up as failures');
  console.log('       refused:', refused.slice(0, 3));
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
