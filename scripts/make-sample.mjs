/**
 * Writes the sample payroll to disk as a real file you can drag into the app,
 * or open in Excel for the "this is what I would have uploaded" shot.
 *
 *   npm run sample                 # 50,000 rows, matches the in-app button
 *   npm run sample -- 5000         # smaller, if you want it to open faster
 *
 * It bundles src/sample.ts rather than reimplementing it, so the file on disk
 * is byte-identical to what "Use sample payroll" generates in the page. The
 * demo script quotes specific figures from this data; a second generator that
 * drifted would quietly invalidate them.
 *
 * Output is gitignored. The repo ships the generator, not the data.
 */
import { build } from 'esbuild';
import { mkdirSync, rmSync, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'sample-data');
const tmp = join(outDir, '.sample.bundle.mjs');

const rows = Number(process.argv[2] ?? 50000);
if (!Number.isFinite(rows) || rows < 1) {
  console.error(`Not a row count: ${process.argv[2]}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'sample.ts')],
  outfile: tmp,
  format: 'esm',
  bundle: true,
  platform: 'node',
  logLevel: 'silent',
});

const { generateSampleRows } = await import(pathToFileURL(tmp).href);
rmSync(tmp, { force: true });

// Streamed in blocks. A gigabyte of CSV is past what V8 will hand back as one
// string, and this has to be able to produce files larger than that.
const out = join(outDir, 'employee_compensation_2026.csv');
const sink = createWriteStream(out, { encoding: 'utf8' });
let bytes = 0;
let block = [];

const flush = async (suffix) => {
  const chunk = block.join('\n') + suffix;
  bytes += Buffer.byteLength(chunk);
  if (!sink.write(chunk)) await once(sink, 'drain');
  block = [];
};

for (const line of generateSampleRows({ rows })) {
  block.push(line);
  if (block.length >= 20000) await flush('\n');
}
if (block.length) await flush('');
sink.end();
await once(sink, 'finish');

console.log(`${out}\n${rows.toLocaleString()} rows, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
