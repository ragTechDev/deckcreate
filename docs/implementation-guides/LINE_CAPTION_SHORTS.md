# Line-caption Shorts — Implementation Plan

## How agents use this document

This document is the authoritative implementation guide for the line-caption
shorts feature. Work is broken into isolated commits. Each commit is
independently testable.

**To resume interrupted work:**
1. Run `git log --oneline` to see which commits are complete.
2. Match the last commit message against the slugs below.
3. Continue from the next unstarted step.

**Rules:**
- Implement commits in order — each step depends on the previous.
- Do not combine steps into one commit. Isolation is intentional.
- The "Status check" line under each commit tells you how to verify it is
  already done.
- If a commit is partially done (files exist but broken), fix it within that
  commit before moving on.

---

## Architecture overview

A dedicated, standalone pipeline that takes a raw short-form portrait video
and produces a burned-in-caption render, independent of the longform/shorts
camera+hook pipeline:

```
raw portrait video
  ↓ [captions:create]  extract audio → transcribe → align → diarize (if
                        --num-speakers > 1) → chunk into 3-word lines →
                        write lines.json + lines.doc.txt
  Human edits lines.doc.txt (rewords lines; ids/timestamps untouched)
  ↓ [captions:merge]   re-parses doc, overwrites line text in lines.json
  ↓ [captions:render]  Remotion renders raw video pass-through + burned-in
                        3-word caption lines
```

Output structure:

```
public/line-captions/
  {id}/
    source.mp4          copy of the raw input video
    audio.wav            extracted mono 16kHz audio
    transcribe/          Transcriber output (transcript.raw.json, .vtt)
    lines.json            LineCaptionsDoc — meta + CaptionLine[]
    lines.doc.txt         human-editable doc (speaker headers + [id] text)
```

`lines.json` is a new artifact, distinct from `transcript.json` — it has no
segments/tokens/cuts, just fixed-window caption lines. See
`remotion/types/lineCaptions.ts`.

### Line-break rule

Lines never mix two speakers — chunking never carries a run of words across a
segment boundary (segments already partition by speaker after
`assign-speakers` runs). A trailing partial run (1-2 words) at the end of a
segment stands alone rather than borrowing from the next segment/speaker.

### Editing model

`lines.doc.txt` is edited for wording only. The `[id]` markers must not be
added/removed/reordered — `captions:merge` maps edited text back onto the
existing `lines.json` entry by id and leaves `startMs`/`endMs`/`speaker`
untouched (best-effort timing; no re-alignment).

---

## Commit checklist

### Commit 1 — `feat: add CaptionLine types and chunkIntoLines`

Add `remotion/types/lineCaptions.ts`:
```ts
import type { Segment } from './transcript';

export type CaptionLine = { id: number; speaker: string; text: string; startMs: number; endMs: number };
export type LineCaptionsMeta = { title: string; duration: number; fps: number; videoSrc?: string };
export type LineCaptionsDoc = { meta: LineCaptionsMeta; lines: CaptionLine[] };
```

Whisper tokens are BPE sub-word pieces, not whole words (`Transcriber.js:213-218`
puts raw whisper.cpp token text straight into `token.tokens[]`, no word
reconstruction) — a "word" like "jinx" can arrive as two tokens (`" j"`,
`"inx"`), and punctuation can arrive as its own token. Chunking raw tokens by
count-of-3 would split lines mid-word. `CaptionOverlay.tsx:43-103` already
solves this for its own rendering path with a `wordGroups` merge step; port a
trimmed version of the same merge (BPE-continuation attach, contraction-suffix
attach, punctuation attach — skip the reverse-iteration hook-overlap dedup,
which doesn't apply to a fresh non-overlapping transcript) into
`scripts/line-captions/chunkLines.js`, since this runs in plain Node
(`scripts/`) rather than the TS/browser `remotion/` runtime the existing
implementations live in.

Add `scripts/line-captions/chunkLines.js` exporting
`chunkIntoLines(segments, wordsPerLine = 3)`:
- `buildWordGroups(tokens)`: drops `isSpecialToken` tokens (imported from
  `../edit-transcript.js`, exported at `edit-transcript.js:2104`) and `cut`
  tokens; for each remaining token, attaches it to the previous group's text
  when it's a BPE continuation (`!t.text.startsWith(' ')`), a contraction
  suffix (`/^'(m|s|t|re|ve|ll|d)$/i`), or punctuation-only
  (`/^[^\w\s']+$/`); otherwise starts a new group with `{ text: trimmed,
  t_dtw: t.t_dtw, t_end: t.t_end }`. Continuation/suffix attaches append the
  trimmed token text directly (no separator); a later attach's `t_end`
  overwrites the group's `t_end` so the group's end time tracks its last
  token.
- `chunkIntoLines`: runs `buildWordGroups` per segment (skipping `cut`
  segments), buckets the resulting whole-word groups into runs of exactly
  `wordsPerLine`, never spanning a segment boundary — a trailing partial run
  (1-2 words) stands alone.
- `startMs = run[0].t_dtw * 1000`. `endMs` = the next run's `t_dtw * 1000`
  within the same segment, or for the last run in a segment:
  `(run[run.length - 1].t_end ?? segment.end) * 1000`.
- Line text = `run.map(g => g.text).join(' ')`.
- Assigns sequential `id` starting at 1 across the whole transcript.
- `speaker` comes from `segment.speaker`.

Add `scripts/line-captions/chunkLines.test.js` covering:
- An exact multiple of 3 word-groups → one line per 3 words.
- A non-multiple → trailing partial line of 1-2 words.
- A word split across two BPE tokens (no leading space on the second) is
  reconstructed as one word, not counted as two.
- A punctuation-only token attaches to the preceding word instead of
  starting its own group.
- Two adjacent segments with different speakers → no line spans both.
- `cut: true` tokens/segments are excluded entirely.
- A token without `t_end` falls back to `segment.end` for the last run.

**Status check:** `remotion/types/lineCaptions.ts` and
`scripts/line-captions/chunkLines.js` exist; `npm run test:unit -- chunkLines`
passes.

---

### Commit 2 — `feat: add captions:create script`

Add `scripts/line-captions/create-line-captions.js`, CLI:
```
node scripts/line-captions/create-line-captions.js --video <path> [--num-speakers N] [--id <slug>]
```
- Resolves `id`: uses `--id` if given, else auto-increments `clip-{n}` by
  scanning `public/line-captions/` (same scheme as `nextId` in
  `scripts/shorts-wizard.js:114-120`).
- `fs.ensureDir` + copy the source video to
  `public/line-captions/{id}/source.mp4`.
- Extract audio to `public/line-captions/{id}/audio.wav` using the same
  ffmpeg spawn invocation as `extractAudio()` in `scripts/wizard.js:63-90`
  (`-vn -ar 16000 -ac 1`).
- `const transcriber = new Transcriber({ audioPath, outputDir: path.join(clipDir, 'transcribe') }); await transcriber.init(); await transcriber.transcribe();`
  (import `Transcriber` from `../transcribe/Transcriber.js`, used unmodified).
- Spawn `node scripts/align/align-transcript.js --audio <audio.wav> --raw <transcribe/raw/transcript.raw.json>`
  to populate `token.t_end` (always run — unmodified script).
- If `--num-speakers` is given and `> 1`, spawn (in order, unmodified):
  - `node scripts/diarize/diarize-audio.js --audio <audio.wav> --output <transcribe/raw/diarization.json> --num-speakers N`
  - `node scripts/diarize/assign-speakers.js --diarization <diarization.json> --raw <transcript.raw.json>`
- Load `transcript.raw.json`, call `chunkIntoLines(segments)`.
- Write `public/line-captions/{id}/lines.json`:
  `{ meta: { title, duration, fps, videoSrc: 'line-captions/{id}/source.mp4' }, lines }`
  (`title`/`duration`/`fps` copied from `transcript.raw.json.meta`).
- Write `public/line-captions/{id}/lines.doc.txt` via a new `buildLineDoc(linesDoc)`:
  group consecutive lines by `speaker` into `=== NAME ===` blocks (blank line
  before/after, matching the visual grammar of `buildDoc()` in
  `scripts/edit-transcript.js:683-756`), then one `[id]  text` line per
  `CaptionLine`.
- Print next-step instructions: open the doc, edit wording only, then run
  `npm run captions:merge -- --id {id}`.

**Status check:** `scripts/line-captions/create-line-captions.js` exists.
Running it against a short sample portrait clip produces
`public/line-captions/{id}/lines.json` and `lines.doc.txt`, and `lines.doc.txt`
groups lines under `=== SPEAKER ===` headers in readable 3-word chunks.

---

### Commit 3 — `feat: add captions:merge script`

Add `scripts/line-captions/merge-line-captions.js`, CLI:
```
node scripts/line-captions/merge-line-captions.js --id <slug>
```
- Reads `public/line-captions/{id}/lines.doc.txt` and `lines.json`.
- Parses the doc: tracks current speaker from `=== NAME ===` headers, matches
  `/^\[(\d+)\]\s*(.*)$/` per line to get `(id, text)` pairs.
- For each parsed id found in `lines.json`, overwrites only its `text` field.
  `startMs`/`endMs`/`speaker` are left untouched.
- `console.warn` (does not throw) for: a doc id with no matching `lines.json`
  entry; a `lines.json` id missing from the doc entirely.
- Writes the updated `lines.json` back in place.

**Status check:** `scripts/line-captions/merge-line-captions.js` exists.
Hand-editing one line's text in `lines.doc.txt` and running the merge command
updates that line's `text` in `lines.json` while its `startMs`/`endMs` stay
identical to before the edit.

---

### Commit 4 — `feat: add LineCaptionClip Remotion composition`

Add `remotion/components/LineCaptionOverlay.tsx`:
- Props: `{ lines: CaptionLine[]; brand: Brand }`.
- `const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const ms = (frame / fps) * 1000;`
- `const active = lines.find(l => ms >= l.startMs && ms < l.endMs) ?? null;`
- Renders `active.text` using the same layout constants as
  `CaptionOverlay.tsx` (`CAPTION_TOP`, `CAPTION_FONT_SIZE`, brand typography,
  text-shadow) for visual consistency with the rest of the brand's captions.
- When `lines` contains more than one distinct `speaker`, tint the text color
  per-speaker (stable hash of speaker name into `brand.colors` accent slots,
  or a simple two-way alternation — keep it simple, this is cosmetic).

Add `remotion/LineCaptionClip.tsx`:
- Props: `{ src: string; linesSrc: string; brandSrc?: string; brandId?: string }`.
- Loads `linesSrc` and brand JSON using the same `fetchJson` /
  `normalizeStaticPath` / `delayRender`+`continueRender` pattern as
  `ShortFormClip.tsx:42-46,264-293`.
- Renders `<OffthreadVideo src={staticFile(normalizeStaticPath(src))} />` — a
  plain full-length pass-through, no `SegmentPlayer`/`CameraPlayer`, no cuts —
  plus `<LineCaptionOverlay lines={linesDoc.lines} brand={brand} />`.
- Export `calculateLineCaptionMetadata: CalculateMetadataFunction<...>` that
  fetches `linesSrc`, sets `durationInFrames = Math.ceil(meta.duration * fps)`,
  `fps: 60, width: 1080, height: 1920`.

Update `remotion/Root.tsx`:
- Add a `LINE_CAPTION_IDS` array using the same `require.context` pattern as
  `SHORT_IDS` (lines 7-19), scanning `../public/line-captions` for
  `/\/lines\.json$/`.
- Map it to `<Composition id={\`LineCaptionClip-${id}\`} component={LineCaptionClip} calculateMetadata={calculateLineCaptionMetadata} defaultProps={{ linesSrc: \`line-captions/${id}/lines.json\`, brandSrc: 'brand.json' }} durationInFrames={300} fps={60} width={1080} height={1920} />`
  (mirroring `SHORT_IDS.map(...)` at lines 47-65). `src` is resolved inside
  `LineCaptionClip` from `linesDoc.meta.videoSrc` if not passed explicitly.

Add `remotion/components/LineCaptionOverlay.test.tsx`: smoke-renders with 2-3
sample `CaptionLine`s at different frames, asserts the correct line's text is
shown (and that no text shows before the first line's `startMs`).

**Status check:** `remotion/LineCaptionClip.tsx`,
`remotion/components/LineCaptionOverlay.tsx` exist; `Root.tsx` registers
`LineCaptionClip-{id}` per `public/line-captions/*/lines.json`; `npm run
test:react -- LineCaptionOverlay` passes.

---

### Commit 5 — `feat: add captions:render script and npm scripts`

Add `scripts/line-captions/render-line-captions.js`, CLI:
```
node scripts/line-captions/render-line-captions.js --id <slug>
```
Modeled directly on `scripts/shorts/render-short.js`: reads
`public/line-captions/{id}/lines.json` for `meta.videoSrc`, spawns
```
npx remotion render remotion/index.ts LineCaptionClip-{id} --props='{"linesSrc":"line-captions/{id}/lines.json","brandSrc":"brand.json"}'
```
outputting to `public/renders/{id}.mp4`.

Add to `package.json` `scripts`:
```json
"captions:create": "node scripts/line-captions/create-line-captions.js",
"captions:merge": "node scripts/line-captions/merge-line-captions.js",
"captions:render": "node scripts/line-captions/render-line-captions.js",
```

**Status check:** All three `captions:*` scripts are present in
`package.json`; `npm run captions:render -- --id <slug>` (against a clip
produced by commit 2/3) produces `public/renders/<slug>.mp4`.

---

### Commit 6 — `docs: document line-caption artifacts in CLAUDE.md`

Update `d:\Environment\deckcreate\CLAUDE.md`:
- Add a `lines.json` entry under **Data Schemas** documenting `CaptionLine`
  and `LineCaptionsMeta` fields (mirror the existing `transcript.json` /
  `camera-profiles.json` schema block style).
- Add rows to the **Key Source Files** table for:
  `scripts/line-captions/chunkLines.js`, `create-line-captions.js`,
  `merge-line-captions.js`, `render-line-captions.js`,
  `remotion/types/lineCaptions.ts`, `remotion/components/LineCaptionOverlay.tsx`,
  `remotion/LineCaptionClip.tsx`.

Update `.gitignore`: add `public/line-captions/` next to the existing
`public/shorts/` line (~line 69) — same fully-generated-directory rule.

**Status check:** `git diff CLAUDE.md .gitignore` shows the new schema entry,
file-table rows, and gitignore line.

---

### Commit 7 — manual end-to-end verification (no commit, or `chore:` fixups only)

Run the full pipeline against one real short portrait clip with two speakers:
1. `npm run captions:create -- --video <sample.mp4> --num-speakers 2`
2. Open `lines.doc.txt`, confirm 3-word lines read naturally and never mix
   speakers within a line.
3. Hand-edit one line's wording.
4. `npm run captions:merge -- --id <slug>`
5. `npx remotion studio`, select `LineCaptionClip-<slug>`, confirm captions
   are burned in, timed correctly against the audio, and the edited line
   shows its new wording during its original time window.
6. `tsc --noEmit` and `npm run lint` pass.

If this surfaces bugs, fix them in a new commit rather than amending prior
steps.
