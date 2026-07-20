# Opportunity: Transcript token timing accuracy

## Problem statement

Transcript-driven cuts are only as precise as the word-level timestamps that define them. Current token timings are not accurate enough to make clean cuts without manual compensation — editors are forced to estimate and pad timings rather than trust the transcript, which defeats much of the automation benefit.

## Evidence

- **Internal dogfooding:** Word-level start/end timestamps (`t_dtw`, `t_end`) are not precise enough for frame-accurate cuts. The fallback when `t_end` is absent is a heuristic — `CUT_START_BIAS = 1.0` and `WORD_DURATION_ESTIMATE = 0.4s` in `scripts/edit-transcript.js` — and hook timing constants add further padding (`HOOK_TAIL_PAD_UNBOUNDED_SECONDS = 0.16s`, `HOOK_TAIL_PAD_BOUNDED_SECONDS = 0.02s` in `remotion/lib/hookTiming.ts`) specifically to absorb timing imprecision. These constants exist because timing cannot be trusted without them.
- **Internal dogfooding:** The current workaround for timing-sensitive cuts (e.g. hook clip boundaries) is to use `hookFrom?/hookTo?` bounds in the segment with manual time estimates — not visually placed, not frame-verified, just a number written into the doc. This requires the editor to estimate timing rather than observe it, making the process error-prone and non-repeatable.
- Root `CLAUDE.md` schema note: "`token.t_end` is populated only after forced alignment. Without it, `deriveCuts` falls back to `CUT_START_BIAS` heuristic." — the heuristic path is the default, not the exception.

## Proposed direction

Two improvements, in priority order:

1. **Better forced alignment.** WhisperX forced alignment (currently a Python subprocess) produces `t_dtw` and `t_end` per token. The quality of these timestamps is the ceiling for cut precision — improving alignment accuracy directly improves every downstream cut without any other change. In the new codebase, `whisper-rs` for transcription and continued WhisperX subprocess for alignment is the planned path (RFC §Decision #4); the goal is that `t_end` is reliably populated and accurate enough that the `CUT_START_BIAS` fallback is never needed in practice.

2. **Frame-accurate visual cut placement.** When alignment accuracy still isn't sufficient for a specific cut, the editor should be able to place the cut boundary visually (scrub to the frame, set the point) and have that propagate back into the transcript representation — not estimate a float and type it into the doc. This is the "synced with transcript" part and is addressed in [Opportunity 05 — visual transcript editor](./05-visual-transcript-editor.md).

## Success metric

- `t_end` populated for every token after the alignment stage — no token falls back to the `WORD_DURATION_ESTIMATE` heuristic in a normal pipeline run.
- Cut boundaries placed via transcript alone (no manual `hookFrom`/`hookTo` adjustment) are within 1 frame (≤16ms at 60fps) of the intended edit point, verified on real episode fixtures.
- The padding constants (`CUT_START_BIAS`, `HOOK_TAIL_PAD_UNBOUNDED_SECONDS`) can be reduced toward zero without introducing audible pops or visible frame bleed — meaning they're no longer load-bearing compensation for timing error.

## Related RFC / technical context

- [RFC §Decision #4](../rfcs/0001-native-desktop-rewrite.md) — Transcription: port to `whisper-rs` with CUDA/Metal feature flags. Forced alignment (WhisperX): kept as `tokio::process` subprocess call.
- RFC §Decision #4 — "Port the algorithm from `scripts/edit-transcript.js`... preserving the tuned constants (`PAUSE_THRESHOLD`, `WORD_DURATION_ESTIMATE`, `CUT_START_BIAS`) exactly — they encode real editorial behavior." This is true for the initial port; reducing these constants is a post-port accuracy goal, not a v1 requirement.
- Root `CLAUDE.md` — `WORD_DURATION_ESTIMATE`, `CUT_START_BIAS`, `HOOK_TAIL_PAD_UNBOUNDED_SECONDS`, `HOOK_TAIL_PAD_BOUNDED_SECONDS` — the full list of constants that exist to compensate for timing imprecision.

## Status

Validated — internal dogfooding. Pain is directly observed and the workaround (manual time estimation for hook boundaries) is actively in use. Priority: P1 — depends on the transcription pipeline being ported (RFC Build Order Step 2) before this can be improved.
