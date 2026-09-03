/**
 * Ask Blindfold a question in plain English, with an agent that is not ChatGPT.
 *
 *   node scripts/ask.mjs "Where is pay least equitable in this company?"
 *   node scripts/ask.mjs --file sample-data/employee_compensation_2026.csv "..."
 *
 * WebMCP is a browser standard, not one vendor's plugin surface, so the page
 * should work with whatever agent you point at it. This drives it with Gemini:
 * it reads the tool descriptions out of `document.modelContext.getTools()`,
 * lets the model choose which to call, and executes each choice through
 * `document.modelContext.executeTool()` — the same path ChatGPT's browser uses.
 *
 * The model never sees a row. It sees eight tool descriptions and whatever the
 * disclosure guard decides to return.
 *
 * Needs GEMINI_API_KEY. The repo has no key in it; export one, or point
 * GEMINI_ENV_FILE at a .env that has it.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.TARGET ?? 'https://beeeeen.github.io/blindfold/';

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const envFile = process.env.GEMINI_ENV_FILE;
  if (envFile && existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('GEMINI_API_KEY='));
    if (line) return line.slice('GEMINI_API_KEY='.length).replace(/^"|"$/g, '').trim();
  }
  return null;
}

const KEY = apiKey();
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-lite-latest';
if (!KEY) {
  console.error('Set GEMINI_API_KEY, or GEMINI_ENV_FILE to a .env containing one.');
  process.exit(1);
}

const args = process.argv.slice(2);
const fileFlag = args.indexOf('--file');
const dataFile = fileFlag >= 0 ? resolve(args[fileFlag + 1]) : null;
const question = args.filter((a, i) => !a.startsWith('--') && i !== fileFlag + 1).join(' ')
  || 'Where is pay least equitable in this company, and show me a chart of it.';

/**
 * Gemini takes a subset of JSON Schema. Union types and the bookkeeping fields
 * the WebMCP descriptors carry are rejected outright, so they are stripped
 * rather than sent and hoped for.
 */
function forGemini(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === 'default') continue;
    if (k === 'type' && Array.isArray(v)) { out.type = 'string'; continue; }
    if (k === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(v).map(([name, sub]) => [name, forGemini(sub)]).filter(([, sub]) => sub),
      );
      continue;
    }
    if (k === 'items') { out.items = forGemini(v); continue; }
    out[k] = v;
  }
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}

async function gemini(contents, functionDeclarations) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        tools: [{ functionDeclarations }],
        systemInstruction: {
          parts: [{
            text:
              'You analyse a dataset you cannot see. Call describe_dataset first to learn the columns and ' +
              'the rules. Sealed columns can never be grouped, filtered or returned; personal measurements ' +
              'are aggregate-only. If a call is refused, read the suggested alternative and try that instead ' +
              'of repeating yourself. When you have the answer, call render_chart with the rows you already ' +
              'received so the human can see it, then reply in two or three sentences.',
          }],
        },
      }),
    },
  );
  const json = await res.json();
  if (json.error) throw new Error(`${json.error.status}: ${json.error.message}`);
  return json.candidates?.[0]?.content;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.SHOW ? false : 'new',
  args: ['--no-sandbox', '--enable-features=WebMCP'],
  protocolTimeout: 180000,
});

try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });

  if (dataFile && existsSync(dataFile)) {
    const input = await page.$('#file-input');
    await input.uploadFile(dataFile);
  } else {
    await page.click('#load-sample');
  }
  await page.waitForFunction(
    () =>
      /\d[\d,]* rows/.test(document.querySelector('#dataset-meta')?.textContent ?? '') &&
      (window.blindfold?.listTools()?.length ?? 0) > 0,
    { timeout: 600000 },
  );
  console.log(await page.$eval('#dataset-meta', (e) => e.textContent.replace(/\s+/g, ' ').trim()));

  // Straight from the browser: the same list any WebMCP host would be handed.
  const tools = await page.evaluate(async () =>
    (await document.modelContext.getTools()).map((t) => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
    })));
  console.log(`${tools.length} tools offered by the page\n`);

  const declarations = tools.map((t) => ({
    name: t.name,
    description: t.description.slice(0, 1000),
    parameters: forGemini(t.inputSchema),
  }));

  const exec = (name, argsObj) =>
    page.evaluate(async (n, a) => {
      const list = await document.modelContext.getTools();
      const tool = list.find((t) => t.name === n);
      if (!tool) return `No tool named ${n}`;
      const r = await document.modelContext.executeTool(tool, JSON.stringify(a ?? {}));
      return typeof r === 'string' ? r : r.content.map((c) => c.text).join('\n');
    }, name, argsObj);

  console.log(`> ${question}\n`);
  const contents = [{ role: 'user', parts: [{ text: question }] }];

  for (let turn = 0; turn < 12; turn++) {
    const reply = await gemini(contents, declarations);
    if (!reply) { console.log('(no reply)'); break; }
    contents.push(reply);

    const calls = (reply.parts ?? []).filter((p) => p.functionCall);
    const text = (reply.parts ?? []).filter((p) => p.text).map((p) => p.text).join('');

    if (!calls.length) {
      if (text) console.log(`\n${text.trim()}`);
      break;
    }

    const responses = [];
    for (const { functionCall } of calls) {
      const { name, args: callArgs } = functionCall;
      const shown = JSON.stringify(callArgs ?? {});
      console.log(`  → ${name} ${shown.length > 110 ? shown.slice(0, 110) + '…' : shown}`);
      const result = await exec(name, callArgs);
      const firstLine = result.split('\n')[0];
      console.log(`    ${firstLine.slice(0, 140)}`);
      responses.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  const snap = await page.evaluate(() => window.blindfold.ledger());
  console.log(
    `\nledger: ${(snap.bytesIngested / 1024 / 1024).toFixed(1)} MB read, ` +
    `${snap.bytesReleased} bytes to the agent, 0 raw rows, ` +
    `${snap.callsBlocked} refused, ${snap.groupsSuppressed} groups suppressed`);
} finally {
  await browser.close();
}
