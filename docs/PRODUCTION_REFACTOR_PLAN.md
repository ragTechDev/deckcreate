# DeckCreate — Production Architecture Overhaul

> **For agents picking this up:** This is the master refactor plan. Read it fully before starting any phase. Each phase has explicit status checks so you can verify prior work and resume correctly. Follow the CLAUDE.md commit convention: one isolated commit per step, commit slugs matching doc headings exactly.

---

## Critical Assessment

This app works, but it is not production software by professional video tool standards. The core problems are architectural, not cosmetic:

1. **Non-deterministic output.** Re-running the pipeline on the same inputs can produce different output frames. Whisper model versions are not recorded, the diarization seed is not pinned, FFT peak selection has no tie-breaking, and the timestamp offset flag is not persisted in the JSON it affects. No professional video tool allows this.

2. **No project model.** DaVinci Resolve has a `.drp` file. Premiere has `.prproj`. This app has no equivalent — tool versions, codec parameters, pipeline flags, and artifact lineage exist only in the heads of the people who ran the wizard. Re-rendering episode 12 from three months ago is impossible.

3. **The rendering engine is fundamentally throughput-limited.** Remotion renders via headless Chromium (Puppeteer) — each frame is rendered, extracted via IPC, PNG-encoded, and piped to FFmpeg. The practical ceiling is 2–5 fps on a MacBook Air M3. A 60-minute episode at 60fps (216,000 frames) takes 6–18 hours. This is not a configuration issue; it is inherent to the Puppeteer architecture.

4. **GPU acceleration is almost entirely missing.** M3 Metal, VideoToolbox, NVIDIA NVENC/NVDEC, CUDA FFT for sync, Core ML for face detection — none of it is used. The app leaves 5–50× speedups on the table.

5. **Hook timing logic has three separate implementations.** `CameraPlayer`, `SegmentPlayer`, and `Composition` all implement `hookClipEnd()` with slightly different formulas. They can disagree by 1–3 frames per hook segment. This is a correctness bug, not a style issue.

6. **No dependency graph.** The wizard runs steps serially with a "jump to step" menu, but has no idea which downstream artifacts are invalidated when you re-run sync. The DAG is implied, not enforced.

7. **Scripts are untested, untyped, and not structured for resumption.** 53 scripts with hardcoded paths, hand-rolled argument parsing, and no shared error handling. A crash mid-encode leaves orphaned temp files and broken outputs.

8. **All brand content is hardcoded.** 45+ host name references, 19 hardcoded mascot paths, terminal prompts, social handles — in TypeScript files, not config. Supporting a second brand requires code changes, not file creation.

---

## Target Standard

Match what a single-developer professional tool (Kdenlive, Gyroflow-style FFmpeg pipeline) achieves:

- **Frame-exact, byte-reproducible output** given the same inputs and tool versions
- **Content-addressed artifacts** — every intermediate file named by SHA-256 hash
- **A project file** capturing tool versions, model hashes, pipeline parameters
- **GPU-accelerated encode/decode** with automatic hardware detection (M3 VideoToolbox, NVIDIA NVENC/NVDEC)
- **ML models pinned by hash**, downloaded on first use
- **A proper DAG** so re-running sync automatically marks downstream artifacts stale
- **Typed, validated data contracts** between every pipeline stage
- **Multi-brand ready** — adding a new brand client requires creating files, not modifying code

---

## Architecture: What To Build

### Layer 1 — Project File (`.ragtech/project.json`)

Every episode has a project directory:

```
.ragtech/
  project.json          — episode metadata, tool versions, run parameters
  artifacts/
    {sha256[:12]}.mp4   — content-addressed video artifacts
    {sha256[:12]}.json  — content-addressed JSON artifacts
  runs/
    {iso-timestamp}/    — run log: which scripts, which flags, which outputs
```

`project.json` schema:
```json
{
  "version": "1",
  "episode": { "id": "ep42", "title": "...", "fps": 60 },
  "brandId": "ragtech",
  "tools": {
    "whisper_cpp": "1.5.5",
    "whisper_model": "medium.en",
    "whisper_model_sha256": "abc123...",
    "whisperx": "3.1.2",
    "pyannote": "3.1.0",
    "ffmpeg": "7.1",
    "remotion": "4.0.451"
  },
  "params": {
    "timestamp_offset": 0,
    "diarization_seed": 42,
    "num_speakers": 3,
    "sync_window_seconds": null
  },
  "artifacts": {
    "raw_video": [{ "path": "input/raw.mp4", "sha256": "..." }],
    "synced": { "artifact": "abc123", "created": "2026-05-07T..." },
    "transcript_raw": { "artifact": "def456", "created": "..." },
    "transcript_aligned": { "artifact": "ghi789", "created": "..." },
    "transcript_final": { "artifact": "jkl012", "created": "..." },
    "camera_profiles": { "artifact": "mno345", "created": "..." }
  }
}
```

### Layer 2 — Pipeline DAG

Replace `wizard.js` (60KB procedural script) with a typed pipeline runner:

```
           raw video + audio
                  │
           [sync]  ←── diarization_seed, sync_window_seconds
                  │
        synced-output.mp4
                  │
        [transcribe]  ←── whisper_model, timestamp_offset
                  │
        transcript.raw.json
           │              │
      [diarize]       [align]  ←── whisperx_model
           │              │
    diarization.json  transcript.aligned.json
                  │
        [assign-speakers]
                  │
        transcript.assigned.json
                  │
        [edit-transcript]
                  │
        transcript.doc.txt  ←── human edit
                  │
        [merge-doc]
                  │
        transcript.final.json
                  │
        [camera-setup]  ←── face detection model
                  │
        camera-profiles.json
                  │
        [render]  ←── remotion, ffmpeg, hardware flags
                  │
        episode.mp4
```

Each node: declares its inputs (content hashes) and outputs (content hashes), checks if outputs are already cached (hash match) → skips if yes, writes a run log on completion.

Implementation: `scripts/pipeline/dag.ts` — a lightweight DAG runner, not a full build tool.

### Layer 3 — Deterministic Reproducibility

| Issue | Fix |
|-------|-----|
| Diarization seed not pinned | Add `diarization_seed: 42` to `project.json`; pass to `run_diarize.py` |
| Whisper model version not recorded | Store `whisper_model_sha256` in `project.json`; verify on each run |
| Timestamp offset not persisted | Store in `project.json` params; never a CLI flag |
| FFT peak selection non-deterministic | Add tie-breaking: prefer earliest peak when SNR within 0.5 of max |
| Floating-point lag → frame conversion | Round lag to nearest frame boundary at sync time; store as integer frames |
| Camera face detection non-deterministic | Store detection results in artifact; only re-run if source video changes |
| Alignment coverage threshold | Make `ALIGNMENT_COVERAGE_THRESHOLD = 0.35` explicit in `project.json` params |

### Layer 4 — GPU Acceleration

All FFmpeg invocations go through a single `buildFfmpegArgs(profile, task)` function in `scripts/config/hardware.ts`. No more scattered platform checks.

| Component | M3 Mac | NVIDIA RTX 5050 | Current |
|-----------|--------|-----------------|---------|
| H.264 encode | `h264_videotoolbox` ✓ | `h264_nvenc` — missing | `libx264` on Linux |
| H.264 decode | `videotoolbox` input | `-hwaccel cuda` — missing | software |
| HDR tonemapping | `scale_metal` (macOS 13+) | `scale_cuda` | CPU `zscale` |
| Face detection | Core ML (.mlpackage) | TensorRT (ONNX) | CPU MediaPipe |
| Whisper | Native arm64 whisper.cpp | faster-whisper + CUDA | CPU whisper.cpp |
| Diarization | CPU PyTorch (native arm64) | GPU PyTorch (`cu124`) | CPU PyTorch |
| Audio FFT (sync) | CPU FFT.js | cuFFT | CPU FFT.js |
| Remotion rendering | 6-thread CPU (max) | 6-thread CPU (no GPU path) | same |

Note: Remotion (Puppeteer → PNG → FFmpeg) has no GPU path. Accept this. Focus GPU effort on encode/decode and ML.

### Layer 5 — Data Contracts (Typed + Validated)

Single source of truth: `scripts/types/`
```
scripts/types/
  project.ts          — ProjectFile interface
  transcript.ts       — mirrors remotion/types/transcript.ts
  camera.ts           — mirrors remotion/types/camera.ts
  python-interop.ts   — all JSON emitted by Python scripts
  pipeline.ts         — DAG node input/output contracts
```

`remotion/types/` imports from `scripts/types/` — one schema, two consumers, no duplication.

### Layer 6 — Remotion Component Architecture

Remotion is the right tool. CSS-based video compositions in React are maintainable. The issues are implementation quality.

| Problem | Fix |
|---------|-----|
| `hookClipEnd()` in 4 files (correctness bug) | Single `remotion/lib/hookTiming.ts` |
| `buildCaptions()` duplicated | Single `remotion/lib/captions.ts` |
| `Brand` drilled through 4 levels | `BrandContext` + `useBrand()` hook |
| `GraphicsCue.props: Record<string,unknown>` | Discriminated union in `remotion/types/overlayProps.ts` |
| No error boundary | `OverlayErrorBoundary` wraps every overlay instance |
| `CameraPlayer` 779 lines | Extract `computeCameraShots()` → `remotion/lib/cameraShots.ts` |
| `NameTitle.tsx` + `NameTitle.short.tsx` (90% dup) | Single component with `isShortForm?: boolean` |
| No transcript validation on load | `remotion/lib/validateTranscript.ts` after `fetchJson` |

---

## Language/Runtime Recommendations

| Layer | Current | Recommendation | Reason |
|-------|---------|---------------|--------|
| Pipeline orchestration | JavaScript (untyped) | **TypeScript strict** | Type-checking across boundaries prevents silent failures |
| Video processing | FFmpeg via `child_process` | **FFmpeg via typed wrapper** | Keep FFmpeg; add hardware detection + typed command builders |
| ML: transcription | whisper.cpp (CPU) | **faster-whisper on NVIDIA; whisper.cpp arm64 on M3** | 4× speedup on CUDA; arm64 already optimal on M3 |
| ML: diarization | pyannote (CPU PyTorch) | **pyannote (GPU PyTorch on NVIDIA; CPU on M3)** | 5× speedup on GPU |
| ML: face detection | MediaPipe (CPU) | **Core ML on M3; ONNX/TensorRT on NVIDIA** | 10–50× speedup |
| Rendering | Remotion (React + Chromium) | **Keep Remotion** | Right tool for CSS-driven video overlays |
| UI | Next.js + Mantine | **Keep; add proper auth** | Appropriate for internal tooling |
| Data persistence | JSON files | **JSON + content-addressed artifact store** | Human-readable + reproducible |
| Project file | None | **`.ragtech/project.json`** | Critical missing piece |

**Do not rewrite:** Python ML stack (pyannote, whisperx). Python owns the ML ecosystem. The JS/Python boundary is fine with typed JSON contracts on both sides.

---

## AI Model Recommendations

| Task | Current | Recommended | Why |
|------|---------|-------------|-----|
| Transcription | Whisper medium.en (whisper.cpp) | **Whisper large-v3** (faster-whisper on NVIDIA) | 30% fewer word errors; 4× faster on CUDA |
| Speaker diarization | pyannote (unpinned) | **pyannote/speaker-diarization-3.1** (pin in requirements.txt) | Better short segments; must be pinned |
| Forced alignment | WhisperX (unpinned) | **WhisperX 3.1.x** (pin + store model hash) | Alignment outputs change across versions |
| Face detection | MediaPipe BlazeFace | **MediaPipe Face Landmarker** → Core ML on M3 | 6 landmarks (better viewports); 50× faster |
| Carousel LLM | Unknown | **claude-sonnet-4-6** (hardcode model ID, never "latest") | Model changes break reproducibility |
| Thumbnail selection | Frame sampling | Keep current | Already good enough |

---

## Multi-Brand Architecture

### The Core Problem

The current `Brand` type only covers design tokens. All brand content is hardcoded in TypeScript:
- 45+ host name references (Natasha, Saloni, Victoria) across 4 files
- 19 hardcoded Techybara asset paths across 9 components
- Terminal prompt `~/ragtech` hardcoded in 4 overlay files
- `@ragtechdev` social handle hardcoded in 2 files
- Episode grid (12 thumbnail paths) hardcoded in `PodcastIntro`/`PodcastOutro`
- Audio file paths hardcoded in 3 files

Supporting a second brand requires code changes. That is the problem to fix.

### Principle: Don't Build Multi-Tenancy, Build the Abstraction

Build the file structure and type schema that makes adding a new brand a matter of creating files, not modifying existing code.

### Brand Directory Structure

```
brands/
  ragtech/                     ← current brand, migrated here
    brand.json                 ← full extended Brand config
    assets/
      team/                    ← natasha.PNG, saloni.PNG, victoria.PNG
      logo/
      techybara/               ← all mascot PNGs
      episodes/                ← episode grid thumbnails
    sounds/
      intro-outro-music.mp3
      jazz-cafe-music.mp3
    components/                ← brand-specific overlay components
      index.ts                 ← exports component registry
  acme-corp/                   ← future client
    brand.json
    assets/
    sounds/
    components/                ← optional
```

Active brand set in `project.json` as `"brandId": "ragtech"`.

### Extended Brand Type

```typescript
// remotion/types/brand.ts (extended)

export type BrandHost = {
  name: string;
  role: string;
  imgSrc: string;       // relative to brands/{brandId}/
  nameBgColor: string;
};

export type BrandMascot = {
  enabled: boolean;
  name: string;
  assets: {
    holdingMic?: string;
    teacher?: string;
    raisingHand?: string;
    holdingLaptop?: string;
    holdingLaptop2?: string;
    sparkleEyes?: string;
    [key: string]: string | undefined;
  };
};

export type Brand = {
  id: string;          // brand registry key (e.g. 'ragtech')

  // Existing (keep)
  colors: BrandColors;
  typography: BrandTypography;
  logo: string;
  shape: { borderRadius: number; borderRadiusSmall: number };

  // NEW: Identity
  identity: {
    name: string;            // 'RAG Tech'
    terminalPath: string;    // '~/ragtech'
    socialHandle: string;    // '@ragtechdev'
    website?: string;
  };

  // NEW: Team
  hosts: BrandHost[];

  // NEW: Mascot
  mascot: BrandMascot;

  // NEW: Media
  audio: {
    introOutroMusic: string;
    backgroundMusic: string;
  };
  background: {
    episodeGridAssets: string[];
  };
};
```

### Overlay Classification: Core Infrastructure vs. Brand-Owned

All existing keyword overlays are RAG Tech branded assets — they carry Techybara, the `~/ragtech` terminal chrome, and the RAG Tech visual vocabulary. They cannot be reused by a different brand. They are RAG Tech's creative work.

**Stays in `remotion/components/` (core):**

| Component | Why it's core |
|-----------|--------------|
| `BaseOverlay` | Pure animation + positioning infrastructure |
| `OverlayErrorBoundary` | Error handling infrastructure |
| `PodcastIntro`, `PodcastOutro`, `PodcastThumbnail` | Layout structure; parameterized by `brand.hosts`, `brand.audio`, `brand.background` |
| `NameTitle`, `ConceptExplainer`, `TextOverlay`, `CodeBlock`, `ChapterMarker`, `EpisodePill`, `HookTitle`, `ShortFormOutro`, `ImageWindowOverlay`, `GifWindowOverlay` | Layout structure; move to `remotion/components/overlays/templates/`; mascot conditional on `brand.mascot.enabled`; terminal path from `brand.identity.terminalPath` |
| `OverlayRenderer` | Dispatch system; brand overlays injected, not hardcoded |

**Moves to `brands/ragtech/components/`:**

| Component | Why it's brand-specific |
|-----------|------------------------|
| `AIOverlay`, `AwardsOverlay`, `CodingOverlay`, `EngineeringOverlay`, `FrameworkOverlay`, `LanguageOverlay`, `InfrastructureOverlay`, `EducationOverlay`, `BestPracticesOverlay`, `RolesOverlay` | RAG Tech's keyword vocabulary — different show = different topics |
| `RagtechOverlay` | Brand introduction overlay — every brand builds their own |
| All `*/ragtech/` overlays | Already brand-namespaced |

### The Overlay Registry

```typescript
// remotion/components/OverlayRenderer.tsx
import { CORE_TEMPLATE_MAP } from './overlays/templates';
import { getBrandOverlays } from '../lib/brandRegistry';

const COMPONENT_MAP = {
  ...CORE_TEMPLATE_MAP,
  ...getBrandOverlays(brand.id),
};
```

```typescript
// remotion/lib/brandRegistry.ts
export function getBrandOverlays(brandId: string) {
  // Static imports — esbuild tree-shakes unused branches
  if (brandId === 'ragtech') {
    return require('../../brands/ragtech/components').default;
  }
  // Future brands: add an if-branch here
  return {};
}
```

Static build-time imports only — no dynamic `import()`, no runtime plugins.

### How a New Brand Gets Overlays

- **Option A — Custom:** Build `brands/{clientId}/components/` with their mascot and keyword vocabulary. Maximum creative expression.
- **Option B — Templates only:** Use core template overlays styled via `brand.json`. Set `mascot.enabled: false`. Zero custom code.
- **Option C — Hybrid:** Core templates + one custom brand-intro overlay.

When a client signs: create `brands/{clientId}/`, fill `brand.json`, add assets, optionally add components, add one `if`-branch in `brandRegistry.ts`. No existing file changes.

---

## Editor Strategy: Code + Web Hybrid (Gap Analysis Integration)

Based on the Descript comparison in `docs/research/TRANSCRIPT_EDITOR_GAP_ANALYSIS.md`, the optimal strategy is a hybrid approach:

### Code Editor (VSCode) Remains Primary For:
- Text corrections and transcript editing
- Hook placement and content decisions
- Camera directives and speaker assignments
- Graphics and overlay markup
- All creative decisions that map to named doc directives

**Why:** The code editor already provides autocomplete, syntax highlighting, and VSCode's native undo/redo. Most "smart" features (filler detection, silence removal) are already implemented in the pipeline — the gap is UI discoverability, not capability.

### Web Editor Focuses On Three Critical Features (in priority order):
1. **`PreviewPlayer`** — Real-time video preview of cuts using `HTMLVideoElement` seek + `timeupdate`. This alone makes the editor feel like Descript's core experience. All required data exists in `transcript.json`.

2. **Waveform visualization** — Pre-computed during sync pipeline, rendered in `timelineCanvas.ts`. Makes silence and breath visible without listening.

3. **Transcript text panel with scroll-sync** — Read-only transcript view that highlights current word during playback. Enables inline text correction and filler word review in the web editor.

### Implementation Priority:
- **Phase 8** implements all three critical web features
- **Phase 0.5** adds VSCode extension improvements (`Wrap in cut` command, `> NOTE` support)
- **Phase 2** adds AI-powered features (hook suggestions, captions export)
- **Phase 0** enables version history/snapshots for undo/redo

### Features Explicitly Out of Scope:
- Voice synthesis (Overdub) — Descript's moat feature, complex and expensive
- Eye contact correction — Requires per-frame ML inference
- Direct platform publishing — Lower priority than core editing experience

---

## Phased Rebuild Plan

### Phase 0 — Project File & Determinism
**Branch:** `refactor/p0-project-file`
**Doc:** `docs/implementation-guides/REFACTOR_P0_PROJECT_FILE.md`
**Goal:** Make every subsequent run reproducible + enable version history.

Steps (each = one isolated commit):
1. Create `scripts/config/project.ts` — `ProjectFile` interface + `readProject()` / `writeProject()` helpers
2. Store `diarization_seed`, `timestamp_offset`, `num_speakers` in project file; remove from CLI flags
3. Pin all ML model versions in `requirements.txt` with `==`; add SHA verification on startup
4. Add `schema_version` and `tool_versions` to every JSON artifact written by any script
5. Add FFT tie-breaking in `AudioSyncer`: prefer earliest peak when SNR within 0.5 of max; store lag as integer frame offset, not float seconds
6. Create `scripts/config/artifacts.ts` — `storeArtifact(content): string` returns SHA256-based filename, writes to `.ragtech/artifacts/`
7. Add version history support: every `merge-doc` and web editor save snapshots transcript to `.ragtech/artifacts/` with timestamp; implement `npm run transcript:history` to list/restore snapshots

**Status checks:**
- `node -e "require('./scripts/config/project.ts')"` loads without error
- `diff <(npm run sync && cat .ragtech/artifacts/...) <(npm run sync && cat .ragtech/artifacts/...)` → identical output on second run
- `grep "timestamp_offset" scripts/**/*.ts` → only appears in `project.ts`, nowhere else

---

### Phase 0.5 — Brand Abstraction Layer
**Branch:** `refactor/p0-brand`
**Doc:** `docs/implementation-guides/REFACTOR_P0_BRAND.md`
**Goal:** All brand content out of code into config. Adding a new brand = creating files only + VSCode extension improvements.

Steps:
1. Extend `remotion/types/brand.ts` with `identity`, `hosts`, `mascot`, `audio`, `background` types
2. Create `brands/ragtech/`; migrate `public/brand.json` → `brands/ragtech/brand.json` with all new fields; update `BrandContext` to load from `brands/{brandId}/brand.json` using `brandId` from `project.json`
3. Move all keyword overlays (`AIOverlay`, `AwardsOverlay`, `CodingOverlay`, `EngineeringOverlay`, `FrameworkOverlay`, `LanguageOverlay`, `InfrastructureOverlay`, `EducationOverlay`, `BestPracticesOverlay`, `RolesOverlay`, `RagtechOverlay`) → `brands/ragtech/components/`; export from `brands/ragtech/components/index.ts`
4. Create `remotion/lib/brandRegistry.ts` with `getBrandOverlays(brandId)` static switch
5. Update `OverlayRenderer`: remove hardcoded keyword imports; use `{ ...CORE_TEMPLATE_MAP, ...getBrandOverlays(brand.id) }`
6. Move remaining overlays to `remotion/components/overlays/templates/`; parameterize mascot with `brand.mascot.enabled` guard; replace `~/ragtech` with `brand.identity.terminalPath`
7. Update `PodcastIntro`, `PodcastOutro`, `PodcastThumbnail`: `COHOSTS` → `brand.hosts`; `EPISODES` → `brand.background.episodeGridAssets`; audio paths → `brand.audio.*`
8. **VSCode extension improvements:** Add `Wrap in cut` command (Cmd+D) to wrap selected text in `{}`; add `> NOTE` directive support; add `> SPEAKER` snippet

**Status checks:**
- `grep -r "natasha\|saloni\|victoria\|techybara\|ragtechdev\|~/ragtech" remotion/components/` → zero results
- `grep -r "AIOverlay\|RagtechOverlay" remotion/components/OverlayRenderer.tsx` → zero results
- `tsc --noEmit` passes
- Frame comparison: RAG Tech compositions pixel-identical to pre-refactor baseline

---

### Phase 1 — Hardware Detection & GPU Acceleration
**Branch:** `refactor/p1-hardware`
**Doc:** `docs/implementation-guides/REFACTOR_P1_HARDWARE.md`
**Goal:** Use the hardware you have.

Steps:
1. `scripts/config/hardware.ts` — `detectHardware(): Promise<HardwareProfile>`; detects M3 / NVIDIA / CPU
2. `scripts/lib/ffmpeg.ts` — `buildFfmpegCommand(profile, task)` typed wrapper; NVENC, NVDEC, `scale_cuda`, `scale_metal` paths
3. Replace all inline `ffmpeg` spawn calls with `buildFfmpegCommand()`
4. Update `Dockerfile`: `ARG CUDA_ENABLED=false`; install GPU PyTorch when enabled
5. `detect-faces.py`: branch to Core ML on arm64 Darwin; CPU MediaPipe otherwise
6. `transcribe-audio.ts`: use faster-whisper when CUDA available; whisper.cpp otherwise

**Status checks:**
- On M3: `npm run video:optimize` ffmpeg command contains `h264_videotoolbox`
- On NVIDIA Docker: command contains `h264_nvenc`
- `grep -r "process.platform" scripts/` → only appears in `hardware.ts`

---

### Phase 2 — Pipeline DAG
**Branch:** `refactor/p2-dag`
**Doc:** `docs/implementation-guides/REFACTOR_P2_DAG.md`
**Goal:** Replace wizard with dependency-tracked runner + add AI-powered features.

Steps:
1. `scripts/pipeline/dag.ts` — `PipelineNode` type: `{ id, inputs: Artifact[], outputs: Artifact[], run() }`
2. `scripts/pipeline/nodes/` — one file per stage (`sync.ts`, `transcribe.ts`, `diarize.ts`, `align.ts`, `assign.ts`, `edit.ts`, `merge.ts`, `camera.ts`, `render.ts`)
3. `scripts/pipeline/runner.ts` — checks cached outputs (hash match); skips if yes; writes run log to `.ragtech/runs/`
4. `scripts/wizard.ts` — rewritten as thin interactive wrapper over `runner.ts`; keeps existing UX
5. `npm run pipeline:status` — prints which stages are stale and why
6. Add AI hook/chapter suggestions: `scripts/suggest-hooks.ts` calling Claude API with `transcript.json`; outputs commented `> HOOK` and `> ChapterMarker` suggestions in doc or `suggestions.json` sidecar
7. Add captions export: `scripts/export-captions.ts` generating SRT/VTT from token timestamps with cut sections excluded; reuse `SegmentPlayer` section math for timing

**Status checks:**
- Re-running sync: runner reports `transcript.raw.json` as stale, prompts re-transcription
- Skipped stage output: `✓ transcribe (cached sha:def456)`
- `.ragtech/runs/{timestamp}/run-log.json` exists after each stage

---

### Phase 3 — Scripts: TypeScript + Shared Infrastructure
**Branch:** `refactor/p3-scripts-ts`
**Doc:** `docs/implementation-guides/REFACTOR_P3_SCRIPTS_TS.md`
**Goal:** Type safety and shared utilities across all 53 scripts.

Steps:
1. `scripts/config/paths.ts` — centralized path resolver; `PATHS.transcribeInput(cwd)` etc.
2. `scripts/config/parseArgs.ts` — schema-driven CLI parser replacing 28 hand-rolled loops; generates `--help`
3. `scripts/config/exitOnError.ts` — `handleFatalError(err)` + `withCleanup(main, cleanup)` for SIGTERM/temp cleanup
4. `scripts/types/python-interop.ts` — TypeScript interfaces for all Python JSON output (`DiarizationSegment`, `AlignmentResult`, `TranscriberToken`)
5. Migrate all 53 scripts `.js` → `.ts` (dependency order: config → shared → individual scripts → `edit-transcript.ts` last)
6. Add `tsconfig.scripts.json` with `strict: true, noEmit: true`; must pass clean

**Status checks:**
- `npx tsc -p tsconfig.scripts.json --noEmit` → zero errors
- `grep -rn "any" scripts/**/*.ts` → zero untyped `any` (use `unknown` + narrowing)
- `npm run transcribe -- --help` prints usage
- `npm run transcribe -- --unknown-flag` exits 1 with clear stderr message

---

### Phase 4 — Scripts: Testability + Coverage
**Branch:** `refactor/p4-scripts-tests`
**Doc:** `docs/implementation-guides/REFACTOR_P4_SCRIPTS_TESTS.md`
**Goal:** Critical pipeline logic is unit-tested.

Steps:
1. Add optional `{ fs, spawn }` injection to `Transcriber`, `Diarizer`, `AudioSyncer` constructors; entry points pass production defaults
2. Extract pure functions from `edit-transcript.ts`: `buildTranscript(rawJson, options)` and `mergeDoc(transcript, docText)` — no I/O
3. Write tests: `parseArgs.test.ts`, `paths.test.ts`, `exitOnError.test.ts`, `Transcriber.test.ts`, `buildTranscript.test.ts`, `mergeDoc.test.ts`, `alignTranscript.test.ts`
4. Update Jest config for `.ts` files; coverage threshold ≥60% on `scripts/**/*.ts`

**Status checks:**
- `npm run test` passes; coverage report shows ≥60% on `scripts/**/*.ts`
- No test file uses real file I/O (all use temp dirs or mocks)
- Existing carousel/caption tests still pass

---

### Phase 5 — Remotion: Fix Correctness Issues First
**Branch:** `refactor/p5-remotion-correctness`
**Doc:** `docs/implementation-guides/REFACTOR_P5_REMOTION_CORRECTNESS.md`
**Goal:** Fix the bugs before reorganizing.

Steps:
1. Create `remotion/lib/hookTiming.ts` — extract `hookClipEnd()`, `getHookSubClips()`, `buildHookSections()` from 4 files; all import from here
2. Create `remotion/lib/captions.ts` — extract `buildCaptions()` and all token-classification helpers from `HookOverlay.tsx` + `CaptionOverlay.tsx`
3. Create `remotion/lib/constants.ts` — all timing constants (`HOOK_TAIL_PAD_*`, `HOOK_BRIDGE_*`, `FPS`, `DECLICK_FRAMES`); delete all duplicate declarations
4. Create `remotion/components/OverlayErrorBoundary.tsx` — catches render errors, shows transparent fallback; wrap every overlay instance in `OverlayRenderer`
5. Create `remotion/lib/validateTranscript.ts` — manual shape-checking; call after `fetchJson` in `Composition.tsx` and `ShortFormClip.tsx`; show error card in Studio on failure
6. `CameraPlayer`: add `console.warn` + wide-shot fallback when speaker profile missing; never silently skip

**Status checks:**
- `grep -r "HOOK_TAIL_PAD_UNBOUNDED_SECONDS = 0.16" remotion/` → zero results
- `grep -r "hookClipEnd" remotion/components/` → zero results (only in `lib/hookTiming.ts`)
- `remotion studio` shows error card (not crash) when `segments` field is null
- Frame comparison: frames 0, first hook start, hook→main transition pixel-identical to pre-refactor baseline screenshots in `docs/render-baselines/`

---

### Phase 6 — Remotion: Architecture Cleanup
**Branch:** `refactor/p6-remotion-arch`
**Doc:** `docs/implementation-guides/REFACTOR_P6_REMOTION_ARCH.md`
**Goal:** Maintainable component structure.

Steps:
1. `BrandContext` (`remotion/context/BrandContext.tsx`) + `SectionsContext` — remove 4-level prop drilling; components call `useBrand()` / `useSections()`
2. Create `remotion/types/overlayProps.ts` — discriminated union for all overlay prop types; `OverlayRenderer` switch-narrows `cue.type`; eliminate all `React.FC<any>`
3. Merge `NameTitle.tsx` + `NameTitle.short.tsx` → single component with `isShortForm?: boolean`; `.short` is thin re-export. Same for `ConceptExplainer`
4. Extract `computeCameraShots()` + `resolveVideoSrc()` + `sourceToOutputFrame()` from `CameraPlayer.tsx` → `remotion/lib/cameraShots.ts` (pure TS, no React/Remotion imports); `CameraPlayer` under 350 lines
5. Extract intro animation helpers → `remotion/lib/introAnimations.ts`
6. `remotion/types/` imports from `scripts/types/` — no duplicate type definitions

**Status checks:**
- `grep -r "React.FC<any>" remotion/` → zero results
- `grep -r "brand\b" remotion/components/SegmentPlayer.tsx` → zero results (uses context, not prop)
- `wc -l remotion/components/CameraPlayer.tsx` → under 350
- `tsc --noEmit` strict: zero errors
- Pixel-identical frame comparison to Phase 5 output

---

### Phase 7 — App: Auth + API Hardening
**Branch:** `refactor/p7-app-api`
**Doc:** `docs/implementation-guides/REFACTOR_P7_APP_API.md`
**Goal:** No hardcoded credentials; proper API error handling.

Steps:
1. Remove `DEMO_CREDENTIALS` from `AuthContext.tsx`; new `POST /api/auth/login` reads `AUTH_EMAIL`/`AUTH_PASSWORD`/`SESSION_SECRET` env vars; returns httpOnly SameSite=Strict cookie session
2. `GET /api/auth/me` validates session cookie
3. `app/api/middleware.ts`: `withErrorHandler(handler)` wraps all 7 route handlers; unhandled throws → `{ error: "..." }` JSON with status 500

**Status checks:**
- `grep -r "DEMO_CREDENTIALS\|demo_password\|localStorage" app/` → zero results
- Route that throws returns `{ error: "..." }` JSON with status 500, not HTML
- Cookie is httpOnly in browser devtools

---

### Phase 8 — App: Component Decomposition + Editor Features
**Branch:** `refactor/p8-app-components`
**Doc:** `docs/implementation-guides/REFACTOR_P8_APP_COMPONENTS.md`
**Goal:** No component over 350 lines + add critical Descript-like editing features.

Steps:
1. `AutoCarouselForm.tsx` (810 lines) → orchestrator <150 lines + `VideoInput`, `CarouselConfig`, `ManualPromptMode`, `CarouselResults`, `SlideEditor` sub-components (each <250 lines)
2. `Timeline.tsx` (630 lines) → extract `useDragHandlers`, `useAutoScroll`, `useMarkIn` custom hooks; component under 300 lines
3. **Critical: Add PreviewPlayer** - browser video player that reads `transcript.json` cuts and plays back with sections skipped using `HTMLVideoElement` seek + `timeupdate`; port section calculation logic from `remotion/components/SegmentPlayer.tsx`
4. **Add transcript text panel with scroll-sync** - read-only transcript view that highlights current word during playback; map playback time → token → doc line
5. **Add waveform visualization** - pre-compute peak amplitude per frame during sync pipeline step; store as sidecar JSON; render in `timelineCanvas.ts` as waveform layer
6. **Add filler word review panel** - list all `{word}` cuts with per-word restore buttons
7. **Add silence removal preview** - show proposed silence cuts as pending yellow bands in timeline before user confirms
8. **Add speaker assignment UI** - right-click on segment track → "Change speaker" dropdown; writes `> SPEAKER` directive back to doc
9. **Add undo/redo functionality** - implement command pattern or `useReducer` with history stack for web editor edits
10. **Add audio scrubbing** - connect timeline drag events to `videoElement.currentTime` updates in real time

**Status checks:**
- `wc -l app/components/AutoCarouselForm.tsx` → under 150
- `wc -l app/editor/Timeline.tsx` → under 300
- Full auto-carousel flow works end-to-end
- Timeline trim drags, camera cue drags, auto-scroll all function correctly

---

### Phase 9 — Lint + Dead Code
**Branch:** `refactor/p9-polish`
**Doc:** `docs/implementation-guides/REFACTOR_P9_POLISH.md`
**Goal:** Enforce standards automatically.

Steps:
1. Audit and delete confirmed-unused components: `grep -r "BaseOverlay\|TextOverlay\|IconBadge\|CodeBlock" remotion/ app/` — delete any with no imports outside their own file
2. Add ESLint rules: `@typescript-eslint/no-explicit-any` as error (in `remotion/`, `app/`), `no-console` as warning outside `scripts/`
3. Fix or suppress (with explicit comments) all new lint violations

**Status checks:**
- `npm run lint` → zero errors
- `tsc --noEmit` → zero errors
- `remotion studio` starts; `npm run test` passes

---

## Phase Dependency Order

```
Phase 0   (project file + determinism)
Phase 0.5 (brand abstraction)          ← can run in parallel with Phase 0
  └── Phase 1 (hardware + GPU)         ← independent of brand work
      └── Phase 2 (pipeline DAG)
          └── Phase 3 (scripts TS)
              └── Phase 4 (scripts tests)

Phase 5 (remotion correctness)         ← can start after Phase 0.5
  └── Phase 6 (remotion architecture)
      └── Phase 7 (app API)
          └── Phase 8 (app components)
              └── Phase 9 (lint)
```

Phases 1–4 (scripts) and Phases 5–6 (Remotion) can proceed on separate branches in parallel.

---

## Per-PR Review Checklist

Every PR must pass this before merge:

1. **Behaviour parity** — smoke-test the `npm run` scripts or Remotion compositions relevant to this phase on a real episode
2. **No test regressions** — `npm run test` passes
3. **TypeScript** — `tsc --noEmit` passes (where applicable to the phase's layer)
4. **Scope discipline** — PR touches only files listed in the implementation doc
5. **Doc completeness** — every step in the phase's implementation doc has its Status check marked done
6. **No new hardcoded paths** in `scripts/`; no new duplicated timing constants in `remotion/`
7. *(Remotion phases)* — `remotion studio` launches; frame comparison against `docs/render-baselines/` baseline

---

## Operational Continuity Rules

- `main` is never broken — always production-safe for real episode production
- Remotion phases (5–6) merge only after `npx remotion render ragTechVodcast --frames 0,420,900` diff passes against `docs/render-baselines/`
- Python scripts are never modified (out of scope for this refactor)
- Implementation docs stay in `docs/implementation-guides/` permanently as audit trail
- **Resume interrupted work:** `git log --oneline` → match against doc headings → continue from next unstarted step

---

## Render Throughput Honest Assessment

The Puppeteer-based rendering ceiling (2–5 fps) cannot be fixed within Remotion. For 1–2 episodes per month, this is acceptable — renders run overnight. If episode volume grows:

- **Short-term:** Run renders overnight (already the workflow)
- **Medium-term:** Remotion Lambda (serverless distributed rendering)
- **Long-term:** `renderFrames` API with max `--concurrency` on a multi-core machine (8–16 cores = 3–8× faster)

Do not rewrite the rendering engine. Remotion is correct for this use case.

---

## Agent-Readable Conventions

Every run log written by the pipeline:
```json
{
  "stage": "transcribe",
  "started": "2026-05-08T10:00:00Z",
  "finished": "2026-05-08T10:08:32Z",
  "inputs": [{ "artifact": "abc123", "role": "audio" }],
  "outputs": [{ "artifact": "def456", "role": "transcript_raw" }],
  "tool_versions": { "whisper_cpp": "1.5.5", "model_sha256": "..." },
  "params": { "model": "medium.en", "timestamp_offset": 0 }
}
```

Every implementation doc step:
```markdown
### Step N — [description]
[what to do]

**Status check:** `[command]` → [expected output]
```

---

## Critical Files Reference

| File | Problem | Phase |
|------|---------|-------|
| [scripts/wizard.js](../scripts/wizard.js) | 60KB procedural; replace with DAG runner | Phase 2 |
| [scripts/sync/AudioSyncer.js](../scripts/sync/AudioSyncer.js) | Non-deterministic FFT peak; lag stored as float | Phase 0 |
| [remotion/components/CameraPlayer.tsx](../remotion/components/CameraPlayer.tsx) | 779 lines; 4 duplicate `hookClipEnd()` | Phase 5+6 |
| [remotion/components/OverlayRenderer.tsx](../remotion/components/OverlayRenderer.tsx) | `React.FC<any>`; hardcoded brand overlay imports | Phase 0.5+5 |
| [remotion/components/HookOverlay.tsx](../remotion/components/HookOverlay.tsx) | Duplicate `buildCaptions()`; 518 lines | Phase 5 |
| [app/editor/page.tsx](../app/editor/page.tsx) | Needs PreviewPlayer and transcript text panel | Phase 8 |
| [app/editor/Timeline.tsx](../app/editor/Timeline.tsx) | 630 lines; needs waveform layer and scroll-sync | Phase 8 |
| [app/editor/timelineCanvas.ts](../app/editor/timelineCanvas.ts)) | Needs waveform draw functions | Phase 8 |
| [vscode-transcript-language/src/extension.js](../vscode-transcript-language/src/extension.js) | Missing `Wrap in cut` command and `> NOTE` support | Phase 0.5 |
| [scripts/edit-transcript.js](../scripts/edit-transcript.js) | Filler detection exists but needs discoverability | Phase 2 |
| [remotion/Composition.tsx](../remotion/Composition.tsx) | No transcript validation; duplicate hook logic | Phase 5 |
| [remotion/types/brand.ts](../remotion/types/brand.ts) | Incomplete — only design tokens | Phase 0.5 |
| [app/components/AutoCarouselForm.tsx](../app/components/AutoCarouselForm.tsx) | 810 lines; no sub-components | Phase 8 |
| [app/context/AuthContext.tsx](../app/context/AuthContext.tsx) | Hardcoded credentials | Phase 7 |
| [scripts/diarize/run_diarize.py](../scripts/diarize/run_diarize.py) | No seed pinning | Phase 0 |
