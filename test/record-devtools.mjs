/**
 * Records the seal beat with Chrome's own DevTools Console in frame.
 *
 *   npm run record:devtools            # → docs/broll/07-seal.webm
 *   npm run record:devtools -- --still # → docs/frames/devtools.png, to check framing
 *
 * The in-app panel reporting five refusals is still the page reporting on
 * itself, which is the exact move this project argues against. Chrome saying it
 * is a level up, so this shot has both: the app's verdict above, and the
 * browser's own console messages below, updating together on one click.
 *
 * page.screencast() records the viewport only, so this captures the OS window
 * with ffmpeg's gdigrab instead.
 */
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'https://beeeeen.github.io/blindfold/';
const FILE = join(process.cwd(), 'sample-data', 'employee_compensation_2026.csv');
const OUT_DIR = join(process.cwd(), 'docs', 'broll');
const stillOnly = process.argv.includes('--still');

// This display runs at 150%, so DIPs x 1.5 = the pixels the grabber sees.
// 1195 x 672 DIPs lands on 1792 x 1008 physical: exactly 16:9, and clear of the
// taskbar along the bottom.
const WIN_W = 1195;
const WIN_H = 672;
const CAP_W = 1776;   // trimmed 16 px so no neighbouring window shows at the edge
const CAP_H = 998;    // and 10 px so the taskbar never creeps in; even, because
                      // libvpx-vp9 rejects an odd height outright

const durations = JSON.parse(readFileSync(join(process.cwd(), 'voice', 'durations.json'), 'utf8'));
const TARGET_S = durations['07-seal'];
if (!TARGET_S) throw new Error('no measured duration for 07-seal — run npm run voice');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(join(process.cwd(), 'docs', 'frames'), { recursive: true });
const beat = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  devtools: true,
  args: [
    '--enable-features=WebMCP',
    '--window-position=0,0', `--window-size=${WIN_W},${WIN_H}`,
    '--hide-scrollbars',
  ],
  defaultViewport: null,
  ignoreDefaultArgs: ['--enable-automation'],
});

try {
  const page = (await browser.pages())[0];
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await beat(2500);

  const dt = await browser.targets().find((t) => t.url().startsWith('devtools://'))?.asPage();
  if (!dt) throw new Error('DevTools window not found');
  // Dock underneath so the app and the console share one frame, and show the
  // console rather than whichever panel this profile last had open.
  await dt.evaluate(() => {
    try { globalThis.DevToolsAPI.setDockSide?.('bottom'); } catch { /* older builds */ }
    globalThis.DevToolsAPI.showPanel('console');
  });
  await beat(1500);

  if (!existsSync(FILE) || statSync(FILE).size < 50 * 1024 * 1024) {
    throw new Error('Need the big sample: npm run sample -- 1000000');
  }
  const input = await page.$('#file-input');
  await input.uploadFile(FILE);
  await page.waitForFunction(
    () =>
      /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? '') &&
      (window.blindfold?.listTools()?.length ?? 0) > 0,
    { timeout: 600000 },
  );

  // Put the seal panel in view, and clear the loading chatter so the only thing
  // that appears in the console is what the click causes.
  await page.evaluate(() => document.querySelector('#seal')?.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => console.clear());
  await beat(1200);

  if (stillOnly) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'gdigrab', '-framerate', '2',
      '-offset_x', '0', '-offset_y', '0', '-video_size', `${CAP_W}x${CAP_H}`, '-i', 'desktop',
      '-frames:v', '1', join(process.cwd(), 'docs', 'frames', 'devtools.png')]);
    await page.evaluate(() => window.blindfold.testSeal());
    await beat(2500);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'gdigrab', '-framerate', '2',
      '-offset_x', '0', '-offset_y', '0', '-video_size', `${CAP_W}x${CAP_H}`, '-i', 'desktop',
      '-frames:v', '1', join(process.cwd(), 'docs', 'frames', 'devtools-after.png')]);
    console.log('wrote docs/frames/devtools.png and devtools-after.png');
  } else {
    const out = join(OUT_DIR, '07-seal.webm');
    const ff = spawn('ffmpeg', ['-y', '-v', 'error',
      '-f', 'gdigrab', '-framerate', '30', '-draw_mouse', '0',
      '-offset_x', '0', '-offset_y', '0', '-video_size', `${CAP_W}x${CAP_H}`, '-i', 'desktop',
      '-t', String(TARGET_S),
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '4M',
      '-row-mt', '1', '-deadline', 'realtime', out]);

    await beat(2400);                              // let the frame settle
    await page.click('#seal-test');
    await page.waitForFunction(() => document.querySelectorAll('#seal-results li').length >= 5, { timeout: 30000 });
    await beat(2200);
    await page.evaluate(() => {
      const el = document.querySelector('#seal-results');
      if (!el) return;
      const r = document.createElement('div');
      const b = el.getBoundingClientRect();
      r.style.cssText = [
        'position:fixed', 'z-index:99997', 'pointer-events:none',
        `left:${b.left - 8}px`, `top:${b.top - 8}px`,
        `width:${b.width + 16}px`, `height:${b.height + 16}px`,
        'border:3px solid #1f6f4a', 'border-radius:10px',
        'box-shadow:0 0 0 4px rgba(31,111,74,.16), 0 0 26px rgba(31,111,74,.30)',
      ].join(';');
      document.body.appendChild(r);
    });
    await new Promise((resolve) => ff.on('close', resolve));
    console.log(`wrote ${out} (${TARGET_S.toFixed(1)}s)`);
  }
} finally {
  await browser.close();
}
