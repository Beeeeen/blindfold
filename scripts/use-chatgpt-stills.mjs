/**
 * Turns screenshots of the ChatGPT conversation into beat 5.
 *
 *   npm run chatgpt:stills -- shot1.png shot2.png shot3.png
 *
 * Recording is better when it is easy. It is often not: the model can take two
 * and a half minutes to answer, and most of that footage is waiting. Stills
 * skip the waiting and keep the states that matter.
 *
 * Each image is held for an equal share of the 05b narration and given a slow
 * push-in, so the result reads as deliberate framing rather than a slideshow.
 * Cross-dissolves cover the joins.
 *
 * Writes docs/broll/05b-chatgpt.webm, which `npm run assemble` then prefers
 * over the scripted beat. Delete that file to go back.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const BROLL = join(ROOT, 'docs', 'broll');
const WORK = join(ROOT, 'docs', '.assembly');

const images = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => resolve(a));
if (!images.length || images.some((f) => !existsSync(f))) {
  console.error('Usage: npm run chatgpt:stills -- shot1.png shot2.png [shot3.png …]');
  if (images.length) for (const f of images) if (!existsSync(f)) console.error(`  missing: ${f}`);
  process.exit(1);
}

const durations = JSON.parse(readFileSync(join(ROOT, 'voice', 'durations.json'), 'utf8'));
const total = durations['05b-chatgpt'];
if (!total) {
  console.error('No 05b-chatgpt narration measured. Run `npm run voice` first.');
  process.exit(1);
}

mkdirSync(BROLL, { recursive: true });
mkdirSync(WORK, { recursive: true });
const ff = (a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a], { stdio: 'pipe' });

const FPS = 30;
const FADE = 0.5;
// Overlapping dissolves mean each still is on screen a little longer than its
// share, so the arithmetic has to account for the joins it eats.
const each = (total + FADE * (images.length - 1)) / images.length;
const frames = Math.round(each * FPS);

console.log(`${images.length} stills, ${each.toFixed(1)}s each, ${total.toFixed(1)}s total`);

const clips = [];
images.forEach((src, i) => {
  const out = join(WORK, `still-${i}.mp4`);
  // Alternate the direction of the push so consecutive shots do not feel like
  // the same move repeated.
  const from = i % 2 === 0 ? 1.0 : 1.06;
  const to = i % 2 === 0 ? 1.06 : 1.0;
  const zoom = `${from}+(${to}-${from})*on/${frames}`;
  ff([
    '-loop', '1', '-i', src, '-t', String(each), '-r', String(FPS),
    '-vf',
    `scale=3840:-2:flags=lanczos,` +
      `zoompan=z='${zoom}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${FPS},` +
      `setsar=1`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    out,
  ]);
  clips.push(out);
  console.log(`  ${i + 1}. ${src.split(/[\\/]/).pop()}`);
});

const out = join(BROLL, '05b-chatgpt.webm');
if (clips.length === 1) {
  ff(['-i', clips[0], '-t', String(total), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p',
    '-b:v', '4M', '-row-mt', '1', '-deadline', 'good', out]);
} else {
  const inputs = clips.flatMap((c) => ['-i', c]);
  // xfade chains pairwise; each join starts FADE before the running end.
  let filter = '';
  let last = '[0:v]';
  let offset = each - FADE;
  for (let i = 1; i < clips.length; i++) {
    const label = i === clips.length - 1 ? '[v]' : `[x${i}]`;
    filter += `${last}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label};`;
    last = label;
    offset += each - FADE;
  }
  ff([...inputs, '-filter_complex', filter.replace(/;$/, ''), '-map', '[v]',
    '-t', String(total),
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '4M', '-row-mt', '1', '-deadline', 'good', out]);
}

const dur = execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
console.log(`\nwrote ${out} (${Number(dur).toFixed(1)}s against ${total.toFixed(1)}s of narration)`);
console.log('\nNow run:  npm run assemble');
