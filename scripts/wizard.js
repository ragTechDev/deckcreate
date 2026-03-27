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

/** Run two steps concurrently, streaming output with prefixed labels. */
function runParallel(steps) {
  return Promise.all(steps.map(({ label, cmd, args }) =>
    new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const pfx = `  [${label}]`;
      const writeLine = (stream, line) => { if (line) stream.write(`${pfx} ${line}\n`); };
      proc.stdout.on('data', d => d.toString().split('\n').forEach(l => writeLine(process.stdout, l)));
      proc.stderr.on('data', d => d.toString().split('\n').forEach(l => writeLine(process.stderr, l)));
      proc.on('close', code => {
        if (code === 0) { console.log(`${pfx} ✓ Done`); resolve(); }
        else reject(new Error(`${label} failed (exit ${code})`));
      });
      proc.on('error', e => reject(new Error(`${label}: ${e.message}`)));
    })
  ));
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

  if (mode !== 3) await fs.ensureDir(inputVideo);
  if (mode !== 2) await fs.ensureDir(inputAudio);

  console.log('\n  ── Place your files ──────────────────────────────────');
  if (mode === 1) {
    console.log('  Video file → public/input/video/   (.mp4 .mov .mkv)');
    console.log('  Audio file → public/input/audio/   (.mp3 .aac .wav .m4a)');
  } else if (mode === 2) {
    console.log('  Video file → public/input/video/   (.mp4 .mov .mkv)');
  } else {
    console.log('  Audio file → public/input/audio/   (.mp3 .aac .wav .m4a)');
  }
  await ask('  Press Enter when files are ready...');

  const videoFile = mode !== 3 ? await findFileIn(inputVideo, videoExts) : null;
  const audioFile = mode !== 2 ? await findFileIn(inputAudio, audioExts) : null;

  if (mode !== 3 && !videoFile) {
    console.error(`  ✗ No video file found in ${inputVideo}`); process.exit(1);
  }
  if (mode !== 2 && !audioFile) {
    console.error(`  ✗ No audio file found in ${inputAudio}`); process.exit(1);
  }

  return { videoFile, audioFile };
}

async function copyToSyncDirs(videoFile, audioFile) {
  const syncVideo = path.join(cwd, 'public', 'sync', 'video');
  const syncAudio = path.join(cwd, 'public', 'sync', 'audio');
  await fs.ensureDir(syncVideo);
  await fs.ensureDir(syncAudio);
  console.log('  Copying files to sync directories...');
  await fs.copy(videoFile, path.join(syncVideo, path.basename(videoFile)), { overwrite: true });
  await fs.copy(audioFile, path.join(syncAudio, path.basename(audioFile)), { overwrite: true });
}

async function extractAudio(videoPath) {
  const outPath = path.join(cwd, 'public', 'transcribe', 'input', 'audio.wav');
  await fs.ensureDir(path.dirname(outPath));
  console.log('  Extracting audio with ffmpeg...');
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-y', outPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'], cwd });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg failed:\n${err}`)));
    proc.on('error', e => reject(new Error(`ffmpeg not found — is ffmpeg installed? (${e.message})`)));
  });
  return outPath;
}

async function copyToTranscribeInput(filePath) {
  const dir = path.join(cwd, 'public', 'transcribe', 'input');
  await fs.ensureDir(dir);
  const dest = path.join(dir, path.basename(filePath));
  await fs.copy(filePath, dest, { overwrite: true });
  return dest;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  DeckCreate — Video Editor');
  console.log('  ─────────────────────────\n');

  // Mode selection
  console.log('  What are you working with?');
  console.log('  1. Separate video + audio files (need sync)');
  console.log('  2. Single video file (already combined)');
  console.log('  3. Audio file only (transcription only)');
  const modeStr = (await ask('  > ')).trim();
  const mode = [1, 2, 3].includes(parseInt(modeStr)) ? parseInt(modeStr) : 2;

  // Speaker count
  console.log('\n  How many speakers are in this recording?');
  console.log('  (Enter 1 if solo or unknown)');
  const numSpeakers = Math.max(1, parseInt((await ask('  > ')).trim()) || 1);
  const multiSpeaker = numSpeakers > 1;

  // File placement
  const { videoFile, audioFile } = await placeFiles(mode);

  // ── STEP: Sync (mode 1 only) ───────────────────────────────────────────────
  let videoForExtract = videoFile;

  if (mode === 1) {
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
  console.log('\n  ── Prepare audio for transcription ──────────────────');
  if (mode === 1 || mode === 2) {
    // Copy video to transcribe/input so remotion/camera can find it
    if (mode === 2) await copyToTranscribeInput(videoFile);
    const audioWav = await extractAudio(videoForExtract);
    console.log(`  ✓ Done — ${audioWav}`);
  } else {
    // Audio-only: copy as-is
    const dest = await copyToTranscribeInput(audioFile);
    console.log(`  ✓ Done — ${dest}`);
  }

  // ── STEP: Transcribe (+ diarize in parallel if multi-speaker) ─────────────
  const rawTranscriptPath = path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'transcript.raw.json');
  const diarizationPath   = path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'diarization.json');
  const docPath           = path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.doc.txt');
  const transcriptPath    = path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.json');

  if (multiSpeaker) {
    console.log('\n  ── Transcribe + Diarize (parallel) ──────────────────');
    let transcribeOk = false;
    while (!transcribeOk) {
      try {
        await runParallel([
          { label: 'transcribe', cmd: 'npm', args: ['run', 'transcribe'] },
          { label: 'diarize',    cmd: 'npm', args: ['run', 'diarize', '--', '--num-speakers', String(numSpeakers)] },
        ]);
        console.log(`\n  Output: ${rawTranscriptPath}`);
        console.log(`          ${diarizationPath}`);
        transcribeOk = true;
      } catch (err) {
        console.error(`\n  ✗ ${err.message}`);
        const retry = await confirm('  Retry?');
        if (!retry) { transcribeOk = true; } // skip and continue
      }
      if (transcribeOk) {
        const happy = await confirm('  Happy with the result?');
        if (!happy) transcribeOk = false;
      }
    }
  } else {
    console.log('\n  ── Transcribe ────────────────────────────────────────');
    await runStep('npm run transcribe', 'npm', ['run', 'transcribe'], rawTranscriptPath);
  }

  // ── STEP: Assign speakers (multi-speaker only) ────────────────────────────
  if (multiSpeaker) {
    let speakersOk = false;
    while (!speakersOk) {
      console.log('\n  ── Assign speakers ───────────────────────────────────');
      try {
        await spawnStep('npm', ['run', 'assign-speakers']);
        await spawnStep('npm', ['run', 'edit-transcript']);
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
        await spawnStep('npm', ['run', 'merge-doc']);
        // Regenerate doc with real speaker names in segment lines
        await spawnStep('npm', ['run', 'edit-transcript']);
        console.log('  ✓ Speaker names applied');
      } catch (err) {
        console.error(`  ✗ ${err.message}`);
      }

      speakersOk = await confirm('\n  Happy with the speaker assignments?');
    }
  } else {
    // Single speaker: just generate the doc
    console.log('\n  ── Build editable transcript ─────────────────────────');
    await runStep('npm run edit-transcript', 'npm', ['run', 'edit-transcript'], docPath);
  }

  // ── STEP: Edit transcript ─────────────────────────────────────────────────
  console.log('\n  ── Edit transcript ───────────────────────────────────');
  console.log(`  Open and edit: ${docPath}`);
  console.log('  (See instructions at the top — cut words, fix text, mark segments CUT.)');
  openFile(docPath);
  await ask('  Press Enter when done editing...');

  const cutPauses = await confirm('  Auto-cut silences longer than 0.5 s?', false);
  if (cutPauses) {
    await runStep(
      'npm run merge-doc:cut-pauses',
      'npm', ['run', 'merge-doc:cut-pauses'],
      transcriptPath,
    );
  } else {
    await runStep(
      'npm run merge-doc',
      'npm', ['run', 'merge-doc'],
      transcriptPath,
    );
  }

  // ── STEP: Camera setup (optional — skip for audio-only) ───────────────────
  if (mode !== 3) {
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

      // Spawn dev server detached so we can still read stdin
      const devServer = spawn('npm', ['run', 'dev'], {
        cwd,
        shell: process.platform === 'win32',
        detached: true,
        stdio: 'ignore',
      });
      devServer.unref();

      // Give the server a moment to start
      await new Promise(r => setTimeout(r, 3000));

      console.log('\n  → Open http://localhost:3000/camera in your browser');
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
  if (mode !== 3) {
    console.log('');
    const doPreview = await confirm('  Generate flat MP4 preview?', false);
    if (doPreview) {
      const previewPath = path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'preview-cut.mp4');
      await runStep('npm run cut-preview', 'npm', ['run', 'cut-preview'], previewPath);
    }
  }

  // ── STEP: Remotion (optional — skip for audio-only) ──────────────────────
  if (mode !== 3) {
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
