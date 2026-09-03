/**
 * Slots your ChatGPT screen recording in as beat 5.
 *
 *   npm run chatgpt -- path/to/recording.mp4
 *   npm run chatgpt -- path/to/recording.mp4 --from 4.5 --to 38
 *   npm run assemble
 *
 * Record as long as you like and trim with --from/--to; whatever is left is
 * fitted to the 05b narration by adjusting playback speed, so an agent that
 * spent thirty seconds thinking still lands on the line. Speeding up an agent's
 * pauses is normal in a demo and does not change what happened.
 *
 * Once docs/broll/05b-chatgpt.webm exists, `npm run assemble` prefers it over
 * the scripted take automatically. Delete it to go back.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderCallout } from './lib/callout.mjs';

const ROOT = process.cwd();
const BROLL = join(ROOT, 'docs', 'broll');
const VOICE = join(ROOT, 'voice');
const WORK = join(ROOT, 'docs', '.assembly');

const args = process.argv.slice(2);
/** Flags whose value is a word, so the value is not mistaken for the filename. */
const TAKES_VALUE = new Set(['--beat', '--callout', '--callout-at', '--from', '--to', '--ranges']);
const src = args.find((a, i) => !a.startsWith('--') && !/^\d/.test(a) && !TAKES_VALUE.has(args[i - 1]));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : null;
};
const from = flag('from');
const to = flag('to');

/**
 * Several ranges joined, e.g. --ranges 25-35,92-103.
 *
 * Compressing one long take evenly puts the payoff in its last second: the
 * narration talks about the chart for half its length, but the chart only
 * exists at the very end of the recording. Taking the question and the moment
 * it lands, and dropping the wait between them, keeps both on screen at close
 * to real speed.
 */
const rangesFlag = args.indexOf('--ranges');
const ranges = rangesFlag >= 0 && args[rangesFlag + 1]
  ? args[rangesFlag + 1].split(',').map((r) => {
      const [a, b] = r.split('-').map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
        console.error(`Bad range "${r}" — expected start-end in seconds.`);
        process.exit(1);
      }
      return [a, b];
    })
  : null;

if (!src || !existsSync(resolve(src))) {
  console.error('Usage: npm run chatgpt -- path/to/recording.mp4 [--from 4.5] [--to 38]');
  process.exit(1);
}

/**
 * Which beat this footage is for.
 *
 * Beat 5 swaps its narration as well, so it writes to the 05b file and assembly
 * prefers that over the scripted take. Any other beat keeps the line it already
 * has and only wants different footage, so it writes over that beat's clip.
 */
const beatFlag = args.indexOf('--beat');
const beat = beatFlag >= 0 && args[beatFlag + 1] ? args[beatFlag + 1] : '05b-chatgpt';

/**
 * The spotlight to burn in, as "headline|second line", and when in the finished
 * clip it should appear.
 *
 * The scripted b-roll labels what it is showing at the moment it shows it. This
 * footage comes from outside the app, so nothing labels it unless we do — and
 * it is the part of the cut where the most is happening. Defaults are the two
 * beats we actually shoot this way; --callout overrides, --no-callout drops it.
 */
const DEFAULT_CALLOUTS = {
  '05b-chatgpt': ['it has never seen a salary', 'the chart cost zero bytes of data'],
  '06-refuse': ['refused, then redirected', 'the guard tells the agent what to ask instead'],
};
const calloutFlag = args.indexOf('--callout');
const callout = args.includes('--no-callout')
  ? null
  : calloutFlag >= 0 && args[calloutFlag + 1]
    ? args[calloutFlag + 1].split('|').map((s) => s.trim())
    : (DEFAULT_CALLOUTS[beat] ?? null);
/** Seconds into the finished clip. Defaults to the last few seconds of it. */
const calloutAt = flag('callout-at');

const durations = JSON.parse(readFileSync(join(VOICE, 'durations.json'), 'utf8'));
const target = durations[beat];
if (!target) {
  console.error(`No "${beat}" narration measured. Run \`npm run voice\` first.`);
  console.error(`Known beats: ${Object.keys(durations).join(', ')}`);
  process.exit(1);
}

const ff = (a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a], { stdio: 'pipe' });
const probe = (f) =>
  Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {
      encoding: 'utf8',
    }).trim(),
  );

mkdirSync(BROLL, { recursive: true });
mkdirSync(WORK, { recursive: true });
const input = resolve(src);

/** The window is light along the edges this matte sits against. */
const PAD = process.env.CHATGPT_PAD ?? '0xfbfbfa';

// 1. trim to the part worth showing
const trimmed = join(WORK, 'chatgpt.trim.mp4');
if (ranges) {
  const parts = ranges.map(([a, b], i) => {
    const out = join(WORK, `chatgpt.part${i}.mp4`);
    ff(['-ss', String(a), '-i', input, '-t', String(b - a), '-an',
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', out]);
    console.log(`  range ${a}-${b}s`);
    return out;
  });
  const list = join(WORK, 'chatgpt.concat.txt');
  const forConcat = (f) => f.split('\\').join('/');
  writeFileSync(list, parts.map((f) => `file '${forConcat(f)}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', trimmed]);
} else {
  const pre = from != null ? ['-ss', String(from)] : [];
  const post = to != null ? ['-t', String(to - (from ?? 0))] : [];
  ff([...pre, '-i', input, ...post, '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
    '-pix_fmt', 'yuv420p', trimmed]);
}

const have = probe(trimmed);
const speed = have / target;
console.log(`recording   ${have.toFixed(1)}s`);
console.log(`narration   ${target.toFixed(1)}s`);
console.log(`speed       ${speed.toFixed(2)}x${speed > 3 ? '   very fast — try --from/--to to cut the dead air' : ''}`);

// 2. the spotlight, rendered from the same markup the scripted b-roll uses
let overlay = null;
if (callout) {
  overlay = join(WORK, `callout-${beat}.png`);
  await renderCallout(callout[0], callout[1] ?? '', overlay, 2400);
  console.log(`callout     "${callout[0]}" at ${(calloutAt ?? Math.max(0, target - 3.6)).toFixed(1)}s`);
}

// 3. fit to the line, and match the frame the rest of the cut uses
const out = join(BROLL, `${beat}.webm`);
const fit =
  `setpts=PTS/${speed},` +
  'scale=2400:1350:force_original_aspect_ratio=decrease:flags=lanczos,' +
  `pad=2400:1350:(ow-iw)/2:(oh-ih)/2:color=${PAD},fps=30`;
const encode = ['-an', '-c:v', 'libvpx-vp9', '-b:v', '4M', '-row-mt', '1', '-deadline', 'good'];

if (overlay) {
  const at = calloutAt ?? Math.max(0, target - 3.6);
  ff([
    '-i', trimmed,
    '-loop', '1', '-framerate', '30', '-i', overlay,
    '-filter_complex',
    `[0:v]${fit}[base];` +
      `[1:v]format=rgba,fade=t=in:st=${at}:d=0.45:alpha=1[spot];` +
      `[base][spot]overlay=0:main_h-overlay_h:shortest=1:enable='gte(t,${at})'[v]`,
    '-map', '[v]', ...encode, out,
  ]);
} else {
  ff(['-i', trimmed, '-filter:v', fit, ...encode, out]);
}

console.log(`\nwrote  ${out}  (${probe(out).toFixed(1)}s)`);
console.log('\nNow run:  npm run assemble');
console.log(
  beat === '05b-chatgpt'
    ? '(it prefers this clip over the scripted take while the file exists)'
    : `(${beat} keeps its own narration; a later \`npm run record\` would overwrite this footage)`,
);
