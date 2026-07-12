# Opportunity: Render speed

## Problem statement

Editors wait up to 6–18 hours after completing a transcript edit before they can review and deliver a final cut. At that turnaround, same-day delivery of client work is impossible regardless of how fast the editing itself goes — the render is the wall.

## Evidence

- Journey map stage: Render/export — no entries yet (pre-interviews), but the time cost is directly observed from ragTech's own pipeline.
- **Internal dogfooding (not yet externally validated):** Remotion renders via headless Chromium at a 2–5 fps ceiling with no GPU path. A 60-minute episode at 60fps takes 6–18 hours. Multi-camera angles compound this: each inactive angle's `OffthreadVideo` must stay decoding at `opacity:1` simultaneously or its decoder stalls and produces stale frames on switch — decode cost scales linearly with angle count. Source: [`docs/rfcs/0001-native-desktop-rewrite.md` §Context #1](../rfcs/0001-native-desktop-rewrite.md).
- Lean Canvas §8 Key Metrics: render time per episode is listed as a primary metric; RFC target is under 1 hour from up to 8.
- Lean Canvas §7 Cost Structure: "faster rendering directly increases effective hourly rate, not just 'nice to have'" — `docs/FINANCIAL_PROJECTIONS.md` estimates effective rates of S$156–204/h per tier even before render-speed improvement; that rate compounds upward when render time stops being a floor constraint on episode volume.
- 12-month success metric from [`00-problem-hypothesis.md`](../00-problem-hypothesis.md): "ragTech renders episodes in under 1 hour instead of 8."

## Proposed direction

Replace the Remotion/headless-Chromium render path with a native compositor that routes encode/decode through platform GPU APIs (VideoToolbox on Mac, NVENC/NVDEC on Windows/Linux) and uses hardware-accelerated multi-angle decoding. Preview and final render share the same compositor code path — no second implementation that can drift. This removes the browser-engine ceiling entirely rather than tuning around it.

## Success metric

- Render time for a 60-minute, 3-angle episode at 60fps: under 1 hour on Mac M2, Mac M3, and Windows/NVIDIA — verified across all three hardware targets, not just the fastest machine.
- Lean Canvas §8 tie-in: "render time per episode" drops from the current 6–18h range into the sub-1h range across the full hardware matrix.
- Unit economics tie-in: effective hourly rate per episode tier (S$156–204/h baseline from `docs/FINANCIAL_PROJECTIONS.md`) should improve meaningfully once render time is no longer a floor constraint on daily episode volume.

## Related RFC / technical context

- [`docs/rfcs/0001-native-desktop-rewrite.md` §Context #1](../rfcs/0001-native-desktop-rewrite.md) — Remotion bottleneck analysis; multi-angle decode cost.
- RFC §Decision #1 — Rust chosen over C++ specifically for this render/compositor path.
- RFC §Decision #2 — Native egui/wgpu GUI (not Tauri) so preview shares the compositor rather than duplicating it.
- RFC §Decision #4 — Render/compositing engine is the first thing to port; hardware/encoder selection ported alongside it.
- RFC §Build Order Step 1 — Validate against real-episode fixtures with golden-frame diffing across Mac M2, Mac M3, and Windows/NVIDIA before trusting it.
- RFC §Open Questions — FFmpeg vs gstreamer-rs binding choice is unresolved; a spike must resolve this before the render engine epic begins.

## Status

Hypothesis — internal dogfooding only. Not yet validated against external customers. Priority: P0 — this is the blocker for the service business's unit economics and the primary motivation for the rewrite.
