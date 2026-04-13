#!/usr/bin/env node
/**
 * DeckCreate — Step-by-step video editing wizard.
 * Usage: npm run wizard
 */

import readline from 'readline';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '..');

// ── Prompt helpers ────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function confirm(q, defaultYes = true) {
  const hint = defaultYes ? '[Y/n/q]' : '[y/N/q]';
  const ans = (await ask(`  ${q} ${hint} `)).trim().toLowerCase();
  if (ans === 'q') quit();
  return defaultYes ? ans !== 'n' : ans === 'y';
}

function quit() {
  console.log('\nExiting wizard.\n');
  rl.close();
  process.exit(0);
}

// ── Process helpers ───────────────────────────────────────────────────────────

function spawnStep(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      cwd,
      shell: process.platform === 'win32',
      ...opts,
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Exited with code ${code}`));
    });
    proc.on('error', e => reject(new Error(e.message)));
  });
}

/** Run a step with an interactive review-and-retry loop. */
async function runStep(label, cmd, args, outputPath) {
  while (true) {
    console.log(`\n  → ${label}`);
    let ok = false;
    try {
      await spawnStep(cmd, args);
      if (outputPath) console.log(`  ✓ Done — ${outputPath}`);
      else console.log(`  ✓ Done`);
      ok = true;
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }

    const happy = await confirm('  Happy with the result?');
    if (happy) return;

    console.log('');
    console.log('  1. Re-run this step');
    if (ok && outputPath) console.log(`  2. Open output file, then re-run`);
    const skipNum = ok && outputPath ? 3 : 2;
    console.log(`  ${skipNum}. Skip and continue anyway`);
    const c = (await ask('  > ')).trim();
    if (ok && outputPath && c === '2') openFile(outputPath);
    if (c === String(skipNum)) return;
    // else: re-run
  }
}

function isDockerEnv() {
  return fs.existsSync('/.dockerenv') || process.env.DOCKER === '1';
}

async function waitForHttp(url, timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/** Run one step, streaming prefixed output. Resolves/rejects with captured stderr. */
function runStep_parallel(label, cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pfx = `  [${label}]`;
    let stderr = '';
    const writeLine = (stream, line) => { if (line) stream.write(`${pfx} ${line}\n`); };
    proc.stdout.on('data', d => d.toString().split('\n').forEach(l => writeLine(process.stdout, l)));
    proc.stderr.on('data', d => {
      const s = d.toString();
      stderr += s;
      s.split('\n').forEach(l => writeLine(process.stderr, l));
    });
    proc.on('close', code => {
      if (code === 0) { console.log(`${pfx} ✓ Done`); resolve(); }
      else {
        console.log(`${pfx} ✗ Failed`);
        console.log('');
        console.log('  ┌─────────────────────────────────────────────────────────┐');
        console.log(`  │  ${label.toUpperCase()} FAILED — OTHER STEPS ARE STILL RUNNING       │`.slice(0, 63) + '│');
        console.log('  │  Please wait. Do NOT close this window.                 │');
        console.log('  │  Recovery options will appear when all steps finish.    │');
        console.log('  └─────────────────────────────────────────────────────────┘');
        console.log('');
        const e = new Error(`${label} failed (exit ${code})`); e.stderr = stderr; reject(e);
      }
    });
    proc.on('error', e => { e.stderr = stderr; reject(new Error(`${label}: ${e.message}`)); });
  });
}

/** Run steps concurrently, streaming output. Returns {ok, error} per step. */
async function runParallel(steps) {
  const results = await Promise.allSettled(
    steps.map(({ label, cmd, args }) => runStep_parallel(label, cmd, args))
  );
  return steps.map(({ label }, i) => ({
    label,
    ok: results[i].status === 'fulfilled',
    error: results[i].reason ?? null,
  }));
}

// ── Progress helpers ──────────────────────────────────────────────────────────

function progressBar(pct, width = 24) {
  const filled = Math.round(pct / 100 * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function spinner(label) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let current = label;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]}  ${current}`);
  }, 80);
  return {
    update: (text) => { current = text; },
    stop: (finalMsg) => {
      clearInterval(interval);
      const padding = ' '.repeat(Math.max(0, current.length - finalMsg.length + 4));
      process.stdout.write(`\r  ${finalMsg}${padding}\n`);
    },
  };
}

async function copyFileWithProgress(src, dest, label) {
  const { size: total } = await fs.stat(src);
  const fmt = (bytes) => bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${(bytes / 1e6).toFixed(0)} MB`;

  process.stdout.write(`\r  ${label}  ${progressBar(0)} 0%  0 / ${fmt(total)}`);

  const copyPromise = fs.copy(src, dest, { overwrite: true });

  const interval = setInterval(async () => {
    const { size: current } = await fs.stat(dest).catch(() => ({ size: 0 }));
    const pct = Math.min(99, Math.round(current / total * 100));
    process.stdout.write(`\r  ${label}  ${progressBar(pct)} ${pct}%  ${fmt(current)} / ${fmt(total)}`);
  }, 300);

  await copyPromise;
  clearInterval(interval);
  process.stdout.write(`\r  ${label}  ${progressBar(100)} 100%  ${fmt(total)} / ${fmt(total)}\n`);
}

// ── File helpers ──────────────────────────────────────────────────────────────

function openFile(filePath) {
  const cmd = process.platform === 'win32' ? 'start ""'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    execSync(`${cmd} "${filePath}"`, { stdio: 'ignore', shell: true });
  } catch {
    console.log(`  (Open manually: ${filePath})`);
  }
}

async function findFileIn(dir, exts) {
  if (!await fs.pathExists(dir)) return null;
  const files = await fs.readdir(dir);
  const match = files.find(f => exts.includes(path.extname(f).toLowerCase()));
  return match ? path.join(dir, match) : null;
}

async function placeFiles(mode) {
  const videoExts = ['.mp4', '.mov', '.mkv'];
  const audioExts = ['.mp3', '.aac', '.wav', '.m4a'];
  const inputVideo = path.join(cwd, 'public', 'input', 'video');
  const inputAudio = path.join(cwd, 'public', 'input', 'audio');

  const needsVideo = mode !== 4;
  const needsAudio = mode !== 3;

  if (needsVideo) await fs.ensureDir(inputVideo);
  if (needsAudio) await fs.ensureDir(inputAudio);

  console.log('\n  ── Place your files ──────────────────────────────────');
  if (mode === 1 || mode === 2) {
    console.log('  Video file → public/input/video/   (.mp4 .mov .mkv)');
    console.log('  Audio file → public/input/audio/   (.mp3 .aac .wav .m4a)');
  } else if (mode === 3) {
    console.log('  Video file → public/input/video/   (.mp4 .mov .mkv)');
  } else {
    console.log('  Audio file → public/input/audio/   (.mp3 .aac .wav .m4a)');
  }
  await ask('  Press Enter when files are ready...');

  const videoFile = needsVideo ? await findFileIn(inputVideo, videoExts) : null;
  const audioFile = needsAudio ? await findFileIn(inputAudio, audioExts) : null;

  if (needsVideo && !videoFile) {
    console.error(`  ✗ No video file found in ${inputVideo}`); process.exit(1);
  }
  if (needsAudio && !audioFile) {
    console.error(`  ✗ No audio file found in ${inputAudio}`); process.exit(1);
  }

  return { videoFile, audioFile };
}

async function copyToSyncDirs(videoFile, audioFile) {
  const syncVideo = path.join(cwd, 'public', 'sync', 'video');
  const syncAudio = path.join(cwd, 'public', 'sync', 'audio');
  await fs.ensureDir(syncVideo);
  await fs.ensureDir(syncAudio);
  await copyFileWithProgress(videoFile, path.join(syncVideo, path.basename(videoFile)), 'Copying video...');
  await copyFileWithProgress(audioFile, path.join(syncAudio, path.basename(audioFile)), 'Copying audio...');
}

async function extractAudio(videoPath) {
  const outPath = path.join(cwd, 'public', 'transcribe', 'input', 'audio.wav');
  await fs.ensureDir(path.dirname(outPath));
  const spin = spinner('Extracting audio...');
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-y', outPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'], cwd });
    let err = '';
    let totalSecs = null;
    let buf = '';
    proc.stderr.on('data', d => {
      buf += d.toString();
      err += buf;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!totalSecs) {
          const m = line.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
          if (m) totalSecs = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
        }
        const tm = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
        if (tm && totalSecs) {
          const current = +tm[1] * 3600 + +tm[2] * 60 + +tm[3] + +tm[4] / 100;
          const pct = Math.min(99, Math.round(current / totalSecs * 100));
          spin.update(`Extracting audio...  ${progressBar(pct)} ${pct}%`);
        }
      }
    });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg failed:\n${err}`)));
    proc.on('error', e => reject(new Error(`ffmpeg not found — is ffmpeg installed? (${e.message})`)));
  });
  spin.stop(`✓ Extracted audio  ${progressBar(100)} 100%`);
  return outPath;
}

async function copyToTranscribeInput(filePath) {
  const dir = path.join(cwd, 'public', 'transcribe', 'input');
  await fs.ensureDir(dir);
  const dest = path.join(dir, path.basename(filePath));
  await copyFileWithProgress(filePath, dest, `Copying ${path.basename(filePath)}...`);
  return dest;
}

// ── Resume detection ──────────────────────────────────────────────────────────

async function detectExistingWork() {
  const p = (...parts) => path.join(cwd, ...parts);
  const [syncedVideo, rawTranscript, diarization, transcriptDoc, transcriptJson] = await Promise.all([
    fs.pathExists(p('public', 'sync', 'output', 'synced-output.mp4')),
    fs.pathExists(p('public', 'transcribe', 'output', 'raw', 'transcript.raw.json')),
    fs.pathExists(p('public', 'transcribe', 'output', 'raw', 'diarization.json')),
    fs.pathExists(p('public', 'transcribe', 'output', 'edit', 'transcript.doc.txt')),
    fs.pathExists(p('public', 'transcribe', 'output', 'edit', 'transcript.json')),
  ]);

  let alignedTranscript = false;
  if (rawTranscript) {
    try {
      const rawJson = await fs.readJson(p('public', 'transcribe', 'output', 'raw', 'transcript.raw.json'));
      alignedTranscript = !!rawJson?.meta?.alignment?.provider;
    } catch {
      alignedTranscript = false;
    }
  }

  const inputDir = p('public', 'transcribe', 'input');
  const audioInInput = !!(await findFileIn(inputDir, ['.wav', '.mp3', '.aac', '.m4a']));
  const videoInInputPath = await findFileIn(inputDir, ['.mp4', '.mov', '.mkv']);
  const videoInInput = !!videoInInputPath;
  return {
    syncedVideo,
    rawTranscript,
    alignedTranscript,
    diarization,
    transcriptDoc,
    transcriptJson,
    audioInInput,
    videoInInput,
    videoInInputPath,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  DeckCreate — Video Editor');
  console.log('  ─────────────────────────\n');

  // ── Detect existing work ───────────────────────────────────────────────────
  const existing = await detectExistingWork();

  //  resumeStep: 0=fresh  1=audio ready  2=transcribed  3=doc generated  4=edits applied
  let resumeStep = 0;
  if (existing.audioInInput)   resumeStep = 1;
  if (existing.rawTranscript)  resumeStep = 2;
  if (existing.transcriptDoc)  resumeStep = 3;
  if (existing.transcriptJson) resumeStep = 4;

  if (resumeStep > 0) {
    console.log('  Found existing work from a previous session:');
    if (existing.transcriptJson) console.log('    ✓ Edits applied        — transcript.json');
    if (existing.transcriptDoc)  console.log('    ✓ Doc generated        — transcript.doc.txt');
    if (existing.alignedTranscript) console.log('    ✓ Forced alignment     — transcript.raw.json timings');
    if (existing.rawTranscript)  console.log('    ✓ Transcription done   — transcript.raw.json');
    if (existing.diarization)    console.log('    ✓ Diarization done     — diarization.json');
    if (existing.audioInInput)   console.log('    ✓ Audio ready          — transcribe/input/');
    if (existing.syncedVideo)    console.log('    ✓ Sync done            — synced-output.mp4');

    const labels = ['', 'Transcription', 'Build transcript doc', 'Edit & apply doc', 'Camera / preview / render'];
    console.log(`\n  Next step: ${labels[resumeStep]}`);

    const resume = await confirm('  Resume from here?');
    if (!resume) resumeStep = 0;
  }

  // ── Mode and speaker setup ─────────────────────────────────────────────────
  let mode, numSpeakers, multiSpeaker;

  if (resumeStep === 0) {
    // Fresh start — ask everything
    console.log('\n  What are you working with?');
    console.log('  1. Separate video + audio files (need sync)');
    console.log('  2. Separate video + audio files (already in sync)');
    console.log('  3. Single video file (audio already combined)');
    console.log('  4. Audio file only (transcription only)');
    const modeStr = (await ask('  > ')).trim();
    mode = [1, 2, 3, 4].includes(parseInt(modeStr)) ? parseInt(modeStr) : 3;

    console.log('\n  How many speakers are in this recording?');
    console.log('  (Enter 1 if solo or unknown)');
    numSpeakers = Math.max(1, parseInt((await ask('  > ')).trim()) || 1);
    multiSpeaker = numSpeakers > 1;
  } else {
    // Resuming — infer from existing files
    // Prefer any available video source (transcribe/input or sync/output)
    // so downstream video-dependent steps (camera/remotion) remain enabled.
    if (existing.videoInInput) mode = 3;
    else if (existing.syncedVideo) mode = 1;
    else mode = 4;
    multiSpeaker = existing.diarization;
    numSpeakers = multiSpeaker ? 2 : 1; // exact count only matters for a fresh diarize run

    if (resumeStep < 2 && !existing.diarization) {
      // Still need to transcribe/diarize — ask speaker count
      console.log('\n  How many speakers are in this recording?');
      console.log('  (Enter 1 if solo or unknown)');
      numSpeakers = Math.max(1, parseInt((await ask('  > ')).trim()) || 1);
      multiSpeaker = numSpeakers > 1;
    }
  }

  // ── File placement (fresh start only) ─────────────────────────────────────
  let videoFile = null, audioFile = null;
  if (resumeStep === 0) {
    ({ videoFile, audioFile } = await placeFiles(mode));
  }

  // ── Determine video src for Remotion (relative to public/) ────────────────
  let videoSrcForRemotion = null;
  if (mode === 1) {
    videoSrcForRemotion = 'sync/output/synced-output.mp4';
  } else if (mode === 2 || mode === 3) {
    const vf = videoFile || existing.videoInInputPath;
    if (vf) videoSrcForRemotion = `transcribe/input/${path.basename(vf)}`;
  }

  // ── STEP: Sync (mode 1 only) ───────────────────────────────────────────────
  let videoForExtract = videoFile;

  if (resumeStep === 0 && mode === 1) {
    console.log('\n  ── Sync audio and video ─────────────────────────────');
    await copyToSyncDirs(videoFile, audioFile);
    await runStep(
      'npm run sync',
      'npm', ['run', 'sync'],
      path.join(cwd, 'public', 'sync', 'output', 'synced-output.mp4'),
    );
    videoForExtract = path.join(cwd, 'public', 'sync', 'output', 'synced-output.mp4');
  }

  // ── STEP: Prepare audio ───────────────────────────────────────────────────
  if (resumeStep === 0) {
    console.log('\n  ── Prepare audio for transcription ──────────────────');
    if (mode === 1 || mode === 3) {
      if (mode === 3) await copyToTranscribeInput(videoFile);
      await extractAudio(videoForExtract);
    } else if (mode === 2) {
      await copyToTranscribeInput(videoFile);
      await copyToTranscribeInput(audioFile);
    } else {
      await copyToTranscribeInput(audioFile);
    }
  }

  // ── STEP: Choose Whisper model ────────────────────────────────────────────
  const rawTranscriptPath = path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'transcript.raw.json');
  const diarizationPath   = path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'diarization.json');
  const docPath           = path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.doc.txt');
  const transcriptPath    = path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.json');

  let whisperModel = 'medium.en';
  if (resumeStep < 2) {
    console.log('\n  ── Whisper model ─────────────────────────────────────');
    console.log('  Choose a transcription model (for a ~36 min recording on CPU):\n');
    console.log('  1. tiny.en    ~5 min       Lower accuracy');
    console.log('  2. small.en   ~20–30 min   Good accuracy  (best speed/accuracy balance)');
    console.log('  3. medium.en  ~60–120 min  High accuracy  (default)');
    console.log('  4. large-v3   ~3–4 hrs     Highest accuracy\n');
    console.log('  The model is downloaded automatically on first use.');
    const modelChoice = (await ask('  > [3] ')).trim() || '3';
    const modelMap = { '1': 'tiny.en', '2': 'small.en', '3': 'medium.en', '4': 'large-v3' };
    whisperModel = modelMap[modelChoice] ?? 'medium.en';
    console.log(`  ✓ Using ${whisperModel}`);
  }
  const transcribeArgs = ['run', 'transcribe', '--', '--model', whisperModel];

  // ── STEP: Transcribe (+ diarize in parallel if multi-speaker) ─────────────
  if (resumeStep < 2 && multiSpeaker) {
    const diarizationAlreadyDone = existing.diarization;

    if (diarizationAlreadyDone) {
      // Diarization already complete — run transcription only
      console.log('\n  ── Transcribe ────────────────────────────────────────');
      console.log('  (Diarization already complete — skipping)');
      await runStep('npm run transcribe', 'npm', transcribeArgs, rawTranscriptPath);
    } else {
      console.log('\n  ── Transcribe + Diarize (parallel) ──────────────────');

    // ── Run transcription + diarization ───────────────────────────────────
    let diarizeArgs = ['run', 'diarize', '--', '--num-speakers', String(numSpeakers)];

    let results = await runParallel([
      { label: 'transcribe', cmd: 'npm', args: transcribeArgs },
      { label: 'diarize',    cmd: 'npm', args: diarizeArgs },
    ]);

    const transcribeResult = results.find(r => r.label === 'transcribe');
    let diarizeResult      = results.find(r => r.label === 'diarize');

    // ── Handle transcription failure ──────────────────────────────────────
    if (!transcribeResult.ok) {
      console.error(`\n  ✗ Transcription failed: ${transcribeResult.error.message}`);
      const retry = await confirm('  Retry transcription?');
      if (retry) {
        await runStep('npm run transcribe', 'npm', transcribeArgs, rawTranscriptPath);
      }
    }

    // ── Handle diarization failure — with Python venv recovery ────────────
    while (!diarizeResult.ok) {
      const errText = (diarizeResult.error?.stderr ?? '') + (diarizeResult.error?.message ?? '');
      const isPythonNotFound  = /python not found|command missing|ENOENT/i.test(errText);
      const isPythonWrongVersion = /not supported|3\.\d+.*required|requires python/i.test(errText);

      if (isPythonNotFound) {
        console.log('\n  ✗ Python was not found on this machine.');
        console.log('  Diarization requires Python 3.9–3.12.\n');
        console.log('  1. Download and install Python 3.12 from https://www.python.org/downloads/');
        console.log('     During install, check "Add python.exe to PATH".');
        console.log('     Or if you already have a Python 3.12 install, make sure py launcher is available.\n');
        console.log('  2. Once installed, open a NEW terminal and run:\n');
        console.log('       py -3.12 -m venv .venv');
        console.log('       .venv\\Scripts\\activate');
        console.log('       pip install -r scripts/diarize/requirements.txt\n');
        await ask('  Press Enter here when pip install has finished...');
        console.log('');
        console.log('  Enter the path to the Python executable inside the venv.');
        console.log('  If you used the commands above, the path is:');
        console.log('    .venv\\Scripts\\python.exe  (press Enter to use this default)\n');
        const pythonPath = (await ask('  Python path [.venv\\Scripts\\python.exe]: ')).trim()
          || '.venv\\Scripts\\python.exe';
        diarizeArgs = ['run', 'diarize', '--', '--num-speakers', String(numSpeakers), '--python', pythonPath];
      } else if (isPythonWrongVersion) {
        console.log('\n  ✗ Diarization requires Python 3.9–3.12 (your default Python is too new).');
        console.log('  Open a NEW terminal window and run:\n');
        console.log('    py -3.12 -m venv .venv');
        console.log('    .venv\\Scripts\\activate');
        console.log('    pip install -r scripts/diarize/requirements.txt\n');
        console.log('  If py -3.12 is not found, install Python 3.12 from https://www.python.org/downloads/\n');
        await ask('  Press Enter here when pip install has finished...');
        console.log('');
        console.log('  Enter the path to the Python executable inside the venv.');
        console.log('  If you used the commands above, the path is:');
        console.log('    .venv\\Scripts\\python.exe  (press Enter to use this default)\n');
        const pythonPath = (await ask('  Python path [.venv\\Scripts\\python.exe]: ')).trim()
          || '.venv\\Scripts\\python.exe';
        diarizeArgs = ['run', 'diarize', '--', '--num-speakers', String(numSpeakers), '--python', pythonPath];
      } else {
        console.error(`\n  ✗ Diarization failed: ${diarizeResult.error.message}`);
        const retry = await confirm('  Retry diarization?');
        if (!retry) break;
      }

      console.log('\n  → Re-running diarization...');
      const [retryResult] = await runParallel([
        { label: 'diarize', cmd: 'npm', args: diarizeArgs },
      ]);
      diarizeResult = retryResult;
    }

    if (diarizeResult.ok) {
      console.log(`\n  Output: ${rawTranscriptPath}`);
      console.log(`          ${diarizationPath}`);
    }

    const happy = await confirm('\n  Happy with the result?');
    if (!happy) {
      console.log('  Re-run wizard from the transcription step when ready.\n');
    }
    } // end else (diarization not already done)
  } else if (resumeStep < 2) {
    console.log('\n  ── Transcribe ────────────────────────────────────────');
    await runStep('npm run transcribe', 'npm', transcribeArgs, rawTranscriptPath);
  }

  // ── STEP: Forced alignment (after transcribe, before assignment/editing) ──
  const shouldRunAlignment = resumeStep < 3 && !(resumeStep >= 2 && existing.alignedTranscript);
  if (shouldRunAlignment) {
    console.log('\n  ── Forced alignment (WhisperX, CPU-local) ────────────');
    let alignArgs = ['run', 'align'];
    let alignOk = false;

    while (!alignOk) {
      try {
        await spawnStep('npm', alignArgs);
        console.log(`  ✓ Done — ${rawTranscriptPath}`);
        alignOk = true;
        break;
      } catch (err) {
        const errText = err.message || '';
        const isPythonNotFound = /python not found|command missing|ENOENT|WindowsApps\\python|permission denied/i.test(errText);
        const isPythonWrongVersion = /requires python 3\.9-3\.12|requires python 3\.9–3\.12|python 3\.(1[3-9]|[2-9][0-9])/i.test(errText);
        const isWhisperxMissing = /WhisperX is not installed|No module named ['"]whisperx['"]|could not import whisperx/i.test(errText);

        if (isPythonNotFound || isPythonWrongVersion || isWhisperxMissing) {
          console.log('\n  ✗ Forced alignment could not run with the current Python interpreter.');
          console.log('  Use a Python 3.12 virtual environment for alignment.\n');
          console.log('  1. Create and activate a venv (if not done already):\n');
          console.log('       py -3.12 -m venv .venv');
          console.log('       .venv\\Scripts\\activate');
          console.log('       python -m pip install --upgrade pip setuptools wheel');
          console.log('       python -m pip install whisperx faster-whisper\n');
          console.log('  2. Enter the Python path from that venv.');
          console.log('     If you used the commands above, it is:');
          console.log('       .venv\\Scripts\\python.exe  (press Enter to use this default)\n');

          const pythonPath = (await ask('  Python path [.venv\\Scripts\\python.exe]: ')).trim()
            || '.venv\\Scripts\\python.exe';
          alignArgs = ['run', 'align', '--', '--python', pythonPath];

          console.log('\n  → Re-running alignment...');
          continue;
        }

        console.error(`\n  ✗ Forced alignment failed: ${err.message}`);
        const retry = await confirm('  Retry alignment?');
        if (!retry) break;
      }
    }

    if (!alignOk) {
      console.log('  Continuing without forced alignment. You can run it later with:');
      console.log('    npm run align -- --python .venv\\Scripts\\python.exe');
    }
  } else if (resumeStep >= 2 && existing.alignedTranscript) {
    console.log('\n  ── Forced alignment ───────────────────────────────────');
    console.log('  (Already applied — skipping)');
  }

  // ── STEP: Caption alignment test (optional) ──────────────────────────────
  let timestampOffset = 0;
  console.log('');
  const doAlignTest = await confirm('  Check caption alignment? (recommended for first recording)', false);
  if (doAlignTest) {
    console.log('\n  ── Caption alignment test ────────────────────────────');
    console.log('  Starting local server for caption_test.html...\n');

    const serveProc = spawn('npx', ['serve', 'public/transcribe', '--listen', 'tcp://0.0.0.0:3001', '--no-clipboard'], {
      cwd,
      shell: process.platform === 'win32',
      detached: true,
      stdio: 'ignore',
    });
    serveProc.unref();
    await new Promise(r => setTimeout(r, 2000));

    openFile('http://localhost:3001/caption_test.html');
    console.log('  → Opened http://localhost:3001/caption_test.html in your browser');
    console.log('  Follow the on-screen instructions:');
    console.log('    1. Scrub audio to exactly when a word starts speaking');
    console.log('    2. Note the time shown in green');
    console.log('    3. Enter the word and time in the form');
    console.log('    4. Repeat with a second word 5+ min later');
    console.log('    5. The page calculates the offset and shows the fix command\n');

    await ask('  Press Enter when done with the alignment test...');

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(serveProc.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
      } else {
        process.kill(serveProc.pid, 'SIGTERM');
      }
    } catch { /* ignore */ }

    const hasOffset = await confirm('  Did you find a timestamp offset?', false);
    if (hasOffset) {
      const offsetStr = (await ask('  Enter offset in seconds (e.g. 0.5): ')).trim();
      timestampOffset = parseFloat(offsetStr) || 0;
      if (timestampOffset > 0) {
        console.log(`  ✓ Will apply --timestamp-offset ${timestampOffset} to edit-transcript`);
      }
    }
  }

  // ── STEP: Assign speakers (multi-speaker only) ────────────────────────────
  if (resumeStep < 3 && multiSpeaker) {
    let speakersOk = false;
    while (!speakersOk) {
      console.log('\n  ── Assign speakers ───────────────────────────────────');
      const extraFlags = [
        ...(timestampOffset > 0 ? ['--timestamp-offset', String(timestampOffset)] : []),
        ...(videoSrcForRemotion ? ['--video-src', videoSrcForRemotion] : []),
      ];
      const offsetArgs = extraFlags.length > 0 ? ['--', ...extraFlags] : [];
      try {
        await spawnStep('npm', ['run', 'assign-speakers']);
        await spawnStep('npm', ['run', 'edit-transcript', ...offsetArgs]);
      } catch (err) {
        console.error(`  ✗ ${err.message}`);
        const retry = await confirm('  Retry?');
        if (!retry) break;
        continue;
      }

      console.log(`  ✓ Done — ${docPath}`);
      console.log('\n  Open transcript.doc.txt and rename speakers in the SPEAKERS section at the top.');
      console.log(`  File: ${docPath}\n`);
      openFile(docPath);
      await ask('  Press Enter when done renaming speakers...');

      console.log('  Applying speaker names...');
      try {
        await spawnStep('npm', ['run', 'merge-doc', ...offsetArgs]);
        // Regenerate doc with real speaker names in segment lines
        await spawnStep('npm', ['run', 'edit-transcript', ...offsetArgs]);
        console.log('  ✓ Speaker names applied');
      } catch (err) {
        console.error(`  ✗ ${err.message}`);
      }

      speakersOk = await confirm('\n  Happy with the speaker assignments?');
    }
  } else if (resumeStep < 3) {
    // Single speaker: just generate the doc
    const singleExtraFlags = [
      ...(timestampOffset > 0 ? ['--timestamp-offset', String(timestampOffset)] : []),
      ...(videoSrcForRemotion ? ['--video-src', videoSrcForRemotion] : []),
    ];
    const offsetArgs = singleExtraFlags.length > 0 ? ['--', ...singleExtraFlags] : [];
    console.log('\n  ── Build editable transcript ─────────────────────────');
    await runStep('npm run edit-transcript', 'npm', ['run', 'edit-transcript', ...offsetArgs], docPath);
  }

  // ── STEP: Edit transcript ─────────────────────────────────────────────────
  if (resumeStep < 4) {
    console.log('\n  ── Edit transcript ───────────────────────────────────');
    console.log(`  Open and edit: ${docPath}`);
    console.log('  (See instructions at the top — cut words, fix text, mark segments CUT.)');
    openFile(docPath);
    await ask('  Press Enter when done editing...');

    const mergeExtraFlags = [
      ...(timestampOffset > 0 ? ['--timestamp-offset', String(timestampOffset)] : []),
      ...(videoSrcForRemotion ? ['--video-src', videoSrcForRemotion] : []),
    ];
    const mergeOffsetArgs = mergeExtraFlags.length > 0 ? ['--', ...mergeExtraFlags] : [];
    const cutPauses = await confirm('  Auto-cut silences longer than 0.5 s?', false);
    if (cutPauses) {
      await runStep(
        'npm run merge-doc:cut-pauses',
        'npm', ['run', 'merge-doc:cut-pauses', ...mergeOffsetArgs],
        transcriptPath,
      );
    } else {
      await runStep(
        'npm run merge-doc',
        'npm', ['run', 'merge-doc', ...mergeOffsetArgs],
        transcriptPath,
      );
    }
  }

  // ── STEP: Camera setup (optional — skip for audio-only) ───────────────────
  if (mode !== 4) {
    console.log('');
    const doCamera = await confirm('  Set up speaker closeup cuts? (camera)', false);
    if (doCamera) {
      console.log('\n  ── Camera setup ──────────────────────────────────────');
      console.log('  Detecting faces in video frame...');
      try {
        await spawnStep('node', ['scripts/camera/setup-camera.js', '--detect-only']);
      } catch (err) {
        console.warn(`  ⚠ Face detection failed: ${err.message}`);
        console.log('  You can draw boxes manually in the GUI.');
      }

      // Spawn dev server and capture logs so startup failures are visible.
      let devLog = '';
      let devExitedCode = null;
      const devServer = spawn('npm', ['run', 'dev', '--', '--hostname', '0.0.0.0', '--port', '3000'], {
        cwd,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const appendDevLog = (chunk) => {
        devLog += chunk.toString();
        if (devLog.length > 6000) devLog = devLog.slice(-6000);
      };
      devServer.stdout.on('data', appendDevLog);
      devServer.stderr.on('data', appendDevLog);
      devServer.on('close', code => { devExitedCode = code; });

      const cameraUrl = 'http://127.0.0.1:3000/camera';
      const serverReady = await waitForHttp(cameraUrl, 90000, 700);

      console.log('\n  → Open http://localhost:3000/camera in your browser');
      if (isDockerEnv()) {
        console.log('  (Docker) Ensure you started wizard with: docker-compose run --rm --service-ports wizard');
      }
      if (!serverReady) {
        if (devExitedCode !== null) {
          console.log(`  ✗ Next.js dev server exited early (code ${devExitedCode}).`);
          if (devLog.trim()) {
            console.log('  Last server log lines:');
            console.log('  ─────────────────────────────────────────────────────');
            console.log(devLog.split('\n').slice(-12).map(l => `  ${l}`).join('\n'));
            console.log('  ─────────────────────────────────────────────────────');
          }
        } else {
          console.log('  ⚠ Server is running but /camera is still unreachable.');
          console.log('  If it does not load, confirm port 3000 is free and retry with --service-ports.');
        }
      }
      console.log('  Assign faces to speakers, then click Save profiles.\n');
      await ask('  Press Enter when done saving...');

      // Best-effort kill
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(devServer.pid), '/f', '/t'], {
            shell: true, stdio: 'ignore',
          });
        } else {
          process.kill(devServer.pid, 'SIGTERM');
        }
      } catch {
        console.log('  (Stop the dev server manually if it is still running)');
      }

      const profilePath = path.join(cwd, 'public', 'transcribe', 'output', 'camera', 'camera-profiles.json');
      if (await fs.pathExists(profilePath)) {
        console.log(`  ✓ camera-profiles.json saved`);
      } else {
        console.log('  ⚠ camera-profiles.json not found — camera cuts will not be applied in Remotion');
      }
    }
  }

  // ── STEP: Cut preview (optional — skip for audio-only) ───────────────────
  if (mode !== 4) {
    console.log('');
    const doPreview = await confirm('  Generate flat MP4 preview?', false);
    if (doPreview) {
      const previewPath = path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'preview-cut.mp4');
      await runStep('npm run cut-preview', 'npm', ['run', 'cut-preview'], previewPath);
    }
  }

  // ── STEP: Remotion (optional — skip for audio-only) ──────────────────────
  if (mode !== 4) {
    console.log('');
    const doRemotion = await confirm('  Launch Remotion studio?', false);
    if (doRemotion) {
      console.log('\n  Starting Remotion...\n');
      await spawnStep('npm', ['run', 'remotion']);
    }
  }

  console.log('\n  ✓ All done!\n');
  rl.close();
}

main().catch(err => {
  console.error('\n✗ Wizard error:', err.message);
  rl.close();
  process.exit(1);
});
