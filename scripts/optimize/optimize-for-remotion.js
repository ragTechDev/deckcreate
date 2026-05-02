#!/usr/bin/env node
/**
 * Re-encode synced video files with dense keyframes so Remotion can seek
 * efficiently frame-by-frame without decoding back to sparse keyframes.
 *
 * -g 60          = keyframe every 60 frames (1 s at 60 fps)
 * +faststart     = move index to front of file for fast initial seeks
 *
 * On macOS, VideoToolbox hardware encode is used (fast, ~1-2 min/hour of video).
 * On other platforms, libx264 is used.
 */

import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const videoPaths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--videos') {
      while (args[i + 1] && !args[i + 1].startsWith('--')) {
        videoPaths.push(args[++i]);
      }
    }
  }
  return { videoPaths };
}

function progressBar(pct, width = 20) {
  const filled = Math.round(width * pct / 100);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function encodeWithKeyframes(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const isAppleSilicon = process.platform === 'darwin';
    const videoCodecArgs = isAppleSilicon
      ? ['-c:v', 'h264_videotoolbox', '-g', '60']
      : ['-c:v', 'libx264', '-preset', 'fast', '-g', '60'];

    const args = [
      '-i', inputPath,
      ...videoCodecArgs,
      '-movflags', '+faststart',
      '-c:a', 'copy',
      '-y', outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let totalSecs = null;
    let buf = '';
    let lastErr = '';

    process.stdout.write(`  Optimising ${path.basename(inputPath)}...  `);

    proc.stderr.on('data', d => {
      buf += d.toString();
      lastErr += d.toString();
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
          process.stdout.write(`\r  Optimising ${path.basename(inputPath)}...  ${progressBar(pct)} ${pct}%   `);
        }
      }
    });

    proc.on('close', code => {
      if (code === 0) {
        process.stdout.write(`\r  Optimising ${path.basename(inputPath)}...  ${progressBar(100)} 100%\n`);
        resolve();
      } else {
        process.stdout.write('\n');
        reject(new Error(`ffmpeg exited with code ${code}\n${lastErr.slice(-500)}`));
      }
    });

    proc.on('error', e => reject(new Error(`ffmpeg not found — is ffmpeg installed? (${e.message})`)));
  });
}

/**
 * Re-encode each video in videoPaths with -g 60 -movflags +faststart in-place.
 * Uses a temp file to avoid partial writes on failure.
 *
 * @param {string[]} videoPaths  Absolute paths to files to optimise
 */
export async function optimizeForRemotion(videoPaths) {
  for (const videoPath of videoPaths) {
    if (!await fs.pathExists(videoPath)) {
      throw new Error(`File not found: ${videoPath}`);
    }
    const tmpPath = videoPath + '.opt.tmp.mp4';
    try {
      await encodeWithKeyframes(videoPath, tmpPath);
      await fs.move(tmpPath, videoPath, { overwrite: true });
    } catch (err) {
      await fs.remove(tmpPath).catch(() => {});
      throw err;
    }
  }
  console.log(`  ✓ Keyframe optimisation complete — ${videoPaths.length} file(s) updated`);
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

import { fileURLToPath } from 'url';
const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('/optimize-for-remotion.js') || _argv1.endsWith('/optimize-for-remotion')) {
  const { videoPaths } = parseArgs();
  if (!videoPaths.length) {
    console.error('Usage: node optimize-for-remotion.js --videos <path1> [<path2> ...]');
    process.exit(1);
  }
  optimizeForRemotion(videoPaths).catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}
