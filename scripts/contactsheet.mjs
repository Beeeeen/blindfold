/**
 * Builds a contact sheet from a long recording, so the moments worth cutting
 * can be found by looking rather than by scrubbing.
 *
 *   npm run contactsheet -- path/to/recording.mp4
 *   npm run contactsheet -- recording.mp4 --every 5
 *
 * Writes numbered sheets to docs/.contact/, each tile stamped with its
 * timestamp so a chosen tile converts straight into --from/--to.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs', '.contact');

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const everyFlag = args.indexOf('--every');
const every = everyFlag >= 0 ? Number(args[everyFlag + 1]) : 4;

if (!src || !existsSync(resolve(src))) {
  console.error('Usage: npm run contactsheet -- path/to/recording.mp4 [--every 4]');
  process.exit(1);
}
const input = resolve(src);

const duration = Number(
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input], {
    encoding: 'utf8',
  }).trim(),
);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The drive colon has to reach ffmpeg escaped, so the JS string needs a real
// backslash in it.
const FONT = process.env.CONTACT_FONT ?? 'C\\:/Windows/Fonts/consola.ttf';

const COLS = 4;
const ROWS = 4;
const perSheet = COLS * ROWS;
const tiles = Math.ceil(duration / every);
const sheets = Math.ceil(tiles / perSheet);

console.log(`${(duration / 60).toFixed(1)} min, a frame every ${every}s → ${tiles} tiles across ${sheets} sheet(s)`);

for (let s = 0; s < sheets; s++) {
  const start = s * perSheet * every;
  const span = Math.min(perSheet * every, duration - start);
  const out = join(OUT, `sheet-${String(s + 1).padStart(2, '0')}.jpg`);
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-ss', String(start), '-i', input, '-t', String(span),
    '-vf',
    // Stamp each tile with its absolute time so a tile maps back to a cut point.
    // The font has to be named explicitly: this ffmpeg has no fontconfig, and
    // a Windows path needs its drive colon escaped inside a filter argument.
    `fps=1/${every},scale=480:-2,` +
      `drawtext=fontfile='${FONT}':text='%{eif\\:trunc((n*${every})+${Math.round(start)})\\:d}s':` +
      `x=8:y=8:fontsize=26:fontcolor=white:box=1:boxcolor=0x000000AA:boxborderw=6,` +
      `tile=${COLS}x${ROWS}:padding=6:color=0x14181a`,
    '-frames:v', '1', out,
  ]);
  console.log(`  ${out}  (${Math.round(start)}s – ${Math.round(start + span)}s)`);
}

console.log(`\n${readdirSync(OUT).length} sheet(s) in ${OUT}`);
console.log('Each tile is labelled with its second; use those for --from / --to.');
