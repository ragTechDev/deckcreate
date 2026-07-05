# RFC 0001: Native Desktop Rewrite of the Editing Pipeline

**Status:** Proposed
**Date:** 2026-07-05

---

## Context

The current pipeline (Node.js/TypeScript + Next.js + Remotion, documented in the root [CLAUDE.md](../../CLAUDE.md)) is a working prototype that ships the ragTech podcast biweekly. Four architectural problems limit scaling it further:

1. **Rendering is a confirmed, unfixable-within-Remotion bottleneck.** Remotion renders via headless Chromium/Puppeteer — a 2–5 fps ceiling with no GPU path. Multi-camera-angle jump cuts make this worse: every angle's `OffthreadVideo` must stay decoding at `opacity:1` simultaneously (`remotion/components/CameraPlayer.tsx` ~L994-998) because dropping an inactive layer to `opacity:0` causes the browser to throttle/stall its decode, producing stale `currentTime` and content repeats when switching back. Decode cost therefore scales linearly with camera-angle count. A 60-minute episode at 60fps can take 6–18 hours to render.

2. **Hardware detection is a stub with no real cross-platform consistency.** `scripts/config/hardware.ts` derives `encoderProfile` from `process.platform`/`process.arch` string-matching only: `supportsVideoToolbox = platform === 'darwin'`, `supportsCuda = platform === 'linux' && arch === 'x64'`. A Windows machine with an NVIDIA GPU never resolves to `nvenc` under this logic — it silently falls back to software `libx264`. The type's own doc comment confirms: "No FFmpeg integration — encoder flags are recorded but not applied here."

3. **FFmpeg encoder selection is scattered and inconsistent.** Only `scripts/sync/AudioSyncer.js` actually branches on platform to pick `h264_videotoolbox` vs `libx264`; `conform-to-raw.js`, `cut-preview.js`, `optimize-for-remotion.js`, and `transcode-proxy.js` all hardcode `libx264` unconditionally, despite `optimize-for-remotion.js`'s comments implying VideoToolbox is used. No `h264_nvenc`, `-hwaccel cuda`, or `scale_cuda`/`scale_metal` flags exist anywhere in the repo — NVENC/NVDEC is entirely unimplemented.

4. **The pipeline is polyglot by necessity.** Node/TS orchestrates whisper.cpp (subprocess, via `@remotion/install-whisper-cpp`), Python/pyannote for diarization (subprocess), Python/WhisperX for forced alignment (subprocess), Python/mediapipe for face detection (subprocess), and Python/rembg for thumbnail background removal (subprocess). Two JSON schemas — `transcript.json` and `camera-profiles.json` — are the stable contract every stage already reads and writes, and are documented in CLAUDE.md.

**Goals for a rewrite:** reliability, materially faster rendering, transcription accuracy, and consistent behavior across Mac M2 vs M3 and Windows with an NVIDIA GPU.

**Team constraints:** the team is strongest in JavaScript/Java, not Rust or C++, and will lean heavily on coding agents to write the new codebase. The current codebase will keep shipping episodes as-is (critical fixes only) while the new codebase is built in parallel — this is a from-scratch rewrite, not an in-place incremental sidecar into the existing repo.

---

## Decision

### 1. Language: Rust, not C++

Both are technically capable of this category of application — C++ is the industry default (Shotcut, Kdenlive, and Olive are all C++/Qt/FFmpeg; MLT, the engine under Shotcut/Kdenlive, is a genuinely reusable multitrack composition engine; whisper.cpp links as a library for free in either language). The deciding factor here is the team's profile, not raw ecosystem maturity: given a JS/Java background and heavy reliance on coding agents, Rust's compiler converts most memory-safety mistakes — the dominant bug class an LLM introduces in unfamiliar systems code — into a compile error the agent sees and can fix immediately. C++ converts the same class of mistake into undefined behavior that can surface later as a platform-specific crash, which is exactly the cross-hardware inconsistency problem this rewrite exists to eliminate. Cargo's unified build/test/lockfile/toolchain story is also a smaller leap from the team's npm-based workflow than CMake plus vcpkg or Conan.

Cost accepted: there is no mature, shipping Rust NLE to draw architectural patterns from. `whisper-rs`, `ort`, `ffmpeg-next`/`gstreamer-rs`, and `wgpu` are each individually solid, but the team is the integrator connecting decode → composite → encode. This integration layer is the highest-risk part of the plan regardless of which language is chosen — see [Reference Material](#reference-material) below for one external codebase worth reading against this specific risk.

### 2. GUI: native (egui + wgpu), not a Tauri-wrapped web frontend

Final render is an offline batch job (native binary in, mp4 out) and is unaffected by GUI framework choice either way. Live **preview** is different: a WebView-based shell (Tauri) cannot cheaply show the actual composited multi-cam preview — viewport crops, jump cuts, overlays — without either streaming re-encoded frames into the WebView (adds latency) or reimplementing the compositor in JavaScript, a second implementation that can drift from the native one. This project has already hit that exact failure mode once: `hookClipEnd()` was duplicated across four files (`CameraPlayer`, `SegmentPlayer`, `Composition`, `HookOverlay`) before being fixed by consolidating into a single source of truth, `remotion/lib/hookTiming.ts`. The rewrite should not reintroduce that pattern.

Instead, build **one compositor library** shared by both the live-preview surface and the final-render encoder — the same code path, with the output sink swapped (screen surface vs. file encoder). `egui`'s immediate-mode painting model is a good fit for a timeline/waveform editor specifically, since per-frame redraw of playheads, waveforms, and clip lanes is the natural way that kind of UI already worked in the existing custom-canvas Next.js timeline editor — the paradigm carries over even though the code doesn't. Since this is a ground-up rewrite regardless, "reuse the existing React timeline" is a smaller win than "guarantee preview matches final render," so it does not outweigh the parity argument.

### 3. Interop boundary: frozen JSON schemas as fixtures, not live IPC

`transcript.json` and `camera-profiles.json` (schemas documented in CLAUDE.md) become the reference contract for the new codebase, used as follows:

- Export real `transcript.json` + `camera-profiles.json` from several already-shipped episodes as fixtures.
- Port these shapes faithfully into Rust structs; the new render engine consumes the fixtures directly.
- Validate new-engine output against what Remotion actually produced for those same episodes — frame-level PSNR/hash diff for video, audio-hash diff for audio — before trusting any stage as correct.
- Treat the schemas as versioned and frozen for the duration of the rewrite.

This is validation-by-fixture, not a live sidecar process between two running codebases — the two codebases stay operationally independent, matching the team's decision to keep the current pipeline shipping in parallel.

### 4. What to port vs. what to keep as a subprocess

| Stage | Decision |
|---|---|
| Render/compositing engine | **Port first.** Confirmed bottleneck, fully team-authored logic, no ML-model dependency. Rust + wgpu compositor; FFmpeg for decode/encode. |
| Hardware/encoder selection | Port alongside the render engine. Replace the `hardware.ts` heuristic with real capability probing and a single `encoderProfile → ffmpeg args` mapping, collapsing the currently-scattered per-file branching into one place. |
| Transcription (whisper.cpp) | Port to a direct binding — **whisper-rs**, with CUDA/Metal feature flags — eliminating the current subprocess + VTT-parsing contract entirely. |
| Audio/video sync (FFT cross-correlation) | Port the algorithm from `scripts/sync/AudioSyncer.js` (cross-correlation, deterministic tie-break, SNR reliability check) faithfully into Rust; it is tuned, team-owned logic worth preserving exactly. GPU offload is a later optimization, not a v1 requirement. |
| Diarization (pyannote), face detection (mediapipe), thumbnail background removal (rembg), forced alignment (WhisperX) | **Keep as external subprocess calls indefinitely** (`tokio::process`). These are pretrained third-party models, not team algorithms — porting them buys no accuracy and risks regressions. An ONNX port (`ort` crate) is optional future cleanup, not a phase gate. |
| Transcript editing logic (cut derivation, sentence merging) | Port faithfully from `scripts/edit-transcript.js`, preserving the tuned constants (`PAUSE_THRESHOLD`, `WORD_DURATION_ESTIMATE`, `CUT_START_BIAS`) exactly — they encode real editorial behavior, not incidental implementation detail. |

### 5. Build order

1. Render/compositing engine + hardware/encoder layer — the bottleneck, and the piece with no ML-model risk. Validate against real-episode fixtures with golden-frame diffing across Mac M2, Mac M3, and a Windows/NVIDIA machine before trusting it.
2. whisper-rs transcription — isolated, low-risk, immediately removes a subprocess boundary.
3. Remaining pipeline orchestration (sync, diarize/align/mediapipe/rembg as subprocess calls, transcript editing logic) — wired around the now-proven render core.
4. Native GUI (egui + wgpu), sharing the compositor library from step 1, built once that API is stable so the GUI isn't chasing a moving target.

### 6. Verification approach

- Golden-output gate per stage: diff native output against the current production pipeline's output for the same fixture input before considering a stage done.
- Cross-hardware matrix: every gate must pass on Mac M2, Mac M3, and the Windows/NVIDIA machine — this is the point of the rewrite.
- Schema conformance tests: the new codebase's structs for `transcript.json`/`camera-profiles.json` must round-trip real fixture files without loss.
- No cutover of the production pipeline happens until the new codebase reaches full parity across the stages needed for a real episode; the current Node/Remotion codebase continues shipping in the meantime, critical-fixes-only.

---

## Alternatives Considered

- **C++.** Industry-default for this category — Shotcut/Kdenlive/Olive/MLT provide real prior art, whisper.cpp links natively either way, and NVENC/VideoToolbox are proven via FFmpeg on both target platforms. Rejected primarily on the agent-driven-development risk profile (undefined behavior surfaces later and is harder for an agent, or a reviewer unfamiliar with C++, to catch), not on raw capability.
- **Tauri wrapping the existing Next.js GUI.** Would preserve the working canvas timeline editor with minimal rewrite risk. Rejected because it can't cheaply achieve preview/final-render parity (see Decision §2), and because "avoid rewriting the GUI" is a weaker argument when the rest of the codebase is being rewritten from scratch anyway.
- **Porting the Python ML models to native/ONNX immediately.** Would remove Python from the stack entirely. Rejected as unnecessary risk up front — these are pretrained third-party models with no team-owned logic to preserve, so the cost of a subtle porting regression outweighs the benefit of removing the subprocess boundary this early.

---

## Reference Material

**[gausian-AI/Gausian_native_editor](https://github.com/gausian-AI/Gausian_native_editor)** — a Rust/egui/wgpu native video editor, evaluated as a possible foundation and rejected as a dependency, but its `crates/native-decoder` is worth reading as a solution sketch for the exact "team is the integrator" risk called out in Decision §1. Findings from a close read of that crate:

**Read this, don't import it:**
- `src/macos.rs` — `VideoToolboxDecoder`: a real AVFoundation + VideoToolbox CPU-plane decode loop, including the Objective-C shim call pattern (`avfoundation_seek_to`, `avfoundation_read_next_sample`, `avfoundation_get_reader_status`), a ring buffer with frame caching, and correct `CFRelease` of `CVPixelBufferRef` after each copy. This is a working reference for the macOS hardware-decode path.
- `src/gstreamer_backend.rs` — `GstDecoder`: a real GStreamer pipeline wrapper with a tuned seek policy (re-seek only when the ring buffer is empty *and* the timestamp jump exceeds 0.25s, avoiding seek jitter during normal playback) and a strict-paused vs. streaming mode distinction. Useful reference for the Windows/Linux decode path if `gstreamer-rs` is chosen over direct FFmpeg bindings (see Open Questions).
- `src/wgpu_integration.rs` — `GpuYuv::import_from_iosurface`: correct handling of IOSurface plane bytes-per-row alignment padding when uploading NV12 planes into wgpu textures. Well-written, though (see below) unused in the source app itself.

**Do not trust without independently verifying — confirmed dead or fake by reading the code and grepping the rest of the repo for call sites:**
- `src/fallback.rs` (`FallbackDecoder`) — the non-macOS, non-GStreamer decode path is a pure stub: `get_properties()` returns hardcoded `1920×1080/10s/30fps` regardless of the real file, and `decode_frame()` returns a solid mid-gray frame for every timestamp, never reading the actual video. It's inert in their shipped app only because `apps/desktop/Cargo.toml` always enables the `gstreamer` feature — the crate itself has no safe default.
- `is_videotoolbox_available()` — hardcoded `true`, checks nothing.
- `IOSurfaceTexture`, `IOSurfaceRenderPipeline`, `ZeroCopyVideoRenderer` (`wgpu_integration.rs`) — decorative dead code. The texture-upload function never writes pixel data (comment admits it), and the fragment shader ignores its bound texture entirely, outputting a plain UV-coordinate gradient instead of the decoded frame. A repo-wide search found zero call sites from `apps/desktop` or `crates/renderer` — the real app uploads frames through its own separate path, not through this module's own `GpuYuv` function either.

**Caveats before using this as anything beyond reading material:**
- **License is unresolved and contradictory** — the root `LICENSE` file is Apache-2.0, but the README's own License section claims "Core: MPL-2.0, Pro Features: separate commercial license," and no per-crate `Cargo.toml` declares a `license` field. Do not copy code verbatim until this is directly clarified with the maintainer.
- Effectively a solo-maintained project (2 contributors, 24 total commits across 87 Rust files), no CI, and minimal test coverage (5 test-related files repo-wide, one named `tmp_test.rs`). The dead-code findings above are a direct symptom of that — treat every function as unverified until read, not just the ones flagged here.

---

## Consequences

- The team takes on Rust's learning curve without prior team experience in either target language, offset by leaning on coding agents and the compiler's tight feedback loop.
- The new codebase has no turnkey reference NLE architecture to build from; the render/compositing engine, GPU interop, and hardware probing must be integrated from smaller crates rather than adapted from an existing project.
- The pipeline remains partially polyglot (Rust core + Python subprocesses for pretrained ML models) for the foreseeable future — this is an accepted, intentional tradeoff, not a gap to close immediately.
- The current Node/Remotion codebase continues to receive critical fixes only until the new codebase reaches parity; no new feature work should land there once rewrite work begins in earnest.

---

## Open Questions (non-blocking)

- **Repository location:** recommend a separate repository for the new codebase (different toolchain/build system from the existing Next.js monorepo) rather than a subdirectory of the current one.
- **Decode/encode binding:** direct FFmpeg C API bindings vs. `gstreamer-rs`. Leaning toward direct FFmpeg bindings, since they map more directly onto the `encoderProfile` (`videotoolbox`/`nvenc`/`libx264`) concept already defined in `hardware.ts` — validate with a small spike before committing.
- **Implementation process:** whether to carry this project's existing "Agent Implementation Convention" (an implementation doc per multi-step task, one commit per step with a status check, documented in CLAUDE.md) into the new repository. Recommended, since it's an already-proven practice for this team and translates directly to agent-driven development.
