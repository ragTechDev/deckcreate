# deckcreate

Video podcast editing and carousel generation pipeline.

## Quick start — Video Editing

```
npm run wizard
```

The wizard guides you through every step interactively: it asks what files you have, how many speakers, then runs each stage in sequence — waiting for you to review each output before moving on. Transcription and diarization are run in parallel automatically.

---

## Manual steps (reference)

Run scripts in order:

### 1. Sync audio and video
```
npm run sync
```
Aligns recorded audio with the camera feed and outputs `public/transcribe/sync/output/synced-output.mp4`.

### 2. Transcribe
```
npm run transcribe
```
Runs Whisper on the synced audio and produces `public/transcribe/output/raw/transcript.raw.json`.

### 3. Diarize (speaker detection)
`--num-speakers` is required — the model does not work well without a fixed speaker count.
```
npm run diarize -- --num-speakers 2
```
Outputs `public/transcribe/output/raw/diarization.json`.

### 4. Assign speakers
```
npm run assign-speakers
```
Labels each transcript segment with the detected speaker and updates `transcript.raw.json`.

### 5. Edit transcript
```
npm run edit-transcript
```
Merges raw segments into sentences, preserves existing edits, and writes:
- `public/transcribe/output/edit/transcript.json` — machine-readable transcript
- `public/transcribe/output/edit/transcript.doc.txt` — human-editable doc

### 6. Edit the doc
Open `transcript.doc.txt` and follow the instructions at the top:
- Rename speakers in the `SPEAKERS` section
- Retype words to correct them
- Wrap words in `{curly braces}` to cut them
- Add `CUT` after a segment number to cut the whole segment

### 7. Save edits
```
npm run merge-doc
```
Applies doc edits back to `transcript.json`.

To also auto-cut silences longer than 0.5 s:
```
npm run merge-doc:cut-pauses
```

### 8. Camera setup — punch-in/punch-out cuts (optional)

Simulates a multi-camera effect by digitally cropping and zooming into the speaking speaker's face, alternating with wide shots on a pacing schedule.

**Prerequisites — install MediaPipe into your Python environment:**
```
pip install mediapipe pillow
```
Or using the requirements file:
```
pip install -r scripts/camera/requirements.txt
```

**Run:**
```
npm run setup-camera
```
This will:
1. Extract a single frame from the video at `transcript.meta.videoStart`
2. Detect faces in that frame (MediaPipe BlazeFace — no internet required)
3. Start the Next.js dev server and print the GUI URL

**Assign faces to speakers:**

Open `http://localhost:3000/camera` in your browser. You will see the extracted frame with numbered, colour-coded rectangles around each detected face. Use the dropdowns on the right to assign each face to the matching speaker name (names come from your transcript). Click **Save profiles** when done.

This writes `public/transcribe/output/camera/camera-profiles.json`, which Remotion reads automatically.

On newer MediaPipe versions (≥ 0.10.20) the bundled model API was removed. The script automatically falls back to the Tasks API and downloads the BlazeFace model (~800 KB) on first run, then caches it at `scripts/camera/blaze_face_short_range.tflite`. Subsequent runs are fully offline.

The number of speakers is read from the transcript and enforced on the detector — it will iteratively lower its detection confidence until the right number of faces are found. If it still can't find all of them, a warning is printed and you can draw the missing boxes manually in the GUI.

To skip auto-detection entirely and draw all boxes by hand:
```
npm run setup-camera -- --skip-detect
```

If Python is not on your `PATH`, pass the binary explicitly:
```
npm run setup-camera -- --python python3
```

To use a specific video or transcript:
```
npm run setup-camera -- --video path/to/video.mp4 --transcript path/to/transcript.json
```

### 9. Preview in Remotion
```
npm run remotion
```
If `camera-profiles.json` exists, the composition will apply punch-in/punch-out cuts automatically. To disable, remove or rename that file — the composition falls back to the standard cut-only render.

### 10. Cut preview (optional)
```
npm run cut-preview
```
Generates a flat MP4 with all cuts applied for quick review outside Remotion.

---

## Pipeline: Carousel Generation

```
npm run generate
npm run generate:bulk
```
