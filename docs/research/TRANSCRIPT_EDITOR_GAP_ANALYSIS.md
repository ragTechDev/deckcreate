# Transcript Editor Gap Analysis: Current Implementation vs. Descript

> **Context for agents:** This doc compares DeckCreate's transcript-based video editing workflow against Descript (the industry benchmark for browser-based transcript-driven video editing). The "code editor" column refers to the VSCode + `transcript.doc.txt` + custom language extension workflow. The "web editor" refers to `app/editor/` (the Next.js timeline UI). Feasibility ratings apply to implementing the feature *within* the existing approach — not from scratch.

---

## How the Current Editor Works (Baseline)

Two parallel editing surfaces:

**Surface A — Code editor (VSCode + `transcript.doc.txt`)**
- Human edits a plain-text markup file with a custom grammar
- VSCode extension provides syntax highlighting, directive autocomplete (`> [TAB]`), and real-time linting
- Supports: text corrections, `{word cuts}`, segment cuts (`-[n]`), hooks (`> HOOK`), camera directives (`> CAM`), speaker splits (`> SPEAKER`), graphics (`> LowerThird`, `> ImageWindow`), trim bounds (`> START`/`> END`), silence cuts (`> CUT`)
- No video, no audio, no visual feedback — pure text markup

**Surface B — Web timeline editor (`app/editor/`)**
- Canvas-based timeline: colored speaker tracks, cut overlays, camera cue track
- Video player above timeline (separate element, not synced to word positions)
- Mark In / Mark Out (I/O keys) to add visual cuts; saved as `> CUT` lines back to the doc
- Camera cue drag-and-drop on the camera track
- Cuts list panel with seek-to-cut links
- No waveform, no audio scrubbing, no real-time render preview

**Round-trip:** Doc edits → `npm run merge-doc` → `transcript.json` → Remotion render. Web editor cuts → save → `transcript.json` + `> CUT` lines appended to doc.

---

## Gap Analysis

### 1. Word-Level Text Editing as Video Cutting

**Descript:** Clicking on a word and pressing Delete removes it from both the transcript and the video. The transcript IS the edit decision list.

**Current:** Words are cut by wrapping in `{braces}` in the doc. No clicking. No visual connection between transcript text and video frames.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Partially feasible — the doc format already supports `{word}` cuts; a `Wrap in cut` command could wrap any VSCode selection | Not feasible — web editor has no transcript text view at all |
| What's missing | A VSCode command (e.g. Cmd+D) that wraps selected text in `{}`; no further infrastructure needed | A transcript text panel synced to video time; word-level click-to-cut |
| **Recommendation** | **Extend the VSCode extension**: add a `Wrap in cut` command. Closes ~70% of the Descript word-cutting experience with minimal effort. |

---

### 2. Transcript Scroll-Sync During Playback

**Descript:** As video plays, the transcript scrolls and highlights the current word in real time.

**Current:** No connection between video playback and the doc in VSCode. Web editor shows a moving playhead but no transcript text.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Not feasible — VSCode cannot receive live video playback position from a separate browser window | Feasible — the video playback time is already in state; mapping time → token → doc line is a data problem, not a new system |
| What's missing | A transcript text panel in the web editor; `currentWordIndex` derived from playback time + token `t_dtw` timestamps; scroll-into-view on word change |
| **Recommendation** | **Web editor task.** All required data exists in `transcript.json`. This is a UI-only problem. |

---

### 3. Filler Word Detection and One-Click Removal

**Descript:** "Remove filler words" detects all "um", "uh", "like", "you know" and marks them for removal with human review.

**Current:** `edit-transcript.js` already auto-detects fillers and wraps them in `{}` during doc generation. No UI to review or selectively restore them.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | **Already implemented** in the pipeline — fillers appear as `{word}` cuts in the generated doc; the VSCode diff view shows what was auto-cut | Feasible — a "Filler words" panel listing all `{word}` cuts with per-word restore buttons |
| What's missing | Discoverability: users don't know the auto-detection ran. A summary in the generated doc header would help. Web editor gap: no filler review panel. |
| **Recommendation** | **Short-term:** Add a filler summary comment block to the top of the generated doc. **Medium-term:** Filler review panel in the web editor. |

---

### 4. Silence Detection and Removal

**Descript:** "Remove silences" with configurable threshold; previews proposed cuts before applying.

**Current:** `npm run merge-doc:cut-pauses` adds `> CUT` lines for detected pauses. No preview. No configurable threshold in the UI. No undo.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Functional — the command exists; threshold could be a `> CONFIG silence_threshold=0.5` doc directive | Feasible — show proposed silence cuts as pending yellow bands in the timeline before the user confirms |
| What's missing | Per-episode threshold config; preview mode showing proposed cuts without committing; confirm/discard all |
| **Recommendation** | **Web editor task.** Detection logic already exists. Add a "Detect silences" button → show pending cuts → "Apply all" or dismiss. |

---

### 5. Waveform Visualization

**Descript:** Audio waveform in the timeline makes silence, breath, and filler audio visible without listening.

**Current:** No waveform. Timeline shows colored segment blocks only. Audio content is invisible.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Not applicable | Feasible — pre-compute peak amplitude per frame during the `sync` pipeline step; store as a sidecar JSON in the artifact store; render in `timelineCanvas.ts` as a waveform layer |
| What's missing | Waveform extraction in the pipeline (`ffmpeg -af astats` or similar); waveform JSON stored as a pipeline artifact; waveform layer in `timelineCanvas.ts` |
| **Recommendation** | **Pipeline + web editor task.** Add waveform extraction to the `sync` stage. Render in canvas behind speaker tracks. Moderate effort, high daily-use value. |

---

### 6. Real-Time Video Preview of Edits

**Descript:** As you mark cuts, the video player immediately skips cut sections during playback.

**Current:** The video player shows the **raw uncut source video**. Edits are not previewed until a full Remotion render (hours).

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Not feasible | Feasible — the jump-cut logic in `SegmentPlayer.tsx` can be ported to a browser `PreviewPlayer` using `HTMLVideoElement` seek + `timeupdate` events |
| What's missing | A `PreviewPlayer` React component that reads `transcript.json` cuts and plays back the video with sections skipped using native browser video APIs — no Remotion involved |
| **Recommendation** | **The single highest-ROI missing feature.** Without cut preview, the editor is blind. Implement `PreviewPlayer` using the same section calculation logic as `SegmentPlayer`. All the cut data already exists. |

---

### 7. Audio Scrubbing

**Descript:** Dragging the playhead plays audio at high speed so you can hear context while seeking.

**Current:** Dragging the playhead is silent. Only click-to-seek works.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Not applicable | Feasible — connect timeline drag events to `videoElement.currentTime` updates in real time |
| What's missing | Forward drag position from canvas mouse events to the video element's `currentTime` property |
| **Recommendation** | **Low effort, high usability improvement.** The drag event handler is already in `Timeline.tsx`; it just needs to call `video.currentTime = dragPosition`. |

---

### 8. Speaker Assignment / Correction UI

**Descript:** Click on any segment to change its speaker. Drag to merge adjacent speaker turns.

**Current:** Speaker names can only be changed via `> SPEAKER` directives in the doc. No UI for this in the web editor.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | **Already supported** — `> SPEAKER Alice at="word"` works; VSCode extension could add a snippet for it | Feasible — right-click on a segment track → "Change speaker" dropdown; writes `> SPEAKER` directive back to doc |
| What's missing | VSCode snippet for `> SPEAKER` (trivial to add); web editor context menu on segment blocks |
| **Recommendation** | **Extend VSCode extension** with `> SPEAKER` snippet (immediate). Add context menu to web editor (medium-term). |

---

### 9. Inline Transcript Text Correction

**Descript:** Click on a misrecognized word in the transcript, retype the correct word. Used for captions; audio is unchanged.

**Current:** Text corrections are made by editing `transcript.doc.txt` in VSCode. The web editor has no text view.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | **Already the intended workflow** — editing doc text IS the text correction mechanism | Feasible only after scroll-sync (gap #2) is implemented — requires a transcript text panel |
| What's missing | The code editor already handles this. The gap is that new users don't know to edit the doc text. |
| **Recommendation** | **Code editor is correct for text correction.** Improve discoverability via documentation and wizard prompts. Web editor text editing is a stretch goal dependent on scroll-sync. |

---

### 10. Undo / Redo

**Descript:** Full undo/redo stack; every edit is reversible.

**Current:** No undo/redo in the web editor. The doc has VSCode's built-in text undo (works well). No snapshots taken before destructive pipeline operations.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | **VSCode undo/redo works natively** for doc text edits | Not implemented; requires command pattern or `useReducer` with history stack |
| What's missing | Pre-operation snapshots of `transcript.doc.txt` and `transcript.json` before destructive pipeline runs; web editor history stack |
| **Recommendation** | **Phase 0 of the production refactor delivers pipeline snapshots** via content-addressed artifacts. Web editor undo is a medium-term task. |

---

### 11. Timestamped Comments / Annotations

**Descript:** Leave timestamped comments for async team review.

**Current:** No comment system. The doc has no comment syntax for review notes.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Feasible — add `> NOTE "comment text"` as a doc directive; parsed but not rendered in video; shown as markers in web editor | Feasible — note markers on timeline; tooltip on hover |
| What's missing | `> NOTE` directive in VSCode extension and doc parser; notes layer in `timelineCanvas.ts` |
| **Recommendation** | **Low priority for solo workflow.** Trivial to implement as a `> NOTE` directive when multi-person async review is needed. |

---

### 12. AI Hook / Chapter / Highlight Suggestions

**Descript:** AI identifies key moments, suggests chapter titles, highlights quotable quotes.

**Current:** Hooks are manually marked with `> HOOK` in the doc. No AI assistance. `hook-qa.js` reviews quality but doesn't suggest locations.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | **LLM-ready** — the transcript is structured text; a Claude API call with the full transcript can identify hooks, suggest chapter names, and flag quotable moments; output as suggested doc directives | Feasible as a "Suggestions" panel in the web editor showing AI-proposed hooks for human approval |
| What's missing | `scripts/suggest-hooks.ts` calling Claude API with `transcript.json`; output as commented `> HOOK` and `> ChapterMarker` suggestions in the doc or a `suggestions.json` sidecar |
| **Recommendation** | **High value, moderate effort.** Claude API is already used in this project. A structured prompt → suggested hook timestamps + chapter titles is a straightforward addition. |

---

### 13. Version History / Project Snapshots

**Descript:** Every save creates a named version. Roll back to any point.

**Current:** No versioning. The doc is overwritten on every save. Git provides history only if the user commits manually.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | **Feasible with the Phase 0 refactor** — the `.ragtech/artifacts/` content-addressed store makes pre-save snapshots automatic | The web editor save endpoint can write a snapshot before overwriting |
| What's missing | Snapshot logic in the pipeline runner; a `npm run transcript:history` command to list and restore snapshots |
| **Recommendation** | **Implement as part of Phase 0 (project file refactor).** Every `merge-doc` and web editor save snapshots the transcript to `.ragtech/artifacts/`. Restoring is a one-line copy command. |

---

### 14. Captions Export (SRT / VTT)

**Descript:** Export standalone captions in SRT, VTT, or burned-in formats.

**Current:** Captions are burned-in by Remotion (`CaptionOverlay.tsx`). No standalone SRT/VTT export.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | **Feasible as a pipeline script** — `transcript.final.json` has all token timestamps; generating SRT/VTT is straightforward | Web editor "Export captions" button calling the script |
| What's missing | `scripts/export-captions.ts` generating SRT/VTT from token timestamps with cut sections excluded; timing must skip cut regions (same logic as `SegmentPlayer`) |
| **Recommendation** | **Short-term pipeline task.** SRT format is trivial. Main complexity is applying cut logic to caption timing — reuse `SegmentPlayer` section math. |

---

### 15. Direct Publish to Platforms

**Descript:** Export and upload directly to YouTube, Spotify, Apple Podcasts from within the app.

**Current:** Render produces a video file. Upload is manual.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Not applicable | Feasible — YouTube Data API v3 for video upload; podcast RSS for audio; render output path is known from `project.json` |
| What's missing | OAuth token management per platform; upload progress UI; metadata entry (title, description, tags, thumbnail) |
| **Recommendation** | **Medium-term web UI task.** Add a "Publish" step to the wizard after render. Lower priority than preview and waveform. |

---

### 16. AI Voice Synthesis (Overdub)

**Descript:** Fix a word by typing — the app synthesizes replacement audio in the speaker's voice.

**Current:** Not implemented anywhere.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Feasible in theory with ElevenLabs/Play.ht API — but requires audio replacement pipeline and re-sync with video | Not feasible without significant audio mixing infrastructure |
| What's missing | Voice model cloning per speaker; audio replacement pipeline; re-sync synthesized clip with video |
| **Recommendation** | **Out of scope.** Descript's moat feature. Complex and expensive to build. Skip unless there is a specific demand for correcting audio without re-recording. |

---

### 17. Eye Contact Correction

**Descript:** AI makes speakers appear to look directly at the camera.

**Current:** Not implemented.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Requires per-frame video ML inference (NVIDIA Maxine or equivalent) | Not applicable |
| **Recommendation** | **Out of scope.** Infrastructure does not support per-frame video ML today. |

---

### 18. Video B-Roll Insertion

**Descript:** Drag a video clip from the media library onto the timeline to insert B-roll at a timecode.

**Current:** Image B-roll (`> ImageWindow`) and GIF B-roll (`> GifWindow`) work via doc directives. No video B-roll. No media library browser.

| | Code editor | Web editor |
|--|------------|------------|
| Feasibility | Image/GIF: **already implemented** via doc directives | Video B-roll: requires a new `> VideoWindow` Remotion overlay component + media upload UI |
| What's missing | `> VideoWindow` overlay in Remotion; media library browser in web editor; timeline representation of video B-roll clips |
| **Recommendation** | **Image/GIF B-roll: already done.** Video B-roll: add `> VideoWindow` Remotion component as a medium-term task. |

---

## Summary Table

| Feature | Code editor | Web editor | Priority |
|---------|------------|------------|---------|
| Word-level cut (select → `{}`) | **Add `Wrap in cut` command** | Requires transcript text panel | High |
| Transcript scroll-sync | Not feasible | Requires text panel + token mapping | High |
| Filler word review | Auto-detected; add summary comment | Add filler review panel | Medium |
| Silence removal preview | Add `> CONFIG` threshold | Preview layer before commit | Medium |
| Waveform visualization | Not applicable | Pipeline step + canvas layer | Medium |
| **Real-time cut preview** | Not feasible | **`PreviewPlayer` — highest ROI** | **Critical** |
| Audio scrubbing | Not applicable | Connect drag → `video.currentTime` | Low |
| Speaker assignment UI | Add `> SPEAKER` snippet | Context menu on segment | Medium |
| Inline text correction | Already works in doc | Depends on scroll-sync | Low |
| Undo / redo | Built into VSCode | `useReducer` history stack | Medium |
| Timestamped comments | Add `> NOTE` directive | Notes layer on canvas | Low |
| AI hook/chapter suggestions | Claude API script → doc directives | Suggestions panel | High |
| Version history | **Phase 0 refactor delivers this** | Snapshot on save | High |
| Captions export (SRT/VTT) | Pipeline script | Export button | Medium |
| Direct publish | Not applicable | YouTube/podcast API | Low |
| Voice synthesis (Overdub) | Out of scope | Out of scope | Skip |
| Eye contact correction | Out of scope | Out of scope | Skip |
| Video B-roll | Not applicable | `> VideoWindow` component | Low |

---

## Key Conclusion: Is Staying in the Code Editor Feasible?

**Yes, for content decisions.** The code editor (VSCode + `transcript.doc.txt`) is correct for: text corrections, hook placement, camera directives, speaker corrections, graphics, and any edit that maps to a named doc directive. The custom language extension already provides autocomplete, linting, and syntax highlighting. Most Descript "smart" editing features (filler detection, silence removal) are already implemented in the pipeline — the gap is UI discoverability, not capability.

**The code editor is not the right surface for:** real-time video preview, waveform visualization, transcript scroll-sync, or audio scrubbing. Those require a browser.

**The right strategy:** Keep the code editor as the source-of-truth for content decisions. Invest web editor effort in exactly three things, in order:

1. **`PreviewPlayer`** — a browser video player that reads `transcript.json` cuts and plays back with sections skipped. This alone makes the editor feel like Descript's core experience. All required data exists; it is a pure frontend implementation using `HTMLVideoElement` seek + `timeupdate`. The section calculation logic to port already exists in `remotion/components/SegmentPlayer.tsx`.

2. **Waveform layer** — pre-computed during the sync pipeline step, rendered in `timelineCanvas.ts`. Makes silence and breath visible without listening.

3. **Transcript text panel with scroll-sync** — a read-only transcript view that highlights the current word during playback. Once this exists, inline text correction and filler word review in the web editor become possible.

Everything else on the gap list can wait.

---

## Critical Files for Implementation

| File | Relevance |
|------|-----------|
| [app/editor/page.tsx](../../app/editor/page.tsx) | `PreviewPlayer` and transcript text panel would be added here |
| [app/editor/Timeline.tsx](../../app/editor/Timeline.tsx) | Waveform layer and scroll-sync highlighting added here |
| [app/editor/timelineCanvas.ts](../../app/editor/timelineCanvas.ts) | Waveform draw functions go here |
| [scripts/edit-transcript.js](../../scripts/edit-transcript.js) | Filler detection + silence detection already implemented here |
| [vscode-transcript-language/src/extension.js](../../vscode-transcript-language/src/extension.js) | `Wrap in cut` command + `> NOTE` directive support added here |
| [remotion/components/SegmentPlayer.tsx](../../remotion/components/SegmentPlayer.tsx) | Jump-cut section logic to port to `PreviewPlayer` |
