# DeckCreate — Architecture Reference

End-to-end guide for AI agents and contributors. See `CLAUDE.md` for project/brand context.

---

## Agent implementation convention

Any multi-step feature must be broken into isolated, independently-testable commits.
Implementation docs live in `docs/`. Each commit message slug must match the heading
in the corresponding doc exactly so that a resuming agent can locate its starting point.

**Resuming interrupted work:**
1. Run `git log --oneline` to see completed commits.
2. Open the relevant doc in `docs/`.
3. Match the last commit message against the slugs in the checklist.
4. Continue from the next unstarted step. Do not re-do completed commits.

**When writing an implementation doc:**
- Each step must include a "Status check" — a single command or file-existence test
  that confirms the step is already done.
- Steps must be ordered by dependency. Note cross-step dependencies explicitly.
- Commits must not be combined. Isolation allows partial recovery.

---

## Pipeline

```
Raw audio/video
  ↓ [sync]            FFT cross-correlation → synced-output-{N}.mp4 (one per angle)
  ↓ [transcribe]      Whisper.cpp → token-level timestamps → transcript.raw.json
  ↓ [diarize]         Speaker turn detection → diarization.json
  ↓ [assign-speakers] Labels segments with speaker names
  ↓ [align]           WhisperX forced alignment → refines t_dtw, populates t_end
  ↓ [edit-transcript] Merges phrases → sentences → transcript.doc.txt + transcript.json
  Human edits doc (cuts, corrections, hooks, camera cues)
  ↓ [merge-doc]       Applies doc edits → transcript.json
  ↓ [setup-camera]    Face detection per angle → camera-profiles.json
  ↓ Remotion          transcript.json + camera-profiles.json → composed video
```

Intermediate files: `public/transcribe/output/`. Synced video(s): `public/sync/output/`.

---

## transcript.json schema

```
meta
  videoSrc?:   string     path relative to /public (overrides composition src prop)
  videoSrcs?:  string[]   all angle paths (multi-angle); used by setup-camera
  videoStart?: number     source seconds; segments before are excluded
  videoEnd?:   number     source seconds; segments after are excluded
  fps:         60

segments[]
  id, start, end          source-video timestamps in seconds
  speaker                 display name (e.g. "Natasha")
  text                    human-readable sentence
  cut: boolean            true = entire segment removed
  tokens[]
    t_dtw: number         word start time (WhisperX-aligned or Whisper t_dtw)
    t_end?: number        word end time (forced alignment only)
                          when present, deriveCuts uses exact boundaries
                          when absent, falls back to heuristic CUT_START_BIAS
    text: string
    cut: boolean
  cuts: TimeCut[]         [{from, to}] intra-segment ranges to skip
                          populated by edit-transcript from token.cut flags
                          NOT set manually — edit transcript.doc.txt instead
  hook?: boolean          when true, prepended as hook/teaser before main
  hookFrom?, hookTo?      clip bounds within the segment (seconds)
  cameraCues[]            explicit camera shot overrides (> CAM directives in doc)
```

---

## camera-profiles.json schema

```json
{
  "sourceWidth": 1920, "sourceHeight": 1080,
  "outputWidth": 1920, "outputHeight": 1080,
  "wideViewport": { "cx": 0.5, "cy": 0.5, "w": 1, "h": 1 },

  // Multi-angle only — one entry per camera angle
  "angles": {
    "angle1": { "videoSrc": "sync/output/synced-output-1.mp4",
                "sourceWidth": 1920, "sourceHeight": 1080,
                "wideViewport": { "cx": 0.5, "cy": 0.5, "w": 1, "h": 1 } },
    "angle2": { "videoSrc": "sync/output/synced-output-2.mp4",
                "sourceWidth": 1920, "sourceHeight": 1080 }
  },

  "speakers": {
    "Natasha": {
      "label": "Natasha",
      "angleName": "angle1",        // omit for single-angle
      "closeupViewport": { "cx": 0.3, "cy": 0.4, "w": 0.35, "h": 0.35 },
      "portraitCx": 0.3             // portrait-mode centre
    }
  }
}
```

`CropViewport`: `cx/cy` = normalised centre (0–1), `w/h` = crop dimensions (0–1).

---

## Rendering model — "inclusive by default"

Full range `[videoStart, lastSegment.end]` plays continuously. Cuts are opt-in:

| Source | Mechanism |
|--------|-----------|
| Entire segment removed | `segment.cut = true` |
| Intra-segment word/phrase | `segment.cuts[]` entries (from `{curly braces}` in doc) |
| Inter-segment silence | `merge-doc:cut-pauses` writes silence ranges into `cuts[]` |

No implicit cuts. Gaps between segments play as silence unless you run `merge-doc:cut-pauses`.

---

## Remotion component architecture

### Data flow
```
transcript.json
  → getActiveSegments()        filter by meta.videoStart/videoEnd
  → buildSections()            → {hookSections[], mainSections[]}
  → SegmentPlayer / CameraPlayer
  → SectionGroupPlayer         OffthreadVideo + trimBefore per section
```

### buildSections (`SegmentPlayer.tsx`)

Two independent section arrays — hooks and main — each in its own `<Sequence>` with a local frame counter. Separation prevents negative `trimBefore` (hooks originate deep in source time).

**Main sections** (`buildMainSubClips`):
1. Range = `[videoStart, lastActiveSegment.end]`
2. Collect exclusions: `cut=true` spans + all `cuts[]` entries
3. Merge overlapping exclusions; invert → playable `SubClip[]`
4. Convert: `trimBefore = Math.floor(start*fps)`, `trimAfter = Math.ceil(end*fps)`

**Hook sections** (`getHookSubClips`): uses `hookFrom/hookTo` bounds, extends end when spoken tokens drift past `hookTo`, bridges to next hook if gap ≤ 1 s.

### SectionGroupPlayer (`SegmentPlayer.tsx`)

Jump-cut engine. At composition frame `f`:
```
summedDurations = Σ(section.trimAfter - section.trimBefore) for sections[0..k]
trimBefore      = section.trimAfter - summedDurations    (= S(f) - f)
sourceFrame     = trimBefore + f                         (= S(f))
```
`OffthreadVideo` receives `trimBefore` and renders source frame `S(f)`. Cuts are skipped because no section covers those source frames.

`muted?: boolean` prop silences audio — used by `CameraPlayer` for non-active angle layers.

### CameraPlayer (`CameraPlayer.tsx`)

Applies viewport transforms (scale + translate) to simulate punch-in/punch-out camera cuts.

**Single-angle**: wraps one `SegmentPlayer` in an `AbsoluteFill`, animates `CropViewport` transform.

**Multi-angle**: stacks one `SegmentPlayer` per unique `videoSrc` referenced in shots. At each frame, the active angle layer has `opacity: 1`; all others `opacity: 0, muted`. Viewport transform and source dimensions are per-angle.

**`buildCameraShots`** — builds `CameraShot[]` timeline:
- Shot boundaries at segment start times via `sourceToOutputFrame(seg.start, mainSections, fps)`
- `emitShot()` looks up `speaker.angleName → profiles.angles[name].videoSrc` to set `shot.videoSrc`
- Pacing constants: `MIN_WIDE_S=1.5s`, `MAX_CLOSEUP_S=20s`, `PERIODIC_WIDE_S=45s`
- Speaker changes trigger immediate cut to new closeup if previous shot ≥ 1 s

**`CameraShot`**: `{ startFrame, endFrame, viewport: CropViewport, videoSrc?: string }`

**Viewport transform**:
```
scale = max(outW / (srcW × vp.w), outH / (srcH × vp.h))
tx    = (0.5 - vp.cx) × 100 %
ty    = (0.5 - vp.cy) × 100 %
→ CSS: scale(${scale}) translate(${tx}%, ${ty}%)
```

**Explicit overrides** (`cameraCues[]`): `collectCameraOverrides` maps cue timestamps to output frames via `sourceToOutputFrame`; `applyOverrides` splices them into the pacing shot list, propagating `videoSrc` from the cue's speaker profile.

### Hook rendering

1. `hookSections` → frames `[0, hookDuration)`
2. `PodcastIntro` → frames `[hookDuration, hookDuration + INTRO_DURATION_FRAMES)`
3. `mainSections` → from `hookDuration + introFrames` (passed as `mainOffset`)

Hook music looped over hook duration. `HookOverlay` shows karaoke captions + Techybara mascot; mounted for full composition duration, returns `null` outside hook frames.

---

## Multi-angle sync (`AudioSyncer.syncMultiple`)

`AudioSyncer.syncMultiple(videoPaths, audioPath, outputDir)` — static method in `scripts/sync/AudioSyncer.js`. Syncs each video independently to the same audio via FFT cross-correlation. Outputs `synced-output-1.mp4`, `synced-output-2.mp4`, etc. Returns `[{ outputPath, videoSrc, sourceWidth, sourceHeight }]`.

---

## Camera setup — multi-angle (`setup-camera.js`)

`--videos p1 p2 ...` OR reads `meta.videoSrcs` from transcript. Per angle:
- Extracts `frame-angle{N}.jpg` at `meta.videoStart`
- Runs MediaPipe face detection → `detections-angle{N}.json`

Writes `angles.json` (manifest for the camera GUI):
```json
[{ "angleName": "angle1", "videoSrc": "...", "frameFile": "frame-angle1.jpg",
   "detectFile": "detections-angle1.json" }, ...]
```

Camera GUI (`app/camera/page.tsx`): loads `angles.json`, shows angle tabs, tags each face box with `angleName`, saves `angleName` per speaker + `angles` map to `camera-profiles.json`.

---

## Silence removal

`merge-doc:cut-pauses` (`--auto-cut-pauses N`) detects silence gaps and writes `TimeCut` entries into `segment.cuts[]`. The renderer excludes those ranges identically to any other cut. Default threshold: `0.5 s`.

With `token.t_end` (after forced alignment): silence = `next.t_dtw − curr.t_end` (exact).  
Without: estimate = `next.t_dtw − curr.t_dtw − WORD_DURATION_ESTIMATE (0.4 s)`.

---

## Cut boundary precision

`deriveCuts` in `edit-transcript.js`:

| Field available | Cut start | Cut end |
|---|---|---|
| `prevWord.t_end` present | `prevWord.t_end` (exact) | `nextWord.t_dtw` (exact) |
| `t_end` absent | `prevWord.t_dtw + CUT_START_BIAS × gap` | `nextWord.t_dtw` (exact) |

---

## Key source files

| File | Purpose |
|------|---------|
| `remotion/Composition.tsx` | Root composition, duration calc, asset loading |
| `remotion/components/SegmentPlayer.tsx` | `buildSections`, `buildMainSubClips`, jump-cut player |
| `remotion/components/CameraPlayer.tsx` | `buildCameraShots`, `sourceToOutputFrame`, multi-angle viewport |
| `remotion/components/HookOverlay.tsx` | Hook captions, Techybara, hook timing |
| `remotion/types/transcript.ts` | `Segment`, `Token`, `TimeCut`, `Transcript` |
| `remotion/types/camera.ts` | `CameraProfiles`, `AngleConfig`, `SpeakerProfile`, `CameraShot`, `CropViewport` |
| `scripts/edit-transcript.js` | Sentence merging, `deriveCuts`, doc generation |
| `scripts/sync/AudioSyncer.js` | FFT sync, `syncMultiple` |
| `scripts/camera/setup-camera.js` | Frame extraction, face detection, `angles.json` |
| `app/camera/page.tsx` | Camera GUI (face box editor, angle tabs, save profiles) |
| `scripts/wizard.js` | Interactive pipeline runner |

---

## Common constants

| Constant | Value | File |
|----------|-------|------|
| `PAUSE_THRESHOLD` (sentences) | 0.8 s | `edit-transcript.js` |
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

## Short-form pipeline

Implementation plan: `docs/SHORT_FORM_WIZARD.md`. Entry point: `npm run shorts:wizard`.

### Two paths

**Path A — clip from longform:** `public/edit/transcript.json` must exist. User selects a
time range; wizard creates one or more clips without re-running sync or transcription.

**Path B — dedicated portrait recording:** Own sync/transcribe/align pipeline rooted at
`public/shorts/`, then user defines clips from the result.

### Output structure

```
public/shorts/
  camera-profiles.json     ← shared portrait profiles for ALL clips (created once)
  short-{id}/
    transcript.doc.txt     ← full longform doc copy, > START / > END mark clip bounds
    transcript.json        ← merged short transcript
    preview-cut.mp4
  # Path B only: input/ sync/ transcribe/
```

### Short transcript.json extra meta fields

```
meta.outputAspect:      "9:16"
meta.videoStart:        float  — clip start in source video seconds
meta.videoEnd:          float  — clip end in source video seconds
meta.parentTranscript:  string — path to longform transcript.json (Path A only)
```

Segments keep absolute timestamps from the source video. `videoStart` / `videoEnd`
are derived from the `> START` / `> END` markers in the doc.

### Short-form transcript doc

`extract-short-doc.js` copies the full longform `transcript.doc.txt` and inserts
`> START` / `> END` around the clip range. It strips `> CAM` and `> HOOK` lines.
`> GRAPHIC` lines are optionally carried over (user-prompted at clip creation).

The same `> START` / `> END` mechanism used in the longform editor applies here —
everything outside those markers is excluded by the merge step.

### ShortFormClip composition

- ID: `ShortFormClip` — registered in `remotion/Root.tsx`
- Dimensions: 1080 × 1920 @ 60 fps
- Reuses `SegmentPlayer` (jump-cuts) and `CameraPlayer` (portrait profiles)
- `CaptionOverlay` covers the full video duration (not only hook segments)
- No `PodcastIntro`

### Portrait camera profiles

`public/shorts/camera-profiles.json` — same schema as the longform `camera-profiles.json`
with `outputWidth: 1080, outputHeight: 1920`. Created by `portrait-camera-setup.js` once
and shared by all clips. Longform `camera-profiles.json` is the starting point for Path A.

### Key scripts

| Script | File |
|--------|------|
| `shorts:wizard` | `scripts/shorts-wizard.js` |
| `shorts:extract-doc` | `scripts/shorts/extract-short-doc.js` |
| `shorts:merge-doc` | `scripts/shorts/merge-short-doc.js` |
| `shorts:camera-setup` | `scripts/shorts/portrait-camera-setup.js` |
