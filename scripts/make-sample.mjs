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
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
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

const { generateSampleCsv } = await import(pathToFileURL(tmp).href);
rmSync(tmp, { force: true });

const csv = generateSampleCsv({ rows });
const out = join(outDir, 'employee_compensation_2026.csv');
writeFileSync(out, csv, 'utf8');

const mb = (Buffer.byteLength(csv, 'utf8') / 1024 / 1024).toFixed(1);
console.log(`${out}\n${rows.toLocaleString()} rows, ${mb} MB`);
