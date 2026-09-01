import puppeteer from 'puppeteer-core';
let bad = 0;
for (let i = 1; i <= 5; i++) {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new', args: ['--no-sandbox'],
  });
  const p = await b.newPage();
  // domcontentloaded, not networkidle: click as early as a human possibly could.
  await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.click('#load-sample');
  try {
    await p.waitForFunction(() => /\d+ rows/.test(document.querySelector('#dataset-meta')?.textContent ?? ''), { timeout: 120000 });
    console.log(`run ${i}: ok`);
  } catch {
    const m = await p.$eval('#dataset-meta', e => e.textContent);
    console.log(`run ${i}: FAIL -> ${m}`);
    bad++;
  }
  await b.close();
}
console.log(bad ? `${bad}/5 failed` : 'all 5 clean');
process.exit(bad ? 1 : 0);
