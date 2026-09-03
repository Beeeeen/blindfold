# The demo video

**Already built: `docs/demo-assembly.mp4` — 2:25, narrated, captioned, with the real ChatGPT conversation in beats 5 and 6.**

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
| 2 | claim | 5.4s | The loaded dataset, sealed badges |
| 3 | grading | 11.7s | Cursor across the three sealed columns |
| 3b | override | 21.7s | department reclassified to sealed; the same query then refused |
| 4 | tools | 18.3s | The registered tool list opening |
| 5 | work | 17.3s | The ChatGPT conversation: the question, then the chart landing |
| 6 | refuse | 15.6s | ChatGPT relaying the refusal, and offering a percentile instead |
| 7 | seal | 18.8s | The leak test refusing all five channels |
| 8 | verbatim | 8.4s | A feed row expanded to the literal rows the agent received |
| 9 | close | 15.9s | The ledger, then the tested ceiling |

Number callouts are burnt in, and the two that quote measurements — the query
time and the byte counts — are read off the running page at record time rather
than typed in. The ChatGPT beats are shot outside the app, so their callouts are
rendered from the same markup afterwards and laid over the clip; on screen the
two sources are indistinguishable. An earlier cut claimed "3.8 KB out" over a ledger reading 1.7 KB,
because the figure came from a different session.

## What a camera would still add

Nothing is missing. Two things would strengthen it, and both need OS-level
screen capture, which `page.screencast()` cannot do — it records the page, not
the browser's own UI.

### The DevTools Console during the leak test (strongest)

The seal panel reports the five refusals, but the page reporting on itself is
exactly what this project argues against. Chrome saying it is a level up.

**Film the Console, not the Network panel.** Verified with `npm run test:csp`:
the Network panel records `blockedReason=csp` for only two of the five channels
(XHR and Image), because fetch, sendBeacon and WebSocket do not produce separate
Network rows. The Console carries all six messages, in readable red:

```
Refused to connect because it violates the document's Content Security Policy.
Connecting to 'https://example.com/…' violates the following Content Security
Policy directive: "connect-src 'none'".
Loading the image 'https://example.com/….gif?rows=leaked' violates … "img-src"
```

Open DevTools in Chrome 149+ with the WebMCP flag on, load the sample, press
**Try to leak data on purpose**, and film the Console filling with refusals. Cut
it over beat 7.

### The ChatGPT conversation (in the cut)

**The ChatGPT conversation.** The tool calls in the B-roll go through the
browser's real WebMCP API, so the execution is genuine, but a script chooses
them rather than a model — which is why the narration never says otherwise.
Confirmed working in the ChatGPT desktop app: the page reports
*WebMCP connected — 8 tools offered* there.

Either a recording or a handful of screenshots works. The rules ask the video
as a whole to demonstrate the project with audio; they do not ask every second
of it to move.

```bash
# a screen recording of any length -- Win+G is enough
npm run chatgpt -- path/to/recording.mp4
npm run chatgpt -- path/to/recording.mp4 --from 4 --to 42   # or trim it

# or stills: the question typed, the tool calls arriving, the chart drawn
npm run chatgpt:stills -- shot1.png shot2.png shot3.png

npm run assemble
```

Stills are less of a compromise here than they sound. The model took two and a
half minutes to answer, and most of a real-time recording is therefore someone
waiting. Each image is held for an equal share of the line with a slow push-in
and cross-dissolves, which reads as framing rather than as a slideshow.

It is fitted to the 17.3s alternate line by adjusting speed, so record for as
long as the agent needs. Assembly prefers the take while
`docs/broll/05b-chatgpt.webm` exists; delete that file to go back to the
scripted one.

One recording covers both beats. `--ranges` keeps only the parts worth showing
and drops the wait between them, so the question and the answer both play at
close to real speed instead of one long take compressed evenly:

```bash
# beat 5: the question, then the chart landing
npm run chatgpt -- recording.mp4 --ranges 25-35,92-104 --callout-at 14.0

# beat 6: the refusal, keeping the narration that beat already has
npm run chatgpt -- recording.mp4 --beat 06-refuse --ranges 164-182 --callout-at 10.2
```

Each beat has a default callout; `--callout "headline|second line"` overrides it
and `--no-callout` drops it.

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

**Voice choice, decided by measurement.** `scripts/voice-analyse.py` tracks
fundamental frequency across the same line in each candidate. What people are
reacting to when they call a synthetic read flat is objective — the pitch barely
moves:

| Voice | Median F0 | Intonation spread |
|---|---|---|
| **Andrew** (in use) | 116 Hz | **4.45 semitones** |
| Emma | 172 Hz | 4.44 st |
| Ava | 208 Hz | 3.39 st |
| Brian | 123 Hz | 2.55 st |

Andrew and Emma are level on range; Andrew takes it on register. Microsoft tags
it *Warm, Confident, Authentic, Honest*, which is the voice a project whose
whole argument is "don't trust me, check it" needs. Emma's *Cheerful* is wrong
for the subject.

`npm run voice:lab` renders all four dry and mastered with spoken labels into
`voice/lab/comparison.mp3` if you want to overrule this by ear. Switch by
changing `voice` in `voice/narration.json`:

| Voice | Microsoft's own description |
|---|---|
| `en-US-AvaMultilingualNeural` | Expressive, Caring, Pleasant, Friendly |
| `en-US-AndrewMultilingualNeural` | Warm, Confident, Authentic, Honest |
| `en-US-BrianMultilingualNeural` | Approachable, Casual, Sincere |
| `en-US-EmmaMultilingualNeural` | Cheerful, Clear, Conversational |

## Captions

`npm run captions` → `docs/demo-assembly.srt`, 42 cues. Upload it with the
video; YouTube's automatic captions will not spell WebMCP, run_sql, XHR or
sendBeacon, and a judge reading in a second language sees those mistakes instead
of the argument.

The timings come from the synthesiser rather than from recognition, so they are
exact. Two things the raw word events need fixing first: they arrive stripped of
punctuation, so cues are aligned back against the source line to restore it and
break on clauses; and the script spells some terms out so the voice says them
properly, which a reader should not see — "A-I" becomes "AI", "run-S-Q-L"
becomes `run_sql`.

## Recording notes

- 1600×900 viewport at 2× → 2400×1350, downscaled to 1080p on assembly.
- The window must be visible; `page.screencast()` does not work headless.
- Load the page once before recording so the 7.8 MB wasm is cached.
- `voice/*.timings.json` has word-level timings if you want to cut on a word.
