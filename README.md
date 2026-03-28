# deckcreate

Video podcast editing and carousel generation pipeline.

## Quick start — Video Editing

```
npm run wizard
```

The wizard guides you through every step interactively: it asks what files you have, how many speakers, then runs each stage in sequence — waiting for you to review each output before moving on. Transcription and diarization are run in parallel automatically.

Modes:
1. **Separate video + audio (need sync)** — aligns audio to video before transcribing
2. **Separate video + audio (already in sync)** — skips sync, uses audio directly
3. **Single video file** — extracts audio from the video
4. **Audio only** — transcription only, no video output

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

If you already know the timestamp offset for this recording (see step 2a), you can bake it in at this stage:
```
npm run transcribe -- --timestamp-offset 0.5
```

**Model selection**

The default model is `medium.en`. Larger models are more accurate but significantly slower on CPU:

| Model | Speed (≈36 min audio, CPU) | Accuracy |
|-------|---------------------------|----------|
| `tiny.en` | ~5 min | Low |
| `small.en` | ~20–30 min | Good — best speed/accuracy balance |
| `medium.en` | ~60–120 min | High |

To use a different model:
```
npm run transcribe -- --model small.en
```

The model is downloaded automatically on first use and cached in `whisper.cpp/`. Transcription runs on CPU — expect real-time or slower depending on your machine. The wizard prints a heartbeat every 15 seconds while Whisper is running so you can confirm it is still working.

### 2a. Check caption alignment (recommended on first recording)

Whisper's token-level timestamps (`t_dtw`) can be slightly late — typically 0.3–0.6 s — causing captions to lag behind the audio. Use the alignment test tool to measure the offset before editing:

1. Start a local server:
   ```
   cd public/transcribe && npx serve . -p 3001
   ```
2. Open `http://localhost:3001/caption_test.html` in your browser.
3. Follow the on-screen instructions:
   - Scrub the audio to exactly when a word begins speaking.
   - Note the timestamp shown in green.
   - Enter the word and time in the form — the page looks up the Whisper timestamp and calculates the offset.
   - Repeat with a second word at least 5 minutes later.
   - The page shows the average offset and the exact command to run.
4. If an offset is found, apply it in step 7 (`merge-doc`) or re-run transcription with `--timestamp-offset`.

> The wizard runs this check automatically and carries the offset through to subsequent steps.

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

If you measured a timestamp offset (see step 2a), pass it here:
```
npm run merge-doc -- --timestamp-offset 0.5
npm run merge-doc:cut-pauses -- --timestamp-offset 0.5
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
