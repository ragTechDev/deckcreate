# deckcreate

Video podcast editing and carousel generation pipeline.

## Prerequisites

### Option 1: Local

**Required:**
- **Node.js** v18+
- **ffmpeg** — `brew install ffmpeg` / `apt-get install ffmpeg` / [ffmpeg.org](https://ffmpeg.org/download.html)
- **Python 3.9–3.12** (use 3.12) — diarization + forced alignment

**Verify:**
```bash
ffmpeg -version && python --version && node --version
```

### Option 2: Docker

All dependencies included.

```bash
docker-compose run --rm --service-ports wizard
docker-compose run --rm app npm run transcribe
docker-compose run --rm app npm run remotion
```

Caption alignment test (port 3001) and camera GUI (port 3000) both work in Docker when using `--service-ports`.

---

## Quick start

```bash
npm run wizard
```

Guides you interactively through every step. Transcription + diarization run in parallel automatically.

### Wizard modes

| # | Mode | Description |
|---|------|-------------|
| 1 | Separate video + audio (need sync) | Aligns audio to video before transcribing. Supports multiple camera angles. |
| 2 | Separate video + audio (in sync) | Skips sync, uses audio directly |
| 3 | Single video file | Extracts audio from video |
| 4 | Audio only | Transcription only, no video output |

**Multi-angle (mode 1):** When prompted "how many camera angles?", enter 2+. Place each additional angle's video in `public/input/video/angle2/`, `angle3/`, etc. Each is synced independently to the same audio and assigned to speakers in the camera GUI.

---

## Python setup — diarization + forced alignment

Python 3.12 required for `diarize` and `align`.

```bash
py -3.12 -m venv .venv
.\.venv\Scripts\activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r scripts/diarize/requirements.txt
python -m pip install whisperx faster-whisper
```

If `python` resolves to `WindowsApps\python` (permission denied), pass the path explicitly:
```bash
npm run diarize -- --num-speakers 2 --python .venv\Scripts\python.exe
npm run align -- --python .venv\Scripts\python.exe
```

---

## Manual steps

### 1. Sync audio and video

**Single angle:**
```bash
npm run sync
```
Output: `public/sync/output/synced-output.mp4`

**Multi-angle** (run via wizard, or call directly from a script using `AudioSyncer.syncMultiple`):
Outputs: `public/sync/output/synced-output-1.mp4`, `synced-output-2.mp4`, etc.

### 2. Transcribe

```bash
npm run transcribe
npm run transcribe -- --model small.en   # faster, less accurate
npm run transcribe -- --timestamp-offset 0.5
```

| Model | Speed (≈36 min, CPU) | Accuracy |
|-------|----------------------|----------|
| `tiny.en` | ~5 min | Low |
| `small.en` | ~20–30 min | Good |
| `medium.en` (default) | ~60–120 min | High |

Model downloaded automatically on first use, cached in `whisper.cpp/`.

### 2a. Caption alignment check (recommended on first recording)

Whisper timestamps can lag 0.3–0.6 s. Measure the offset:

1. `cd public/transcribe && npx serve . -p 3001`
2. Open `http://localhost:3001/caption_test.html`
3. Scrub to a word onset, enter the word — page calculates offset
4. Repeat with a word 5+ min later; page shows the fix command

The wizard runs this automatically and carries the offset through subsequent steps.

### 3. Diarize

```bash
npm run diarize -- --num-speakers 2
```
Output: `public/transcribe/output/raw/diarization.json`

### 4. Assign speakers

```bash
npm run assign-speakers
```
Labels each segment with detected speaker in `transcript.raw.json`.

### 4a. Forced alignment

```bash
npm run align
npm run align -- --python .venv\Scripts\python.exe
```
Refines `segments[].start/end` and `tokens[].t_dtw` in `transcript.raw.json`. Populates `tokens[].t_end` (word-end boundary) enabling exact cut boundaries.

### 5. Edit transcript

```bash
npm run edit-transcript
```
Merges phrases into sentences. Outputs:
- `public/transcribe/output/edit/transcript.json`
- `public/transcribe/output/edit/transcript.doc.txt`

### 6. Edit the doc

Open `transcript.doc.txt`. Follow the instructions at the top:
- Rename speakers in the `SPEAKERS` section
- Retype words to correct them
- Wrap words in `{curly braces}` to cut them
- Add `CUT` after a segment number to remove the whole segment

### 7. Save edits

```bash
npm run merge-doc
npm run merge-doc:cut-pauses               # also remove silences > 0.5 s
npm run merge-doc:cut-pauses -- --pause-threshold 0.3
npm run merge-doc -- --timestamp-offset 0.5
```

Applies doc edits back to `transcript.json`. Re-running resets any previous pause cuts or offset — always pass the flags you want.

### 8. Camera setup (optional)

Simulates multi-camera by digitally cropping to the speaking speaker's face on a pacing schedule. Supports multiple physical camera angles: each angle uses a separate synced video file; each speaker is assigned to an angle.

**Install MediaPipe:**
```bash
pip install mediapipe pillow
# or:
pip install -r scripts/camera/requirements.txt
```

**Single angle:**
```bash
npm run setup-camera
```

**Multi-angle:**
```bash
node scripts/camera/setup-camera.js --videos path/to/angle1.mp4 path/to/angle2.mp4
```
Or let the wizard handle it (recommended).

The script:
1. Extracts a reference frame from each video at `transcript.meta.videoStart`
2. Runs MediaPipe BlazeFace face detection per angle (offline after first run — model cached at `scripts/camera/blaze_face_short_range.tflite`)
3. Starts the Next.js dev server

**Open `http://localhost:3000/camera`** in your browser:
- Use angle tabs to switch between camera angles
- Assign each detected face box to a speaker
- Click **Save profiles**

Output: `public/transcribe/output/camera/camera-profiles.json`

**Flags:**
```bash
npm run setup-camera -- --skip-detect          # skip auto-detection, draw manually
npm run setup-camera -- --video path/to/v.mp4  # specify video explicitly
npm run setup-camera -- --python python3        # custom Python path
```

### 9. Preview in Remotion

```bash
npm run remotion
```

Plays the full recording with all cuts applied. If `camera-profiles.json` exists, punch-in/punch-out cuts are applied automatically (including multi-angle switching). Remove or rename the file to disable camera cuts.

### 10. Cut preview (optional)

```bash
npm run cut-preview
```
Generates a flat MP4 for quick review outside Remotion.

---

## Editing: Long-form video

The wizard handles the full editing flow interactively.

```bash
npm run video:wizard
# Docker:
docker-compose run --rm --service-ports wizard npm run video:wizard
```

**Resume behaviour:** The wizard detects existing work and picks up where you left off. Choose *Resume*, *Jump to a specific step*, or *Start fresh*.

### Steps

**1. Build the transcript doc**

After transcription and speaker assignment complete, the wizard generates:

```
public/edit/transcript.doc.txt
```

This plain-text file represents every segment of the recording as a numbered line. The wizard opens it automatically.

**2. Edit the doc**

Each line looks like:

```
[42]  Natasha: And I think the real issue is context windows.
```

Make edits directly in the file:

| What you want | How to write it |
|---|---|
| Cut a word or phrase | Wrap in `{curly braces}` — `{um}`, `{you know}` |
| Cut an entire segment | Add `CUT` after the segment number: `[42] CUT` |
| Fix a transcript error | Retype the word inline |
| Rename a speaker | Edit the `SPEAKERS` block at the top of the file |

Save the file, return to the terminal, press **Enter**.

**3. Apply edits**

The wizard runs `merge-doc` to bake your changes back into `transcript.json`:

```bash
# Optional flags you can pass when jumping to this step manually:
npm run transcript:merge
npm run transcript:merge:cut-pauses   # also auto-cut silences > 0.5 s
```

**4. Camera setup (optional)**

Sets up digitally-simulated punch-in/punch-out cuts to the speaking face. The wizard:
1. Detects faces via MediaPipe
2. Opens `http://localhost:3000/camera` — assign each face box to a speaker, click **Save profiles**

Output: `public/camera/camera-profiles.json`

**5. Preview in Remotion Studio**

```bash
npm run remotion
```

Open the `ragTechVodcast` composition. Scrub through the timeline to review all cuts and overlays.

**6. Render**

```bash
npm run shorts:render   # renders the final MP4 based on outName in transcript meta
```

Or use Remotion's built-in render button in the Studio.

---

## Editing: Short-form clips

Short-form clips are vertical (9:16) cuts derived from the longform recording. Each clip lives in `public/shorts/<clip-id>/`.

**Prerequisite:** the longform pipeline must have run and produced `public/edit/transcript.json`.

```bash
npm run shorts:wizard
# Docker:
docker-compose run --rm --service-ports wizard npm run shorts:wizard
```

### Choosing a path

The wizard offers two paths:

| Path | When to use |
|---|---|
| **A — Clip from longform** | You recorded landscape and want to cut a vertical clip from it |
| **B — Dedicated portrait recording** | You recorded directly in portrait (phone, vertical camera) |

### Path A walkthrough

**1. Pick a clip ID**

Give the clip a short slug, e.g. `mediocrity`. Output goes to `public/shorts/mediocrity/`.

**2. Edit the clip doc**

The wizard copies a cleaned version of the longform doc to `public/shorts/<clip-id>/transcript.doc.txt` and opens it. You define the clip by adding directives:

**Define the clip range** — required:

```
> START
[42]  This is the first segment to include.
[55]  This is the last segment to include.
> END
```

For a precise sub-segment start or end, use `at=`:

```
> START at="the real issue is"
[42]  And I think the real issue is context windows.
> END at="context windows"
```

**Add a hook** — optional teaser that plays before the main clip:

```
# Whole segment as hook:
[38]  This is a great hook line.
> HOOK

# Specific phrase as hook:
[38]  This segment has a {great soundbite} in the middle.
> HOOK "great soundbite"
```

The hook section plays first, then the main clip from `START` to `END`.

**Word-level cuts** — same as longform:

```
[42]  Remove these {um} {you know} filler words.
```

Save the file, return to the terminal, press **Enter**.

**3. Apply edits**

The wizard runs `shorts:merge-doc`, which writes `public/shorts/<clip-id>/transcript.json` including:
- `meta.videoStart` / `meta.videoEnd` — the source time range
- `meta.hookTitle` — derived from the first `> HOOK` phrase
- `meta.outName` — auto-named `<source-filename>_<clip-id>.mp4`

**4. Portrait camera setup**

Uses the existing longform camera profiles and re-maps them for the 9:16 frame. Opens `http://localhost:3000/camera` — review face positions and click **Save profiles**.

Output: `public/shorts/<clip-id>/camera-profiles.json`

**5. Preview in Remotion Studio**

```bash
npm run remotion
```

Select the **ShortFormClip** composition. The studio reads from `public/shorts/mediocrity/` by default; pass `?shortId=<clip-id>` in the URL to switch clips.

**6. Render**

```bash
npm run shorts:render -- --id <clip-id>
```

Output MP4 is written to the path stored in `transcript.meta.outName`.

---

## Pipeline: Carousel Generation

```bash
npm run generate
npm run generate:bulk
```
