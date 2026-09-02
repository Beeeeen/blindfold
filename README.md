# Blindfold

**Analysis your AI never sees.**

**Live: <https://beeeeen.github.io/blindfold/>**

Blindfold is a data workbench that hands an AI agent the controls to a dataset it
is structurally unable to read. You drop in a spreadsheet of salaries, patient
records or customer accounts. The agent decides what to compute. The page
computes it. Only the answer crosses back.

![Blindfold analysing a payroll file](docs/screenshot.png)

---

## The problem

Every organisation with data worth analysing has a rule against pasting it into a
chatbot, and the rule is correct. Uploading a payroll file to an AI service means
handing over every row, every name, every salary — to answer a question whose
answer is one number.

So the analysis does not happen, or it happens badly, in a spreadsheet, by
somebody who has better things to do.

## The idea

WebMCP tools execute **inside the page**, in the user's own browser tab. That is
not a convenience — it is a different trust model. The data can stay in memory
that the agent has no way to address, while the agent still directs the analysis
through tools it *can* call.

Blindfold makes that concrete:

- The file is read into [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview)
  inside the tab. There is no server. There is no `fetch` of user data anywhere
  in this codebase.
- Every column is graded for re-identification risk before the agent is told it
  exists.
- The agent gets eight structured tools. **None of them accepts SQL.** It fills
  in narrow specs; the page compiles them to queries it controls.
- Every grouped result is passed through k-anonymity suppression before it is
  allowed to become a tool return value.
- A running ledger shows the human exactly how many bytes went in and how few
  came out.

The design rule throughout: **a leak should be impossible to express, not merely
refused after the fact.**

---

## How it works

### 1. Columns are graded before the agent hears about them

| Tier | Meaning | What the agent may do |
|---|---|---|
| `sealed` | Points at one human — name, email, employee ID | Nothing. It cannot group by it, filter on it, measure it, or receive it. |
| `personal` | A personal measurement — salary, balance, score | Aggregate it only. Never group by it, never match it exactly. |
| `category` | A grouping dimension — department, region, level | Group and filter, subject to k-anonymity. |
| `safe` | Everything else | Anything. |

Grading is heuristic — column names, cardinality, type — and heuristics are
wrong sometimes, so **every grade is one click to change** in the UI. Changing
one re-registers the whole toolset immediately, with new descriptions.

### 2. The agent cannot write a query, only fill in a form

There is no `run_sql` tool, deliberately. Free-form SQL cannot be proven
non-disclosive without a full parser and a lot of hope. Instead:

| Tool | Returns |
|---|---|
| `describe_dataset` | Schema, tiers and the rules. No values at all. |
| `list_group_values` | Distinct categories and their counts. |
| `aggregate` | One aggregate, optionally grouped and filtered. |
| `distribution` | Histogram bucket counts. Edges, not contents. |
| `correlate` | A Pearson coefficient and a sample size. |
| `compare_groups` | Two cohort means, the gap, and an effect size. |
| `render_chart` | Nothing. It draws on the human's screen. |
| `policy_report` | What this session has and has not disclosed. |

### 3. Refusals teach

A refusal is returned to the agent as a usable answer, not an exception, so it
can correct itself in one turn:

```
Refused by the disclosure guard.

min/max on "base_salary" would return one real person's exact value.

What to do instead: Use p25, median or p75 — they describe the same
shape without exposing an individual.
```

### 4. Thin groups are suppressed

Any group covering fewer than **k = 5** people is dropped before the agent sees
it. `compare_groups` is stricter still: *both* cohorts must independently clear
k, because a "gap" computed over two people is just those two people's salaries
with extra steps.

### 5. `render_chart` is a one-way mirror

The agent supplies rows it already has and a shape to draw. The chart appears on
the human's screen. What the agent receives back is the word "drawn".

This is the part that only works because the tool runs in the page. A
server-side agent cannot show a person something without first holding it
itself.

---

## Try it

```bash
npm install
npm run dev
```

Then open the page in **ChatGPT's built-in browser** (desktop app, latest
version, GPT-5.6 Sol or Terra), or in **Chrome 146+** with
`chrome://flags/#enable-webmcp-testing` set to Enabled. Turning on
`chrome://flags/#devtools-webmcp-support` as well lets you inspect the
registered tools in DevTools. Verified working on Chrome 152.

Click **Use sample payroll** — it generates 50,000 synthetic employee records in
the tab. Then ask your agent:

> Where is pay least equitable in this company, and show me a chart of it.

It will find that the gender pay gap runs about 3% at IC1-IC3 and 12-14% from
IC4 upward — without ever having seen a salary.

**Want it as a file?** `npm run sample` writes the same 50,000 rows to
`sample-data/employee_compensation_2026.csv` so you can drag it in, or open it in
a spreadsheet to see what you would otherwise have been uploading. Pass a row
count to make it smaller: `npm run sample -- 5000`.

**No agent handy?** Open *Run a tool without an agent* in the ledger panel and
call the same tools by hand. The whole app is reviewable without a WebMCP host.

### Tests

```bash
npm run build
npm run preview      # in one terminal

npm test             # 29 checks: engine, classifier, guard, charts, ledger
npm run test:live    # 14 checks: against Chrome's real WebMCP implementation
npm run test:coverage # 30 checks: user files, every chart kind, every refusal
npm run test:race    # 5 runs: clicking before the engine has finished booting
npm run test:all     # all of the above
```

`npm test` drives a real Chrome and asserts that the compiled SQL runs, that the
classifier grades the sample correctly, and that each thing the guard claims to
refuse is actually refused.

`npm run test:live` launches Chrome with `--enable-features=WebMCP` and goes
through the browser's own API rather than the page's internals: that
`getTools()` lists all eight with their schemas, that `executeTool()` returns
real results, and that refusals reach the host intact. It also covers
re-registration, which is where the interesting bug was — Chrome 152 ships no
`unregisterTool`, so replacing a toolset means aborting the previous batch's
`AbortSignal`. Without that, reclassifying one column throws
`InvalidStateError: Duplicate tool name` and silently strands the agent with
tools describing a file that is no longer loaded.

---

## What this does *not* do

Being straight about the limits, because a privacy tool that oversells itself is
worse than none:

- **This is k-anonymity, not differential privacy.** No noise is added.
  A determined adversary with outside knowledge can still learn things from a
  long series of legal queries. The disclosure budget (2,000 values per session)
  is a blunt backstop against exactly that, not a proof.
- **The classifier is a heuristic.** It reads column names and cardinality. A
  sensitive column with an innocuous name will be graded wrong. That is why the
  override exists, and why the tiers are shown on screen rather than hidden.
- **Column *names* are metadata the agent does see.** If your column is called
  `hiv_status`, the agent learns that such a column exists, though never who is
  in it.
- **`min`/`max` are blocked on personal measurements but allowed elsewhere**, so
  a column graded `category` by mistake can still leak an extreme value.
- **The guarantee is about the agent, not about your device.** Data stays in
  your tab; it does not stay secret from anything else running on your machine.

---

## Stack

- [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview) — the query engine, in the tab
- [Observable Plot](https://observablehq.com/plot/) — charts
- [WebMCP](https://github.com/webmachinelearning/webmcp) — the agent surface
- Vite + TypeScript, no framework, no backend

```
src/
  db.ts         DuckDB-WASM: ingest and raw query. No network calls, by design.
  classify.ts   Grades each column for re-identification risk.
  guard.ts      Compiles specs to SQL; suppresses thin groups. The heart of it.
  tools.ts      The eight WebMCP tools, re-registered per dataset.
  chart.ts      The one-way mirror.
  ledger.ts     Byte accounting.
  sample.ts     Synthetic payroll, generated in-page so no real records ship.
```

## Licence

MIT — see [LICENSE](LICENSE).

Built for the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/).
