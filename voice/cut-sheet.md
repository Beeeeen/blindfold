# Cut sheet

Voice: `en-US-AvaMultilingualNeural` at rate `-6%`. Regenerate with `npm run voice`.

**Total narration 2:39**, against a 3:00 limit. Leave the gaps between
clips short — the numbers below are speech only.

| # | Clip | Length | Footage |
|---|---|---|---|
| 1 | `voice/01-problem.mp3` | 23.8s | YOU: the file open in a spreadsheet, scrolling. File size visible. |
| 2 | `voice/02-load.mp3` | 7.2s | B-roll: the file lands, row count reaches 1,000,000. |
| 3 | `voice/03-grading.mp3` | 18.6s | B-roll: cursor moves across the sealed badges. |
| 4 | `voice/04-tools.mp3` | 13.9s | YOU: ChatGPT's address bar, Site tools open, showing the eight names. |
| 5 | `voice/05-agent.mp3` | 22.7s | YOU: the ChatGPT conversation. Ask where pay is least equitable, let the tool calls stream. |
| 6 | `voice/06-refusals.mp3` | 20.2s | B-roll: the two refusals appear in red in the feed. |
| 7 | `voice/07-seal.mp3` | 28.5s | B-roll: the leak test runs, five channels refuse. |
| 8 | `voice/08-verbatim.mp3` | 9.0s | B-roll: a feed row expands to its verbatim payload. |
| 9 | `voice/09-close.mp3` | 15.1s | B-roll: rest on the ledger. |

## What you still have to shoot

- **01-problem** — the file open in a spreadsheet, scrolling. File size visible.
- **04-tools** — ChatGPT's address bar, Site tools open, showing the eight names.
- **05-agent** — the ChatGPT conversation. Ask where pay is least equitable, let the tool calls stream.

Everything else is already recorded in `docs/broll/`, one clip per line.

## Assembling

`npm run assemble` already does this and writes `docs/demo-assembly.mp4`:
every beat in order, narration laid under it, and a card standing in for each
shot that is yours. Watch that first — the pacing of the finished video is
already in it.

To finish by hand instead:

1. Lay the nine narration clips end to end, in order.
2. Put `docs/broll/<id>.webm` under its own clip. Each was recorded to the
   measured length of that line, so nothing needs stretching.
3. Replace the three cards with your footage, cut to the same length.
4. Word-level timings are in `voice/*.timings.json` if you want to cut on a
   specific word.

