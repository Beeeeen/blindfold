# Recording checklist

One session, one file. Record everything and hand it over — finding the moments
and cutting them is the easy part.

## Before you press record

- [ ] ChatGPT desktop, model on **GPT-5.6 Sol or Terra** (Luna has WebMCP off)
- [ ] `Ctrl+Shift+B` for the built-in browser, go to
      `https://beeeeen.github.io/blindfold/`
- [ ] Drag in **`sample-data/employee_compensation_2026.csv`** — the million-row
      one. The in-app button loads 50,000, and the video's opening line says
      twenty-six million tokens, so the two would contradict each other.
- [ ] **Reload the page.** The disclosure budget only resets on load, and a
      session that starts at 290/2000 looks like something to explain.
- [ ] Top right reads **WebMCP connected — 8 tools offered**
- [ ] Close anything you would not want on camera. The whole window is filmed.

## While recording

Ask these in order. After each answer finishes, **wait about three seconds
before typing the next** — that silence is where the cuts go.

Do not scroll while an answer is being produced; the frame needs to hold still.

---

**1 · The one the video is built around**

```
Where is pay least equitable in this company, and show me a chart of it.
```

Expect a long think — it took 2m37s last time. That is fine, it gets sped up.
Let it finish drawing the chart before moving on.

---

**2 · The refusal**

```
Who is the highest paid person here? Give me their name and salary.
```

Expect it to decline and say why — sealed names, no individual-level
compensation.

---

**3 · The one where the agent explains the guard in its own words**

```
Show me the salary distribution for each level.
```

Last time it ended with *"Five very small level–salary buckets were suppressed
for privacy."* That sentence is the agent relaying k-anonymity unprompted, and
it is worth more than anything scripted.

---

**4 · Refusals that teach**

```
What is the maximum salary in Engineering?
```

max on a personal measurement is refused with a suggestion to use p75 or the
median instead. Watch whether it takes the suggestion.

---

**5 · Optional, if you still have patience**

```
Does tenure predict pay? Break it down by department.
```

Exercises `correlate`, which nothing else in the video shows.

---

## Before you stop recording

- [ ] Scroll the middle panel down through **What the agent asked** slowly, so
      the tool calls are on camera in order
- [ ] Scroll the right panel so the **Disclosure ledger** is fully visible —
      bytes in, bytes out, groups suppressed
- [ ] Hold still for three seconds, then stop

## Afterwards

Just send the file path. No trimming needed.

```bash
npm run contactsheet -- path/to/recording.mp4   # so I can find the moments

# one recording feeds two beats; --ranges drops the waiting in between
npm run chatgpt -- path/to/recording.mp4 --ranges <a-b>,<c-d> --callout-at <s>
npm run chatgpt -- path/to/recording.mp4 --beat 06-refuse --ranges <a-b> --callout-at <s>

npm run assemble
npm run captions
```

If recording turns out to be more trouble than it is worth, screenshots of the
same moments work too:

```bash
npm run chatgpt:stills -- shot1.png shot2.png shot3.png
```
