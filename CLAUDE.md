# DeckCreate — Architecture Reference

Single source of truth for AI agents and contributors.

---

## Project: ragTech Podcast

**RAG Tech** — biweekly tech podcast. Handle: `@ragtechdev` on Spotify · YouTube · Apple Podcasts · Instagram · TikTok · LinkedIn.

### Cohosts
| Name | Role | Image |
|------|------|-------|
| Natasha | Software Engineer | `public/assets/team/natasha.PNG` |
| Saloni | Software Developer | `public/assets/team/saloni.PNG` |
| Victoria | Solutions Engineer | `public/assets/team/victoria.PNG` |

All cohost images have transparent backgrounds.

### Brand & Assets
- Config: `public/brand.json` — **being migrated to `brands/ragtech/brand.json`** (Phase 0.5)
- Logo: `public/assets/logo/transparent-bg-logo.png`
- Font: Nunito (variable, loaded via `remotion/loadFonts.ts`)
- Mascot: **Techybara** (capybara) — PNGs in `public/assets/techybara/`
- Intro/outro music: `public/sounds/intro-outro-music.mp3`
- Background music: `public/sounds/jazz-cafe-music.mp3`

---

## Pipeline

```
Raw audio/video
  ↓ [sync]             FFT cross-correlation → synced-output-{N}.mp4 (one per angle)
  ↓ [transcribe]       Whisper.cpp → token-level timestamps → transcript.raw.json
  ↓ [diarize]          Speaker turn detection → diarization.json
  ↓ [assign-speakers]  Labels segments with speaker names
  ↓ [align]            WhisperX forced alignment → refines t_dtw, populates t_end
  ↓ [edit-transcript]  Merges phrases → sentences → transcript.doc.txt + transcript.json
  Human edits doc (cuts, corrections, hooks, camera cues)
  ↓ [merge-doc]        Applies doc edits → transcript.json
  ↓ [setup-camera]     Face detection per angle → camera-profiles.json
  ↓ Remotion           transcript.json + camera-profiles.json → composed video
```

Intermediate files: `public/transcribe/output/`. Synced video(s): `public/sync/output/`.

Entry point: `scripts/wizard.js` (60KB procedural — being replaced with typed DAG runner in Phase 2).

---

## Data Schemas

### transcript.json

```
meta
  videoSrc?:   string     path relative to /public (overrides composition src prop)
  videoSrcs?:  string[]   all angle paths (multi-angle); used by setup-camera
  videoStart?: number     source seconds; segments before are excluded
  videoEnd?:   number     source seconds; segments after are excluded
  fps:         60
  outputAspect?: "9:16"   short-form only

segments[]
  id, start, end          source-video timestamps in seconds
  speaker                 display name (e.g. "Natasha")
  text                    human-readable sentence
  cut: boolean            true = entire segment removed
  tokens[]
    t_dtw: number         word start time (WhisperX-aligned or Whisper t_dtw)
    t_end?: number        word end time (forced alignment only)
    text: string
    cut: boolean
  cuts: TimeCut[]         [{from, to}] intra-segment ranges to skip
  hook?: boolean          when true, prepended as hook/teaser before main
  hookFrom?, hookTo?      clip bounds within the segment (seconds)
  cameraCues[]            explicit camera shot overrides (> CAM directives in doc)
```

`token.t_end` is populated only after forced alignment. Without it, `deriveCuts` falls back to `CUT_START_BIAS` heuristic.

### camera-profiles.json

```json
{
  "sourceWidth": 1920, "sourceHeight": 1080,
  "outputWidth": 1920, "outputHeight": 1080,
  "wideViewport": { "cx": 0.5, "cy": 0.5, "w": 1, "h": 1 },
  "angles": {
    "angle1": { "videoSrc": "sync/output/synced-output-1.mp4",
                "sourceWidth": 1920, "sourceHeight": 1080 }
  },
  "speakers": {
    "Natasha": {
      "label": "Natasha",
      "angleName": "angle1",
      "closeupViewport": { "cx": 0.3, "cy": 0.4, "w": 0.35, "h": 0.35 },
      "portraitCx": 0.3
    }
  }
}
```

`CropViewport`: `cx/cy` = normalised centre (0–1), `w/h` = crop dimensions (0–1).

---

## Rendering Model

Full range `[videoStart, lastSegment.end]` plays continuously. Cuts are opt-in:

| Source | Mechanism |
|--------|-----------|
| Entire segment removed | `segment.cut = true` |
| Intra-segment word/phrase | `segment.cuts[]` (from `{curly braces}` in doc) |
| Inter-segment silence | `merge-doc:cut-pauses` writes silence ranges into `cuts[]` |

No implicit cuts. Gaps between segments play as silence unless `merge-doc:cut-pauses` is run.

---

## Remotion Component Architecture

### Compositions

| ID | Component | Notes |
|----|-----------|-------|
| `ragTechVodcast` | `MyComposition` | Full episode: hooks → intro → main video |
| `PodcastIntro` | `PodcastIntroComposition` | 7 s intro (420 frames @ 60 fps) |
| `ShortFormClip` | `ShortFormClip` | 1080 × 1920 @ 60 fps portrait |

### Data flow

```
transcript.json
  → getActiveSegments()     filter by meta.videoStart/videoEnd
  → buildSections()         → {hookSections[], mainSections[]}
  → SegmentPlayer / CameraPlayer
  → SectionGroupPlayer      OffthreadVideo + trimBefore per section
```

### Key components

- **`SegmentPlayer`** — `buildSections`, `buildMainSubClips`, jump-cut engine. At frame `f`: `sourceFrame = S(f)` via summed section durations.
- **`CameraPlayer`** — `buildCameraShots`, `sourceToOutputFrame`, multi-angle viewport. Stacks one `SegmentPlayer` per unique angle; active angle `opacity:1`, others `opacity:0, muted`.
- **`SectionGroupPlayer`** — renders `OffthreadVideo` with `trimBefore`/`trimAfter` per section.
- **`HookOverlay`** — hook karaoke captions, Techybara mascot, hook timing.
- **`CaptionOverlay`** — short-form full-duration captions.
- **`OverlayRenderer`** — dispatches `GraphicsCue` → component; currently uses `React.FC<any>` (fixed in Phase 5).

**Viewport transform:**
```
scale = max(outW / (srcW × vp.w), outH / (srcH × vp.h))
tx    = (0.5 - vp.cx) × 100%
ty    = (0.5 - vp.cy) × 100%
→ CSS: scale(${scale}) translate(${tx}%, ${ty}%)
```

### Known correctness bugs (Phase 5 targets)

- `hookClipEnd()` has 4 separate implementations (`CameraPlayer`, `SegmentPlayer`, `Composition`, `HookOverlay`) — can disagree by 1–3 frames. Fix: `remotion/lib/hookTiming.ts`.
- `buildCaptions()` duplicated across `HookOverlay` and `CaptionOverlay`. Fix: `remotion/lib/captions.ts`.
- No `OverlayErrorBoundary` — overlay crash kills the composition.
- No transcript validation on load.

---

## Common Constants

| Constant | Value | File |
|----------|-------|------|
| `PAUSE_THRESHOLD` | 0.8 s | `edit-transcript.js` |
| `WORD_DURATION_ESTIMATE` | 0.4 s | `edit-transcript.js` |
| `CUT_START_BIAS` | 1.0 | `edit-transcript.js` |
| `HOOK_TAIL_PAD_UNBOUNDED_SECONDS` | 0.16 s | `SegmentPlayer.tsx` |
| `HOOK_TAIL_PAD_BOUNDED_SECONDS` | 0.02 s | `SegmentPlayer.tsx` |
| `HOOK_BRIDGE_MAX_GAP_SECONDS` | 1.0 s | `SegmentPlayer.tsx` |
| `HOOK_END_FADE_FRAMES` | 12 | `SegmentPlayer.tsx` |
| `DECLICK_FRAMES` | 3 | `SegmentPlayer.tsx` |
| `MIN_WIDE_S` | 1.5 s | `CameraPlayer.tsx` |
| `MAX_CLOSEUP_S` | 20 s | `CameraPlayer.tsx` |
| `PERIODIC_WIDE_S` | 45 s | `CameraPlayer.tsx` |

---

## Key Source Files

| File | Purpose | Refactor note |
|------|---------|---------------|
| `remotion/Composition.tsx` | Root composition, duration calc, asset loading | Add transcript validation (Phase 5) |
| `remotion/components/SegmentPlayer.tsx` | Jump-cut player, section builders | Extract hookTiming, captions (Phase 5) |
| `remotion/components/CameraPlayer.tsx` | Camera shots, multi-angle viewport (779 lines) | Extract cameraShots lib → <350 lines (Phase 6) |
| `remotion/components/HookOverlay.tsx` | Hook captions, Techybara (518 lines) | Extract captions.ts (Phase 5) |
| `remotion/components/OverlayRenderer.tsx` | Graphics cue dispatcher | Remove brand hardcoding (Phase 0.5+5) |
| `remotion/types/transcript.ts` | `Segment`, `Token`, `TimeCut`, `Transcript` | Will import from `scripts/types/` (Phase 6) |
| `remotion/types/camera.ts` | `CameraProfiles`, `CameraShot`, `CropViewport` | Will import from `scripts/types/` (Phase 6) |
| `remotion/types/brand.ts` | Brand design tokens only | Extend with identity/hosts/mascot/audio (Phase 0.5) |
| `scripts/config/project.ts` | `ProjectFile` type, `readProject`/`writeProject`, `ProjectNotFoundError` | Sprint 1 Issue #1 |
| `scripts/edit-transcript.js` | Sentence merging, `deriveCuts`, doc generation | Migrate to .ts (Phase 3) |
| `scripts/sync/AudioSyncer.js` | FFT sync, `syncMultiple` | Add FFT tie-breaking (Phase 0) |
| `scripts/wizard.js` | Interactive pipeline runner (60KB) | Replace with DAG runner (Phase 2) |
| `scripts/camera/setup-camera.js` | Frame extraction, face detection, `angles.json` | |
| `app/camera/page.tsx` | Camera GUI (face box editor, angle tabs) | |
| `app/editor/page.tsx` | Transcript editor | Add PreviewPlayer + scroll-sync (Phase 8) |
| `app/editor/Timeline.tsx` | Timeline component (630 lines) | Decompose + add waveform (Phase 8) |
| `app/components/AutoCarouselForm.tsx` | Carousel generator (810 lines) | Decompose (Phase 8) |
| `app/context/AuthContext.tsx` | Auth context with hardcoded credentials | Fix (Phase 7) |
| `vscode-transcript-language/src/extension.js` | VSCode transcript extension | Add Wrap-in-cut command (Phase 0.5) |

---

## Short-form Pipeline

Entry: `npm run shorts:wizard`. Two paths:

**Path A — clip from longform:** `public/edit/transcript.json` must exist. User selects time range; wizard creates clips without re-running sync/transcription.

**Path B — dedicated portrait recording:** Own sync/transcribe/align pipeline rooted at `public/shorts/`.

Output: `public/shorts/short-{id}/transcript.json` with `meta.outputAspect: "9:16"`, `meta.videoStart/videoEnd`, `meta.parentTranscript` (Path A only). Segments keep absolute timestamps from source.

Scripts: `scripts/shorts/extract-short-doc.js`, `scripts/shorts/merge-short-doc.js`, `scripts/shorts/portrait-camera-setup.js`.

---

## Refactor Plan

**Master doc:** `docs/PRODUCTION_REFACTOR_PLAN.md` — read in full before starting any phase.

Core problems being fixed: non-deterministic output, no project file, no pipeline DAG, no type safety across scripts, `hookClipEnd()` bug in 4 files, brand content hardcoded in TypeScript, no GPU acceleration.

### Phase map

| Phase | Branch | Goal |
|-------|--------|------|
| 0 | `refactor/p0-project-file` | `.ragtech/project.json`, deterministic runs, content-addressed artifacts |
| 0.5 | `refactor/p0-brand` | `brands/ragtech/` directory, extended Brand type, brand abstraction |
| 1 | `refactor/p1-hardware` | `scripts/config/hardware.ts`, GPU-accelerated FFmpeg encode/decode |
| 2 | `refactor/p2-dag` | Typed pipeline DAG replaces `wizard.js`; AI hook suggestions; captions export |
| 3 | `refactor/p3-scripts-ts` | Migrate 53 `.js` scripts → `.ts strict` |
| 4 | `refactor/p4-scripts-tests` | Unit tests, ≥60% coverage on `scripts/**/*.ts` |
| 5 | `refactor/p5-remotion-correctness` | Fix hook timing bug, add error boundaries, transcript validation |
| 6 | `refactor/p6-remotion-arch` | `BrandContext`, extract `cameraShots.ts`, merge duplicate components |
| 7 | `refactor/p7-app-api` | Remove hardcoded credentials, `withErrorHandler` middleware |
| 8 | `refactor/p8-app-components` | `PreviewPlayer`, waveform, scroll-sync, decompose large components |
| 9 | `refactor/p9-polish` | ESLint `no-explicit-any`, dead code removal |

Phases 0–4 (scripts) and 5–6 (Remotion) can proceed on separate branches in parallel.

### Target directory additions (post-refactor)

```
.ragtech/
  project.json            episode metadata, tool versions, run parameters
  artifacts/{sha256}.mp4  content-addressed artifact store
  runs/{timestamp}/       run logs per pipeline stage

brands/
  ragtech/
    brand.json            extended Brand config (identity, hosts, mascot, audio)
    assets/               team/, logo/, techybara/, episodes/
    sounds/
    components/           brand-specific overlays (AIOverlay, RagtechOverlay, etc.)

scripts/
  types/                  shared TS interfaces (imported by scripts + remotion)
  config/                 project.ts, hardware.ts, paths.ts, parseArgs.ts, artifacts.ts
  pipeline/               dag.ts, runner.ts, nodes/{sync,transcribe,...}.ts

remotion/
  lib/                    hookTiming.ts, captions.ts, cameraShots.ts, constants.ts
  context/                BrandContext.tsx
  types/overlayProps.ts   discriminated union for all overlay prop types
```

---

## Testing

**Standards doc:** `docs/TESTING_STANDARDS.md` — read before writing any test.

Three test types, three runners:

| Type | Location | Runner | Command |
|------|----------|--------|---------|
| Unit (scripts/pipeline) | `scripts/**/*.test.ts` | Jest `node` project | `npm test` |
| Unit (React components) | `app/**/*.test.tsx`, `remotion/**/*.test.tsx` | Jest `react` project | `npm run test:react` |
| Integration | `tests/integration/**/*.test.ts` | Jest `node` project | `npm run test:integration` |
| E2E | `e2e/**/*.test.ts` | Playwright | `npm run test:e2e` |

**First-time Playwright setup:** `npx playwright install chromium`

Every new pure function gets a unit test. Every new React component gets a smoke render test. E2E tests are required for Phase 8 user-facing features. Coverage thresholds are defined per phase in the standards doc.

**Key placement rule:** If a test uses `os.tmpdir()`, `fs.mkdtempSync`, real file reads/writes, or spawns a process, it is an **integration test** — place it in `tests/integration/`, not next to the source file in `scripts/`. Unit tests in `scripts/**/*.test.ts` must have no real I/O.

---

## Agent Implementation Convention

For any multi-step task:
- Write an implementation doc in `docs/implementation-guides/` before starting
- Each step must have a **Status check** — a single command or file-existence test that confirms it is done
- One isolated commit per step; commit message slug must match the doc heading exactly
- Never combine steps — isolation enables partial recovery

**Resuming interrupted work:**
1. `git log --oneline` — see completed commits
2. Open the relevant `docs/implementation-guides/` file
3. Match the last commit slug against doc headings → continue from next unstarted step

**Per-PR checklist:**
1. Behaviour parity — smoke-test relevant `npm run` scripts or Remotion compositions
2. `npm run test` passes
3. `tsc --noEmit` passes (where applicable)
4. Scope discipline — only files listed in the implementation doc touched
5. No new hardcoded paths in `scripts/`; no new duplicated timing constants in `remotion/`
6. *(Remotion phases)* — `remotion studio` launches; frame comparison against `docs/render-baselines/`
