# The demo video

**Already built: `docs/demo-assembly.mp4` — 1:32, narrated, ready to upload.**

The narration is not written out here. It lives in
[`../voice/narration.json`](../voice/narration.json), which is what the pipeline
actually reads. A prose copy would drift from it within a day, and then nobody
would know which one was true.

```bash
npm run sample -- 1000000   # the 99 MB, one-million-row file
npm run fileview            # renders the raw file for the opening shot
npm run voice               # narration → voice/*.mp3, each one measured
npm run record              # one B-roll clip per line, cut to its length
npm run assemble            # → docs/demo-assembly.mp4
```

Change a line in `narration.json`, run the last three, and the footage
re-records itself to the new timing.

## Why in that order

Synthesise first, measure, *then* record to the measured lengths. Recording
first and stretching footage to fit afterwards is what makes a demo feel padded.
Clips land within 0.15s of their narration.

## The cut

| # | Beat | Length | What is on screen |
|---|---|---|---|
| 1 | hook | 11.5s | The raw file scrolling past real names and salaries, then it lands on 1,000,000 rows |
| 2 | claim | 4.9s | The loaded dataset, sealed badges |
| 3 | grading | 12.4s | Cursor across the three sealed columns |
| 4 | tools | 11.2s | The registered tool list opening |
| 5 | work | 12.9s | Tools run, both charts appear |
| 6 | refuse | 11.8s | Two refusals in red |
| 7 | seal | 18.6s | The leak test refusing all five channels |
| 8 | close | 8.4s | The ledger |

Number callouts are burnt in, and the two that quote measurements — the query
time and the byte counts — are read off the running page at record time rather
than typed in. An earlier cut claimed "3.8 KB out" over a ledger reading 1.7 KB,
because the figure came from a different session.

## What a camera would still add

Nothing is missing. One thing is optional:

**The ChatGPT conversation.** The tool calls in the B-roll go through the
browser's real WebMCP API, so the execution is genuine, but a script chooses
them rather than a model — which is why the narration never says otherwise.
Confirmed working in the ChatGPT desktop app: the page reports
*WebMCP connected — 8 tools offered* there.

Record the conversation with anything (Win+G is enough), then:

```bash
npm run chatgpt -- path/to/recording.mp4            # whole clip
npm run chatgpt -- path/to/recording.mp4 --from 4 --to 42   # or trim it
npm run assemble
```

It is fitted to the 14.6s alternate line by adjusting speed, so record for as
long as the agent needs. Assembly prefers the take while
`docs/broll/05b-chatgpt.webm` exists; delete that file to go back to the
scripted one.

To shoot it: `Ctrl+Shift+B` in the ChatGPT desktop app, go to
`https://beeeeen.github.io/blindfold/`, load the sample, and ask *"Where is pay
least equitable in this company, and show me a chart of it."* Needs GPT-5.6 Sol
or Terra — Luna has WebMCP disabled — and a workspace that is not Enterprise or
Edu.

## The narration

Edge TTS, same helper the content-factory pipeline uses. Three things keep it
from sounding synthesised:

**Per-beat pacing.** Every line moves at its own rate — `-10%` for the hook,
`-2%` through the mechanism, `-9%` to land the close. A constant rate across
every line is the loudest tell that nobody actually spoke it. Set `rate` on any
beat in `voice/narration.json`.

**A mastering chain.** High-pass, a dip at 220 Hz where TTS gets boxy, presence
at 2.8 kHz, air above 9.5 kHz, gentle compression (2.2:1 — heavy compression
flattens the delivery, which is the opposite of warmth), a very small room, and
`loudnorm` to −16 LUFS. Every beat lands within 0.7 LU of the others; raw
synthesis was −19 to −21 and uneven.

**Voice choice.** `npm run voice:lab` synthesises the same line in all four
multilingual voices, dry and mastered, with spoken labels, into
`voice/lab/comparison.mp3`. Switch by changing `voice` in
`voice/narration.json`:

| Voice | Microsoft's own description |
|---|---|
| `en-US-AvaMultilingualNeural` | Expressive, Caring, Pleasant, Friendly |
| `en-US-AndrewMultilingualNeural` | Warm, Confident, Authentic, Honest |
| `en-US-BrianMultilingualNeural` | Approachable, Casual, Sincere |
| `en-US-EmmaMultilingualNeural` | Cheerful, Clear, Conversational |

## Recording notes

- 1600×900 viewport at 2× → 2400×1350, downscaled to 1080p on assembly.
- The window must be visible; `page.screencast()` does not work headless.
- Load the page once before recording so the 7.8 MB wasm is cached.
- `voice/*.timings.json` has word-level timings if you want to cut on a word.
