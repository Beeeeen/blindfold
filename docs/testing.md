# How to test Blindfold

Four ways, in order of setup cost. Only route 2 answers the question that still
matters — whether it works in ChatGPT's own browser.

The dev server:

```bash
npm run build && npm run preview -- --host 127.0.0.1     # http://127.0.0.1:4173
# or, for live reload while editing:
npm run dev -- --host 127.0.0.1                          # http://127.0.0.1:5173
```

`localhost` counts as a secure context, so WebMCP works without HTTPS.

Pass `--host 127.0.0.1`. Left alone, Vite binds `localhost`, which on Windows
resolves to the IPv6 `::1` — so `http://127.0.0.1:4173` refuses the connection
while `http://localhost:4173` works. Since OpenAI's own docs use the
`127.0.0.1` form, that mismatch costs you a confusing round of "the page won't
load". Binding explicitly makes both addresses answer.

---

## 1. No agent, no flags — 30 seconds

Works in any browser, including the one you already have open.

1. Open <http://localhost:4173>
2. Click **Use sample payroll** (50,000 rows, generated in the tab)
3. In the right-hand panel, open **Run a tool without an agent**
4. Pick a tool, edit the JSON, press **Call tool**

Try these in order — the last two are the interesting ones:

```json
{ "agg": "median", "metric": "base_salary", "group_by": ["department"] }
```
```json
{ "metric": "base_salary", "split_by": "gender",
  "group_a": "F", "group_b": "M", "within": "level" }
```
```json
{ "agg": "max", "metric": "base_salary" }
```
```json
{ "agg": "count", "group_by": ["full_name"] }
```

The first two answer. The last two are refused, with a reason and a legal
alternative. Watch the **Disclosure ledger** while you do it.

**This proves:** the engine, the guard, the ledger. **It does not prove**
anything about WebMCP — this path calls the handlers directly.

---

## 2. ChatGPT desktop app — the one that still needs checking

This is what the submission is judged in, and the only route that shows an agent
actually driving the tools.

**Prerequisites**

- ChatGPT desktop app, updated to the latest version
- Model set to **GPT-5.6 Sol** or **Terra** — Luna has WebMCP disabled
- Not an Enterprise or Edu workspace (site tools are unavailable there)

**Steps**

1. Open the built-in browser: **Ctrl+Shift+B** on Windows, **Cmd+Shift+B** on
   Mac, or the browser icon in the toolbar. It keeps its own profile and
   history, separate from your normal Chrome.
2. Type `http://127.0.0.1:4173/` in the address bar. Include the scheme and the
   trailing slash, or the address bar may treat it as a search term.
3. Click **Use sample payroll**
4. Check the top-right pill reads **WebMCP connected — 8 tools offered**
5. **Site tools** appears in the address bar when a page offers them — open it
   and choose **Available site tools** to list all eight
6. Ask, in the chat:

   > Where is pay least equitable in this company, and show me a chart of it.

   Expect: several tool calls in the page's *What the agent asked* feed, a chart
   drawn on the page, and an answer naming a gap of roughly 2% at junior levels
   and 13% from IC4 upward.

7. Then try to break it:

   > Who is the highest paid person here? Give me their name and salary.

   Expect: two refusals in red, and the model recovering by asking for a median
   or a percentile instead of giving up.

**If step 4 says no host was found**, the model is probably Luna, or the app
needs updating. If the page will not load at all in that browser, serve it over
HTTPS instead of localhost and use that URL.

---

## 3. Chrome 152 + DevTools — proves registration without an LLM

Enabling the flag gives the page the WebMCP API. It does **not** put an agent in
Chrome — nothing will call your tools on its own. Use this to confirm the tools
register correctly and to invoke them the way a host would.

1. `chrome://flags/#enable-webmcp-testing` → **Enabled**
2. `chrome://flags/#devtools-webmcp-support` → **Enabled**
3. Relaunch Chrome, open <http://localhost:4173>, load the sample
4. DevTools → the WebMCP panel lists the registered tools and lets you run them

Or drive it from the console:

```js
const tools = await document.modelContext.getTools();
tools.map(t => t.name);

const agg = tools.find(t => t.name === 'aggregate');
// note: executeTool takes the tool handle and a JSON *string*
await document.modelContext.executeTool(
  agg,
  JSON.stringify({ agg: 'median', metric: 'base_salary', group_by: ['department'] })
);
```

---

## 4. Automated — what CI would run

```bash
npm run build
npm run preview        # leave running in one terminal

npm run test:all       # in another
```

| Suite | Checks | What it covers |
|---|---|---|
| `test` | 29 | engine, classifier, guard, charts, ledger |
| `test:live` | 14 | real WebMCP: `getTools`, `executeTool`, re-registration |
| `test:coverage` | 33 | user-supplied CSV / Parquet / JSON, every chart kind, every refusal branch |
| `test:race` | 5 runs | clicking the sample button before the engine has booted |

All four drive a real Chrome via `puppeteer-core`. Set `CHROME_PATH` if Chrome
is not at the default Windows location.

---

## What is still unverified

Route 2 has never been run. Everything else has. The gap that matters is whether
ChatGPT's host passes tool arguments the same way Chrome does — there is a
defensive JSON-string parse in `guarded()` in `src/tools.ts` covering the
difference, but that is a precaution, not a measurement.
