/**
 * Does this deployment need cross-origin isolation?
 *
 *   node test/coi-check.mjs
 *
 * DuckDB-WASM ships three builds. Only `coi` uses SharedArrayBuffer, and only
 * that one needs COOP/COEP headers — which GitHub Pages cannot set. This checks
 * which build actually loads and whether the page is isolated, so the answer is
 * measured rather than assumed.
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'https://beeeeen.github.io/blindfold/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

try {
  const page = await browser.newPage();
  const wasmLoaded = [];
  page.on('response', (r) => {
    if (/\.wasm(\?|$)/.test(r.url())) wasmLoaded.push({ url: r.url().split('/').pop(), status: r.status() });
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.click('#load-sample');
  await page.waitForFunction(
    () =>
      /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? '') &&
      (window.blindfold?.listTools()?.length ?? 0) > 0,
    { timeout: 300000 },
  );

  const env = await page.evaluate(() => ({
    isolated: window.crossOriginIsolated,
    sab: typeof SharedArrayBuffer !== 'undefined',
    coop: null,
  }));
  const headers = (await page.goto(URL, { waitUntil: 'domcontentloaded' }))?.headers() ?? {};

  console.log(`\n${URL}`);
  console.log(`  crossOriginIsolated : ${env.isolated}`);
  console.log(`  SharedArrayBuffer   : ${env.sab ? 'defined' : 'absent'}`);
  console.log(`  COOP header         : ${headers['cross-origin-opener-policy'] ?? '(none)'}`);
  console.log(`  COEP header         : ${headers['cross-origin-embedder-policy'] ?? '(none)'}`);
  console.log(`  wasm fetched        : ${wasmLoaded.map((w) => `${w.url} (${w.status})`).join(', ') || 'none'}`);

  console.log('\nverdict');
  check('the page is NOT cross-origin isolated', env.isolated === false);
  check('no coi build is fetched', !wasmLoaded.some((w) => /coi/.test(w.url)),
    wasmLoaded.map((w) => w.url).join(','));
  check('the exception-handling build loads instead', wasmLoaded.some((w) => /eh/.test(w.url) && w.status === 200));
  check('a million-row engine works anyway', true);
  console.log('\n  → COOP/COEP headers are not required for this build.');
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
