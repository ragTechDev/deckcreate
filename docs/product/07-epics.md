# Epic Map

This document is the direct bridge from product discovery to engineering. Each epic here maps to one or more opportunity docs in `06-opportunities/`, is sequenced against the RFC build order, and is broken into features at enough resolution to write a GitHub issue with acceptance criteria from each one.

**How to use this in the new repo:**
- Each epic becomes a GitHub Epic (or milestone, depending on how the new repo structures work).
- Each feature under an epic becomes one or more GitHub issues, with acceptance criteria derived from the success metrics in the linked opportunity doc.
- Epic 0 must be the first epic completed — its outputs (test fixtures, golden-frame baselines, AI harness) are the acceptance criteria infrastructure that every subsequent epic depends on.
- The spike is resolved — `ffmpeg-the-third` is the chosen binding (see `spike/rust-decode-spike/FINDINGS.md`). Epic 1 issues can be written now, with F1.0 (LGPL FFmpeg build) as the first task.

---

## Pre-epic: FFmpeg vs gstreamer-rs spike

**Status: RESOLVED.** See [`spike/rust-decode-spike/FINDINGS.md`](../../spike/rust-decode-spike/FINDINGS.md) — verified on Mac M3, Mac M2, and Windows/NVIDIA. Decision feeds into Epic 1 F1.0.

**Decision: `ffmpeg-the-third`** (the actively-maintained fork of `ffmpeg-next`; `ffmpeg-next` itself is maintenance-mode only — confirmed by the spike).

**Rationale summary:**
- On Mac M2 and M3: `ffmpeg-the-third` with VideoToolbox hardware path is pixel-exact (mean diff = 0.000, max = 0) against reference frames at both tested timestamps. `gstreamer-rs`/`vtdec_hw` fails pixel tolerance on both chips (mean ~3.86, max ~168–181) — root cause is a colorimetry/YUV-matrix mismatch during GPU→CPU readback, not a seek bug.
- On Windows/NVIDIA: both candidates' hardware paths are active but fail the spike's pixel tolerance. `ffmpeg-the-third`/CUDA is materially closer to reference than `gstreamer-rs`/`nvh264dec` (lower mean and much lower max diff). Both require follow-up hardening in Epic 1.
- `ffmpeg-the-third`'s missing high-level hwaccel API requires ~40 lines of unsafe FFI for the VideoToolbox and CUDA paths — this is a one-time bounded cost, and the spike's `hw` module (`ffmpeg-candidate/src/main.rs`) is the working reference implementation. Do not re-derive from FFmpeg's C `hw_decode.c` example — use the spike code directly.
- `gstreamer-rs` has the easier integration surface but unresolved hardware-path pixel failures on both Mac and Windows, plus a Cocoa run-loop dependency (`NSApplication`) introduced by `vtdec_hw`'s GL-memory output — a real open question for a headless render engine.

**Open questions carried into Epic 1** (not re-investigated in the spike):
1. Windows/NVIDIA hardware decode pixel quality needs root-cause and correction — treat as integration-incomplete until resolved in Epic 1.
2. The GPL/LGPL FFmpeg build configuration is a **hard prerequisite for Epic 1**: both Mac and Windows test machines used Homebrew/system FFmpeg builds with `--enable-gpl --enable-libx264 --enable-libx265`, making the software `avdec_h264` decode path GPL-contaminated. A clean LGPL-only FFmpeg build (without `--enable-gpl`) fully supports H.264 decode and removes this risk — this must be resolved before Epic 1 begins, not deferred. See F1.0 below.

**Where the spike ran:** `spikes/rust-decode-spike/` in the deckcreate repo. Spike code is not ported — only the `hw` module pattern and the findings doc carry forward.

---

## Epic 0: Project Setup and AI Harness

**Opportunities addressed:** None directly — this epic produces the infrastructure that makes all other epics verifiable and agent-driveable.

**RFC reference:** RFC §Open Questions — repository location, Agent Implementation Convention. RFC §Verification §6 — golden-output gate per stage; cross-hardware matrix; schema conformance tests. All of these require the fixtures, baselines, and tooling this epic creates.

**Problem it solves:** Without test fixtures and golden-frame baselines, Epic 1's acceptance criteria ("output passes PSNR gate vs Remotion baseline") have nothing to diff against — you can't close Epic 1 as done. Without a CLAUDE.md and implementation convention, coding agents working in the new repo have no shared understanding of how work is structured, how to validate a change, or what "done" means per issue. This epic makes all subsequent epics executable and verifiable.

**Definition of done:** A coding agent can be handed any Epic 1 feature issue, find the CLAUDE.md, run `cargo test`, confirm the golden-frame baseline exists for that fixture, and know exactly what a passing acceptance check looks like — without reading anything outside the new repo.

### Features

| ID | Feature | Description | Acceptance criteria |
|----|---------|-------------|---------------------|
| F0.1 | Cargo workspace structure | Multi-crate Cargo workspace with one crate per major subsystem: `crates/compositor`, `crates/transcription`, `crates/pipeline`, `crates/gui`, `crates/brands`; shared types crate (`crates/types`) for `transcript.json` and `camera-profiles.json` structs | `cargo build --workspace` succeeds on Mac and Windows with no warnings; crate boundaries match the Epic 1–5 feature split so no epic needs to reach across the wrong crate |
| F0.2 | CLAUDE.md — AI harness | Agent implementation convention for the new repo: crate layout, how to run tests (`cargo test`, `cargo clippy`, `cargo fmt --check`), implementation doc format (one doc per multi-step task in `docs/implementation-guides/`), status check per step, one commit per step, per-PR checklist adapted for Rust | An agent given a feature issue can orient, find the right crate, run the test suite, and know what done looks like without any out-of-repo context |
| F0.3 | CI/CD cross-platform matrix | GitHub Actions workflow: build + test on Mac ARM (M-series), Windows x64 with NVIDIA GPU runner; clippy and rustfmt checks on every PR; test matrix fails fast if any target fails | Green CI required to merge any PR; a failure on Windows/NVIDIA is as blocking as a failure on Mac |
| F0.4 | Test fixture export | Export real `transcript.json` + `camera-profiles.json` from at least two already-shipped episodes from the current production pipeline; commit as versioned fixtures in `tests/fixtures/` | Fixtures round-trip through the new repo's Rust schema structs without loss; used as the canonical input for all Epic 1–3 acceptance tests |
| F0.5 | Compositor property specs and sanity frames | **Tier 1 (primary gate):** a `properties.json` spec per fixture episode, generated from the deckcreate pipeline's JS logic, defining expected compositor state (active angle, viewport crop, cut/hook/speaker flags, source timestamp) at key checkpoints. **Tier 2 (sanity signal only):** a small set of Remotion-rendered frames per fixture for gross visual regression detection — not a pass/fail gate. | Tier 1 property specs are the acceptance criterion for Epic 1 correctness; Tier 2 frames are informational only. Remotion pixel output is not the correctness target — deckcreate artifacts were produced as prototypes, not pixel-perfect benchmarks. |
| F0.6 | Shared test utilities | Common test helpers in `crates/test-utils`: fixture loader, property spec checker (loads `properties.json` and asserts compositor state), frame extractor, audio hash utility — consumed by all epic test suites | Any crate's test suite can load a fixture and assert compositor state against its property spec in under 5 lines of test code |
| F0.7 | Dev tooling | `rustfmt.toml`, `.clippy.toml`, pre-commit hooks (or equivalent) enforcing format and lint on changed files; `Makefile` or `justfile` with canonical commands (`make test`, `make lint`, `make baseline`) | A new contributor (or agent) can set up the dev environment and run the full check suite with documented commands; no manual tool invocation required |

---

## Epic 1: Native Render Engine

**Opportunities addressed:** [Opportunity 01 — Render speed](06-opportunities/01-render-speed.md), [Opportunity 02 — Hardware-consistent output](06-opportunities/02-hardware-inconsistency.md)

**RFC reference:** Build Order Step 1. Must be the first epic completed — all other epics depend on a stable compositor API.

**Problem it solves:** The current Remotion/headless-Chromium render path has a hard 2–5fps ceiling with no GPU path, producing 6–18 hour renders for a 60-minute episode. Hardware inconsistency (Windows/NVIDIA silently falling back to software encode) means output quality depends on which machine ran the job.

**Definition of done:** A render of the same episode fixture on Mac M2, Mac M3, and Windows/NVIDIA produces output that passes the Tier 1 compositor property spec checks (from F0.5) and completes in under 1 hour — verified across all three hardware targets. Windows NVDEC pixel drift (open from spike) must be root-caused and corrected before this epic closes.

### Features

| ID | Feature | Description | Acceptance criteria |
|----|---------|-------------|---------------------|
| F1.0 | GPL/LGPL FFmpeg build prerequisite | Before any Epic 1 code is written: verify a clean LGPL-only FFmpeg build (compiled without `--enable-gpl --enable-libx264 --enable-libx265`) is available on all CI and dev machines. This removes GPL contamination from the `avdec_h264` software decode path. The spike used Homebrew/system FFmpeg with GPL flags — this must be resolved before the `ffmpeg-the-third` binding is linked in production builds. Document the required build flags in `docs/implementation-guides/ffmpeg-build.md`. | CI pipeline uses an LGPL-clean FFmpeg on Mac ARM and Windows x64; `ffmpeg-the-third` links against it without GPL symbols; build flags documented and reproducible. |
| F1.0a | `ffmpeg-the-third` binding bootstrapped | Add `ffmpeg-the-third` to `crates/compositor/Cargo.toml`; port the spike's `hw` module (`spike/rust-decode-spike/ffmpeg-candidate/src/main.rs`) as the starting point for the hardware decode path — do not re-derive from FFmpeg's C `hw_decode.c` example. VideoToolbox and CUDA paths brought over from the spike. | `cargo build --workspace` succeeds on Mac and Windows with `ffmpeg-the-third` declared; hw module compiles against the LGPL-clean build; spike findings doc linked from this feature's issue. |
| F1.1 | Multi-angle compositor | wgpu-based compositor that stacks multiple decoded video planes, applies viewport crops, and composites to an output surface — same code path for preview and final render | Composites 3 angles with correct viewport transforms matching the `camera-profiles.json` spec; verified against golden frames from the current Remotion output |
| F1.2 | VideoToolbox decode/encode path | Hardware-accelerated H.264 decode and encode via AVFoundation + VideoToolbox on macOS. **Spike result:** `ffmpeg-the-third` VideoToolbox path is pixel-exact on both Mac M2 and Mac M3 (mean diff = 0.000, max = 0 at both tested timestamps) — the implementation baseline exists in the spike's `hw` module. | Render on Mac M2 and Mac M3 completes in under 1 hour for a 60-min episode; output passes Tier 1 property spec checks; VideoToolbox path engaged (verified in logs, not silent software fallback). |
| F1.3 | NVENC/NVDEC decode/encode path | Hardware-accelerated H.264 decode (NVDEC) and encode (NVENC) on Windows/NVIDIA. **Spike result:** NVDEC hardware path is active on both candidates but both fail the spike's pixel tolerance (`ffmpeg-the-third`/CUDA mean diff ≈ 1.85 / max 91; gstreamer-rs/nvh264dec mean ≈ 3.86 / max 168). Root cause is unknown — this is an open Epic 1 investigation item, not a deferred nice-to-have. Both the LGPL build (F1.0) and the root-cause investigation must complete before this feature can be marked done. | Root cause of Windows NVDEC pixel drift identified and corrected; render on Windows/NVIDIA completes in under 1 hour; output passes Tier 1 property spec checks; no silent fallback to libx264; NVDEC hardware engagement verified in logs. |
| F1.4 | Real hardware capability probing | Replaces the `process.platform`/`process.arch` string heuristic in `hardware.ts` with actual GPU/codec capability queries at startup | Correctly identifies VideoToolbox on Mac and NVENC on Windows/NVIDIA; logs the resolved encoder profile at startup; does not silently fall back |
| F1.5 | Unified encoder profile mapping | Single `encoderProfile → FFmpeg/codec args` mapping consumed by every pipeline stage — no per-script encoder decisions | No pipeline script sets its own encoder; all route through the profile mapping; adding a new profile requires one code change in one file |
| F1.6 | Property spec validation suite | Automated Tier 1 property spec checks (active angle, viewport crop, cut/hook/speaker flags, source timestamps) against `properties.json` fixtures for all fixture episodes; Tier 2 sanity frames generated as informational artifact. | Suite runs on CI across Mac M2, Mac M3, and Windows/NVIDIA; Tier 1 checks are the pass/fail gate; Tier 2 frames stored as CI artifacts for visual review — not a blocking gate. |
| F1.7 | `transcript.json` + `camera-profiles.json` schema ingestion | Rust structs for both schemas; round-trips real fixture files without loss | Schema conformance tests pass on all fixture files exported from the current production pipeline |

---

## Epic 2: Transcription and Alignment

**Opportunity addressed:** [Opportunity 04 — Transcript token timing accuracy](06-opportunities/04-transcript-timing-accuracy.md)

**RFC reference:** Build Order Step 2. Isolated and low-risk; can begin once Epic 1's compositor API is stable enough that the transcription output format is known.

**Problem it solves:** Token timestamps are not frame-accurate — `t_end` is only populated after forced alignment, and `deriveCuts` falls back to `CUT_START_BIAS`/`WORD_DURATION_ESTIMATE` heuristics as the default path. Inaccurate timestamps mean every cut decision has a margin of error that compounds downstream.

**Definition of done:** `t_end` is reliably populated for every token after alignment; cut boundaries derived from the transcript alone land within 1 frame (≤16ms at 60fps) of the intended edit point on real episode fixtures.

### Features

| ID | Feature | Description | Acceptance criteria |
|----|---------|-------------|---------------------|
| F2.1 | whisper-rs transcription | Direct `whisper-rs` binding replacing the current subprocess + VTT-parsing contract; CUDA and Metal feature flags enabled | Transcription output matches current Whisper output on real episode fixtures; runs on Mac (Metal) and Windows (CUDA) without subprocess |
| F2.2 | WhisperX forced alignment subprocess | `tokio::process` call to WhisperX; parses output into `t_dtw`/`t_end` per token | `t_end` populated for every token in alignment output; round-trips to the `transcript.json` schema |
| F2.3 | Alignment accuracy validation | Automated test comparing aligned token boundaries against human-verified ground truth on a sample episode | No token's `t_end` misses its true boundary by more than 1 frame on the validation sample; `WORD_DURATION_ESTIMATE` fallback is not invoked in a normal run |

---

## Epic 3: Pipeline Orchestration

**Opportunity addressed:** [Opportunity 03 — End-to-end edit time](06-opportunities/03-edit-time-end-to-end.md)

**RFC reference:** Build Order Step 3. Depends on Epics 1 and 2 being stable — the orchestration wires around the proven render core.

**Problem it solves:** Every mechanical, repeatable step (sync, transcribe, diarize, cut derivation, camera setup, short-form extraction) currently requires manual supervision and produces a full additional day of work for short-form clips. The pipeline should handle all of it with the human's role limited to transcript review and approval.

**Definition of done:** Raw footage in → long-form edit + 3–5 short-form clips out, with under 30 minutes of human hands-on time (transcript review + approval). Measured on a real episode.

### Features

| ID | Feature | Description | Acceptance criteria |
|----|---------|-------------|---------------------|
| F3.1 | Audio/video sync | Port of FFT cross-correlation sync from `scripts/sync/AudioSyncer.js` into Rust; deterministic tie-break and SNR reliability check preserved; tuned constants carried over exactly | Sync output matches current AudioSyncer output on real multi-angle fixtures; offset measured within ±1 frame |
| F3.2 | Diarization subprocess | `tokio::process` call to pyannote; output parsed into speaker-turn segments | Speaker turns correctly segmented on real episode fixtures; speaker labels assignable from output |
| F3.3 | Speaker assignment | Maps diarization output to speaker names using `camera-profiles.json` speaker entries | Correct speaker names assigned to segments matching current pipeline output on fixtures |
| F3.4 | Transcript editing logic | Port of cut derivation and sentence merging from `scripts/edit-transcript.js`; `PAUSE_THRESHOLD`, `WORD_DURATION_ESTIMATE`, `CUT_START_BIAS` constants preserved exactly | Output transcript matches current `edit-transcript.js` output on real fixtures; constants not altered |
| F3.5 | Face detection subprocess | `tokio::process` call to mediapipe; output parsed into per-speaker closeup viewport | Viewport output matches current `setup-camera.js` output on fixtures |
| F3.6 | Thumbnail background removal subprocess | `tokio::process` call to rembg | Output matches current rembg output on fixtures |
| F3.7 | Short-form clip extraction | Short-form clips extracted as a first-class pipeline output from the same long-form source — not a separate wizard pass; produces `transcript.json` with `meta.outputAspect: "9:16"` and correct `meta.videoStart`/`meta.videoEnd` | 3–5 clips produced in the same pipeline run as the long-form edit; no second transcription or sync pass required |

---

## Epic 4: Multi-brand Support

**Opportunity addressed:** [Opportunity 06 — Multi-brand support](06-opportunities/06-multi-brand-support.md)

**RFC reference:** Not an explicit build-order step, but brand config must be in the schema from the start — retrofitting it later (as the current codebase is doing in Phase 0.5) is exactly what the rewrite should avoid. **Build alongside Epic 1** so the compositor, schema types, and asset loading are brand-aware from the first render.

**Problem it solves:** ragTech brand assets are hardcoded throughout the current pipeline. Delivering client footage with a different brand is not possible without manual file replacement. The service business (studio-rental partnership) cannot operate without brand-per-job support.

**Definition of done:** A pipeline run for Brand A and Brand B on the same raw footage produces two fully different branded outputs — logos, colors, fonts, host name cards, intro/outro, audio — with no manual file-swapping. Adding a third brand requires only a new brand directory and config file, zero code changes.

### Features

| ID | Feature | Description | Acceptance criteria |
|----|---------|-------------|---------------------|
| F4.1 | Brand config schema | Versioned JSON schema for per-job brand input: logo, colors, fonts, hosts (with camera angle mapping), intro/outro music, background music, mascot/visual assets, overlay template selection | Schema round-trips without loss; ragTech brand expressed as Brand 0 using this schema, not as a special case |
| F4.2 | Brand asset loader | Resolves brand directory at runtime from config; loads all assets for the job | Brand A and Brand B assets load independently in the same process; wrong-brand asset cannot be loaded for a given job |
| F4.3 | Core overlay template library | Parameterised intro sequence, name card/lower-third, and outro — driven by brand config (colors, fonts, logo, host images) | Same template renders correctly with two different brand configs; no brand-specific code paths inside the template |
| F4.4 | Brand registry | Convention: adding a brand = adding `brands/{name}/brand.json` + `brands/{name}/assets/`; no code changes required | Third brand added by directory + config only; pipeline picks it up without a code change or rebuild |
| F4.5 | ragTech brand migrated as Brand 0 | ragTech brand expressed entirely via the brand config schema — no ragTech-specific code remaining in the compositor or overlay logic | ragTech episode renders identically before and after migration; Techybara mascot, Nunito font, intro/outro music all driven from `brands/ragtech/brand.json` |

---

## Epic 5: Visual Transcript Editor

**Opportunities addressed:** [Opportunity 05 — Visual transcript editor](06-opportunities/05-visual-transcript-editor.md), [Opportunity 04 — Transcript token timing accuracy](06-opportunities/04-transcript-timing-accuracy.md) (visual cut placement component)

**RFC reference:** Build Order Step 4. Built last — after the compositor API (Epic 1) is stable — so the preview surface shares the exact same code path as final render.

**Problem it solves:** The current editing interface (plain text file in VSCode with custom cue syntax) requires editors to make timing-sensitive cut decisions blind — no video preview, no waveform, no playback. Hook clip boundaries require typing estimated float timestamps. Cue syntax is not discoverable. The gap between editing and seeing the result drives most of the trial-and-error in the current workflow.

**Definition of done:** An editor can complete a full episode edit — including hook clip in/out points — without typing a single float timestamp, and can preview any cut in-context before committing to a full render. In-editor preview matches final render output frame-for-frame.

### Features

| ID | Feature | Description | Acceptance criteria |
|----|---------|-------------|---------------------|
| F5.1 | egui timeline with waveform and playhead | Immediate-mode timeline rendering: waveform display, playhead scrubbing, clip lane visualisation | Waveform renders at 60fps without frame drops; playhead scrubs smoothly across a 60-minute episode |
| F5.2 | Transcript ↔ timeline sync | Clicking a word in the transcript scrubs the video to that word's `t_dtw` timestamp; moving the playhead highlights the corresponding word | Both directions work with <1 frame latency; clicking a word in a cut segment shows the cut state visually |
| F5.3 | Visual cut placement | Dragging a cut boundary on the timeline updates `t_dtw`/`t_end` in the transcript; the transcript text reflects the cut without manual float entry | Cut boundary placed visually lands within 1 frame of intended point; corresponding token in transcript updated correctly; no float typing required |
| F5.4 | Hook clip in/out point setting | In/out points for hook clips (`hookFrom`/`hookTo`) set by marking a range on the timeline | Hook boundary set visually; `hookFrom`/`hookTo` in transcript updated correctly; no float estimation |
| F5.5 | In-context preview | Selected cut or clip range plays back immediately in the editor using the compositor — same code path as final render | Preview output matches final render output frame-for-frame for the same segment; no separate render step to verify a cut |
| F5.6 | Camera angle preview per segment | Shows the active camera angle and viewport crop for a given segment inline in the timeline | Correct angle and crop displayed for each segment; switching angles visible without leaving the editor |

---

## Sequencing summary

```
[Spike]  FFmpeg vs gstreamer-rs         ← RESOLVED: ffmpeg-the-third chosen; findings in spike/rust-decode-spike/FINDINGS.md
[Epic 0] Project Setup & AI Harness    ← new repo; fixtures + property specs + harness; must finish before Epic 1
    ↓
[Epic 1] Native Render Engine          ← starts with F1.0 (LGPL FFmpeg build) then F1.0a (hw binding bootstrap)
[Epic 4] Multi-brand Support           ← parallel with Epic 1; brand schema must be in from day 1
    ↓
[Epic 2] Transcription and Alignment   ← begin once Epic 1 compositor API is stable
[Epic 3] Pipeline Orchestration        ← parallel with Epic 2; wires around the proven render core
    ↓
[Epic 5] Visual Transcript Editor      ← built last; shares compositor from Epic 1
```

The spike is resolved. Epic 0 is the current blocker — until fixtures (F0.4), property specs (F0.5), and the AI harness (F0.2) are complete, Epic 1 acceptance criteria cannot be evaluated. Epics 1+4 are parallel once Epic 0 is done. Epics 2+3 are parallel after Epic 1. Epic 5 is last.

**Epic 1 internal sequencing note:** F1.0 (LGPL FFmpeg build verification) must be the first task in Epic 1 — it is a prerequisite for F1.0a (binding bootstrap) and all subsequent F1.x work. F1.3 (Windows NVDEC) has an open root-cause investigation; it is not parallel-safe with F1.2 until the spike pixel drift is understood.
