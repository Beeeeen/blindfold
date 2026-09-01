/**
 * Registration test against a real WebMCP implementation.
 *
 *   node test/webmcp-live.mjs
 *
 * Chrome 146+ exposes document.modelContext behind --enable-features=WebMCP.
 * This checks that our eight tools are actually accepted by the browser, not
 * merely handed to it.
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

  console.log('\napi surface');
  const api = await page.evaluate(() => ({
    on: typeof document.modelContext,
    methods: document.modelContext
      ? Object.getOwnPropertyNames(Object.getPrototypeOf(document.modelContext)).filter((k) => k !== 'constructor')
      : [],
  }));
  check('document.modelContext exists', api.on === 'object', api.on);
  console.log(`       methods: ${api.methods.join(', ')}`);

  console.log('\nstatus before data');
  const before = await page.$eval('#mcp-status', (e) => ({
    state: e.dataset.state,
    text: e.querySelector('.status-text').textContent,
  }));
  check('page detects the host', before.state === 'ready', JSON.stringify(before));

  console.log('\nregistration with real data');
  await page.click('#load-sample');
  await page.waitForFunction(() => document.querySelectorAll('#columns .column').length > 0, { timeout: 180000 });

  const after = await page.$eval('#mcp-status', (e) => e.querySelector('.status-text').textContent);
  check('all eight tools accepted by the browser', /8 tools offered/.test(after), after);
  check('no exception during registerTool', !errors.some((e) => /registerTool|schema|modelContext/i.test(e)),
    errors.filter((e) => /registerTool|schema|modelContext/i.test(e)).slice(0, 2).join(' | '));

  // Re-registration on a second dataset must not throw or duplicate.
  console.log('\nre-registration');
  const reErrors = errors.length;
  await page.click('#change-file');
  await page.click('#load-sample');
  await page.waitForFunction(() => document.querySelectorAll('#columns .column').length > 0, { timeout: 180000 });
  const after2 = await page.$eval('#mcp-status', (e) => e.querySelector('.status-text').textContent);
  check('re-registering a second dataset is clean', /8 tools offered/.test(after2) && errors.length === reErrors,
    `${after2} | new errors: ${errors.slice(reErrors).slice(0, 2).join(' | ')}`);

  // Overriding a tier re-registers again with new descriptions.
  console.log('\ntier override re-registers');
  const beforeOverride = errors.length;
  await page.evaluate(() => document.querySelector('#columns .column .tier').click());
  await new Promise((r) => setTimeout(r, 1500));
  const after3 = await page.$eval('#mcp-status', (e) => e.querySelector('.status-text').textContent);
  check('reclassifying re-offers the toolset', /8 tools offered/.test(after3) && errors.length === beforeOverride,
    `${after3} | ${errors.slice(beforeOverride).slice(0, 2).join(' | ')}`);

  // The point of all this: can a host actually see and drive these tools?
  console.log('\nhost-side discovery');
  const listed = await page.evaluate(async () => {
    const tools = await document.modelContext.getTools();
    return tools.map((t) => ({ name: t.name, hasSchema: !!t.inputSchema, desc: (t.description ?? '').length }));
  });
  check('getTools() reports eight tools', listed.length === 8, `saw ${listed.length}`);
  check('every tool carries a schema', listed.every((t) => t.hasSchema));
  check('descriptions name the loaded columns', listed.some((t) => t.desc > 200), JSON.stringify(listed.map((t) => t.desc)));
  console.log(`       ${listed.map((t) => t.name).join(', ')}`);

  console.log('\nhost-side execution');
  // executeTool takes the RegisteredTool handle from getTools(), not a name.
  const exec = (name, args) =>
    page.evaluate(
      async (n, a) => {
        const tools = await document.modelContext.getTools();
        const tool = tools.find((t) => t.name === n);
        if (!tool) throw new Error(`host does not list a tool called ${n}`);
        const r = await document.modelContext.executeTool(tool, JSON.stringify(a));
        return typeof r === 'string' ? r : JSON.stringify(r);
      },
      name,
      args,
    );

  const real = await exec('aggregate', { agg: 'median', metric: 'base_salary', group_by: ['department'] });
  check('executeTool runs a real query', /Engineering/.test(real), real.slice(0, 200));
  check('result carries no raw identifiers', !/@example-corp\.com/.test(real));

  const refused = await exec('aggregate', { agg: 'max', metric: 'base_salary' });
  check('executeTool surfaces the refusal', /Refused by the disclosure guard/.test(refused), refused.slice(0, 160));
  check('refusal reaches the host with its remedy', /p25, median or p75/.test(refused));

  const sealed = await exec('aggregate', { agg: 'count', group_by: ['full_name'] });
  check('sealed column refused through the host', /Refused/.test(sealed), sealed.slice(0, 160));

  console.log('\npage errors:', errors.length ? errors.slice(0, 6) : 'none');
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
