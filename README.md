# deckcreate

Video podcast editing and carousel generation pipeline.

## Pipeline: Video Editing

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

### 8. Preview in Remotion
```
npm run remotion
```

### 9. Cut preview (optional)
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
