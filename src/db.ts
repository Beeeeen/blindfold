import * as duckdb from '@duckdb/duckdb-wasm';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

/**
 * The engine. Everything in this file runs inside the page's own memory.
 * No row of the user's data is ever sent anywhere -- there is no fetch(),
 * no XHR and no WebSocket in this module, by design.
 */

export type ColumnType = 'number' | 'string' | 'date' | 'boolean';

export interface ColumnInfo {
  name: string;
  sqlType: string;
  type: ColumnType;
  distinctCount: number;
  nullCount: number;
}

export interface DatasetInfo {
  table: string;
  fileName: string;
  byteSize: number;
  rowCount: number;
  columns: ColumnInfo[];
}

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let ready: Promise<void> | null = null;

async function boot(): Promise<void> {
  // Only the exception-handling build ships. Every browser that has WebMCP is
  // modern Chromium, which has had wasm exception handling for years, and the
  // unused MVP bundle is another 38 MB in the deploy for nobody.
  const ehBundle = { mainModule: ehWasm, mainWorker: ehWorker };
  const bundle = await duckdb.selectBundle({ mvp: ehBundle, eh: ehBundle });
  const worker = new Worker(bundle.mainWorker!);
  const instance = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await instance.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await instance.connect();
  db = instance;
}

/**
 * Memoised on the promise, not on the handle. Guarding with `if (db) return`
 * lets a second caller through the moment the instance exists but before its
 * connection does — which is exactly what happens when someone clicks the
 * sample button while the page is still starting up, and it surfaces as
 * "database not ready" with no way back except a reload.
 */
export function initDb(): Promise<void> {
  if (!ready) {
    ready = boot().catch((err) => {
      ready = null; // let a later attempt retry rather than fail forever
      throw err;
    });
  }
  return ready;
}

function normaliseType(sqlType: string): ColumnType {
  const t = sqlType.toUpperCase();
  if (/INT|DECIMAL|NUMERIC|REAL|DOUBLE|FLOAT|HUGEINT/.test(t)) return 'number';
  if (/DATE|TIME/.test(t)) return 'date';
  if (/BOOL/.test(t)) return 'boolean';
  return 'string';
}

/** Convert Arrow scalars (BigInt, Date, ...) into plain JSON-safe values. */
export function plain(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'toString' in (v as object)) {
    const prim = (v as { valueOf(): unknown }).valueOf();
    if (typeof prim === 'bigint') return Number(prim);
  }
  return v as unknown;
}

/** Run SQL and hand back plain JS rows. Internal only -- never exposed to an agent. */
export async function rawQuery(sql: string): Promise<Record<string, unknown>[]> {
  if (!conn) throw new Error('database not ready');
  const result = await conn.query(sql);
  return result.toArray().map((row) => {
    const obj: Record<string, unknown> = {};
    for (const field of result.schema.fields) obj[field.name] = plain(row[field.name]);
    return obj;
  });
}

export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export function quoteLiteral(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/**
 * Ingest a File the user dropped in. The bytes go from the OS file picker
 * straight into wasm memory; they never touch the network.
 */
export async function loadFile(file: File, table = 'data'): Promise<DatasetInfo> {
  if (!db || !conn) throw new Error('database not ready');
  const ext = file.name.toLowerCase().split('.').pop() ?? 'csv';
  await db.registerFileHandle(file.name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);

  const reader =
    ext === 'parquet'
      ? `read_parquet(${quoteLiteral(file.name)})`
      : ext === 'json' || ext === 'ndjson'
        ? `read_json_auto(${quoteLiteral(file.name)})`
        : `read_csv_auto(${quoteLiteral(file.name)}, SAMPLE_SIZE=-1)`;

  await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
  await conn.query(`CREATE TABLE ${quoteIdent(table)} AS SELECT * FROM ${reader}`);

  const described = await rawQuery(`DESCRIBE ${quoteIdent(table)}`);
  const countRow = await rawQuery(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`);
  const rowCount = Number(countRow[0]?.n ?? 0);

  const columns: ColumnInfo[] = [];
  for (const d of described) {
    const name = String(d.column_name);
    const sqlType = String(d.column_type);
    const stats = await rawQuery(
      `SELECT COUNT(DISTINCT ${quoteIdent(name)}) AS d,
              COUNT(*) FILTER (WHERE ${quoteIdent(name)} IS NULL) AS nulls
       FROM ${quoteIdent(table)}`,
    );
    columns.push({
      name,
      sqlType,
      type: normaliseType(sqlType),
      distinctCount: Number(stats[0]?.d ?? 0),
      nullCount: Number(stats[0]?.nulls ?? 0),
    });
  }

  return { table, fileName: file.name, byteSize: file.size, rowCount, columns };
}
