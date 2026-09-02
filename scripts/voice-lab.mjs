/**
 * A/B bench for the narration voice.
 *
 *   npm run voice:lab
 *
 * Synthesises the same line in each candidate voice, dry and mastered, and
 * concatenates them into one file with the labels spoken aloud. Listen to
 * voice/lab/comparison.mp3 and pick — guessing which one sounds warmer from a
 * personality tag is not the same as hearing it against your own script.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const LAB = join(ROOT, 'voice', 'lab');
const HELPER =
  process.env.EDGE_TTS_HELPER ??
  'c:/Users/BenYang/Documents/Beeeeen/content-factory/app/internal/tts/edge_tts_helper.py';

rmSync(LAB, { recursive: true, force: true });
mkdirSync(LAB, { recursive: true });

const LINE =
  'But a counter reading zero is just this page marking its own homework. ' +
  'So the page revokes its own network access. Watch me try to leak the data on purpose.';

const VOICES = [
  ['ava', 'en-US-AvaMultilingualNeural'],
  ['andrew', 'en-US-AndrewMultilingualNeural'],
  ['brian', 'en-US-BrianMultilingualNeural'],
  ['emma', 'en-US-EmmaMultilingualNeural'],
];

/**
 * What separates a recorded voice from a synthesised one is mostly not the
 * synthesis — it is that nobody put the result through a desk. Gentle
 * high-pass, a dip where TTS gets boxy, a lift for presence and air, slow
 * compression to even out the delivery, a room so small you only miss it when
 * it is gone, and a broadcast loudness target.
 */
export const MASTER = [
  'highpass=f=75',
  'equalizer=f=220:t=q:w=1.2:g=-2.5',
  'equalizer=f=2800:t=q:w=1.8:g=2',
  'equalizer=f=9500:t=h:g=2.5',
  'acompressor=threshold=-19dB:ratio=3:attack=12:release=200:makeup=2',
  'aecho=0.9:0.25:22:0.09',
  'loudnorm=I=-16:TP=-1.5:LRA=11',
].join(',');

const ff = (a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a], { stdio: 'pipe' });
const say = (text, voice, out, rate = '-4%') => {
  const txt = out.replace(/\.mp3$/, '.txt');
  writeFileSync(txt, text, 'utf8');
  execFileSync('python', [HELPER, '--text-file', txt, '--voice', voice, `--rate=${rate}`,
    '--out-audio', out, '--out-timings', out.replace(/\.mp3$/, '.json')], { stdio: 'pipe' });
};

const parts = [];
for (const [name, voice] of VOICES) {
  const label = join(LAB, `_label-${name}.mp3`);
  say(`${name}. dry.`, 'en-US-EmmaMultilingualNeural', label, '+10%');

  const dry = join(LAB, `${name}-dry.mp3`);
  say(LINE, voice, dry);

  const wet = join(LAB, `${name}-mastered.mp3`);
  ff(['-i', dry, '-af', MASTER, '-c:a', 'libmp3lame', '-b:a', '192k', wet]);

  const labelWet = join(LAB, `_label-${name}-wet.mp3`);
  say(`${name}. mastered.`, 'en-US-EmmaMultilingualNeural', labelWet, '+10%');

  parts.push(label, dry, labelWet, wet);
  console.log(`  ${name.padEnd(8)} dry + mastered`);
}

const list = join(LAB, 'concat.txt');
writeFileSync(list, parts.map((p) => `file '${p.split('\\').join('/')}'`).join('\n'));
const out = join(LAB, 'comparison.mp3');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '192k', out]);

console.log(`\n${out}`);
console.log('Each voice twice: raw, then through the mastering chain.');
