#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const videos = [];
  let outputDir = null;
  let crf = 23;
  let height = 720;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--videos') {
      while (args[i + 1] && !args[i + 1].startsWith('--')) videos.push(args[++i]);
    } else if (args[i] === '--output-dir' && args[i + 1]) outputDir = args[++i];
    else if (args[i] === '--crf' && args[i + 1]) crf = parseInt(args[++i]);
    else if (args[i] === '--height' && args[i + 1]) height = parseInt(args[++i]);
  }
  return { videos, outputDir, crf, height };
}

function progressBar(pct, width = 20) {
  const filled = Math.round(width * pct / 100);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function transcodeOne(inputPath, outputPath, crf, height) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', inputPath,
      '-vf', `scale=-2:${height}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
      '-c:a', 'aac', '-ar', '48000',
      '-map_metadata', '0',
      '-y', outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let totalSecs = null;
    let buf = '';
    let lastErr = '';
    const label = path.basename(inputPath);
    process.stdout.write(`  Transcoding ${label}...  `);

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
          process.stdout.write(`\r  Transcoding ${label}...  ${progressBar(pct)} ${pct}%   `);
        }
      }
    });

    proc.on('close', code => {
      if (code === 0) {
        process.stdout.write(`\r  Transcoding ${label}...  ${progressBar(100)} 100%\n`);
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
 * Transcode each video to a 720p H.264 proxy and write public/proxy/proxy-map.json.
 *
 * proxy-map.json is an ordered array so angle index is preserved across sessions.
 * videoStart is 0 on creation and updated by the wizard after the sync step.
 *
 * @param {string[]} videoPaths  Absolute paths to raw source files (in angle order).
 * @param {string}   outputDir   Directory to write proxies into.
 * @param {{ crf?: number, height?: number }} opts
 * @returns {Promise<string[]>}  Absolute proxy output paths (same order as input).
 */
export async function transcodeProxies(videoPaths, outputDir, opts = {}) {
  const { crf = 23, height = 720 } = opts;
  await fs.ensureDir(outputDir);

  const proxyPaths = [];
  for (const videoPath of videoPaths) {
    const stem = path.basename(videoPath, path.extname(videoPath));
    const proxyPath = path.resolve(path.join(outputDir, `${stem}-proxy.mp4`));
    await transcodeOne(path.resolve(videoPath), proxyPath, crf, height);
    proxyPaths.push(proxyPath);
  }

  const cwd = process.cwd();
  const mapPath = path.join(cwd, 'public', 'proxy', 'proxy-map.json');
  await fs.ensureDir(path.dirname(mapPath));
  const entries = proxyPaths.map((proxyPath, i) => ({
    proxy: proxyPath,
    raw: path.resolve(videoPaths[i]),
    videoStart: 0,
  }));
  await fs.writeJson(mapPath, entries, { spaces: 2 });

  console.log(`  ✓ ${proxyPaths.length} proxy file(s) written to ${outputDir}`);
  console.log(`  ✓ Proxy map: ${mapPath}`);

  return proxyPaths;
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('/transcode-proxy.js') || _argv1.endsWith('/transcode-proxy')) {
  const { videos, outputDir, crf, height } = parseArgs();
  if (!videos.length) {
    console.error('Usage: node transcode-proxy.js --videos <path1> [<path2> ...] [--output-dir <dir>] [--crf <n>] [--height <n>]');
    process.exit(1);
  }
  const cwd = process.cwd();
  const outDir = outputDir ? path.resolve(outputDir) : path.join(cwd, 'input', 'video-proxy');
  transcodeProxies(videos.map(v => path.resolve(v)), outDir, { crf, height }).catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}
