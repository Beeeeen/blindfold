# Demo video script — 2:45

Requirement: under 3 minutes, public YouTube, **with audio narration**, showing
the project working live.

## Before you record

- [ ] ChatGPT desktop app updated, model set to **GPT-5.6 Sol or Terra**
      (Luna has WebMCP disabled). Not an Enterprise or Edu workspace.
- [ ] *Or* Chrome 146+ with `chrome://flags/#enable-webmcp-testing` set to Enabled
      (confirmed working on Chrome 152). Optionally also
      `chrome://flags/#devtools-webmcp-support` to show the tool list in DevTools.
- [ ] Site served over HTTPS or `localhost` — WebMCP needs a secure context.
- [ ] Load the page once beforehand so the ~8 MB DuckDB wasm is cached. A cold
      load in the video is dead air.
- [ ] Click **Use sample payroll** once, then reload — proves generation speed
      without making the viewer watch it.
- [ ] Screen at 1440p or higher, browser zoom ~110% so the ledger numbers read.

---

## 0:00 – 0:20 · The problem, stated once

> "This is a payroll file. Fifty thousand employees — names, emails, salaries.
> If I paste this into an AI chat to ask one question, I have just handed over
> every row. So in most companies, this analysis never happens."

**On screen:** the file open in a spreadsheet, scrolling. Names and salaries
visible. Close it.

## 0:20 – 0:45 · Load it, show the grading

> "Blindfold opens it inside the browser tab. Nothing is uploaded. And before
> the agent is even told this file exists, every column gets graded."

**On screen:** drop the file in. Point at the left panel:
`employee_id`, `full_name`, `email` → **sealed**. `base_salary` → **personal**.
`department`, `level`, `gender` → **category**.

> "Sealed means the agent cannot group by it, filter on it, or ever receive it."

## 0:45 – 1:00 · The tools appear

**On screen:** the status pill flips to **WebMCP connected — 8 tools offered**.
Open ChatGPT's address-bar tool list to show the eight names.

> "The page registers eight WebMCP tools. Note what is not there: there is no
> 'run SQL' tool. The agent can't write a query. It fills in a form, and the
> page compiles it."

## 1:00 – 1:45 · The agent does real work

**Type into ChatGPT:**

> `Where is pay least equitable in this company, and show me a chart of it.`

**On screen:** let the tool calls run. The "What the agent asked" feed fills in
live. A chart appears on the page.

> "It's calling describe_dataset, then compare_groups, then rendering. Watch the
> ledger on the right — four point nine megabytes went into this page. Three
> kilobytes have come back out. Zero raw rows."

**Let the answer land:** the gap is ~2% at junior levels and ~13% from IC4 up.

> "That's a real finding, and the model never saw a single salary."

## 1:45 – 2:15 · Try to break it

**Type:**

> `Who is the highest paid person here? Give me their name and salary.`

**On screen:** the feed shows two red refusals.

> "It tried. Grouping by name is refused — that's a sealed column. Max on salary
> is refused too, because a maximum *is* one real person's pay. And notice the
> refusal tells it what to ask instead — median, p25, p75. So it recovers on the
> next turn instead of giving up."

## 2:15 – 2:35 · Why in-page matters

**On screen:** point at the chart, then at the ledger.

> "The chart tool is the part that only works inside the page. The agent hands
> over aggregates and a shape. The picture renders on my screen. What the agent
> gets back is the word 'drawn'. A server-side agent can't show you something
> without holding it first. This one can."

## 2:35 – 2:45 · Close

> "k-anonymity of five, a disclosure budget, and a receipt for every byte.
> Blindfold. The agent runs the analysis — it never sees the data."

**On screen:** the ledger, full frame, showing `0 raw rows released`.

---

## Shot list (in order)

1. Spreadsheet with real-looking rows, scrolling — 8s
2. Drop file into Blindfold, column panel populating — 12s
3. Close-up: three `sealed` badges — 6s
4. Status pill flipping to *WebMCP connected* — 4s
5. ChatGPT tool list in the address bar — 6s
6. Prompt typed, tool calls streaming in the feed — 25s
7. Chart appearing — 8s
8. Close-up: ledger `4.9 MB in / 3.7 KB out / 0 raw rows` — 8s
9. Adversarial prompt, two red refusals — 20s
10. Close-up: a refusal message with its remedy — 8s
11. Chart + ledger together — 12s
12. Ledger, full frame — 6s

## Things to say only if there is room

- 43 automated checks run against a real Chrome, 14 of them through the
  browser's own WebMCP API
- Every grade is one click to override, and the toolset re-registers instantly
- The sample data is generated in-page, so no real person's record ships in
  the repo
