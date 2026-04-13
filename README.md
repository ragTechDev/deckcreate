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

## Pipeline: Carousel Generation

```bash
npm run generate
npm run generate:bulk
```
