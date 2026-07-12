# Opportunity: End-to-end edit time

## Problem statement

Producing one episode — long-form edit plus enough short-form clips for 1–2 weeks of promotion — costs a team member approximately 1.5 full days of hands-on work, making consistent biweekly publication unsustainable for a team with full-time jobs, and leaving no headroom to take on client work without sacrificing quality or burning out.

## Evidence

- Journey map stage: all stages (Sync → Transcribe → Edit → Render → short-form clip), but concentrated in Edit transcript and Render/export — no entries yet (pre-interviews).
- **Internal dogfooding (not yet externally validated):**
  - "It takes a dedicated half a day at least to do a standard 30min–1hr podcast edit, considering we have to clean audio, sync audio and video, cut between speakers, add intro and name title cards, and outro." Source: [`00-problem-hypothesis.md`](../00-problem-hypothesis.md).
  - "Creating short-form content through clipping for publicity from the long-form takes another day, especially when you want to create enough to distribute and promote across 1–2 weeks." Source: [`00-problem-hypothesis.md`](../00-problem-hypothesis.md).
  - ragTech rotates editing across three people on a biweekly schedule — even with rotation, the process is described as "tedious" and trades off against audience engagement and product work.
- Lean Canvas §1 (Problem): both pain points above are listed as the top two problems verbatim.
- Lean Canvas §7 Cost Structure: `docs/FINANCIAL_PROJECTIONS.md` estimates hands-on time per tier (Essential ~1.0h, Growth ~2.0h, Premium ~4.0h) — these are the targets for a service business to be viable, and assume the pipeline handles the majority of mechanical work (sync, transcript-driven cuts, camera switching, short-form repurposing) without manual intervention per step.
- Lean Canvas §8 Key Metrics: "edit turnaround time per client project — raw footage to delivered edit" is a primary metric.

## Proposed direction

The pipeline should handle every mechanical, repeatable step without a human waiting on it: multi-angle sync, transcription, diarization, transcript-driven cut derivation, camera switching, intro/outro assembly, and short-form clip extraction from the same long-form source. The human's job is to review and correct the transcript doc and approve the cut — not to supervise each pipeline stage. Short-form repurposing should be a first-class output of the same pipeline run, not a separate manual pass with a different tool.

This opportunity spans multiple pipeline stages and therefore multiple engineering epics — see related RFC context below for how they decompose.

## Success metric

- Full episode (long-form edit + 3–5 short-form clips) produced from raw footage in under 2 hours of calendar time, with under 30 minutes of human hands-on time (transcript review + approval).
- Lean Canvas §8 tie-in: "edit turnaround time per client project" hits same-day delivery for Essential/Growth tiers — raw footage in, delivered edit out, within a business day.
- Lean Canvas §7 unit economics: hands-on time per episode stays within the `docs/FINANCIAL_PROJECTIONS.md` estimates (Essential ~1.0h, Growth ~2.0h) so that the per-tier effective hourly rate (S$156–204/h) holds at the projected episode volume (Scenario B: ~17 episodes/month/person).

## Related RFC / technical context

This opportunity maps to multiple RFC build-order stages:

| Pipeline stage | RFC reference | Build order |
|---|---|---|
| Sync (FFT cross-correlation) | RFC §Decision #4 — port from `AudioSyncer.js` faithfully, tuned constants preserved | Step 3 |
| Transcription | RFC §Decision #4 — `whisper-rs` direct binding, CUDA/Metal feature flags | Step 2 |
| Transcript editing (cut derivation, sentence merging) | RFC §Decision #4 — port from `edit-transcript.js`, preserve `PAUSE_THRESHOLD`, `WORD_DURATION_ESTIMATE`, `CUT_START_BIAS` exactly | Step 3 |
| Diarization, face detection, alignment, thumbnail removal | RFC §Decision #4 — keep as `tokio::process` subprocess calls indefinitely; these are third-party pretrained models | Step 3 |
| Short-form repurposing | Not yet scoped in RFC as a separate build step — currently `scripts/shorts/` in the existing codebase | TBD — depends on render engine (Step 1) being stable first |

- [RFC §Context #4](../rfcs/0001-native-desktop-rewrite.md) — polyglot pipeline overview; JSON schema contracts (`transcript.json`, `camera-profiles.json`) as the stable interop boundary.
- RFC §Decision #3 — frozen JSON schemas as fixtures; new engine consumes them directly.

## Status

Hypothesis — internal dogfooding only. Not yet validated against external customers. Priority: P1 — depends on render speed (Opportunity #01) and hardware consistency (#02) being solved first; the pipeline's mechanical automation is only worth the investment if the render at the end isn't the bottleneck.
