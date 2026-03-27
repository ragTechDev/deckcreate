#!/usr/bin/env node
/**
 * Camera setup orchestrator.
 *
 * 1. Reads transcript.json → gets meta.videoStart timestamp
 * 2. Extracts a single frame from the video at that timestamp (FFmpeg)
 * 3. Runs detect-faces.py (MediaPipe) → writes detections.json
 * 4. Spawns `npm run dev` and prints the camera GUI URL
 *
 * Usage:
 *   node scripts/camera/setup-camera.js [--video <path>] [--python <bin>] [--transcript <path>] [--skip-detect]
 *
 *   --skip-detect  Skip face detection entirely. Opens the GUI with a blank canvas
 *                  so you can draw boxes manually.
 */

import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--video'       && args[i + 1]) result.videoPath      = args[++i];
    if (args[i] === '--python'      && args[i + 1]) result.pythonBin      = args[++i];
    if (args[i] === '--transcript'  && args[i + 1]) result.transcriptPath = args[++i];
    if (args[i] === '--skip-detect')                result.skipDetect     = true;
    if (args[i] === '--detect-only')                result.detectOnly     = true;
  }
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function findVideo() {
  const candidates = [
    path.join(cwd, 'public', 'sync', 'output', 'synced-output.mp4'),
  ];
  for (const p of candidates) {
    if (await fs.pathExists(p)) return p;
  }

  // Auto-detect in transcribe/input
  const inputDir = path.join(cwd, 'public', 'transcribe', 'input');
  if (await fs.pathExists(inputDir)) {
    const files = await fs.readdir(inputDir);
    const match = files.find(f => ['.mp4', '.mov', '.mkv'].includes(path.extname(f).toLowerCase()));
    if (match) return path.join(inputDir, match);
  }

  return null;
}

function extractFrame(videoPath, timestamp, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-ss', String(timestamp),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      '-y', outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`ffmpeg failed:\n${err}`));
      else resolve();
    });
    proc.on('error', e => reject(new Error(`ffmpeg not found: ${e.message}`)));
  });
}

function runDetectFaces(pythonBin, framePath, numSpeakers) {
  const scriptPath = path.join(__dirname, 'detect-faces.py');
  const pyArgs = [scriptPath, framePath];
  if (numSpeakers) pyArgs.push('--num-speakers', String(numSpeakers));
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, pyArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { process.stderr.write(d); });

    proc.on('close', code => {
      try {
        const result = JSON.parse(stdout);
        if (result?.error) { reject(new Error(result.error)); return; }
        if (code !== 0) { reject(new Error(`detect-faces.py exited with code ${code}`)); return; }
        resolve(result);
      } catch {
        if (code !== 0) {
          reject(new Error(`detect-faces.py exited with code ${code}: ${stdout}`));
        } else {
          reject(new Error(`Failed to parse detect-faces.py output: ${stdout}`));
        }
      }
    });

    proc.on('error', e => {
      if (e.code === 'ENOENT') {
        reject(new Error(
          `Python not found ("${pythonBin}" command missing). ` +
          'Install Python or pass --python <path>.'
        ));
      } else {
        reject(new Error(`Failed to spawn Python: ${e.message}`));
      }
    });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const pythonBin = args.pythonBin || 'python';

  const transcriptPath = args.transcriptPath
    || path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.json');

  const outputDir  = path.join(cwd, 'public', 'transcribe', 'output', 'camera');
  const framePath  = path.join(outputDir, 'frame.jpg');
  const detectPath = path.join(outputDir, 'detections.json');

  console.log('\nCamera Setup');
  console.log('============\n');

  // 1. Find video
  const videoPath = args.videoPath || await findVideo();
  if (!videoPath) {
    console.error('❌ No video found. Use --video <path> or place a file in public/sync/output/ or public/transcribe/input/');
    process.exit(1);
  }
  console.log(`Video:      ${videoPath}`);

  // 2. Read transcript for videoStart + speaker count
  let videoStart = 0;
  let numSpeakers = null;
  if (await fs.pathExists(transcriptPath)) {
    const transcript = await fs.readJson(transcriptPath);
    videoStart = transcript.meta?.videoStart ?? 0;
    const speakerSet = new Set(
      (transcript.segments || []).map(s => s.speaker).filter(Boolean)
    );
    numSpeakers = speakerSet.size || null;
    console.log(`Transcript: ${transcriptPath}`);
    console.log(`Frame at:   ${videoStart}s (transcript.meta.videoStart)`);
    if (numSpeakers) console.log(`Speakers:   ${numSpeakers} (enforcing on face detection)`);
  } else {
    console.warn(`  ⚠ Transcript not found, using t=0s\n  (${transcriptPath})`);
  }

  // 3. Extract frame
  await fs.ensureDir(outputDir);
  console.log(`\nExtracting frame...`);
  await extractFrame(videoPath, videoStart, framePath);
  console.log(`  Saved: ${framePath}`);

  // 4. Detect faces (or skip for manual mode)
  if (args.skipDetect) {
    console.log('\nSkipping face detection (--skip-detect). Draw boxes manually in the GUI.');
    await fs.writeJson(detectPath, [], { spaces: 2 });
  } else {
    console.log('\nDetecting faces (mediapipe models download on first run)...');
    const faces = await runDetectFaces(pythonBin, framePath, numSpeakers);
    console.log(`  ${faces.length} face(s) detected.`);
    await fs.writeJson(detectPath, faces, { spaces: 2 });
    console.log(`  Saved: ${detectPath}`);
  }

  // 5. Launch Next.js dev server (skip if --detect-only)
  if (args.detectOnly) {
    console.log('\n✓ Detection complete (--detect-only — not starting server).');
    return;
  }

  console.log('\n──────────────────────────────────────────');
  console.log('Starting Next.js dev server...');
  console.log('→ Open http://localhost:3000/camera in your browser\n');

  const server = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    cwd,
    shell: process.platform === 'win32',
  });

  server.on('error', err => {
    console.error(`\n❌ Failed to start Next.js: ${err.message}`);
    console.log('Start manually with: npm run dev');
    console.log('Then open: http://localhost:3000/camera');
    process.exit(1);
  });
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/')) {
  main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

export default main;
