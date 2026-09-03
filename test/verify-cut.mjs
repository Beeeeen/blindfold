/**
 * Checks the finished video and its subtitles against the source of truth.
 *
 *   npm run test:cut
 *
 * Three things drift silently and are invisible until someone watches the whole
 * thing with the captions on: a beat whose footage is shorter than its line, a
 * subtitle file built before the last re-cut, and a caption that says something
 * the voice does not. Everything below is measured off the finished mp4 and the
 * narration script, not off my memory of what I changed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MP4 = join(ROOT, 'docs', 'demo-assembly.mp4');
const SRT = join(ROOT, 'docs', 'demo-assembly.srt');
const VOICE = join(ROOT, 'voice');

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

// ffmpeg's filter reports go to stderr. Reading only stdout gets an empty
// string, and every check against it passes for the wrong reason.
const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
};
const probe = (args) => execFileSync('ffprobe', ['-v', 'error', ...args], { encoding: 'utf8' }).trim();

for (const f of [MP4, SRT]) {
  if (!existsSync(f)) {
    console.error(`missing ${f} — run npm run assemble && npm run captions`);
    process.exit(1);
  }
}

const spec = JSON.parse(readFileSync(join(VOICE, 'narration.json'), 'utf8'));
const durations = JSON.parse(readFileSync(join(VOICE, 'durations.json'), 'utf8'));

// Assembly and captions both swap beat 5 when the ChatGPT take exists.
const beats = [...spec.beats];
if (existsSync(join(ROOT, 'docs', 'broll', '05b-chatgpt.webm'))) {
  const alt = (spec.optional ?? []).find((o) => o.id === '05b-chatgpt');
  const i = beats.findIndex((b) => b.id === '05-work');
  if (alt && i >= 0) beats[i] = alt;
}

console.log('\nthe file itself');
const vDur = Number(probe(['-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', MP4]));
const aDur = Number(probe(['-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', MP4]));
const size = probe(['-show_entries', 'format=size', '-of', 'csv=p=0', MP4]);
const dims = probe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0:s=x', MP4]);
console.log(`       ${dims}, ${(Number(size) / 1e6).toFixed(1)} MB, video ${vDur.toFixed(2)}s, audio ${aDur.toFixed(2)}s`);
check('video and audio end together', Math.abs(vDur - aDur) < 0.5, `${(vDur - aDur).toFixed(2)}s apart`);
check('under the 3:00 limit', vDur <= 180, `${vDur.toFixed(1)}s`);
check('1920x1080 at 30fps', dims.startsWith('1920x1080x30'), dims);

console.log('\nevery beat is as long as the line under it');
const expected = beats.reduce((a, b) => a + durations[b.id], 0);
check('total matches the narration', Math.abs(vDur - expected) < 1.2, `cut ${vDur.toFixed(2)}s vs narration ${expected.toFixed(2)}s`);
for (const b of beats) {
  const seg = join(ROOT, 'docs', '.assembly', `${b.id}.seg.mp4`);
  if (!existsSync(seg)) continue;
  const d = Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', seg]));
  check(`${b.id} holds its whole line`, Math.abs(d - durations[b.id]) < 0.05,
    `${d.toFixed(2)}s vs ${durations[b.id].toFixed(2)}s`);
}

console.log('\nthe subtitles');
const cues = readFileSync(SRT, 'utf8').trim().split(/\r?\n\r?\n/).map((block, i) => {
  const lines = block.split(/\r?\n/);
  const m = lines[1]?.match(/(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)/);
  if (!m) throw new Error(`cue ${i + 1} has no timing line`);
  const ms = (h, mm, s, f) => (+h * 3600 + +mm * 60 + +s) * 1000 + +f;
  return {
    n: Number(lines[0]),
    start: ms(m[1], m[2], m[3], m[4]),
    end: ms(m[5], m[6], m[7], m[8]),
    text: lines.slice(2).join(' '),
  };
});
check('numbered 1..n in order', cues.every((c, i) => c.n === i + 1));
check('every cue starts before it ends', cues.every((c) => c.end > c.start));
check('no cue overlaps the next', cues.every((c, i) => i === 0 || c.start >= cues[i - 1].end - 1),
  cues.map((c, i) => (i && c.start < cues[i - 1].end - 1 ? c.n : null)).filter(Boolean).join(', '));
check('the last cue lands inside the video', cues.at(-1).end / 1000 <= vDur,
  `${(cues.at(-1).end / 1000).toFixed(2)}s vs ${vDur.toFixed(2)}s`);
check('nothing is on screen too briefly', cues.every((c) => c.end - c.start >= 500),
  cues.filter((c) => c.end - c.start < 500).map((c) => c.n).join(', '));

console.log('\nthe captions say what the voice says');
// Captions write "AI" where the script spells "A-I" for the synthesiser, so
// compare on letters and digits only.
const bare = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
let cursor = 0;
let offset = 0;
for (const b of beats) {
  const end = offset + durations[b.id] * 1000;
  const mine = [];
  while (cursor < cues.length && cues[cursor].start < end - 1) mine.push(cues[cursor++]);
  const said = bare(b.text);
  const shown = bare(mine.map((c) => c.text).join(' '));
  check(`${b.id}: every word of the line is captioned`, said === shown,
    said === shown ? '' : `${mine.length} cues; first difference at ${
      [...said].findIndex((ch, i) => ch !== shown[i])} of ${said.length}`);
  const strays = mine.filter((c) => c.end > end + 400);
  check(`${b.id}: captions stay inside their beat`, strays.length === 0,
    strays.map((c) => c.n).join(', '));
  offset = end;
}
check('no caption left over at the end', cursor === cues.length, `${cues.length - cursor} unassigned`);

console.log('\nwhat the picture and the sound actually do');
const black = ff(['-i', MP4, '-vf', 'blackdetect=d=0.4:pic_th=0.98', '-an', '-f', 'null', '-']);
const blacks = [...black.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)]
  .map((m) => `${Number(m[1]).toFixed(1)}-${Number(m[2]).toFixed(1)}s`)
  // The cut opens and closes on a fade, which is meant to be there.
  .filter((r) => !r.startsWith('0.0') && Number(r.split('-')[0]) < vDur - 1.2);
check('no black frames mid-cut', blacks.length === 0, blacks.join(', '));

const silence = ff(['-i', MP4, '-af', 'silencedetect=n=-45dB:d=1.6', '-f', 'null', '-']);
const gaps = [...silence.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_duration: ([\d.]+)/g)]
  .map((m) => ({ at: Number(m[1]), len: Number(m[2]) }))
  .filter((g) => g.at > 0.5 && g.at + g.len < vDur - 0.5);
check('no dead air over 1.6s', gaps.length === 0,
  gaps.map((g) => `${g.at.toFixed(1)}s for ${g.len.toFixed(1)}s`).join(', '));

const loud = ff(['-i', MP4, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
const lufs = Number(loud.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
const peak = Number(loud.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
console.log(`       ${lufs} LUFS, true peak ${peak} dBFS`);
check('loudness is within a dB of the -16 LUFS target', Math.abs(lufs + 16) <= 1, `${lufs}`);
check('nothing clips', peak <= -0.5, `${peak} dBFS`);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
