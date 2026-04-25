#!/usr/bin/env tsx
/**
 * Computes per-angle color correction from fresh frames and writes corrections
 * into camera-profiles.json as SVG feColorMatrix values.
 *
 * Always extracts fresh frames (with -pix_fmt yuv420p) rather than reusing
 * setup-camera frames, which may pre-date the 10-bit HDR fix.
 *
 * Usage:
 *   npx tsx scripts/camera/color-match.ts [--profiles <path>] [--ref <angleName>]
 *
 *   --profiles <path>   Path to camera-profiles.json (default: public/camera/camera-profiles.json)
 *   --ref <angleName>   Reference angle all others are matched to (default: angle1)
 */

import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { detectHDR, HDR_TONEMAP_VF, SDR_FORMAT_VF } from '../shared/hdr-detect.js';

const cwd = process.cwd();

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
      result[args[i].slice(2)] = args[++i];
    }
  }
  return result;
}

// ── Frame extraction ──────────────────────────────────────────────────────────

async function extractFrame(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
  const isHDR = await detectHDR(videoPath);
  const vf: string = isHDR ? HDR_TONEMAP_VF : SDR_FORMAT_VF;
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
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('close', (code: number | null) => {
      if (code !== 0) reject(new Error(`ffmpeg failed:\n${err}`));
      else resolve();
    });
    proc.on('error', (e: Error) => reject(new Error(`ffmpeg not found: ${e.message}`)));
  });
}

// ── Color sampling ────────────────────────────────────────────────────────────

type FaceBox = { x: number; y: number; w: number; h: number };
type RGBStats = { mean: { r: number; g: number; b: number }; std: { r: number; g: number; b: number } };

async function sampleRegionStats(imagePath: string, region: FaceBox): Promise<RGBStats> {
  const meta = await sharp(imagePath).metadata();
  const imgW = meta.width!;
  const imgH = meta.height!;

  const left   = Math.max(0, Math.round(region.x * imgW));
  const top    = Math.max(0, Math.round(region.y * imgH));
  const width  = Math.min(imgW - left, Math.max(1, Math.round(region.w * imgW)));
  const height = Math.min(imgH - top,  Math.max(1, Math.round(region.h * imgH)));

  const { data } = await sharp(imagePath)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = data.length / 3;

  let rSum = 0, gSum = 0, bSum = 0;
  for (let i = 0; i < data.length; i += 3) {
    rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
  }
  const mean = { r: rSum / pixels, g: gSum / pixels, b: bSum / pixels };

  let rVar = 0, gVar = 0, bVar = 0;
  for (let i = 0; i < data.length; i += 3) {
    rVar += (data[i]     - mean.r) ** 2;
    gVar += (data[i + 1] - mean.g) ** 2;
    bVar += (data[i + 2] - mean.b) ** 2;
  }
  const std = {
    r: Math.sqrt(rVar / pixels),
    g: Math.sqrt(gVar / pixels),
    b: Math.sqrt(bVar / pixels),
  };

  return { mean, std };
}

// ── Matrix math ───────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Builds a 4×5 feColorMatrix (20 values, row-major) that maps src colour
 * statistics to the reference angle's colour statistics via per-channel
 * Reinhard transfer (mean + std matching in sRGB space).
 *
 * Matrix form: each row is [rCoeff, gCoeff, bCoeff, aCoeff, offset]
 * The offset column is normalised to [0, 1] as required by feColorMatrix.
 */
function buildCorrectionMatrix(ref: RGBStats, src: RGBStats): number[] {
  const channels = ['r', 'g', 'b'] as const;
  const gains:   number[] = [];
  const offsets: number[] = [];

  for (const ch of channels) {
    const gain   = src.std[ch] > 1 ? clamp(ref.std[ch] / src.std[ch], 0.5, 2.0) : 1;
    const offset = (ref.mean[ch] - gain * src.mean[ch]) / 255;
    gains.push(gain);
    offsets.push(offset);
  }

  const [rg, gg, bg] = gains;
  const [ro, go, bo] = offsets;

  // feColorMatrix row-major 4×5: R G B A offset (per output channel R, G, B, A)
  return [
    rg, 0,  0,  0, ro,
    0,  gg, 0,  0, go,
    0,  0,  bg, 0, bo,
    0,  0,  0,  1, 0,
  ].map(v => parseFloat(v.toFixed(6)));
}

const IDENTITY_MATRIX = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  const cameraDir    = path.join(cwd, 'public', 'camera');
  const profilesPath = args.profiles ?? path.join(cameraDir, 'camera-profiles.json');
  const anglesPath   = path.join(cameraDir, 'angles.json');
  const refAngle     = args.ref ?? 'angle1';

  console.log('\nColor Match');
  console.log('===========\n');

  if (!await fs.pathExists(anglesPath)) {
    console.error(`❌ angles.json not found at ${anglesPath}`);
    console.error('   Run setup-camera first.');
    process.exit(1);
  }

  type AngleEntry = { angleName: string; videoSrc: string; frameFile: string; detectFile: string };
  const angles: AngleEntry[] = await fs.readJson(anglesPath);

  if (angles.length < 2) {
    console.log('Only one angle — nothing to match. Exiting.');
    return;
  }

  if (!await fs.pathExists(profilesPath)) {
    console.error(`❌ camera-profiles.json not found at ${profilesPath}`);
    console.error('   Complete camera setup in the /camera GUI first.');
    process.exit(1);
  }

  // Read transcript for videoStart timestamp
  const transcriptPath = path.join(cwd, 'public', 'edit', 'transcript.json');
  let videoStart = 0;
  if (await fs.pathExists(transcriptPath)) {
    const transcript = await fs.readJson(transcriptPath);
    videoStart = transcript.meta?.videoStart ?? 0;
  }
  console.log(`Frame timestamp: ${videoStart}s (transcript.meta.videoStart)\n`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'color-match-'));

  try {
    const stats: Record<string, RGBStats> = {};

    for (const angle of angles) {
      const videoPath  = path.join(cwd, 'public', angle.videoSrc);
      const detectPath = path.join(cameraDir, angle.detectFile);
      const framePath  = path.join(tmpDir, `frame-${angle.angleName}.jpg`);

      console.log(`── ${angle.angleName}: ${path.basename(angle.videoSrc)}`);
      process.stdout.write('  Extracting frame...');
      await extractFrame(videoPath, videoStart, framePath);
      process.stdout.write(' done\n');

      type Detection = { x: number; y: number; w: number; h: number; score: number };
      const detections: Detection[] = await fs.pathExists(detectPath)
        ? await fs.readJson(detectPath)
        : [];

      let region: FaceBox;
      if (detections.length === 0) {
        console.log('  ⚠ No face detections — sampling centre of frame');
        region = { x: 0.25, y: 0.1, w: 0.5, h: 0.8 };
      } else {
        const face = [...detections].sort((a, b) => b.score - a.score)[0];
        region = { x: face.x, y: face.y, w: face.w, h: face.h };
      }

      const s = await sampleRegionStats(framePath, region);
      stats[angle.angleName] = s;
      console.log(
        `  RGB mean: R=${s.mean.r.toFixed(1)} G=${s.mean.g.toFixed(1)} B=${s.mean.b.toFixed(1)}  ` +
        `std: R=${s.std.r.toFixed(1)} G=${s.std.g.toFixed(1)} B=${s.std.b.toFixed(1)}\n`,
      );
    }

    const refStats = stats[refAngle];
    if (!refStats) {
      console.error(`❌ Reference angle "${refAngle}" not found.`);
      process.exit(1);
    }

    console.log(`Reference: ${refAngle}\n`);

    const profiles = await fs.readJson(profilesPath);
    if (!profiles.angles) {
      console.error('❌ camera-profiles.json has no "angles" — only multi-angle setups need color matching.');
      process.exit(1);
    }

    for (const angle of angles) {
      if (!(angle.angleName in profiles.angles)) continue;

      if (angle.angleName === refAngle) {
        profiles.angles[angle.angleName].colorCorrection = { matrix: IDENTITY_MATRIX };
        console.log(`  ${angle.angleName}: reference (identity)`);
      } else {
        const matrix = buildCorrectionMatrix(refStats, stats[angle.angleName]);
        profiles.angles[angle.angleName].colorCorrection = { matrix };
        console.log(
          `  ${angle.angleName}: gain R=${matrix[0].toFixed(3)} G=${matrix[6].toFixed(3)} B=${matrix[12].toFixed(3)}  ` +
          `offset R=${matrix[4].toFixed(3)} G=${matrix[9].toFixed(3)} B=${matrix[14].toFixed(3)}`,
        );
      }
    }

    await fs.writeJson(profilesPath, profiles, { spaces: 2 });
    console.log(`\n✓ Written to ${profilesPath}`);

  } finally {
    await fs.remove(tmpDir);
  }
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
