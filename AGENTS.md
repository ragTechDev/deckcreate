# DeckCreate — Architecture Reference

This document describes how the video editing pipeline works end-to-end, from raw recording to a Remotion composition. It is intended to orient AI agents and new contributors quickly.

---

## High-level pipeline

```
Raw audio/video
      ↓
[transcribe]  Whisper.cpp → token-level timestamps
      ↓
[diarize]     Speaker turn detection (optional)
      ↓
[assign-speakers]  Labels each segment with a speaker name
      ↓
[align]       WhisperX refines token timings (t_dtw) via forced alignment
      ↓
[edit-transcript]  Merges Whisper phrases into sentences → transcript.doc.txt
      ↓
Human edits transcript.doc.txt (cuts, corrections, hooks, camera cues)
      ↓
[merge-doc]   Applies doc edits → transcript.json
      ↓
Remotion renderer reads transcript.json → composed video
```

All intermediate files live under `public/transcribe/output/`.

---

## transcript.json schema (key fields)

```
Transcript
  meta
    videoStart?: number     — source seconds; segments before this are excluded
    videoEnd?:   number     — source seconds; segments after this are excluded
    videoSrc?:   string     — path relative to /public (overrides composition prop)
    fps:         number     — always 60
  segments[]
    id, start, end          — source-video timestamps in seconds
    speaker                 — display name (e.g. "Natasha")
    text                    — human-readable sentence
    cut: boolean            — true = entire segment removed from output
    tokens[]
      t_dtw: number         — word start time in seconds (WhisperX-aligned or Whisper t_dtw)
      t_end?: number        — word end time in seconds (populated by forced alignment only)
                              when present, deriveCuts and autoCutPauses use exact word
                              boundaries instead of heuristic bias constants
      text:  string         — word / punctuation
      cut:   boolean        — true = this token is cut
    cuts: TimeCut[]         — [{from, to}] derived from token.cut flags by edit-transcript
                              these are INTRA-segment ranges to skip
    hook?: boolean          — when true, prepended as a hook/teaser before main content
    hookFrom/hookTo?        — start/end seconds of the hook clip within the segment
    cameraCues[]            — explicit camera shot overrides (> CAM directives in doc)
```

`segment.cuts[]` is populated automatically by `edit-transcript.js` / `merge-doc` when tokens are marked for cutting. It is **not** set manually — edit `transcript.doc.txt` to cut words.

---

## Rendering model — "inclusive by default"

The Remotion composition plays the full active range `[videoStart, lastSegment.end]` **continuously by default**. Cuts are opt-in:

| What produces a cut | How |
|---|---|
| Entire segment removed | `segment.cut = true` |
| Intra-segment word/phrase removed | `segment.cuts[]` entries (from `{curly braces}` in doc) |
| Inter-segment silence removed | `merge-doc:cut-pauses` writes silence ranges into `cuts[]` |

**There are no implicit cuts.** Gaps between segments (natural pauses between utterances) play as silence unless you explicitly run `merge-doc:cut-pauses`.

This matches how Descript, Riverside, and similar text-based editors work: the transcript is a window onto a continuous timeline, not a list of clips to concatenate.

---

## Remotion component architecture

### Data flow

```
transcript.json
  ↓  getActiveSegments()       filter by meta.videoStart/videoEnd
  ↓  buildSections()           convert to {hookSections[], mainSections[]}
  ↓  SegmentPlayer / CameraPlayer
  ↓  SectionGroupPlayer        renders one group via OffthreadVideo + trimBefore
```

### buildSections (SegmentPlayer.tsx)

Produces two independent section arrays — hooks and main — each rendered in its own `<Sequence>` with a local frame counter. Keeping them separate prevents negative `trimBefore` values (hooks originate deep in source time).

**Main section logic** (`buildMainSubClips`):
1. Range = `[videoStart, lastActiveSegment.end]`
2. Collect exclusions: `cut=true` segment spans + all `cuts[]` entries
3. Merge overlapping exclusions
4. Invert: the gaps between exclusions become the playable `SubClip[]`
5. Convert `SubClip[]` → `Section[]` via `toSections(clips, fps)` (`trimBefore = Math.floor(start*fps)`, `trimAfter = Math.ceil(end*fps)`)

**Hook section logic** (`getHookSubClips`): uses `hookFrom`/`hookTo` bounds, extends end when spoken tokens drift past `hookTo`, bridges to next hook if gap ≤ 1 s.

### SectionGroupPlayer (SegmentPlayer.tsx)

The jump-cut engine. At each composition frame `f`:

```
summedDurations = Σ (section.trimAfter - section.trimBefore)  for sections[0..k]
trimBefore = section.trimAfter - summedDurations          (= S(f) - f)
sourceFrame = trimBefore + f                              (= S(f))
```

`OffthreadVideo` receives `trimBefore` and renders the source frame that maps to composition frame `f`. Cuts are skipped because no section covers those source frames — the playhead jumps from one section's end directly to the next section's start.

### CameraPlayer (CameraPlayer.tsx)

Wraps `SegmentPlayer` inside a viewport transform (scale + translate) to simulate punch-in/punch-out camera cuts.

`buildCameraShots` builds a `CameraShot[]` timeline. Shot boundaries are placed at **segment** start times using `sourceToOutputFrame(seg.start, mainSections, fps)` so positions are always in sync with the actual rendered output (including silence between segments). Duration per segment = distance to next segment's output start, which correctly includes inter-segment silence in the pacing counters.

`sourceToOutputFrame(sourceSec, mainSections, fps)` maps a source timestamp to its output frame by walking `mainSections` and accumulating section durations.

### Hook rendering

1. `hookSections` play at composition frames `[0, hookDuration)`
2. `PodcastIntro` plays at `[hookDuration, hookDuration + INTRO_DURATION_FRAMES)`
3. `mainSections` play from `hookDuration + introFrames` onward (`mainOffset` parameter)

Hook music is looped over the hook duration. `HookOverlay` shows karaoke captions and the Techybara mascot; it is mounted for the full composition duration and returns `null` outside hook frames.

---

## Silence removal

`--auto-cut-pauses N` (via `npm run merge-doc:cut-pauses`) detects silence gaps between tokens within segments and writes `TimeCut` entries into `segment.cuts[]`. The renderer then excludes those ranges the same way it handles any other cut. This is the **only** mechanism for silence removal — the renderer itself has no silence detection.

Key threshold: `PAUSE_THRESHOLD = 0.8s` for sentence boundaries; `--auto-cut-pauses` defaults to `0.5s`.

When `token.t_end` is present (after forced alignment), silence is measured as `next.t_dtw - curr.t_end` — exact inter-word silence. Without it, the estimate is `next.t_dtw - curr.t_dtw - WORD_DURATION_ESTIMATE (0.4s)`.

## Cut boundary precision

`deriveCuts` builds `TimeCut` ranges from `token.cut` flags. Boundary precision depends on whether forced alignment was run:

| Field available | Cut start | Cut end |
|---|---|---|
| `prevWord.t_end` present | `prevWord.t_end` (exact word finish) | `nextWord.t_dtw` (exact word onset) |
| `t_end` absent | `prevWord.t_dtw + CUT_START_BIAS × gap` (heuristic) | `nextWord.t_dtw` (exact word onset) |

`CUT_END_BIAS` is no longer used — the next word's `t_dtw` (its start time) is already the correct cut endpoint. `CUT_START_BIAS` is only a fallback for transcripts without alignment data.

---

## Key source files

| File | Purpose |
|---|---|
| `remotion/components/SegmentPlayer.tsx` | Section model, `buildSections`, `buildMainSubClips`, jump-cut player |
| `remotion/components/CameraPlayer.tsx` | Camera shot pacing, `sourceToOutputFrame`, viewport transforms |
| `remotion/components/HookOverlay.tsx` | Hook captions, Techybara, hook timing logic |
| `remotion/Composition.tsx` | Root composition, duration calculation, asset loading |
| `remotion/types/transcript.ts` | `Segment`, `Token`, `TimeCut`, `Transcript` types |
| `scripts/edit-transcript.js` | Sentence merging, `deriveCuts`, doc generation |
| `scripts/wizard.js` | Interactive pipeline runner |

---

## Common constants

| Constant | Value | Where | Notes |
|---|---|---|---|
| `PAUSE_THRESHOLD` (sentences) | 0.8 s | `edit-transcript.js` | |
| `WORD_DURATION_ESTIMATE` | 0.4 s | `edit-transcript.js` | Fallback when `token.t_end` absent |
| `CUT_START_BIAS` | 1.0 | `edit-transcript.js` | Fallback when `prevWord.t_end` absent |
| `CUT_END_BIAS` | 0.75 | `edit-transcript.js` | Superseded — `nextWord.t_dtw` used directly |
| `HOOK_TAIL_PAD_UNBOUNDED_SECONDS` | 0.16 s | `SegmentPlayer.tsx` |
| `HOOK_TAIL_PAD_BOUNDED_SECONDS` | 0.02 s | `SegmentPlayer.tsx` |
| `HOOK_BRIDGE_MAX_GAP_SECONDS` | 1.0 s | `SegmentPlayer.tsx` |
| `HOOK_END_FADE_FRAMES` | 12 frames | `SegmentPlayer.tsx` |
| `MIN_WIDE_S` | 1.5 s | `CameraPlayer.tsx` |
| `MAX_CLOSEUP_S` | 20 s | `CameraPlayer.tsx` |
| `PERIODIC_WIDE_S` | 45 s | `CameraPlayer.tsx` |
| `DECLICK_FRAMES` | 3 frames | `SegmentPlayer.tsx` |
