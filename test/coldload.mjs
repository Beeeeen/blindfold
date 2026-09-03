/**
 * What a judge actually experiences on first visit: a cold cache, nothing
 * warmed, clicking the sample button as soon as it appears.
 *
 *   node test/coldload.mjs            (defaults to the live site)
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'https://beeeeen.github.io/blindfold/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-features=WebMCP', '--disk-cache-size=1'],
});

try {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);

  let transferred = 0;
  page.on('response', async (r) => {
    const len = Number(r.headers()['content-length'] ?? 0);
    if (len) transferred += len;
  });

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const domReady = Date.now() - t0;

  // The button is on screen from the first paint; a judge can click it
  // immediately, so measure from there rather than from "engine ready".
  await page.waitForSelector('#load-sample', { timeout: 60000 });
  const interactive = Date.now() - t0;

  await page.click('#load-sample');
  await page.waitForFunction(
    () =>
      /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? '') &&
      (window.blindfold?.listTools()?.length ?? 0) > 0,
    { timeout: 300000 },
  );
  const usable = Date.now() - t0;

  const sealed = await page.$eval('#seal', (e) => e.dataset.sealed);
  const status = await page.$eval('#mcp-status .status-text', (e) => e.textContent);

  console.log(`\n${URL}`);
  console.log(`  html parsed          ${(domReady / 1000).toFixed(2)}s`);
  console.log(`  button clickable     ${(interactive / 1000).toFixed(2)}s`);
  console.log(`  50k rows analysable  ${(usable / 1000).toFixed(2)}s   <- first real answer possible`);
  console.log(`  transferred          ${(transferred / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  sealed               ${sealed}`);
  console.log(`  status               ${status}`);
} finally {
  await browser.close();
}
