# Short-form Wizard — Implementation Plan

## How agents use this document

This document is the authoritative implementation guide for the short-form wizard feature.
Work is broken into isolated commits. Each commit is independently testable.

**To resume interrupted work:**
1. Run `git log --oneline` to see which commits are complete.
2. Match the last commit message against the slugs below.
3. Continue from the next unstarted step.

**Rules:**
- Implement commits in order — each step depends on the previous.
- Do not combine steps into one commit. Isolation is intentional.
- The "Status check" line under each commit tells you how to verify it is already done.
- If a commit is partially done (files exist but broken), fix it within that commit before moving on.

---

## Architecture overview

### Two paths

**Path A — clip from existing longform recording**
The longform pipeline has already run (`public/edit/transcript.json` exists). The user
selects a time range from the longform and produces one or more short clips. No sync or
transcription is needed.

**Path B — dedicated portrait recording**
A fresh recording shot in portrait mode. Runs its own sync/transcribe/align pipeline
rooted at `public/shorts/`, then defines clips from the result.

### Output structure

```
public/shorts/
  camera-profiles.json           ← shared portrait profiles for ALL clips (created once)

  short-{id}/
    transcript.doc.txt           ← editable doc (full longform doc with > START / > END)
    transcript.json              ← merged short transcript
    preview-cut.mp4              ← portrait cut preview

  # Path B only:
  input/video/  input/audio/
  sync/output/
  transcribe/input/
  transcribe/output/raw/
  transcribe/output/edit/
```

### Short transcript.json — extra meta fields

All standard `transcript.json` fields apply. These are added for shorts:

```json
"meta": {
  "outputAspect": "9:16",
  "videoStart": 486.721,
  "videoEnd":   665.819,
  "parentTranscript": "edit/transcript.json"   // Path A only
}
```

`videoStart` / `videoEnd` come from the positions of `> START` / `> END` in the doc.
Segments keep their absolute timestamps from the source video.

### Shared camera profiles

`public/shorts/camera-profiles.json` is created once (on first short, or during Path B
camera setup) and reused by all subsequent clips. Portrait dimensions: 1080 × 1920.
The wizard skips camera setup if this file already exists and offers it as an explicit
redo step instead.

### Short-form transcript doc format

`extract-short-doc.js` copies the **full** longform `transcript.doc.txt` and:
1. Inserts `> START` immediately before the clip's first segment line.
2. Inserts `> END` immediately after the clip's last segment line.
3. Strips all `> CAM` lines (portrait camera is driven by profiles, not doc cues).
4. Strips all `> HOOK` lines (user re-marks hooks for the short form).
5. Optionally strips `> GRAPHIC` lines depending on user's carry-over choice.

Everything outside `> START` … `> END` is ignored by the merge step (same mechanism
as the existing `> START` / `> END` support in `edit-transcript.js`).

### ShortFormClip Remotion composition

- Dimensions: 1080 × 1920 @ 60 fps
- Reuses `SegmentPlayer` for jump-cut playback
- Reuses `CameraPlayer` with portrait `camera-profiles.json`
  (portrait dimensions are encoded in the profiles; no separate portrait camera component needed)
- Caption overlay covers the **full video** (not only hook segments)
  — implement as an "always-on" mode of `HookOverlay` or a dedicated `CaptionOverlay`
- No `PodcastIntro` (short-form has no 7-second intro)
- Hook section is optional; if no hook segments are marked, composition starts at main content
- Registered in `remotion/Root.tsx` as composition ID `ShortFormClip`

---

## Commit checklist

---

### Commit 1 — `feat: extract wizard helpers to shared module`

**Status check:** `scripts/shared/wizard-helpers.js` exists and `scripts/wizard.js`
imports `ask`, `confirm`, `runStep` etc. from it.

**Files created:**
- `scripts/shared/wizard-helpers.js`

**Files modified:**
- `scripts/wizard.js`

**What to do:**

Extract the following functions verbatim from `scripts/wizard.js` into
`scripts/shared/wizard-helpers.js` as named exports:

```
ask, confirm, askYesNo, askQuestion, quit,
spawnStep, runStep, runStep_parallel, runParallel,
progressBar, spinner, copyFileWithProgress,
openFile, findFileIn, waitForHttp, isDockerEnv
```

`wizard-helpers.js` must:
- Use `export function` / `export const` (ES module).
- Accept `rl` (readline interface) as a parameter for `ask`, `confirm`, `askYesNo`,
  `askQuestion`, `quit` — or export a `createHelpers(rl, cwd)` factory that returns
  all prompt helpers bound to that `rl`. **Pick one pattern and use it consistently.**
- Accept `cwd` as a parameter for `spawnStep`, `runStep`, `runStep_parallel`,
  `copyFileWithProgress`.

Update `scripts/wizard.js` to import from `./shared/wizard-helpers.js`.
Remove the now-duplicated function bodies from `wizard.js`.

**Verify:** `npm run video:wizard` launches and the first prompt appears normally.

---

### Commit 2 — `feat: add shorts extract-short-doc script`

**Status check:** `scripts/shorts/extract-short-doc.js` exists; running it with
`--transcript public/edit/transcript.json --from 100 --to 200 --id test` creates
`public/shorts/test/transcript.doc.txt` with `> START` / `> END` markers present.

**Files created:**
- `scripts/shorts/extract-short-doc.js`

**Files modified:**
- `package.json` — add `"shorts:extract-doc": "node scripts/shorts/extract-short-doc.js"`

**CLI interface:**

```
node scripts/shorts/extract-short-doc.js \
  --transcript <path>        # path to longform transcript.json
  --from <seconds>           # clip start (float)
  --to <seconds>             # clip end (float)
  --id <string>              # short ID, e.g. "short-1"
  [--carry-graphics]         # if present, keep > GRAPHIC lines; else strip them
```

**Algorithm:**

1. Resolve the longform `transcript.doc.txt` by replacing `.json` with `.doc.txt`
   in the `--transcript` path (e.g. `public/edit/transcript.json` →
   `public/edit/transcript.doc.txt`).
2. Read the full doc as a string. Split on `\n`.
3. Walk lines. A "segment line" matches `/^\s*[-]?\[(\d+)\]/` — extract the numeric ID.
4. For each segment line, look up `segment.start` in the loaded `transcript.json`.
   - First segment whose `start >= from` → record its line index as `startLineIdx`.
   - Last segment whose `end <= to` → record its line index as `endLineIdx`.
5. Insert `> START` as a new line immediately before line `startLineIdx`.
6. Insert `> END` as a new line immediately after line `endLineIdx` (after the adjustment
   from step 5).
7. Strip lines matching `/^>\s*CAM\b/i`.
8. Strip lines matching `/^>\s*HOOK\b/i`.
9. If `--carry-graphics` is NOT set, strip lines matching `/^>\s*(LowerThird|NameTitle|Callout|ChapterMarker|ChapterMarkerEnd|ConceptExplainer|ImageWindow|GifWindow|AIOverlay|CodingOverlay|EngineeringOverlay|LanguageOverlay|FrameworkOverlay|InfrastructureOverlay|PracticeOverlay|RoleOverlay|EducationOverlay|AwardsOverlay|RagtechOverlay)\b/i`.
10. Ensure output directory `public/shorts/{id}/` exists (`fs.ensureDir`).
11. Write result to `public/shorts/{id}/transcript.doc.txt`.

**Do not modify the header / guide section** at the top of the doc (lines before the
first segment). The user needs the editing instructions intact.

**Verify:** Run the script against the live transcript and inspect the output. Confirm:
- `> START` appears before the first segment in range.
- `> END` appears after the last segment in range.
- No `> CAM` or `> HOOK` lines remain.
- File is in `public/shorts/{id}/`.

---

### Commit 3 — `feat: add shorts merge-short-doc script`

**Status check:** `scripts/shorts/merge-short-doc.js` exists; running it against an
edited `public/shorts/test/transcript.doc.txt` produces
`public/shorts/test/transcript.json` with `meta.outputAspect = "9:16"`.

**Files created:**
- `scripts/shorts/merge-short-doc.js`

**Files modified:**
- `package.json` — add `"shorts:merge-doc": "node scripts/shorts/merge-short-doc.js"`

**CLI interface:**

```
node scripts/shorts/merge-short-doc.js \
  --doc <path>                # path to public/shorts/{id}/transcript.doc.txt
  --parent-transcript <path>  # path to longform transcript.json (Path A)
                              # omit for Path B (dedicated recording)
  --id <string>               # short ID
  [--cut-pauses]              # if present, auto-cut silences >= 0.5 s
```

**Algorithm:**

1. Load `--parent-transcript` (if provided) to get `meta.videoSrc`, `meta.videoSrcs`,
   `meta.fps`, and the full segment array as the base for merging.
   For Path B, the base transcript is `public/shorts/transcribe/output/edit/transcript.json`.
2. Parse `> START` and `> END` positions from the doc to derive `videoStart` and
   `videoEnd`:
   - `videoStart` = `segment.start` of the first segment after `> START`
   - `videoEnd`   = `segment.end` of the last segment before `> END`
3. Call the existing merge-doc logic from `edit-transcript.js` (import its
   `mergeDocIntoTranscript` function, or spawn `npm run transcript:merge` with appropriate
   `--output` and `--transcript` overrides if the function is not cleanly importable).
4. After merging, inject extra meta fields:
   ```js
   transcript.meta.outputAspect      = "9:16";
   transcript.meta.videoStart        = videoStart;
   transcript.meta.videoEnd          = videoEnd;
   // Path A only:
   if (parentTranscriptPath) {
     transcript.meta.parentTranscript = parentTranscriptPath;
   }
   ```
5. Ensure `public/shorts/{id}/` exists and write `transcript.json` there.

**Verify:** Run against an edited doc. Confirm `meta.outputAspect`, `meta.videoStart`,
`meta.videoEnd` are present and the segments array is correctly filtered.

---

### Commit 4 — `feat: add portrait-camera-setup script`

**Status check:** `scripts/shorts/portrait-camera-setup.js` exists. Running it with
`--source public/camera/camera-profiles.json` produces
`public/shorts/camera-profiles.json` with `outputWidth: 1080, outputHeight: 1920`.

**Files created:**
- `scripts/shorts/portrait-camera-setup.js`

**Files modified:**
- `package.json` — add `"shorts:camera-setup": "node scripts/shorts/portrait-camera-setup.js"`

**CLI interface:**

```
node scripts/shorts/portrait-camera-setup.js \
  [--source <path>]           # Path A: existing landscape camera-profiles.json
  [--videos <path...>]        # Path B: video files for fresh face detection
  [--skip-gui]                # skip opening the camera GUI (for scripted use)
```

**Path A (--source provided):**

1. Read the source landscape profiles.
2. Create a new object with the same speakers and angles but override:
   ```js
   outputWidth:  1080,
   outputHeight: 1920,
   ```
3. For each speaker in `profiles.speakers`:
   - Keep `closeupViewport` as-is (the user will adjust via GUI if needed).
   - Ensure `portraitCx` is present; if missing, default to `speaker.closeupViewport.cx`.
4. Write the new profiles to `public/shorts/camera-profiles.json`.
5. Unless `--skip-gui`, spawn the Next.js dev server and open `http://localhost:3000/camera`.
   Wait for user to press Enter after saving in the GUI. Kill the dev server.
   Re-read and confirm `public/shorts/camera-profiles.json` was updated by the GUI save.

**Path B (--videos provided, no --source):**

Call `scripts/camera/setup-camera.js` with the portrait video paths. That script
handles face detection and the GUI. After it writes `public/camera/camera-profiles.json`,
copy the result to `public/shorts/camera-profiles.json` and patch
`outputWidth: 1080, outputHeight: 1920`.

**Verify:** File exists at `public/shorts/camera-profiles.json` with correct dimensions.

---

### Commit 5 — `feat: add ShortFormClip Remotion composition`

**Status check:** `remotion/ShortFormClip.tsx` exists and `remotion/Root.tsx` registers
a composition with `id="ShortFormClip"` at 1080 × 1920.

**Files created:**
- `remotion/ShortFormClip.tsx`
- `remotion/components/CaptionOverlay.tsx`  ← full-video caption bar for short-form

**Files modified:**
- `remotion/Root.tsx` — register the new composition

**`ShortFormClip.tsx` structure:**

```tsx
// Props: transcriptPath, cameraProfilesPath (same pattern as Composition.tsx)
// Dimensions: 1080 × 1920 @ 60 fps

// Section order (same hook + main pattern as Composition.tsx):
// 1. hookSections  → frames [0, hookDuration)   — optional, omit if no hook segments
// 2. mainSections  → frames [hookDuration, ...)

// Key differences from Composition.tsx:
// - No PodcastIntro (no 7-second intro sequence)
// - CameraPlayer receives portrait camera-profiles.json
// - CaptionOverlay covers the full composition duration (not only hook)
// - No hook-specific intro music (or use a short-form specific music bed)
```

**`CaptionOverlay.tsx`:**

Renders word-by-word karaoke captions for the full video duration, not only during
hook segments. Base the implementation on `HookOverlay.tsx` caption rendering logic.

Key differences from `HookOverlay`:
- No Techybara mascot (or make it optional via prop).
- Always active (no `if (currentFrame < hookStart || currentFrame > hookEnd) return null`).
- Caption bar position: bottom third of the 9:16 frame.
- Font size appropriate for portrait mobile viewing (larger than longform hook captions).

**Root.tsx registration:**

```tsx
<Composition
  id="ShortFormClip"
  component={ShortFormClip}
  durationInFrames={/* derive from transcript like Composition.tsx */}
  fps={60}
  width={1080}
  height={1920}
  defaultProps={{ /* same pattern as existing composition */ }}
/>
```

**Verify:** `npm run remotion:studio` shows the `ShortFormClip` composition in the
sidebar. It should render without errors even with a minimal/empty transcript.

---

### Commit 6 — `feat: add shorts-wizard core (detection + Path A)`

**Status check:** `scripts/shorts-wizard.js` exists; `npm run shorts:wizard` launches
and prompts the user.

**Files created:**
- `scripts/shorts-wizard.js`

**Files modified:**
- `package.json` — add `"shorts:wizard": "node scripts/shorts-wizard.js"`

**Detection logic — three startup cases:**

```
detectExistingWork() → { shortClips, hasShortTranscribe, hasLongformTranscript }

shortClips: read public/shorts/ — subdirs matching /^short-/ with their per-clip status:
  { id, hasDoc, hasMerged, hasCameraProfiles (shared), hasPreview }

hasShortTranscribe: public/shorts/transcribe/output/raw/transcript.raw.json exists

hasLongformTranscript: public/edit/transcript.json exists
```

**Startup branching:**

```
Case 1 — No public/shorts/ dir or no short-* dirs AND no shorts transcribe output:
  Has longform transcript?
    Yes → confirm "Found longform transcript. Clip a short from it? [Y/n]"
           Y → runPathA()
           N → confirm "Start a new dedicated portrait recording? [Y/n]"
                Y → runPathB()   (implemented in Commit 7)
    No  → runPathB()

Case 2 — short-* dirs exist (existing shorts):
  Determine source: check any clip's transcript.json for meta.parentTranscript
  Show existing clips with status indicators
  Options:
    1. Continue / redo an existing clip
    2. Create a new clip from same source
    3. Start fresh (new recording entirely)

Case 3 — shorts/transcribe/ exists but no short-* dirs:
  Dedicated recording in progress, clips not yet defined
  Resume Path B pipeline (resumeStep detection, same as wizard.js)
```

**`runPathA()` flow:**

```
1. Load public/edit/transcript.json
   Print: title, duration (formatted MM:SS), speaker list, segment count

2. Define clip range
   Ask: "Clip start time (HH:MM:SS or seconds): "
   Ask: "Clip end time (HH:MM:SS or seconds): "
   Parse both formats. Show the 3 segments immediately before and after each boundary
   for confirmation. Ask: "Happy with this range? [Y/n]"

3. Assign clip ID
   Auto-generate: scan public/shorts/ for existing short-* dirs, increment.
   e.g. if short-1 exists → default "short-2"
   Ask: "Clip ID [short-2]: "

4. Carry-over graphics
   Ask: "Carry over graphic overlay cues from the longform doc? [y/N]: "
   carryGraphics = answer === 'y'

5. Extract doc
   spawn: node scripts/shorts/extract-short-doc.js \
     --transcript public/edit/transcript.json \
     --from {from} --to {to} --id {id} \
     [--carry-graphics]
   Show output path. Open file.

6. Edit doc
   "Open public/shorts/{id}/transcript.doc.txt and edit it."
   "Mark a > HOOK segment, adjust cuts, and correct text as needed."
   await ask("Press Enter when done editing...")

7. Merge doc
   Ask: "Auto-cut silences longer than 0.5 s? [y/N]: "
   spawn: node scripts/shorts/merge-short-doc.js \
     --doc public/shorts/{id}/transcript.doc.txt \
     --parent-transcript public/edit/transcript.json \
     --id {id} [--cut-pauses]
   Print output path.

8. Portrait camera setup
   Check: public/shorts/camera-profiles.json exists?
     Yes → "Using existing portrait camera profiles. [redo camera: y/N]: "
            If redo: spawn node scripts/shorts/portrait-camera-setup.js --source public/camera/camera-profiles.json
     No  → spawn node scripts/shorts/portrait-camera-setup.js --source public/camera/camera-profiles.json

9. Cut preview
   Ask: "Generate portrait cut preview? [y/N]: "
   If yes: spawn npm run cut:preview with appropriate flags for portrait output
   (details: pass --transcript public/shorts/{id}/transcript.json and portrait dimensions)
   Print: public/shorts/{id}/preview-cut.mp4

10. Remotion
    Ask: "Launch Remotion studio with this short? [y/N]: "
    If yes: spawn npm run remotion:studio
    (The ShortFormClip composition should auto-load; document how to select it)
```

**Verify:** Full Path A run against existing longform transcript produces a
`public/shorts/short-1/transcript.doc.txt` and `transcript.json` with correct meta.

---

### Commit 7 — `feat: add shorts-wizard Path B (dedicated portrait recording)`

**Status check:** Running `npm run shorts:wizard` and choosing "new dedicated recording"
enters a pipeline that prompts for input files in `public/shorts/input/`.

**Files modified:**
- `scripts/shorts-wizard.js` — add `runPathB()`

**`runPathB()` flow:**

```
Mirrors wizard.js main() but all paths rooted at public/shorts/:

  input video/audio  → public/shorts/input/video|audio
  sync output        → public/shorts/sync/output/
  transcription      → public/shorts/transcribe/output/raw/
  doc                → public/shorts/transcribe/output/edit/transcript.doc.txt
  merged transcript  → public/shorts/transcribe/output/edit/transcript.json

After merge, ask: "Define clips from this recording"
  Option A: whole recording is one clip → use full transcript as single clip
            (auto-creates public/shorts/short-1/ with the full doc, > START at first
             segment, > END at last)
  Option B: slice into multiple clips → loop: enter time ranges (same as Path A step 2–4)
            for each range, call extract-short-doc.js

Then for each clip → camera setup (check shared camera-profiles.json) → preview → remotion
```

**Reuse:** The per-clip steps (extract doc → edit → merge → camera → preview → remotion)
are identical to Path A steps 4–10. Factor them into a shared `runClipFlow(id, opts)`
function inside `shorts-wizard.js`.

**Verify:** Entering Path B from a fresh state prompts for input files and checks for
required directories.

---

### Commit 8 — `feat: add shorts-wizard resume and redo logic`

**Status check:** Running `npm run shorts:wizard` when `public/shorts/short-1/` exists
shows a clip list with status indicators and a redo menu.

**Files modified:**
- `scripts/shorts-wizard.js` — add per-clip status + redo menu

**Per-clip status:**

```js
function getClipStatus(id) {
  return {
    hasDoc:     fs.pathExistsSync(`public/shorts/${id}/transcript.doc.txt`),
    hasMerged:  fs.pathExistsSync(`public/shorts/${id}/transcript.json`),
    hasPreview: fs.pathExistsSync(`public/shorts/${id}/preview-cut.mp4`),
    hasCamera:  fs.pathExistsSync('public/shorts/camera-profiles.json'),
  };
}
```

**Redo steps available per clip (Path A):**

```
1. Re-extract doc from longform
2. Re-open doc for editing
3. Re-merge doc
4. Redo portrait camera (shared — affects all clips)
5. Re-generate cut preview
6. Relaunch Remotion
```

**Redo steps available for dedicated recording (Path B, before clips):**

```
sync · transcribe · align · buildDoc · mergeDoc
(then per-clip steps above)
```

**Multi-clip listing display:**

```
  Existing short-form clips:
    ◑  short-1   486s–665s   doc edited, not yet merged
    ●  short-2   900s–1020s  camera done
    ○  short-3   (doc only)
```

Status symbols: `○` doc only · `◑` merged · `●` camera done · `✓` preview done.

**Verify:** Selecting "redo" for an existing clip shows the redo menu and executes
the chosen step in isolation.

---

### Commit 9 — `feat: integrate shorts-wizard launch from longform wizard`

**Status check:** `npm run video:wizard` — after "✓ All done!" — prompts to create
short-form clips and spawns `shorts-wizard.js` if the user answers Y.

**Files modified:**
- `scripts/wizard.js`

**Change:**

After `console.log('\n  ✓ All done!\n')` and before `rl.close()`, add:

```js
const doShorts = await confirm('  Create short-form clips from this recording?', false);
if (doShorts) {
  rl.close();
  await spawnStep('node', ['scripts/shorts-wizard.js', '--from-longform']);
  return;
}
```

`shorts-wizard.js` checks for the `--from-longform` flag and skips the startup detection
prompt, jumping directly into Path A (longform transcript is assumed present since the
user just finished the longform pipeline).

**Verify:** After completing a full longform wizard run (or by simulating the end state),
the shorts prompt appears and correctly launches the shorts wizard.

---

### Commit 10 — `chore: finalize npm scripts`

**Status check:** All `shorts:*` scripts are present in `package.json`.

**Note:** AGENTS.md and CLAUDE.md were already updated in the planning session.
This commit only touches `package.json`.

**Files modified:**
- `package.json` — confirm all shorts scripts are present and correctly named:
  ```
  "shorts:camera-setup": "node scripts/shorts/portrait-camera-setup.js"
  "shorts:extract-doc":  "node scripts/shorts/extract-short-doc.js"
  "shorts:merge-doc":    "node scripts/shorts/merge-short-doc.js"
  "shorts:wizard":       "node scripts/shorts-wizard.js"
  ```

**Verify:** `npm run shorts:wizard` works end-to-end for a Path A clip on the existing
longform recording.

---

## Known dependencies between commits

```
Commit 1  (shared helpers)
  └─ required by: Commit 6, 7, 8, 9 (all wizard files import from it)

Commit 2  (extract-short-doc)
  └─ required by: Commit 6 (Path A step 5), Commit 7 (Path B clip slicing)

Commit 3  (merge-short-doc)
  └─ required by: Commit 6 (Path A step 7), Commit 7 (Path B merge)

Commit 4  (portrait-camera-setup)
  └─ required by: Commit 6 (Path A step 8), Commit 7 (Path B camera step)

Commit 5  (ShortFormClip composition)
  └─ required by: Commit 6 (remotion launch at end of Path A)

Commits 6–8 build on each other in order.
Commit 9 depends on Commit 6 being stable.
Commit 10 is purely additive (package.json only).
```
