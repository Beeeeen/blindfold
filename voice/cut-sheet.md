# Cut sheet

Voice: `en-US-AndrewMultilingualNeural` at rate `-4%`. Regenerate with `npm run voice`.

**Total narration 2:23**, against a 3:00 limit. Leave the gaps between
clips short — the numbers below are speech only.

| # | Clip | Length | Footage |
|---|---|---|---|
| 1 | `voice/01-hook.mp3` | 11.5s | B-roll: the raw file scrolling, then the drop landing on 1,000,000 rows. |
| 2 | `voice/02-claim.mp3` | 5.4s | B-roll: hold on the loaded dataset and the sealed badges. |
| 3 | `voice/03-grading.mp3` | 11.7s | B-roll: cursor across the three sealed badges. |
| 4 | `voice/035-override.mp3` | 21.7s | B-roll: department is reclassified to sealed, the toolset rebuilds, the same query is then refused. |
| 5 | `voice/04-tools.mp3` | 18.3s | B-roll: the registered tool list opens. |
| 6 | `voice/05-work.mp3` | 20.1s | B-roll: the tools run, both charts appear. |
| 7 | `voice/06-refuse.mp3` | 11.5s | YOU: ChatGPT relaying the refusal, if you shot it — otherwise b-roll of two refusals in red. |
| 8 | `voice/07-seal.mp3` | 18.8s | B-roll: the leak test refuses all five channels. |
| 9 | `voice/08-verbatim.mp3` | 8.4s | B-roll: a feed row expands to its verbatim payload. |
| 10 | `voice/09-close.mp3` | 15.9s | B-roll: rest on the ledger. |
| 11 | `voice/05b-chatgpt.mp3` | 17.3s | YOU: the ChatGPT conversation, if you shoot it. Swap it in for 05-work. |

## What you still have to shoot

Nothing. Every required beat is recorded in `docs/broll/`. The optional swap
above is the only thing a camera would add.

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

