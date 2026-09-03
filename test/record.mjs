/**
 * Records one clip per narration beat, each held for exactly as long as its
 * voice line runs, with the callouts burnt in.
 *
 *   npm run sample -- 1000000
 *   npm run fileview
 *   npm run voice            # writes voice/durations.json
 *   npm run record           # → docs/broll/01-hook.webm, …
 *
 * Editing then has no timing work in it: clip N goes under narration N.
 *
 * The tool calls run through the browser's real WebMCP API, so the execution is
 * genuine — a script picks them rather than a model, which is why the narration
 * never claims otherwise. Shoot the ChatGPT conversation if you want the
 * agent's reasoning on camera and swap it in for beat 5.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, statSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'http://localhost:4173/';
const FILE = join(process.cwd(), 'sample-data', 'employee_compensation_2026.csv');
const FILEVIEW = join(process.cwd(), 'docs', '.fileview', 'fileview.html');
const OUT_DIR = join(process.cwd(), 'docs', 'broll');

if (!existsSync(FILE) || statSync(FILE).size < 50 * 1024 * 1024) {
  console.error('Need the big sample first:  npm run sample -- 1000000');
  process.exit(1);
}
if (!existsSync(FILEVIEW)) {
  console.error('Need the raw-file view:  npm run fileview');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(join(process.cwd(), 'voice', 'narration.json'), 'utf8'));
let durations;
try {
  durations = JSON.parse(readFileSync(join(process.cwd(), 'voice', 'durations.json'), 'utf8'));
} catch {
  console.error('Run `npm run voice` first so the clips can match the narration.');
  process.exit(1);
}
const calloutFor = (id) => spec.beats.find((b) => b.id === id)?.callout ?? null;
mkdirSync(OUT_DIR, { recursive: true });

const beat = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false, // screencast needs a real window
  args: ['--no-sandbox', '--enable-features=WebMCP', '--window-size=1620,1020', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 }, // 16:9
  // testSeal fires a synchronous XHR on purpose, which parks the main thread
  // long enough that the default CDP timeout can fire mid-beat.
  protocolTimeout: 180000,
});

try {
  const page = await browser.newPage();

  /** Overlay helpers have to be re-injected after every navigation. */
  const inject = () =>
    page.evaluate(() => {
      if (document.getElementById('__cursor')) return;
      const dot = document.createElement('div');
      dot.id = '__cursor';
      dot.style.cssText = [
        'position:fixed', 'z-index:99999', 'width:22px', 'height:22px',
        'margin:-11px 0 0 -11px', 'border-radius:50%',
        'background:rgba(31,111,74,.28)', 'border:2px solid #1f6f4a',
        'pointer-events:none', 'transition:all .5s cubic-bezier(.4,0,.2,1)',
        'opacity:0', 'left:50%', 'top:50%',
      ].join(';');

      const call = document.createElement('div');
      call.id = '__callout';
      call.style.cssText = [
        'position:fixed', 'z-index:99998', 'left:56px', 'bottom:56px',
        'padding:20px 28px', 'border-radius:14px', 'background:#14181a',
        'color:#f7f6f2', 'box-shadow:0 18px 50px -18px rgba(0,0,0,.55)',
        'font:600 15px/1.4 ui-sans-serif,system-ui,"Segoe UI",sans-serif',
        'opacity:0', 'transform:translateY(18px)',
        'transition:opacity .45s ease,transform .45s cubic-bezier(.2,.8,.2,1)',
        'pointer-events:none', 'max-width:640px',
      ].join(';');
      call.innerHTML =
        '<div id="__callout_a" style="font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1.05"></div>' +
        '<div id="__callout_b" style="font-size:17px;font-weight:500;color:#9fb3a8;margin-top:9px"></div>';

      const ring = document.createElement('div');
      ring.id = '__spot';
      ring.style.cssText = [
        'position:fixed', 'z-index:99997', 'pointer-events:none',
        'border:3px solid #1f6f4a', 'border-radius:10px',
        'box-shadow:0 0 0 4px rgba(31,111,74,.16), 0 0 26px rgba(31,111,74,.30)',
        'opacity:0', 'transition:opacity .35s ease, all .45s cubic-bezier(.3,.9,.3,1)',
        'left:0', 'top:0', 'width:0', 'height:0',
      ].join(';');

      document.body.append(dot, call, ring);
      window.__point = (x, y, show = true) => {
        const d = document.getElementById('__cursor');
        d.style.opacity = show ? '1' : '0';
        d.style.left = `${x}px`;
        d.style.top = `${y}px`;
      };
      window.__press = () => {
        const d = document.getElementById('__cursor');
        d.style.transform = 'scale(.6)';
        setTimeout(() => (d.style.transform = 'scale(1)'), 200);
      };
      window.__spot = (selector, pad = 8) => {
        const r = document.getElementById('__spot');
        const el = selector && document.querySelector(selector);
        if (!el) { r.style.opacity = '0'; return; }
        const b = el.getBoundingClientRect();
        r.style.left = `${b.left - pad}px`;
        r.style.top = `${b.top - pad}px`;
        r.style.width = `${b.width + pad * 2}px`;
        r.style.height = `${b.height + pad * 2}px`;
        r.style.opacity = '1';
      };
      window.__callout = (a, b) => {
        const c = document.getElementById('__callout');
        document.getElementById('__callout_a').textContent = a ?? '';
        document.getElementById('__callout_b').textContent = b ?? '';
        const on = Boolean(a);
        c.style.opacity = on ? '1' : '0';
        c.style.transform = on ? 'translateY(0)' : 'translateY(18px)';
      };
    });

  const goto = async (url) => {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
    await inject();
  };

  const pointAt = async (selector) => {
    const box = await page.$eval(selector, (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.evaluate((x, y) => window.__point(x, y), box.x, box.y);
    await beat(650);
    await page.evaluate(() => window.__press());
  };
  const hidePointer = () => page.evaluate(() => window.__point(0, 0, false));
  const spot = (selector, pad) => page.evaluate((s, p) => window.__spot(s, p), selector ?? null, pad ?? 8);
  const spotOff = () => page.evaluate(() => window.__spot(null));
  const callout = (a, b) => page.evaluate((x, y) => window.__callout(x, y), a ?? null, b ?? null);
  const call = (n, a) => page.evaluate((x, y) => window.blindfold.callTool(x, y), n, a);

  /**
   * Runs `action`, then pads until the clip has lasted the whole narration
   * line. Overruns are reported rather than silently producing a clip too
   * short to sit under its voiceover.
   */
  async function clip(id, action) {
    const target = durations[id];
    if (!target) throw new Error(`no measured duration for ${id}`);
    const started = Date.now();
    const recorder = await page.screencast({ path: join(OUT_DIR, `${id}.webm`) });
    await action();
    const pad = Math.round(target * 1000) - (Date.now() - started);
    if (pad > 0) await beat(pad);
    await recorder.stop();
    console.log(`  ${id.padEnd(12)} ${target.toFixed(1)}s${pad < 0 ? `  OVER by ${(-pad / 1000).toFixed(1)}s` : ''}`);
  }

  console.log('recording clips →', OUT_DIR);

  // ── 01 · the hook: what the file actually is, then it lands ──────
  await goto(pathToFileURL(FILEVIEW).href);
  await clip('01-hook', async () => {
    const [a, b] = calloutFor('01-hook') ?? [];
    await beat(300);
    // A slow crawl through real names, emails and salaries.
    await page.evaluate(() => {
      let y = 0;
      const id = setInterval(() => {
        y += 13;
        window.scrollTo(0, y);
        if (y > 3400) clearInterval(id);
      }, 16);
    });
    await beat(1500);
    await callout(a, b);
    await beat(2600);
    await callout(null, null);
    await beat(400);
    await goto(URL);
    const input = await page.$('#file-input');
    await input.uploadFile(FILE);
    await page.waitForFunction(
      () => /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? ''),
      { timeout: 600000 },
    );
  });

  // ── 02 · the claim ───────────────────────────────────────────────
  await clip('02-claim', async () => {
    const [a, b] = calloutFor('02-claim') ?? [];
    await beat(400);
    await spot('#dataset-meta', 10);
    await callout(a, b);
    await beat(600);
  });

  // ── 03 · the grading ─────────────────────────────────────────────
  await clip('03-grading', async () => {
    await callout(null, null);
    await beat(700);
    for (const n of [1, 2, 3]) {
      await pointAt(`#columns .column:nth-child(${n}) .tier`);
      await beat(1600);
    }
    await hidePointer();
  });

  // ── 04 · the tool surface ────────────────────────────────────────
  await clip('04-tools', async () => {
    await page.evaluate(() => document.querySelector('#tools-offered')?.scrollIntoView({ block: 'center' }));
    await beat(500);
    await pointAt('#tools-offered summary');
    await page.evaluate(() => document.querySelector('#tools-offered')?.setAttribute('open', ''));
    await beat(900);
    await hidePointer();
    await page.evaluate(() => document.querySelector('#tools-offered')?.scrollIntoView({ block: 'center' }));
    await beat(600);
    await spot('#tool-list', 8);
    await beat(1200);
  });

  // ── 05 · the work ────────────────────────────────────────────────
  await clip('05-work', async () => {
    const [a, b] = calloutFor('05-work') ?? [];
    await page.evaluate(() => document.querySelector('.panel-stage')?.scrollIntoView({ block: 'start' }));
    await beat(700);
    const t0 = Date.now();
    const gap = await call('compare_groups', {
      metric: 'base_salary', split_by: 'gender', group_a: 'F', group_b: 'M', within: 'level',
    });
    const took = (Date.now() - t0) / 1000;
    await beat(900);
    await call('render_chart', {
      kind: 'bar', x: 'level', y: 'gap_pct',
      rows: JSON.parse(gap.slice(gap.indexOf('['))),
      title: 'Gender pay gap by level (%)',
      x_label: 'Job level', y_label: 'Gap vs male peers (%)',
      caption: 'Around 3% at IC1–IC3, then 12–14% from IC4 upward.',
    });
    await beat(700);
    await spot('.chart-card', 6);
    await beat(900);
    // Quote what this run actually took, not a figure from another session.
    await callout(`${took.toFixed(2)} seconds`, b ?? a);
    const dept = await call('aggregate', { agg: 'median', metric: 'base_salary', group_by: ['department'] });
    await call('render_chart', {
      kind: 'bar', x: 'department', y: 'value',
      rows: JSON.parse(dept.slice(dept.indexOf('['))),
      title: 'Median base salary by department',
      x_label: 'Department', y_label: 'Median base salary (USD)',
    });
    await beat(2200);

    // The narration now names the one-way mirror here, so show it: the call
    // that drew the chart, and the single word that went back for it.
    await callout(null, null);
    await page.evaluate(() => document.querySelector('.feed-wrap')?.scrollIntoView({ block: 'center' }));
    await beat(900);
    await spot('#feed .feed-item:nth-child(1)', 5);
    await beat(2400);
    await hidePointer();
    await spotOff();
  });

  // ── 06 · it refuses ──────────────────────────────────────────────
  await clip('06-refuse', async () => {
    await callout(null, null);
    await page.evaluate(() => document.querySelector('.feed-wrap')?.scrollIntoView({ block: 'center' }));
    await beat(900);
    await call('aggregate', { agg: 'max', metric: 'base_salary' });
    await beat(900);
    await spot('#feed .feed-item:nth-child(1)', 5);
    await beat(2300);
    await call('aggregate', { agg: 'count', group_by: ['full_name'] });
    await beat(900);
    await spot('#feed .feed-item:nth-child(1)', 5);
    await beat(1700);
    await spotOff();
  });

  // ── 07 · the seal ────────────────────────────────────────────────
  await clip('07-seal', async () => {
    const [a, b] = calloutFor('07-seal') ?? [];
    await page.evaluate(() => document.querySelector('#seal')?.scrollIntoView({ block: 'center' }));
    await beat(1600);
    await pointAt('#seal-test');
    await page.click('#seal-test');
    await page.waitForFunction(() => document.querySelectorAll('#seal-results li').length >= 5, { timeout: 30000 });
    await hidePointer();
    await beat(600);
    await spot('#seal-results', 8);
    await beat(1600);
    await callout(a, b);
    await beat(2000);
  });

  // ── 08 · rest on the receipt ─────────────────────────────────────
  // ── 08 · the verbatim payload ────────────────────────────────────
  // The other half of "how would I know": the seal says nothing left the tab,
  // this says exactly what crossed to the agent, character for character.
  await clip('08-verbatim', async () => {
    await callout(null, null);
    await page.evaluate(() => document.querySelector('.feed-wrap')?.scrollIntoView({ block: 'center' }));
    await beat(700);
    await pointAt('#feed .feed-item:nth-child(3)');
    await page.evaluate(() => document.querySelectorAll('#feed .feed-item')[2]?.click());
    await beat(500);
    await hidePointer();
    await spot('#feed .feed-item:nth-child(3) .feed-returned', 6);
    await beat(400);
  });

  await clip('09-close', async () => {
    await callout(null, null);
    await spotOff();
    await page.evaluate(() => document.querySelector('.panel-ledger')?.scrollIntoView({ block: 'start' }));
    await beat(900);
    await spot('.meters', 8);
    await beat(1400);
    // Straight off the ledger, so the burnt-in figures match what is on screen.
    const { inText, outText } = await page.evaluate(() => ({
      inText: document.querySelector('#bytes-in')?.textContent ?? '',
      outText: document.querySelector('#bytes-out')?.textContent ?? '',
    }));
    await callout(`${inText} in — ${outText} out`, '0 raw rows');
  });

  const snap = await page.evaluate(() => window.blindfold.ledger());
  console.log(`\nledger: ${snap.bytesIngested.toLocaleString()} B in, ${snap.bytesReleased.toLocaleString()} B out`);
} finally {
  await browser.close();
}
