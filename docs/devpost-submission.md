# Devpost submission copy

Paste-ready text for the four required fields. Judging is on WebMCP leverage,
execution, potential impact, and creativity — each section below is aimed at one
of those.

---

## Tagline (short)

Analyse a file your AI could never read — without showing it a single row.
A million rows in the tab. 27 KB to the agent. Zero rows disclosed.

---

## The four things the rules ask the description to explain

Answered directly, before the narrative sections below.

### Why this use case is a strong fit for WebMCP

Because the guarantee depends on *where the code runs*. A server-side MCP would
have to hold the data in order to analyse it — the privacy claim would be a
promise about someone's backend. In-page, the rows sit in memory the agent has
no way to address, while the agent still directs the whole analysis.

Take WebMCP away and this project does not degrade into a worse version of
itself. It stops existing.

### How it creates a better user experience

You can point an agent at a 99 MB spreadsheet and have an answer in seconds,
without either of the two things that normally stop you: the context window and
the upload.

When the guard refuses, the refusal arrives with a legal alternative — "use p25,
median or p75" — so the agent corrects itself on the next turn instead of
dead-ending. And the page keeps a receipt: every byte that crossed to the agent,
verbatim, searchable, exportable.

### What people and agents can do together that was difficult or impossible before

Three things, in increasing order of how much WebMCP is doing:

1. **Analyse a file larger than any context window, without sampling.** A
   million rows is ~26 million tokens. The agent answers questions about all of
   it because it never reads any of it.
2. **Delegate authority over data you are not willing to disclose.** You can now
   hand an agent the controls to a payroll file while it stays structurally
   unable to read a row. Delegation and disclosure used to be the same act.
3. **Have an agent show you something it never saw itself.** `render_chart`
   takes aggregates and a shape, draws on the human's screen, and returns one
   sentence saying it is up and that nothing came back with it. The person gets
   the picture; the model gets zero bytes of data. A
   server-side agent cannot show you anything without first holding it.

### How we implemented WebMCP

`document.modelContext.registerTool()` (with a `navigator.modelContext`
fallback for hosts still on the pre-150 Chromium location), eight tools, no SQL.

The parts that took real work:

- **Re-registered per dataset**, so tool descriptions name that file's actual
  columns and tiers rather than describing a generic shape.
- **Withdrawal by `AbortSignal`.** Chrome 152 ships no `unregisterTool`, so
  aborting the previous batch is the only way to replace a toolset without
  colliding with names already registered.
- **Refusals as return values, not exceptions**, each carrying a reason and a
  legal alternative.
- **A write tool that returns nothing.** `render_chart` mutates the page and
  discloses zero bytes.

## Inspiration

Every real dataset hits two walls at once, and they are usually treated as
separate problems.

The first is size. A 99 MB spreadsheet is roughly 26 million tokens. No model
reads that, so people paste a sample and get an answer about the sample.

The second is disclosure. Uploading the whole file to answer one question means
handing over every name and salary in it, which is why most organisations ban it
outright.

The realisation that started this project is that both walls have the same door.
If the agent never reads the rows, the file can be any size *and* nothing has to
be disclosed — those stop being two features and become one consequence of the
same design. WebMCP is what makes it reachable: the tool executes inside the
page, so the data can sit in memory the agent has no way to address while the
agent still directs the work. That is not a convenience. It is a different trust
model, and it only became available when tools started running in the browser.

## What it does

Blindfold is a data workbench you drop a spreadsheet into. It reads the file into
DuckDB-WASM inside your tab — no server, no upload — and exposes eight WebMCP
tools to whatever agent is attached.

The agent can compute almost anything: aggregates, distributions, correlations,
cohort comparisons with effect sizes. It can draw charts on your screen. What it
cannot do is see a row.

- **The page revokes its own network access.** A counter reading zero is the page
  marking its own homework, so once the engine boots Blindfold injects a CSP
  taking away its own ability to reach the network — `connect-src 'none'`,
  `form-action 'none'`, `img-src data:`. From then on the *browser* refuses
  fetch, XHR, WebSocket, sendBeacon and tracking pixels. There is a button that
  attempts all five so you can watch them fail, and you can read the policy out
  of `document.head` yourself.
- **There is no SQL tool.** Deliberately. Free-form SQL can't be proven
  non-disclosive without a parser and a lot of hope. The agent fills in narrow
  structured specs and the page compiles them to queries it controls. A leak
  should be impossible to *express*, not merely refused afterwards.
- **Columns are graded before the agent hears about them.** Direct identifiers
  (`full_name`, `email`, `employee_id`) are *sealed*: not groupable, not
  filterable, never returned. Personal measurements (`base_salary`) are
  aggregate-only. Every grade is one click to override, and changing one
  re-registers the entire toolset with new descriptions.
- **k-anonymity, enforced.** Any group covering fewer than five people is
  suppressed before it becomes a return value. `compare_groups` is stricter: both
  cohorts must independently clear k, because a "gap" computed over two people is
  just those two salaries with extra steps.
- **Refusals teach.** `min`/`max` on a salary is blocked — a maximum *is* one real
  person's pay — and the refusal tells the agent to use p25/median/p75 instead, so
  it recovers on the next turn rather than giving up.
- **A ledger, on screen.** Bytes into the page versus bytes released to the agent,
  values spent against a disclosure budget, calls refused, groups suppressed.
- **A transcript, not a summary.** Every call is stored with the exact text that
  went back, character for character. Search it for a name and there is none.

Measured on a million rows — 99 MB, about 26 million tokens of text:

| | |
|---|---|
| Read and classified | 3.2 s |
| Median salary by department | 0.07 s |
| Pay gap by level, both cohorts k-checked | 0.11 s |
| Salary histogram by level | 0.11 s |
| Tenure vs pay, per department | 0.04 s |
| Bonus by level × region × department | 0.09 s |
| Sent to the agent | 27 KB, about 6,800 tokens |
| Raw rows sent to the agent | 0 |

Pushed further on the same machine: 5,000,000 rows (502 MB) answers in 0.42s,
and 10,000,000 rows — a full gigabyte, about 264 million tokens — still answers
every query in under a second, releasing 7 KB. The disclosure ratio there is
1 : 37,369.

One byte reached the agent for every 3,799 that did not, and on the way it found
a real seeded result: a gender pay gap of about 3% at IC1–IC3 that widens to
12–14% from IC4 upward. The model never saw a salary.

That 27 KB is five questions' worth. Ask fewer and it is a couple of kilobytes;
ask a hundred and it climbs, which is exactly why there is a disclosure budget
rather than only a per-query check. The number that does not move is the one
underneath it: zero rows, at any question count.

## How we built it

Vite, TypeScript, no framework, no backend. DuckDB-WASM is the query engine;
Observable Plot draws.

Tools register through `document.modelContext.registerTool()`, with a fallback to
`navigator.modelContext` so the page works in ChatGPT's built-in browser and in
Chrome 149+ behind the testing flag.

Three WebMCP details did most of the work:

1. **Tools are registered per dataset, not once at load.** Descriptions name the
   actual columns and their tiers, so the agent reads what it may ask for instead
   of discovering it by trial. Loading a second file unregisters the first file's
   tools.
2. **`render_chart` is a one-way mirror.** The agent supplies aggregates and a
   shape; the chart appears on the human's screen; the return value is a sentence
   confirming it, carrying zero bytes of data. A server-side agent cannot show a
   person something without first
   holding it. This one can — that asymmetry is only available in-page.
3. **Refusals are return values, not exceptions.** Each carries the reason and a
   legal alternative, which turns the guard into something the agent can navigate
   rather than something it fights.

The hardest question this project has to answer is not "is it private" but "how
would I know". Being open source is not an answer, because nobody reads the
source; a ledger is not an answer, because the page computes it. The two things
that actually transfer are a policy the *browser* enforces and the verbatim text
of everything that crossed. Both are in the UI, and both are checkable in about
fifteen seconds by someone who assumes we are lying.

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

The one that mattered most was found by writing the attacker instead of the
test. The pitch says a leak should be impossible to *express*, and that is worth
nothing until somebody has honestly tried. Four permitted filters —
department, level, region, gender — narrow this dataset to exactly one person,
and `avg` over that cohort returned 67,100: their salary, through calls the
guard allowed at every step. k-anonymity was only ever applied to *grouped*
results, and an ungrouped aggregate returns a single row, so it walked around
the check that the whole design rested on. The min/max rule was guarding the
front door while this stood open beside it.

Ungrouped aggregates are now checked against the cohort their filters describe,
and an empty cohort is refused in the same words as a cohort of four — refusing
only 1–4 would answer "is anybody here?" by the shape of the response.
`npm run test:attack` keeps trying, from the attacker's side, and a failure
there is a finding rather than a broken test.

A DuckDB precision bug also cost an hour — interpolating JS floats into SQL made
DuckDB read them as DECIMALs, and multiplying them compounded the scale until
histogram bin edges no longer fit a JS number. Explicit `CAST(... AS DOUBLE)`
fixed it. Caught by the smoke test, not by reading the code.

## Accomplishments that we're proud of

A privacy tool that states its own limits. The README has a "What this does not
do" section covering the differencing risk, the heuristic classifier, and the
fact that column *names* are metadata the agent does see. k-anonymity is not
differential privacy and the project says so.

Also: 116 automated checks driving a real Chrome, asserting not just that the
queries run but that every refusal the guard advertises actually fires — and
14 of them go through the browser's own WebMCP API rather than our abstraction
over it, which is the only reason we found the re-registration bug at all.

## What we learned

That "the tool runs in the page" is the whole point of WebMCP, and most of the
interesting designs come from asking what the page can do that a server cannot.
Holding data the agent can't reach is one. Showing a human something the agent
never sees is another.

## The question we could not answer at first

An early reviewer asked how a user is supposed to *know* the AI never got their
data, given the ledger is computed by the same page making the claim. That was
fair, and the honest answer at the time was "read the source".

The fix came from realising a page can tighten its own Content Security Policy
after load, and that Chrome honours it. Nothing here needs the network once
DuckDB's wasm is instantiated, so the app now takes that capability away from
itself the moment the engine is ready. Verified from outside the page: the test
driver watches the network and confirms nothing ever reaches a third party,
while the deliberate exfiltration probes show up as failures.

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
- [ ] Leave the site up: judging runs to **21 Sep 2026, 17:00 PDT**, and the
      rules require the project stay free and unrestricted for testing until then
