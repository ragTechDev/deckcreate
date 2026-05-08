# Transcription, Render Performance & Docker Security — Implementation Plan

## How agents use this document

This document is the authoritative implementation guide for fixing slow transcription,
slow Remotion rendering, a supply chain security vulnerability, and Docker image bloat.

**To resume interrupted work:**
1. Run `git log --oneline` to see which commits are complete.
2. Match the last commit message against the slugs below.
3. Continue from the next unstarted step.

**Rules:**
- Implement commits in order — each step depends on the previous.
- Do not combine steps into one commit. Isolation is intentional.
- The "Status check" under each commit tells you how to verify it is already done.
- If a commit is partially done (files exist but broken), fix it within that commit before moving on.
- Branch: `perf/transcription-render-speed` off `main`. Create it if it does not exist.

---

## Diagnosed problems

### Problem 1 — Transcription takes 2–3 hours (should be ~15 min)

`scripts/transcribe/Transcriber.js` `ensureWhisper()` checks whether the `whisper.cpp/main`
binary file *exists* but not whether it is runnable on the current platform. The project was
run inside Docker at some point, which wrote a Linux ARM64 ELF binary to `whisper.cpp/main`.
On macOS, `ensureWhisper()` sees the file, skips reinstallation, and then whisper.cpp runs
with no Metal GPU access — pure CPU only.

Confirmed via: `file whisper.cpp/main` returns `ELF 64-bit LSB pie executable, ARM aarch64`.
On macOS, the binary should be `Mach-O 64-bit executable arm64`.

**Fix:** add a magic-byte platform check inside `ensureWhisper()`. If the binary starts with
the ELF magic `7F 45 4C 46` on a non-Linux host, delete the directory and reinstall.

### Problem 2 — Rendering takes 5 hours (should be ~30–45 min)

Two compounding causes, both confirmed in `remotion.config.ts`:

**2a. Sparse keyframes in the source video.**
The existing comment reads:
> "The permanent fix is to re-encode the video with -g 60 -movflags +faststart"

Remotion renders frame-by-frame by seeking the source video. Sparse keyframes (e.g. one
every 10+ seconds) mean each seek must decode backwards from the last keyframe — on a
1-hour episode this accumulates to hours. `-g 60` puts a keyframe every 60 frames (1 s at
60 fps), bounding every seek to under 1 second.

**2b. No concurrency set.**
Remotion defaults to `Math.round(cpuCount / 2)` — about 4 on an M3 MacBook Air (8 cores).
Setting it to `cpuCount - 2` (6 on M3 Air) improves throughput ~50% with no other changes.

**Fix 2a:** add a post-sync re-encode step (new script) wired into the wizard.
**Fix 2b:** add `Config.setConcurrency()` to `remotion.config.ts`.

### Problem 4 — SECURITY: `lightning` supply chain compromise (active, CVE in progress)

**This is an active supply chain attack. Do not rebuild the Docker image until Commit 5
is applied. Do not run `pip install` in any environment that resolves `lightning` without
the pin in place.**

The Python `lightning` package (PyPI) versions **2.6.2 and 2.6.3** contain malicious code
that silently exfiltrates developer credentials, cloud secrets, and cryptocurrency wallets
from the host machine at install time (the "Mini Shai-Hulud" campaign).

This project is exposed via the following transitive chain:
```
Dockerfile: pip install whisperx
  → whisperx requires pyannote-audio
    → pyannote-audio requires lightning>=2.4
```
And independently:
```
Dockerfile: pip install -r scripts/diarize/requirements.txt  (diarize>=0.1.1)
  → diarize likely requires pyannote.audio
    → pyannote-audio requires lightning>=2.4
```

Without a pin, `pip install whisperx` on a fresh build will resolve to whatever the latest
`lightning` release is. If that happens to be 2.6.2 or 2.6.3, the image build itself
exfiltrates secrets from the build machine.

**Note:** the existing Dockerfile comment mentions `lightningcss` (a Node.js CSS tool,
line 40–41). That is an entirely separate package and is not affected.

**Fix:** add `lightning!=2.6.2,!=2.6.3` as an explicit constraint before any pip install
that could resolve it. See Commit 5.

---

### Problem 5 — Docker image is ~40 GB (should be ~4–6 GB)

Two causes:

**5a. PyTorch CUDA build installed on a machine that has no CUDA.**
`whisperx`, `faster-whisper`, and `diarize` all depend on `pyannote.audio`, which depends
on `torch`. The default `pip install` fetches the CUDA build of PyTorch (~2.5 GB). Docker
on macOS runs in a Linux VM with no GPU access — the CUDA binaries are dead weight.
Switching to the CPU-only index URL (`https://download.pytorch.org/whl/cpu`) brings
PyTorch down to ~250 MB.

**5b. Media files baked into the image via `COPY . .`.**
`.dockerignore` correctly excludes `node_modules`, `whisper.cpp`, and `.next`, but does
not exclude any of the generated media directories (`public/sync/output/`,
`public/renders/`, `public/transcribe/input/`, etc.). After running the pipeline, these
directories contain large video files that are silently copied into every image build.
At 100 GB of raw footage, a single build attempt copies the entire working set into the
image layer.

**Fix:** see Commits 6 and 7.

---

### Problem 3 — Full Remotion render triggered for every review pass

The wizard's cut-preview step (flat ffmpeg export, ~2–5 min) defaults to `false` and is
easy to skip. Users end up launching the full Remotion render (~5 hours) to review their
edits, when they only need the overlay-composited version at final delivery.

**Fix:** make cut-preview default to `true`, open it automatically, and add copy that frames
the Remotion render as a final-delivery step rather than a review step.

---

## Architecture overview

### New file

```
scripts/optimize/optimize-for-remotion.js   — re-encodes synced video with dense keyframes
```

### New npm script (added to package.json)

```
video:optimize   = node scripts/optimize/optimize-for-remotion.js
```

### Files modified

```
scripts/transcribe/Transcriber.js    — platform check in ensureWhisper()
remotion.config.ts                   — concurrency setting
scripts/wizard.js                    — optimize step after sync; cut-preview promotion
package.json                         — new video:optimize script
```

---

## Commit checklist

---

### Commit 1 — `fix: detect and replace wrong-platform whisper binary` ✅ DONE

**Status check:** `scripts/transcribe/Transcriber.js` `ensureWhisper()` contains a read
of the first 4 bytes of `binaryPath` and a check against the ELF magic bytes `7F 45 4C 46`.

**Files modified:**
- `scripts/transcribe/Transcriber.js`

**What to do:**

In `ensureWhisper()` ([Transcriber.js:69](../scripts/transcribe/Transcriber.js)), after
the existing `binaryExists` check (line 73) and before the install block (line 81), add a
platform compatibility check. If the binary exists, read its first 4 bytes and compare
against the ELF magic number. On a non-Linux host, an ELF binary is wrong-platform.

Insert this block between lines 79 and 81 (after the broken-install cleanup, before the
`if (!binaryExists)` install block):

```javascript
// Guard against a wrong-platform binary (e.g. Linux ELF installed via Docker on macOS).
// ELF magic: 0x7F 'E' 'L' 'F'. If this host is not Linux and the binary starts with
// ELF magic, delete and reinstall for the current platform.
if (binaryExists && process.platform !== 'linux') {
  const fd = await fs.open(binaryPath, 'r');
  const magic = Buffer.alloc(4);
  await fd.read(magic, 0, 4, 0);
  await fd.close();
  const isElf = magic[0] === 0x7F && magic[1] === 0x45 && magic[2] === 0x4C && magic[3] === 0x46;
  if (isElf) {
    console.log('  Detected Linux whisper.cpp binary on non-Linux host — reinstalling for this platform...');
    await fs.remove(this.whisperDir);
    binaryExists = false;
  }
}
```

No other changes to the file.

**Manual test:**
1. Confirm `whisper.cpp/main` currently exists and is ELF:
   `file whisper.cpp/main` should say `ELF 64-bit`.
2. Run `npm run transcribe` (or trigger `new Transcriber().init()` then `ensureWhisper()`).
3. Confirm the console prints `Detected Linux whisper.cpp binary on non-Linux host — reinstalling...`
4. Confirm `whisper.cpp/main` is now a Mach-O binary:
   `file whisper.cpp/main` should say `Mach-O 64-bit executable arm64`.
5. Transcription should complete in ~10–20 min on M3 with `medium.en`.

---

### Commit 2 — `perf: set remotion concurrency to available cpu cores` ✅ DONE

**Status check:** `remotion.config.ts` imports `os` and calls `Config.setConcurrency()`.

**Files modified:**
- `remotion.config.ts`

**What to do:**

Add an `import os from 'os'` at the top of `remotion.config.ts`, then add a concurrency
setting after the existing `Config.setTimeoutInMilliseconds` line:

```typescript
import os from 'os';
```

```typescript
// Use all but 2 cores for rendering (leaves headroom for the OS and other processes).
// On M3 MacBook Air (8 cores) this gives 6 concurrent renderers.
Config.setConcurrency(Math.max(4, os.cpus().length - 2));
```

The `Math.max(4, ...)` floor ensures at least 4 renderers on machines with fewer than 6 cores.

**Manual test:** Run `npx remotion render ragTechVodcast --frames 0-59` (one second of frames)
and confirm in the terminal output that Remotion reports using 6 workers (or `cpuCount - 2`
on the actual machine).

---

### Commit 3 — `feat: add post-sync keyframe optimization` ✅ DONE

**Status check:** `scripts/optimize/optimize-for-remotion.js` exists AND `package.json`
has a `video:optimize` script entry AND `scripts/wizard.js` contains the string
`optimize-for-remotion`.

**Files created:**
- `scripts/optimize/optimize-for-remotion.js`

**Files modified:**
- `package.json`
- `scripts/wizard.js`

**What to do:**

#### 3a — Create `scripts/optimize/optimize-for-remotion.js`

The script re-encodes one or more video files with dense keyframes so Remotion can seek
efficiently. It must:

1. Accept CLI flags:
   - `--videos <path1> [<path2> ...]` — absolute paths to files to optimize. All paths
     after `--videos` up to the next `--`-prefixed flag are treated as video paths.
   - `--cwd <dir>` — optional, used to resolve relative paths.

2. For each input file:
   - Write output to a temp file alongside the original (same directory, `.tmp.mp4` suffix).
   - On macOS (`process.platform === 'darwin'`), use VideoToolbox for hardware-accelerated
     encode — much faster than libx264 on Apple Silicon:
     ```
     ffmpeg -i <input> -c:v h264_videotoolbox -g 60 -movflags +faststart
            -c:a copy -y <input>.tmp.mp4
     ```
   - On other platforms, use libx264:
     ```
     ffmpeg -i <input> -c:v libx264 -preset fast -g 60 -movflags +faststart
            -c:a copy -y <input>.tmp.mp4
     ```
   - On success, rename `.tmp.mp4` over the original (atomic replace via `fs.move`
     with `{ overwrite: true }`).
   - On failure, delete the temp file and throw.

3. Show a progress bar during each encode using the `time=` stderr parsing pattern
   already used in `scripts/wizard.js` `extractAudio()` (lines 82–98 of wizard.js).

4. Print a summary when done.

5. Export an `optimizeForRemotion(videoPaths)` async function as the default export,
   returning when all files are done. This is called by wizard.js.

Add to `package.json` `"scripts"`:
```json
"video:optimize": "node scripts/optimize/optimize-for-remotion.js"
```

#### 3b — Wire into `scripts/wizard.js`

Add the optimize step immediately **after** the sync block completes and the synced output
paths are known, and **before** the audio extraction step (currently around line 393 in
wizard.js). It should only run on a fresh start (`resumeStep === 0`) and only when
`mode === 1` (sync produced output files).

The synced video path(s) to pass are:
- Single angle: `[path.join(syncOutputDir, 'synced-output.mp4')]`
- Multi-angle: `syncResults.map(r => r.outputPath)`

The block:
```javascript
// ── STEP: Keyframe optimization (post-sync) ───────────────────────────
if (resumeStep === 0 && mode === 1) {
  console.log('\n  ── Optimising video for Remotion (keyframes) ────────');
  const { default: optimizeForRemotion } = await import('./optimize/optimize-for-remotion.js');
  const pathsToOptimize = numAngles > 1
    ? syncResults.map(r => r.outputPath)
    : [path.join(syncOutputDir, 'synced-output.mp4')];
  await optimizeForRemotion(pathsToOptimize);
  console.log('  ✓ Keyframe optimisation complete');
}
```

Also add it to the `stepDefs` array in the "Jump to a specific step" menu (around line 206):
```javascript
{ id: 'optimize', label: 'Re-optimise synced video for Remotion', done: false, resumeAt: 0 },
```
And add a `redoStepId === 'optimize'` handler that runs `optimizeForRemotion` on any
existing synced-output files found in `public/sync/output/`.

**Manual test:**
1. Run the wizard through sync on a short test video.
2. Confirm the optimize step runs and prints progress.
3. Run `ffprobe -show_frames -select_streams v public/sync/output/synced-output.mp4 | grep key_frame | head -20`
   and confirm `key_frame=1` appears frequently (every ~60 frames).
4. Run `npx remotion render ragTechVodcast --frames 0-299` (5 s) and confirm it finishes
   noticeably faster than before the optimization.

---

### Commit 4 — `feat: promote cut-preview as primary review step` ✅ DONE

**Status check:** In `scripts/wizard.js`, the cut-preview `confirm()` call uses `true` as
its default argument (not `false`), AND the block calls `openFile(previewPath)` after the
preview is generated.

**Files modified:**
- `scripts/wizard.js`

**What to do:**

Modify the cut-preview block (currently lines 1041–1063 of wizard.js):

1. **Change the heading and prompt copy** to frame this as the review step:
   ```
   ── Review your edit (cut preview) ──────────────────
   Generate a flat MP4 preview of your edit?
   (Fast ffmpeg export — review this before launching Remotion)
   ```
   Change `confirm('  Generate flat MP4 preview?', false)` to
   `confirm('  Generate cut preview for review?', true)`.

2. **Open the preview automatically** after it is generated (both in the redo path and the
   normal path). After the `runStep(...)` call, add:
   ```javascript
   openFile(previewPath);
   console.log(`  → Opened preview: ${previewPath}`);
   console.log('  Review the preview, then continue to launch Remotion for final overlay render.');
   ```

3. **Update the Remotion prompt copy** (currently line 1073) to reinforce the distinction:
   Change:
   ```javascript
   const doRemotion = await confirm('  Launch Remotion studio?', false);
   ```
   To:
   ```javascript
   const doRemotion = await confirm('  Launch Remotion studio for final overlay render?', false);
   ```

No other changes.

**Manual test:** Run `npm run video:wizard`, reach the cut-preview step, confirm:
- The prompt defaults to yes.
- The preview opens automatically after generation.
- The Remotion prompt copy reads "for final overlay render".

---

---

### Commit 5 — `fix: pin lightning away from compromised pypi versions` ⚠️ SECURITY ✅ DONE

**Status check:** `Dockerfile` contains `lightning!=2.6.2,!=2.6.3` on a `pip install`
constraint line that appears **before** any `pip install whisperx` or
`pip install -r scripts/diarize/requirements.txt` line.

**Files modified:**
- `Dockerfile`

**What to do:**

Add an explicit `lightning` constraint as the very first `pip install` call in the
Dockerfile, before any package that transitively depends on it. Insert this as a new
`RUN` layer immediately before the existing Python dependencies `RUN` block:

```dockerfile
# Pin lightning away from compromised versions (Mini Shai-Hulud supply chain attack).
# Versions 2.6.2 and 2.6.3 exfiltrate credentials at install time.
# whisperx → pyannote-audio → lightning>=2.4 is the transitive exposure path.
RUN pip install --no-cache-dir "lightning!=2.6.2,!=2.6.3"
```

The `!=` constraint syntax tells pip to allow any version of lightning *except* these two.
It must appear before `whisperx` and `diarize` are installed so that pip's resolver uses
the constraint when it encounters the transitive `lightning>=2.4` requirement.

Do not use `lightning<2.6.2` — that would block any future clean release (2.6.4+).
Use `!=2.6.2,!=2.6.3` to stay open to patched versions.

**Manual test:**
After applying, run a fresh image build and then inside the container:
```
pip show lightning | grep Version
```
Confirm the version is neither `2.6.2` nor `2.6.3`.

---

### Commit 6 — `fix: exclude media directories from docker build context` ✅ DONE

**Status check:** `.dockerignore` contains `public/sync/output/` and `public/renders/`.

**Files modified:**
- `.dockerignore`

**What to do:**

Add the following block to `.dockerignore`. These are all directories that contain
generated or uploaded media files. They are mounted as Docker volumes at runtime and
must never be baked into the image:

```
# Generated media — mounted as volumes at runtime
input/video/
input/audio/
public/sync/video/
public/sync/audio/
public/sync/output/
public/transcribe/input/
public/transcribe/output/
public/renders/
public/output/
public/edit/
public/camera/
public/thumbnail/
public/shorts/
public/proxy/

# Build artefacts
deckcreate-wizard.tar.gz
docs/
```

Also exclude `docs/` — planning documents have no place in the runtime image.

**Manual test:**
Run `docker build -t deckcreate-test .` with media files present in `public/sync/output/`.
Run `docker run --rm deckcreate-test ls public/sync/output/` — the directory should be
empty (or not exist). If media files appear, the `.dockerignore` is not taking effect.

---

### Commit 7 — `perf: use cpu-only pytorch and no-cache-dir in dockerfile` ✅ DONE

**Status check:** `Dockerfile` contains `--index-url https://download.pytorch.org/whl/cpu`
on the `pip install torch` line AND all `pip install` calls include `--no-cache-dir`.

**Files modified:**
- `Dockerfile`

**What to do:**

Replace the existing Python dependencies `RUN` block in the Dockerfile with the following.
The key changes are:
1. Install CPU-only PyTorch **first**, before anything that depends on it. This prevents
   pip from pulling the CUDA build when resolving transitive dependencies.
2. Add `--no-cache-dir` to every `pip install` call. Without it, pip keeps downloaded
   wheels in `/root/.cache/pip` inside the layer, wasting 1–2 GB per build.
3. Keep the `lightning` pin from Commit 5 here too (consolidate the two `RUN` blocks).

```dockerfile
# Install CPU-only PyTorch first — prevents pip from resolving the CUDA build (~2.5 GB)
# when whisperx/pyannote-audio pull in torch as a transitive dependency.
# Also pins lightning away from compromised versions 2.6.2 and 2.6.3.
RUN pip install --no-cache-dir \
      torch torchaudio \
      --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir "lightning!=2.6.2,!=2.6.3"

# Install remaining Python dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r scripts/diarize/requirements.txt && \
    pip install --no-cache-dir whisperx faster-whisper && \
    pip install --no-cache-dir -r scripts/camera/requirements.txt && \
    pip install --no-cache-dir -r scripts/thumbnail/requirements.txt && \
    pip install --no-cache-dir "coverage>=7.0"
```

If Commit 5 was applied as a separate `RUN` layer (as instructed), remove that layer now
and consolidate the `lightning` pin into this block to reduce layer count.

**Manual test:**
Build the image and run:
```
docker run --rm deckcreate-test pip show torch | grep -E "^Version|^Location"
docker run --rm deckcreate-test python -c "import torch; print(torch.__version__)"
docker images deckcreate-test --format "{{.Size}}"
```
Confirm torch is installed (no CUDA suffix in version string) and the image size is
under 8 GB (was ~40 GB).

---

## Done

All seven commits address the diagnosed problems:

| Problem | Fix | Expected improvement |
|---------|-----|---------------------|
| Transcription 2–3 h | Commit 1 — platform check forces native Metal binary | ~15 min |
| Render 5 h (sparse keyframes) | Commit 3 — post-sync re-encode with `-g 60` | ~30–45 min |
| Render 5 h (low concurrency) | Commit 2 — `concurrency = cpuCount - 2` | additional ~30–50% |
| Unnecessary full renders | Commit 4 — cut-preview defaulted on, opened automatically | full render only at delivery |
| ⚠️ lightning supply chain (SECURITY) | Commit 5 — explicit `!=2.6.2,!=2.6.3` pin before whisperx install | malicious install blocked |
| Docker image ~40 GB (media files) | Commit 6 — media dirs added to `.dockerignore` | removes GBs of baked-in video |
| Docker image ~40 GB (CUDA PyTorch) | Commit 7 — CPU-only torch + `--no-cache-dir` | ~4–6 GB final image size |

**Priority order for the security-sensitive context:** do Commit 5 (or the combined
Commit 7) before any Docker image rebuild. Commits 1–4 are safe to do in any order
independently of the Docker commits.
