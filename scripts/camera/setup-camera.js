#!/usr/bin/env node
/**
 * Camera setup orchestrator.
 *
 * 1. Reads transcript.json → gets meta.videoStart timestamp
 * 2. Extracts a single frame from each video at that timestamp (FFmpeg)
 * 3. Runs detect-faces.py (MediaPipe) for each video → writes detections-angle{N}.json
 * 4. Writes angles.json describing all angle configs for the camera GUI
 * 5. Spawns `npm run dev` and prints the camera GUI URL
 *
 * Usage:
 *   node scripts/camera/setup-camera.js [--video <path>] [--python <bin>] [--transcript <path>] [--skip-detect]
 *   node scripts/camera/setup-camera.js --videos <path1> <path2> ... [--python <bin>] [--transcript <path>] [--skip-detect]
 *
 *   --video <path>          Single video path (single-angle, legacy)
 *   --videos <p1> <p2> ...  Multiple video paths (multi-angle). Collects all remaining args until the next flag.
 *   --skip-detect           Skip face detection entirely. Opens the GUI with a blank canvas.
 *   --detect-only           Run face detection but do not start the dev server.
 */

import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { detectHDR, HDR_TONEMAP_VF, SDR_FORMAT_VF } from '../shared/hdr-detect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { videoPaths: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--video'      && args[i + 1]) { result.videoPath = args[++i]; }
    else if (args[i] === '--videos') {
      // Collect all following non-flag arguments as video paths
      while (args[i + 1] && !args[i + 1].startsWith('--')) {
        result.videoPaths.push(args[++i]);
      }
    }
    else if (args[i] === '--python'     && args[i + 1]) { result.pythonBin      = args[++i]; }
    else if (args[i] === '--transcript' && args[i + 1]) { result.transcriptPath = args[++i]; }
    else if (args[i] === '--skip-detect')               { result.skipDetect     = true; }
    else if (args[i] === '--detect-only')               { result.detectOnly     = true; }
  }
  // If --video was given (legacy single-angle), treat it as the only path
  if (result.videoPath && result.videoPaths.length === 0) {
    result.videoPaths = [result.videoPath];
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

async function extractFrame(videoPath, timestamp, outputPath) {
  const isHDR = await detectHDR(videoPath);
  const vf = isHDR ? HDR_TONEMAP_VF : SDR_FORMAT_VF;
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-ss', String(timestamp),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', vf,
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

async function detectFacesWithFallback({ pythonBin, videoPath, videoStart, framePath, numSpeakers }) {
  const offsets = [0, 0.6, 1.2, 2.0, -0.6, -1.2];
  let best = { faces: [], timestamp: Math.max(0, videoStart) };

  for (const offset of offsets) {
    const timestamp = Math.max(0, Number(videoStart) + offset);
    try {
      await extractFrame(videoPath, timestamp, framePath);
      const faces = await runDetectFaces(pythonBin, framePath, numSpeakers);

      if (faces.length > best.faces.length) {
        best = { faces, timestamp };
      }

      if (numSpeakers && faces.length >= numSpeakers) {
        return { ...best, complete: true };
      }
      if (!numSpeakers && faces.length > 0) {
        return { ...best, complete: true };
      }
    } catch (err) {
      console.warn(`  ⚠ Face detection probe failed at t=${timestamp.toFixed(2)}s: ${err.message}`);
    }
  }

  return { ...best, complete: false };
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

  const outputDir = path.join(cwd, 'public', 'transcribe', 'output', 'camera');

  console.log('\nCamera Setup');
  console.log('============\n');

  // 1. Find video(s)
  // CLI --videos overrides --video; fall back to transcript.meta.videoSrcs, then auto-detect.
  let videoPaths = args.videoPaths.length > 0 ? args.videoPaths : null;

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

    // Use videoSrcs from transcript if not provided via CLI
    if (!videoPaths && transcript.meta?.videoSrcs?.length > 0) {
      videoPaths = transcript.meta.videoSrcs.map(rel =>
        path.join(cwd, 'public', rel.replace(/^\/+/, ''))
      );
    }
  } else {
    console.warn(`  ⚠ Transcript not found, using t=0s\n  (${transcriptPath})`);
  }

  // Fall back to single auto-detected video
  if (!videoPaths || videoPaths.length === 0) {
    const single = await findVideo();
    if (!single) {
      console.error('❌ No video found. Use --video <path> or --videos <p1> <p2> ...');
      process.exit(1);
    }
    videoPaths = [single];
  }

  const isMultiAngle = videoPaths.length > 1;
  console.log(isMultiAngle
    ? `Angles:     ${videoPaths.length} videos`
    : `Video:      ${videoPaths[0]}`
  );

  await fs.ensureDir(outputDir);

  // 3. Per-angle: extract frame + detect faces
  // For single-angle keep legacy filenames (frame.jpg, detections.json).
  // For multi-angle use frame-angle{N}.jpg and detections-angle{N}.json.
  const angleResults = [];

  for (let i = 0; i < videoPaths.length; i++) {
    const videoPath = videoPaths[i];
    const angleName = `angle${i + 1}`;
    const framePath  = isMultiAngle
      ? path.join(outputDir, `frame-${angleName}.jpg`)
      : path.join(outputDir, 'frame.jpg');
    const detectPath = isMultiAngle
      ? path.join(outputDir, `detections-${angleName}.json`)
      : path.join(outputDir, 'detections.json');

    if (isMultiAngle) {
      console.log(`\n── ${angleName}: ${path.basename(videoPath)}`);
    }

    console.log(`\nExtracting frame...`);
    await extractFrame(videoPath, videoStart, framePath);
    console.log(`  Saved: ${framePath}`);

    if (args.skipDetect) {
      console.log('Skipping face detection (--skip-detect). Draw boxes manually in the GUI.');
      await fs.writeJson(detectPath, [], { spaces: 2 });
    } else {
      console.log('Detecting faces (mediapipe models download on first run)...');
      const detection = await detectFacesWithFallback({
        pythonBin,
        videoPath,
        videoStart,
        framePath,
        numSpeakers,
      });
      const faces = detection.faces;
      if (faces.length > 0) {
        console.log(`  Best frame: t=${detection.timestamp.toFixed(2)}s`);
      }
      console.log(`  ${faces.length} face(s) detected.`);
      await fs.writeJson(detectPath, faces, { spaces: 2 });
      console.log(`  Saved: ${detectPath}`);
      if (!detection.complete && faces.length === 0) {
        console.log('  ⚠ No faces auto-detected. Continue in /camera and draw boxes manually.');
      }
    }

    // Store relative paths (relative to outputDir) for angles.json
    angleResults.push({
      angleName,
      videoPath,
      framePath,
      detectPath,
      // Path relative to /public for use in Remotion (best-effort — may not be in /public)
      videoSrc: videoPath.includes(path.join(cwd, 'public'))
        ? videoPath.replace(path.join(cwd, 'public') + path.sep, '').replace(/\\/g, '/')
        : path.basename(videoPath),
    });
  }

  // 4. Write angles.json so the camera GUI knows about all angles
  const anglesJsonPath = path.join(outputDir, 'angles.json');
  await fs.writeJson(anglesJsonPath, angleResults.map(a => ({
    angleName: a.angleName,
    videoSrc:  a.videoSrc,
    // Paths relative to outputDir for serving via Next.js
    frameFile:  path.relative(outputDir, a.framePath).replace(/\\/g, '/'),
    detectFile: path.relative(outputDir, a.detectPath).replace(/\\/g, '/'),
  })), { spaces: 2 });
  console.log(`\n✓ Wrote ${anglesJsonPath}`);

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
