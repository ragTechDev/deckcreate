# Opportunity: Hardware-consistent output

## Problem statement

The pipeline produces different output depending on which machine runs it — a Windows machine with an NVIDIA GPU silently falls back to software encoding, while a Mac with VideoToolbox does not. Editors cannot guarantee that a render on one machine matches a render on another, which is a hidden quality risk when work rotates across team members or hardware.

## Evidence

- Journey map stage: Render/export — no entries yet (pre-interviews), but inconsistency is directly observed from ragTech's own cross-machine experience.
- **Internal dogfooding (not yet externally validated):**
  - `scripts/config/hardware.ts` derives `encoderProfile` from `process.platform`/`process.arch` string-matching only: `supportsVideoToolbox = platform === 'darwin'`, `supportsCuda = platform === 'linux' && arch === 'x64'`. A Windows machine with an NVIDIA GPU never resolves to `nvenc` — it silently falls back to software `libx264`. The type's own doc comment confirms: "No FFmpeg integration — encoder flags are recorded but not applied here." Source: [RFC §Context #2](../rfcs/0001-native-desktop-rewrite.md).
  - FFmpeg encoder selection is scattered across scripts: only `scripts/sync/AudioSyncer.js` branches on platform; `conform-to-raw.js`, `cut-preview.js`, `optimize-for-remotion.js`, and `transcode-proxy.js` hardcode `libx264` unconditionally. No `h264_nvenc`, `-hwaccel cuda`, or `scale_cuda`/`scale_metal` flags exist anywhere in the repo — NVENC/NVDEC is entirely unimplemented. Source: [RFC §Context #3](../rfcs/0001-native-desktop-rewrite.md).
- The current team has Mac M2, Mac M3, and a Windows/NVIDIA machine — all three are real, live hardware targets, and inconsistency between them is already observable.

## Proposed direction

Replace the platform-string heuristic with real hardware capability probing at startup (query the actual GPU/codec hardware, not just OS name), and consolidate the currently-scattered per-file encoder branching into a single `encoderProfile → ffmpeg args` mapping. Every script calls this one place; no script decides its own encoder. Implement NVENC/NVDEC paths so Windows/NVIDIA is a first-class target, not a silent fallback.

## Success metric

- A render of the same episode fixture on Mac M2, Mac M3, and Windows/NVIDIA produces output that passes a PSNR/hash diff gate — frame-level parity, not approximate visual similarity.
- `hardware.ts`-equivalent capability probe correctly identifies VideoToolbox on Mac and NVENC on Windows/NVIDIA without false negatives, verified by running on all three machines in CI.
- No script in the new repo hardcodes an encoder; all route through the single encoder-profile mapping.

## Related RFC / technical context

- [RFC §Context #2](../rfcs/0001-native-desktop-rewrite.md) — `hardware.ts` stub analysis.
- [RFC §Context #3](../rfcs/0001-native-desktop-rewrite.md) — scattered FFmpeg encoder selection; NVENC unimplemented.
- RFC §Decision #4 — Hardware/encoder selection is ported alongside the render engine (not a later phase); the two are tightly coupled.
- RFC §Verification §6 — Cross-hardware matrix: every golden-output gate must pass on Mac M2, Mac M3, and Windows/NVIDIA. Hardware inconsistency is the explicit verification axis, not an afterthought.

## Status

Hypothesis — internal dogfooding only. Not yet validated against external customers. Priority: P0 — ported alongside the render engine; cannot ship cross-hardware parity without it.
