#!/usr/bin/env node
/**
 * Camera setup orchestrator.
 *
 * 1. Reads transcript.json → gets meta.videoStart timestamp
 * 2. Extracts frame(s) from each video at timestamp(s) (FFmpeg)
 *    - Supports dynamic angles: captures multiple frames at intervals when camera shifts
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
 *   --dynamic-angles        Capture frames at intervals for changing camera angles (prompts for interval)
 *   --interval-minutes <n>   Frame capture interval in minutes (default: 5)
 */

import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
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
    else if (args[i] === '--python'      && args[i + 1]) { result.pythonBin       = args[++i]; }
    else if (args[i] === '--transcript' && args[i + 1]) { result.transcriptPath  = args[++i]; }
    else if (args[i] === '--skip-detect')              { result.skipDetect      = true; }
    else if (args[i] === '--detect-only')              { result.detectOnly      = true; }
    else if (args[i] === '--dynamic-angles')            { result.dynamicAngles   = true; }
    else if (args[i] === '--no-dynamic-angles')         { result.dynamicAngles   = false; result.dynamicAnglesSet = true; }
    else if (args[i] === '--interval-minutes' && args[i + 1]) { result.intervalMinutes = parseFloat(args[++i]); }
    else if (args[i] === '--dynamic-angles-indices' && args[i + 1]) {
      result.dynamicAngleIndices = args[++i].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    }
  }
  // If --video was given (legacy single-angle), treat it as the only path
  if (result.videoPath && result.videoPaths.length === 0) {
    result.videoPaths = [result.videoPath];
  }
  return result;
}

// ── Interactive prompts ───────────────────────────────────────────────────────

function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function askYesNo(rl, question, defaultValue = false) {
  const defaultStr = defaultValue ? 'Y/n' : 'y/N';
  const answer = await askQuestion(rl, `${question} [${defaultStr}]: `);
  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith('y');
}

async function askNumber(rl, question, defaultValue, min, max) {
  const defaultStr = defaultValue !== undefined ? ` (default: ${defaultValue})` : '';
  const answer = await askQuestion(rl, `${question}${defaultStr}: `);
  if (!answer && defaultValue !== undefined) return defaultValue;
  const num = parseFloat(answer);
  if (isNaN(num) || (min !== undefined && num < min) || (max !== undefined && num > max)) {
    console.log(`  ⚠ Invalid input, using default: ${defaultValue}`);
    return defaultValue;
  }
  return num;
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

/**
 * Get video duration in seconds using ffprobe.
 */
async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr}`));
        return;
      }
      const duration = parseFloat(stdout.trim());
      if (isNaN(duration)) {
        reject(new Error(`Could not parse duration from ffprobe output: ${stdout}`));
        return;
      }
      resolve(duration);
    });
    proc.on('error', e => reject(new Error(`ffprobe not found: ${e.message}`)));
  });
}

/**
 * Calculate frame timestamps for dynamic angle capture.
 * Returns array of timestamps (in seconds) at which to extract frames.
 */
function calculateFrameTimestamps(videoStart, videoDuration, intervalMinutes) {
  const intervalSeconds = intervalMinutes * 60;
  const timestamps = [];
  // Always include the start time
  let currentTime = videoStart;
  while (currentTime < videoDuration) {
    timestamps.push(currentTime);
    currentTime += intervalSeconds;
  }
  return timestamps;
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
    || path.join(cwd, 'public', 'edit', 'transcript.json');

  const outputDir = path.join(cwd, 'public', 'camera');

  console.log('\nCamera Setup');
  console.log('============\n');

  // 1. Find video(s)
  // CLI --videos overrides --video; fall back to transcript.meta.videoSrcs, then auto-detect.
  let videoPaths = args.videoPaths.length > 0 ? args.videoPaths : null;

  // 2. Read transcript for videoStart + speaker count
  let videoStart = 0;
  let numSpeakers = null;
  let videoEnd = null;
  if (await fs.pathExists(transcriptPath)) {
    const transcript = await fs.readJson(transcriptPath);
    videoStart = transcript.meta?.videoStart ?? 0;
    videoEnd = transcript.meta?.videoEnd ?? null;
    const speakerSet = new Set(
      (transcript.segments || []).map(s => s.speaker).filter(Boolean)
    );
    numSpeakers = speakerSet.size || null;
    console.log(`Transcript: ${transcriptPath}`);
    console.log(`Frame at:   ${videoStart}s (transcript.meta.videoStart)`);
    if (videoEnd) console.log(`Video end:  ${videoEnd}s (transcript.meta.videoEnd)`);
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

  // 3. Interactive prompts for dynamic angles
  let useDynamicAngles = args.dynamicAngles || false;
  let intervalMinutes = args.intervalMinutes || 5;

  // Only prompt if not already set via CLI flags
  const rl = createReadline();
  try {
    if (!args.dynamicAngles && !args.dynamicAnglesSet) {
      useDynamicAngles = await askYesNo(rl, 'Does your camera switch angles while filming (e.g., drooping)?', false);
    }

    if (useDynamicAngles) {
      console.log('\n  Dynamic angles mode: Capturing frames at intervals to account for camera movement.');
      if (!args.intervalMinutes) {
        intervalMinutes = await askNumber(rl, 'Enter sampling interval in minutes', 5, 0.5, 60);
      }
      console.log(`  Using interval: ${intervalMinutes} minutes\n`);
    }
  } finally {
    rl.close();
  }

  // 4. Per-angle: extract frame(s) + detect faces
  // For single-angle keep legacy filenames (frame.jpg, detections.json).
  // For multi-angle use frame-angle{N}.jpg and detections-angle{N}.json.
  // For dynamic angles, use frame-angle{N}-{timestamp}.jpg pattern.
  const angleResults = [];

  for (let i = 0; i < videoPaths.length; i++) {
    const videoPath = videoPaths[i];
    const angleName = `angle${i + 1}`;

    if (isMultiAngle) {
      console.log(`\n── ${angleName}: ${path.basename(videoPath)}`);
      console.log(`  Full path: ${videoPath}`);
    }

    // Get video duration for dynamic angle calculation
    let videoDuration = videoEnd;
    if (!videoDuration) {
      try {
        videoDuration = await getVideoDuration(videoPath);
        console.log(`  Video duration: ${(videoDuration / 60).toFixed(1)} minutes`);
      } catch (err) {
        console.warn(`  ⚠ Could not determine video duration: ${err.message}`);
        videoDuration = videoStart + 3600; // Default to 1 hour if can't determine
      }
    }

    // Determine if THIS angle should use dynamic angles
    const angleUsesDynamic = useDynamicAngles && (
      !args.dynamicAngleIndices || args.dynamicAngleIndices.includes(i)
    );

    // Calculate frame timestamps to extract
    let frameTimestamps;
    if (angleUsesDynamic) {
      frameTimestamps = calculateFrameTimestamps(videoStart, videoDuration, intervalMinutes);
      console.log(`  Capturing ${frameTimestamps.length} frames at ${intervalMinutes}min intervals`);
    } else {
      frameTimestamps = [videoStart];
    }

    // Extract frames and detect faces at each timestamp
    const timeframes = [];

    for (let tIdx = 0; tIdx < frameTimestamps.length; tIdx++) {
      const timestamp = frameTimestamps[tIdx];
      const timeLabel = `${Math.floor(timestamp / 60)}m${Math.floor(timestamp % 60)}s`;

      // Determine file paths based on mode
      let framePath, detectPath;
      if (angleUsesDynamic) {
        framePath = path.join(outputDir, `frame-${angleName}-${timeLabel}.jpg`);
        detectPath = path.join(outputDir, `detections-${angleName}-${timeLabel}.json`);
      } else if (isMultiAngle) {
        framePath = path.join(outputDir, `frame-${angleName}.jpg`);
        detectPath = path.join(outputDir, `detections-${angleName}.json`);
      } else {
        framePath = path.join(outputDir, 'frame.jpg');
        detectPath = path.join(outputDir, 'detections.json');
      }

      console.log(`\n  [${tIdx + 1}/${frameTimestamps.length}] Extracting frame at t=${timestamp.toFixed(1)}s...`);
      console.log(`     From: ${videoPath}`);
      console.log(`     To:   ${framePath}`);
      await extractFrame(videoPath, timestamp, framePath);

      if (args.skipDetect) {
        console.log('  Skipping face detection (--skip-detect).');
        await fs.writeJson(detectPath, [], { spaces: 2 });
      } else {
        console.log('  Detecting faces...');
        const detection = await detectFacesWithFallback({
          pythonBin,
          videoPath,
          videoStart: timestamp,
          framePath,
          numSpeakers,
        });
        const faces = detection.faces;
        console.log(`    ${faces.length} face(s) detected.`);
        await fs.writeJson(detectPath, faces, { spaces: 2 });
        if (!detection.complete && faces.length === 0) {
          console.log('    ⚠ No faces auto-detected. Draw boxes manually in GUI.');
        }
      }

      // Calculate timeframe range
      const fromTime = timestamp;
      const toTime = (tIdx < frameTimestamps.length - 1)
        ? frameTimestamps[tIdx + 1]
        : videoDuration;

      timeframes.push({
        timestamp,
        fromTime,
        toTime,
        framePath,
        detectPath,
        timeLabel,
      });
    }

    // Store relative paths for angles.json
    const primaryFrame = timeframes[0];
    angleResults.push({
      angleName,
      videoPath,
      framePath: primaryFrame.framePath,
      detectPath: primaryFrame.detectPath,
      // Path relative to /public for use in Remotion
      videoSrc: videoPath.includes(path.join(cwd, 'public'))
        ? videoPath.replace(path.join(cwd, 'public') + path.sep, '').replace(/\\/g, '/')
        : path.basename(videoPath),
      // Include timeframes for dynamic angle mode (only if this angle uses dynamic)
      ...(angleUsesDynamic ? { timeframes } : {}),
    });
  }

  // 5. Write angles.json so the camera GUI knows about all angles
  const anglesJsonPath = path.join(outputDir, 'angles.json');
  await fs.writeJson(anglesJsonPath, angleResults.map(a => {
    const base = {
      angleName: a.angleName,
      videoSrc:  a.videoSrc,
      frameFile:  path.relative(outputDir, a.framePath).replace(/\\/g, '/'),
      detectFile: path.relative(outputDir, a.detectPath).replace(/\\/g, '/'),
    };
    // Include timeframes if using dynamic angles
    if (a.timeframes) {
      base.timeframes = a.timeframes.map(t => ({
        timestamp: t.timestamp,
        fromTime: t.fromTime,
        toTime: t.toTime,
        frameFile: path.relative(outputDir, t.framePath).replace(/\\/g, '/'),
        detectFile: path.relative(outputDir, t.detectPath).replace(/\\/g, '/'),
        timeLabel: t.timeLabel,
      }));
    }
    return base;
  }), { spaces: 2 });
  console.log(`\n✓ Wrote ${anglesJsonPath}`);
  if (useDynamicAngles) {
    console.log('  Dynamic angles mode: Multiple timeframes captured per angle.');
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
