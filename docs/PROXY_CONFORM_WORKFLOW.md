# Proxy Transcode + Conform Workflow — Implementation Plan

## How agents use this document

This document is the authoritative implementation guide for raw-video proxy editing support.
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
- Branch: `feat/proxy-conform-workflow` off `main`. Create it if it does not exist.

---

## Context

The podcast editing pipeline uses Remotion (browser-based) to preview and render video.
Raw camera footage can be 100 GB+. Browsers cannot decode raw formats (ProRes, BRAW, etc.)
and have hard memory limits that prevent loading files that large.

**Solution:** two new steps wrap the existing pipeline:

1. **Proxy transcode** (before sync) — convert raw files to small H.264 proxies that the
   browser can handle. All existing pipeline steps (sync, transcribe, Remotion) run on proxies.
2. **Conform to raw** (after Remotion review) — once editing decisions are finalised in
   `transcript.json`, apply those cuts to the original raw files via ffmpeg to produce a
   full-quality final export. Uses `-c copy` (stream copy) so no re-encode for I-frame codecs.

A `proxy-map.json` written by the proxy script records which proxy corresponds to which
original raw file. The conform script reads this map so the user does not need to re-specify
raw paths at export time.

---

## Architecture overview

### New files

```
scripts/proxy/transcode-proxy.js      — standalone proxy transcode script
scripts/conform/conform-to-raw.js     — standalone conform/export script
public/proxy/proxy-map.json           — written by proxy script, read by conform script (gitignored)
```

### New npm scripts (added to package.json)

```
video:proxy   = node scripts/proxy/transcode-proxy.js
video:conform = node scripts/conform/conform-to-raw.js
```

### Where the steps plug into wizard.js

```
[place files in input/video/]
      ↓
[NEW step 3] transcode-proxy prompt    ← after placeFiles(), before multi-angle collection
      ↓
[sync]         ← works on proxy files
[transcribe]
[align]
[edit transcript]
[camera setup]
[remotion preview]
      ↓
[NEW step 4] conform-to-raw prompt     ← after Remotion block, before shorts prompt
      ↓
[shorts prompt]
```

---

## Commit checklist

---

### Commit 1 — `feat: add proxy transcode script`

**Status check:** `scripts/proxy/transcode-proxy.js` exists AND `package.json` has a
`video:proxy` script entry.

**Files created:**
- `scripts/proxy/transcode-proxy.js`

**Files modified:**
- `package.json`

**What to do:**

Create `scripts/proxy/transcode-proxy.js`. It must:

1. Accept CLI flags:
   - `--videos <path1> [<path2> ...]` — one or more absolute paths to raw source files.
     All paths after `--videos` up to the next `--` flag are treated as video paths.
   - `--output-dir <dir>` — directory to write proxies into (default: `input/video-proxy/`
     relative to cwd).
   - `--crf <n>` — optional, default `23`.
   - `--height <n>` — optional scale height, default `720`. Width is auto (`-2`).

2. For each input file, transcode with:
   ```
   ffmpeg -i <input> -vf scale=-2:<height> -c:v libx264 -preset fast -crf <crf>
          -c:a aac -ar 48000 -map_metadata 0 -y <outputDir>/<stem>-proxy.mp4
   ```
   Proxy filename: original stem + `-proxy.mp4` (e.g. `RAW_001.mov` → `RAW_001-proxy.mp4`).

3. Show a progress bar during each transcode (reuse the ffmpeg stderr `time=` parsing
   pattern from `scripts/wizard.js` `extractAudio()` lines ~82–98).

4. After all transcodes complete, write `public/proxy/proxy-map.json`:
   ```json
   {
     "/abs/path/to/input/video-proxy/RAW_001-proxy.mp4": "/abs/path/to/input/video/RAW_001.mov",
     "/abs/path/to/input/video-proxy/RAW_002-proxy.mp4": "/abs/path/to/input/video/RAW_002.mov"
   }
   ```
   Keys are absolute proxy paths; values are absolute raw paths.

5. Print a summary: how many files transcoded and where proxy-map.json was written.

6. Export a `transcodeProxies(videoPaths, outputDir, opts)` async function as the default
   export, returning an array of absolute proxy output paths. This is used by wizard.js.

Add to `package.json` `"scripts"`:
```json
"video:proxy": "node scripts/proxy/transcode-proxy.js"
```

**Manual test:** Place a short `.mov` or `.mp4` in a temp dir and run:
```
node scripts/proxy/transcode-proxy.js --videos /path/to/test.mov --output-dir /tmp/test-proxy
```
Verify `/tmp/test-proxy/test-proxy.mp4` is created and `public/proxy/proxy-map.json` is written.

---

### Commit 2 — `feat: add conform-to-raw script`

**Status check:** `scripts/conform/conform-to-raw.js` exists AND `package.json` has a
`video:conform` script entry.

**Files created:**
- `scripts/conform/conform-to-raw.js`

**Files modified:**
- `package.json`

**What to do:**

Create `scripts/conform/conform-to-raw.js`. It must:

1. Accept CLI flags:
   - `--transcript <path>` — default `public/edit/transcript.json`.
   - `--proxy-map <path>` — default `public/proxy/proxy-map.json`.
   - `--output <path>` — default `public/output/final-cut.mov`.
   - `--angle <n>` — 1-indexed angle to export (default `1`). For multi-angle shoots only
     angle 1 is exported; the user can re-run with `--angle 2` etc. if needed.

2. Build the clip list from `transcript.json` using the **same logic** as
   `scripts/cut-preview.js` `getSubClips()` (lines 18–27) and the main loop (lines 66–77).
   This handles hook clips first (with `hookFrom`/`hookTo` bounds if set), then main content,
   skipping `cut: true` segments and intra-segment `cuts[]` ranges.

3. Determine the raw source video:
   - Read `public/proxy/proxy-map.json`.
   - Identify which proxy was used for angle `--angle` (the sync output for that angle is
     at `public/sync/output/synced-output-<angle>.mp4` or `synced-output.mp4` for single-angle).
   - Walk the proxy-map to find the matching raw file. The map key is the proxy absolute path;
     use `path.basename` matching as a fallback if absolute paths differ between machines.
   - If no proxy-map exists (user is not working with raw files), exit with a clear error:
     `"No proxy-map.json found. This script is only needed when you transcoded proxies from raw files."`

4. Build an ffmpeg concat demuxer input file (`segments.txt`) in a temp directory:
   ```
   ffprobe each raw clip to ensure inpoints/outpoints are valid
   ```
   ```
   file '/abs/path/to/raw.mov'
   inpoint 0.000
   outpoint 12.400

   file '/abs/path/to/raw.mov'
   inpoint 15.100
   outpoint 38.900
   ```
   Note: the `file` line must repeat for every clip even when it is the same file.

5. Run ffmpeg:
   ```
   ffmpeg -f concat -safe 0 -i segments.txt -c copy -avoid_negative_ts make_zero -y <output>
   ```
   `-c copy` avoids re-encoding. This works correctly for ProRes (all-intra) and DNxHR.
   If the input codec is not all-intra (detected via `ffprobe -show_streams`), warn the user:
   `"Input codec is not all-intra — stream copy cuts may be imprecise at non-keyframes.
   Pass --reencode to use -c:v libx264 -preset slow -crf 16 instead."`
   and honour a `--reencode` flag that switches to that encode path.

6. Report progress by piping ffmpeg stderr and parsing `time=` (same pattern as proxy step).

7. Print where the output was written.

8. Export a `conformToRaw(opts)` async function as default export (used by wizard.js).

Add to `package.json` `"scripts"`:
```json
"video:conform": "node scripts/conform/conform-to-raw.js"
```

**Manual test:**
```
node scripts/conform/conform-to-raw.js \
  --transcript public/edit/transcript.json \
  --proxy-map public/proxy/proxy-map.json \
  --output /tmp/final-cut.mov
```
Verify the output file contains only the non-cut segments and its duration matches expectations.

---

### Commit 3 — `feat: integrate proxy step into wizard`

**Status check:** `scripts/wizard.js` contains the string `transcode-proxy` (the proxy
import or spawn call) AND the proxy prompt block is located between the `placeFiles()` call
and the multi-angle `additionalVideoFiles` collection loop.

**Files modified:**
- `scripts/wizard.js`

**What to do:**

In `scripts/wizard.js`, inside the `resumeStep === 0` block (fresh start only), add the
proxy step **after** `placeFiles()` returns the primary `videoFile` and **before** the
multi-angle loop that collects `additionalVideoFiles` (currently around line 325).

The block should:

1. Ask the user:
   ```
   Does your video file need proxy transcoding?
   (Choose this if your footage is raw/ProRes/BRAW or larger than ~10 GB)
   ```
   Default: `false`. Use the existing `confirm()` helper.

2. If yes:
   - Collect additional angle file paths first (move the multi-angle collection loop *before*
     this prompt so all raw paths are known), then transcode all of them in sequence.
   - Import `transcodeProxies` from `./proxy/transcode-proxy.js`.
   - Call `transcodeProxies([videoFile, ...additionalVideoFiles], path.join(cwd, 'input', 'video-proxy'))`.
   - Replace `videoFile` and each entry in `additionalVideoFiles` with the returned proxy paths.
   - Print: `✓ Proxies ready. All editing steps will use proxy files.`
   - Print: `  Original raw files are stored in proxy-map.json and will be used at export time.`

3. If no: continue as normal (no changes to `videoFile` / `additionalVideoFiles`).

The rest of wizard.js is unchanged — because `videoFile` and `additionalVideoFiles` are
already the paths passed to all downstream steps (sync, extract audio, etc.), replacing them
with proxy paths is sufficient.

**Manual test:** Run `npm run video:wizard`, choose mode 1 (separate video + audio),
answer yes to proxy prompt, verify the proxy files appear in `input/video-proxy/` and the
sync step runs on the proxy.

---

### Commit 4 — `feat: integrate conform step into wizard`

**Status check:** `scripts/wizard.js` contains the string `conform-to-raw` (the conform
import or spawn call) AND the conform prompt block is located after the Remotion studio
block and before the shorts prompt.

**Files modified:**
- `scripts/wizard.js`

**What to do:**

In `scripts/wizard.js`, add a new block after the Remotion studio step (currently around
line 1079) and **before** the shorts prompt (the `Create short-form clips` confirm).

The block should only appear when `mode !== 4` (not audio-only) AND `proxy-map.json` exists
at `public/proxy/proxy-map.json`.

```javascript
const proxyMapPath = path.join(cwd, 'public', 'proxy', 'proxy-map.json');
if (mode !== 4 && await fs.pathExists(proxyMapPath)) {
  console.log('');
  const doConform = await confirm('  Export final cut from original raw files?', false);
  if (doConform) {
    console.log('\n  ── Export final cut from raw ─────────────────────────');
    const outputPath = path.join(cwd, 'public', 'output', 'final-cut.mov');
    await spawnStep('node', [
      'scripts/conform/conform-to-raw.js',
      '--transcript', path.join(cwd, 'public', 'edit', 'transcript.json'),
      '--proxy-map', proxyMapPath,
      '--output', outputPath,
    ]);
    console.log(`  ✓ Final cut written to public/output/final-cut.mov`);
  }
}
```

Also add `feat: integrate conform step into wizard` to the "Jump to a specific step" menu
(the `stepDefs` array in the resume detection block, around line 206). Add:
```javascript
{ id: 'conform', label: 'Export final cut from raw (conform)', done: false, resumeAt: 4 },
```
And in the `redoStepId === 'conform'` handler (follow the same pattern as `redoStepId === 'preview'`),
run the conform step directly without the `fs.pathExists` guard (since the user explicitly
chose it, assume they know what they're doing).

**Manual test:** Run `npm run video:wizard`, choose "Jump to a specific step → conform",
verify it runs `conform-to-raw.js` and outputs `public/output/final-cut.mov`.

---

### Commit 5 — `feat: gitignore proxy intermediates`

**Status check:** `.gitignore` contains `public/proxy/` and `input/video-proxy/`.

**Files modified:**
- `.gitignore`

**What to do:**

Add to `.gitignore`:
```
# Proxy editing intermediates
input/video-proxy/
public/proxy/
```

These directories contain either large proxy video files or a proxy-map that contains
absolute paths specific to the local machine — neither should be committed.

**Manual test:** Run `git status` and confirm `input/video-proxy/` and `public/proxy/`
do not appear as untracked if they exist.

---

## Done

All five commits complete the proxy + conform workflow. The existing pipeline is fully
unchanged for users who do not have raw files — the proxy prompt defaults to `false` and
the conform prompt only appears when `proxy-map.json` exists.
