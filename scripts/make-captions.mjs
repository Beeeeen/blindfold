/**
 * Builds subtitles from the word timings the synthesiser already produced.
 *
 *   npm run captions        # → docs/demo-assembly.srt
 *
 * YouTube's automatic captions will not spell WebMCP, k-anonymity or
 * sendBeacon, and a judge watching muted or reading in a second language sees
 * those mistakes rather than the argument. These are exact: the timings come
 * from the synthesiser, not from recognition.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const VOICE = join(ROOT, 'voice');
const OUT = join(ROOT, 'docs', 'demo-assembly.srt');

const spec = JSON.parse(readFileSync(join(VOICE, 'narration.json'), 'utf8'));
const durations = JSON.parse(readFileSync(join(VOICE, 'durations.json'), 'utf8'));

// Assembly swaps in the ChatGPT take when it exists, so captions must follow.
const beats = [...spec.beats];
if (existsSync(join(ROOT, 'docs', 'broll', '05b-chatgpt.webm'))) {
  const alt = (spec.optional ?? []).find((o) => o.id === '05b-chatgpt');
  const i = beats.findIndex((b) => b.id === '05-work');
  if (alt && i >= 0) beats[i] = alt;
}

const MAX_WORDS = 9;
const MAX_MS = 4200;

/**
 * The script spells some things out so the synthesiser says them correctly.
 * A reader wants the written form: "A-I" on screen looks like a typo.
 */
const WRITTEN = new Map(Object.entries({
  'A-I': 'AI',
  'X-H-R': 'XHR',
  'S-Q-L': 'SQL',
  'I-D': 'ID',
  'run-S-Q-L': 'run_sql',
  'I-C-four': 'IC4',
  'WebMCP': 'WebMCP',
}));

/**
 * WordBoundary events arrive stripped of punctuation, so captions would break
 * mid-clause and read as one long run-on. Walking the timings against the
 * source line puts the punctuation back, which is what the line-breaking
 * below keys off.
 */
function withPunctuation(words, sourceText) {
  const tokens = sourceText.split(/\s+/).filter(Boolean);
  const bare = (t) => t.replace(/[^\p{L}\p{N}'-]/gu, '').toLowerCase();
  let ti = 0;
  return words.map((w) => {
    const target = bare(w.word);
    // Scan forward a little: the synthesiser occasionally splits or merges.
    for (let k = ti; k < Math.min(ti + 4, tokens.length); k++) {
      if (bare(tokens[k]) === target) {
        const token = tokens[k];
        ti = k + 1;
        const core = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        const trail = token.slice(token.indexOf(core) + core.length);
        return { ...w, word: (WRITTEN.get(core) ?? core) + trail };
      }
    }
    return { ...w, word: WRITTEN.get(w.word) ?? w.word };
  });
}

const stamp = (ms) => {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  const f = String(Math.floor(ms % 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${f}`;
};

const cues = [];
let offset = 0;

for (const beat of beats) {
  const timingFile = join(VOICE, `${beat.id}.timings.json`);
  if (!existsSync(timingFile)) {
    console.error(`no timings for ${beat.id} — run npm run voice`);
    process.exit(1);
  }
  const words = withPunctuation(JSON.parse(readFileSync(timingFile, 'utf8')), beat.text);

  let line = [];
  const flush = () => {
    if (!line.length) return;
    cues.push({
      start: offset + line[0].start_ms,
      end: offset + line[line.length - 1].end_ms,
      text: line.map((w) => w.word).join(' '),
    });
    line = [];
  };

  for (const w of words) {
    line.push(w);
    const span = w.end_ms - line[0].start_ms;
    // Break on sentence punctuation first, then on length, so a caption ends
    // where the voice does rather than mid-clause.
    const endsClause = /[.!?]$/.test(w.word);
    const softBreak = /[,;:—]$/.test(w.word) && line.length >= 5;
    if (endsClause || softBreak || line.length >= MAX_WORDS || span >= MAX_MS) flush();
  }
  flush();

  offset += Math.round(durations[beat.id] * 1000);
}

const srt = cues
  .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`)
  .join('\n');

writeFileSync(OUT, srt, 'utf8');
const last = cues[cues.length - 1];
console.log(`${OUT}`);
console.log(`${cues.length} cues, last ends at ${stamp(last.end)}`);
