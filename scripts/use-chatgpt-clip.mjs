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
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const BROLL = join(ROOT, 'docs', 'broll');
const VOICE = join(ROOT, 'voice');
const WORK = join(ROOT, 'docs', '.assembly');

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--') && !/^\d/.test(a));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : null;
};
const from = flag('from');
const to = flag('to');

if (!src || !existsSync(resolve(src))) {
  console.error('Usage: npm run chatgpt -- path/to/recording.mp4 [--from 4.5] [--to 38]');
  process.exit(1);
}

const durations = JSON.parse(readFileSync(join(VOICE, 'durations.json'), 'utf8'));
const target = durations['05b-chatgpt'];
if (!target) {
  console.error('No 05b-chatgpt narration measured. Run `npm run voice` first.');
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

// 1. trim to the part worth showing
const trimmed = join(WORK, 'chatgpt.trim.mp4');
const pre = from != null ? ['-ss', String(from)] : [];
const post = to != null ? ['-t', String(to - (from ?? 0))] : [];
ff([...pre, '-i', input, ...post, '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
  '-pix_fmt', 'yuv420p', trimmed]);

const have = probe(trimmed);
const speed = have / target;
console.log(`recording   ${have.toFixed(1)}s`);
console.log(`narration   ${target.toFixed(1)}s`);
console.log(`speed       ${speed.toFixed(2)}x${speed > 3 ? '   very fast — try --from/--to to cut the dead air' : ''}`);

// 2. fit to the line, and match the frame the rest of the cut uses
const out = join(BROLL, '05b-chatgpt.webm');
ff([
  '-i', trimmed,
  '-filter:v',
  `setpts=PTS/${speed},scale=2400:1350:force_original_aspect_ratio=decrease,` +
    'pad=2400:1350:(ow-iw)/2:(oh-ih)/2:color=0x14181a,fps=30',
  '-an', '-c:v', 'libvpx-vp9', '-b:v', '4M', '-row-mt', '1', '-deadline', 'good',
  out,
]);

console.log(`\nwrote  ${out}  (${probe(out).toFixed(1)}s)`);
console.log('\nNow run:  npm run assemble');
console.log('(it prefers this clip over the scripted take while the file exists)');
