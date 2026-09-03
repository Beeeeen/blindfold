/**
 * What does Chrome itself say about the blocked requests?
 *
 *   node test/csp-evidence.mjs
 *
 * The in-app seal panel reports the refusals, but the page reporting on itself
 * is precisely the thing this project argues against. This asks the browser
 * directly, through the DevTools protocol, so we know what a judge would see in
 * the Network panel before telling anyone to film it.
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'https://beeeeen.github.io/blindfold/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-features=WebMCP'],
});

try {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');

  const failures = [];
  const violations = [];
  cdp.on('Network.loadingFailed', (e) => failures.push(e));
  cdp.on('Log.entryAdded', (e) => {
    if (/Content Security Policy/i.test(e.entry.text)) violations.push(e.entry.text.slice(0, 150));
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.click('#load-sample');
  await page.waitForFunction(
    () =>
      /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? '') &&
      (window.blindfold?.listTools()?.length ?? 0) > 0,
    { timeout: 300000 },
  );

  await page.evaluate(() => window.blindfold.testSeal());
  await new Promise((r) => setTimeout(r, 1200));

  console.log(`\nWhat Chrome's Network panel records for the leak test:\n`);
  const seen = new Set();
  for (const f of failures) {
    const key = `${f.type}|${f.blockedReason ?? f.errorText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  type=${(f.type ?? '?').padEnd(10)} blockedReason=${String(f.blockedReason ?? '—').padEnd(6)} ` +
      `error=${f.errorText || '—'} corsError=${f.corsErrorStatus?.corsError ?? '—'}`);
  }
  if (!failures.length) console.log('  (none — nothing was even attempted)');

  console.log(`\nConsole entries Chrome logged (${violations.length}):`);
  for (const v of violations.slice(0, 6)) console.log(`  ${v}`);
} finally {
  await browser.close();
}
