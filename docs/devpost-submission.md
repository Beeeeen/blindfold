# Devpost submission copy

Paste-ready text for the four required fields. Judging is on WebMCP leverage,
execution, potential impact, and creativity — each section below is aimed at one
of those.

---

## Tagline (short)

Analysis your AI never sees. The agent designs the query, the browser runs it,
and the raw rows never leave the page.

---

## Inspiration

Every organisation with data worth analysing has a rule against pasting it into a
chatbot, and the rule is correct. Uploading a payroll file to answer one question
means handing over every row, every name, every salary — to learn a single
number. So the analysis doesn't happen, or it happens badly in a spreadsheet, by
someone with better things to do.

The usual fixes are all about the model: run it locally, sign a DPA, redact first.
WebMCP suggests a different one. If the tool executes *inside the page*, the data
can stay somewhere the agent has no way to address, while the agent still directs
the work. That isn't a convenience — it's a different trust model, and it only
became available when tools started running in the browser.

## What it does

Blindfold is a data workbench you drop a spreadsheet into. It reads the file into
DuckDB-WASM inside your tab — no server, no upload — and exposes eight WebMCP
tools to whatever agent is attached.

The agent can compute almost anything: aggregates, distributions, correlations,
cohort comparisons with effect sizes. It can draw charts on your screen. What it
cannot do is see a row.

- **Columns are graded before the agent hears about them.** Direct identifiers
  (`full_name`, `email`, `employee_id`) are *sealed*: not groupable, not
  filterable, never returned. Personal measurements (`base_salary`) are
  aggregate-only. Every grade is one click to override, and changing one
  re-registers the entire toolset with new descriptions.
- **There is no SQL tool.** Deliberately. Free-form SQL can't be proven
  non-disclosive without a parser and a lot of hope. The agent fills in narrow
  structured specs and the page compiles them to queries it controls. A leak
  should be impossible to *express*, not merely refused afterwards.
- **k-anonymity, enforced.** Any group covering fewer than five people is
  suppressed before it becomes a return value. `compare_groups` is stricter: both
  cohorts must independently clear k, because a "gap" computed over two people is
  just those two salaries with extra steps.
- **Refusals teach.** `min`/`max` on a salary is blocked — a maximum *is* one real
  person's pay — and the refusal tells the agent to use p25/median/p75 instead, so
  it recovers on the next turn rather than giving up.
- **A ledger, on screen.** Bytes into the page versus bytes released to the agent,
  values spent against a disclosure budget, calls refused, groups suppressed.

On the 50,000-row sample it finds a real seeded result — a gender pay gap of about
3% at IC1-IC3 and 12-14% from IC4 upward — having read 4.9 MB and disclosed about
3.7 KB of aggregates.

## How we built it

Vite, TypeScript, no framework, no backend. DuckDB-WASM is the query engine;
Observable Plot draws.

Tools register through `document.modelContext.registerTool()`, with a fallback to
`navigator.modelContext` so the page works in ChatGPT's built-in browser and in
Chrome 146+ behind the testing flag.

Three WebMCP details did most of the work:

1. **Tools are registered per dataset, not once at load.** Descriptions name the
   actual columns and their tiers, so the agent reads what it may ask for instead
   of discovering it by trial. Loading a second file unregisters the first file's
   tools.
2. **`render_chart` is a one-way mirror.** The agent supplies aggregates and a
   shape; the chart appears on the human's screen; the return value is the word
   "drawn". A server-side agent cannot show a person something without first
   holding it. This one can — that asymmetry is only available in-page.
3. **Refusals are return values, not exceptions.** Each carries the reason and a
   legal alternative, which turns the guard into something the agent can navigate
   rather than something it fights.

## Challenges we ran into

Getting the privacy claim to be *true* rather than *plausible* was most of the
work. The first design let the agent write SQL with a result-level check, which
is theatre — you can always find a query whose output is technically aggregated
but practically a row. Dropping SQL entirely and compiling from specs was the
change that made the guarantee real.

Then the second-order leaks: `MIN`/`MAX` returns an individual's exact value;
grouping on a high-cardinality numeric produces one group per person; an
exact-match filter on salary targets whoever holds it; and a long series of
individually-harmless queries reconstructs rows by differencing. Each needed its
own rule, and the last one is why there is a session budget rather than just
per-query checks.

On the WebMCP side, the sharp edge was re-registration. Because the toolset is
rebuilt whenever a dataset loads or a column is reclassified, tools have to be
withdrawn and re-offered — and Chrome 152 ships no `unregisterTool` at all. The
spec's answer is the `AbortSignal` passed alongside each registration: abort the
previous batch and its tools go with it. Until we found that, reclassifying a
single column threw `InvalidStateError: Duplicate tool name`, and because the
failure was swallowed the status bar cheerfully kept claiming eight tools were
on offer while the agent held tools describing a file that was no longer loaded.
That one only showed up when we started testing against the browser's real
implementation instead of our own abstraction over it.

A DuckDB precision bug also cost an hour — interpolating JS floats into SQL made
DuckDB read them as DECIMALs, and multiplying them compounded the scale until
histogram bin edges no longer fit a JS number. Explicit `CAST(... AS DOUBLE)`
fixed it. Caught by the smoke test, not by reading the code.

## Accomplishments that we're proud of

A privacy tool that states its own limits. The README has a "What this does not
do" section covering the differencing risk, the heuristic classifier, and the
fact that column *names* are metadata the agent does see. k-anonymity is not
differential privacy and the project says so.

Also: 76 automated checks driving a real Chrome, asserting not just that the
queries run but that every refusal the guard advertises actually fires — and
14 of them go through the browser's own WebMCP API rather than our abstraction
over it, which is the only reason we found the re-registration bug at all.

## What we learned

That "the tool runs in the page" is the whole point of WebMCP, and most of the
interesting designs come from asking what the page can do that a server cannot.
Holding data the agent can't reach is one. Showing a human something the agent
never sees is another.

## What's next

Differential privacy with a real epsilon budget instead of a cell count. A
join-aware guard for multi-table workbooks. And an audit export — a signed
receipt of every question asked and every answer released, which is the artefact
a compliance team actually needs before they will let this near production data.

## Built with

`webmcp` `duckdb-wasm` `typescript` `vite` `observable-plot` `k-anonymity`
`privacy-engineering`

---

## Submission checklist

- [x] Live URL, HTTPS, reachable in ChatGPT's browser or Chrome + flag — https://beeeeen.github.io/blindfold/
- [x] Public repo, MIT licence, full source — https://github.com/Beeeeen/blindfold
- [ ] Demo video under 3:00, public on YouTube, **with audio**
- [ ] Text description covering use-case fit, UX benefit, implementation
- [ ] Submitted before **3 Sep 2026, 13:00 PDT** (4 Sep, 04:00 Taiwan)
