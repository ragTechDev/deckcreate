#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { transcriptPath: null, proxyMapPath: null, outputPath: null, angle: 1, reencode: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--transcript' && args[i + 1]) result.transcriptPath = args[++i];
    else if (args[i] === '--proxy-map' && args[i + 1]) result.proxyMapPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.outputPath = args[++i];
    else if (args[i] === '--angle' && args[i + 1]) result.angle = parseInt(args[++i]);
    else if (args[i] === '--reencode') result.reencode = true;
  }
  return result;
}

function getSubClips(segment) {
  const clips = [];
  let cursor = segment.start;
  const sorted = [...(segment.cuts || [])].sort((a, b) => a.from - b.from);
  for (const cut of sorted) {
    if (cut.from > cursor) clips.push({ start: cursor, end: cut.from });
    cursor = cut.to;
  }
  if (cursor < segment.end) clips.push({ start: cursor, end: segment.end });
  return clips;
}

async function getVideoCodec(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json',
      '-show_streams', '-select_streams', 'v:0', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe failed for ${filePath}`));
      try {
        const data = JSON.parse(stdout);
        resolve(data.streams?.[0]?.codec_name ?? 'unknown');
      } catch (e) { reject(e); }
    });
    proc.on('error', e => reject(e));
  });
}

// All-intra codecs: stream copy cuts land on exact frames, no partial GOPs
const ALL_INTRA_CODECS = new Set(['prores', 'prores_ks', 'dnxhd', 'dnxhr', 'mjpeg', 'jpeg2000', 'huffyuv', 'ffv1']);

function progressBar(pct, width = 20) {
  const filled = Math.round(width * pct / 100);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let totalSecs = null;
    let buf = '';
    let lastErr = '';
    process.stdout.write('  Exporting...  ');
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
          process.stdout.write(`\r  Exporting...  ${progressBar(pct)} ${pct}%   `);
        }
      }
    });
    proc.on('close', code => {
      if (code === 0) {
        process.stdout.write(`\r  Exporting...  ${progressBar(100)} 100%\n`);
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
 * Apply transcript cut edits to the original raw video, producing a full-quality
 * final cut. Uses stream copy (-c copy) for all-intra codecs (ProRes, DNxHR) so
 * no re-encode is needed; pass --reencode for interframe sources.
 *
 * Transcript timestamps are relative to the synced proxy output (time 0 = first
 * frame of the sync output). proxy-map.json stores the sync videoStart offset so
 * that timestamps are correctly mapped back to positions in the raw file.
 *
 * @param {{ transcriptPath?: string, proxyMapPath?: string, outputPath?: string,
 *           angle?: number, reencode?: boolean }} opts
 */
export async function conformToRaw(opts = {}) {
  const cwd = process.cwd();
  const transcriptPath = opts.transcriptPath || path.join(cwd, 'public', 'edit', 'transcript.json');
  const proxyMapPath = opts.proxyMapPath || path.join(cwd, 'public', 'proxy', 'proxy-map.json');
  const outputPath = opts.outputPath || path.join(cwd, 'public', 'output', 'final-cut.mov');
  const angle = opts.angle || 1;
  const reencode = opts.reencode || false;

  if (!await fs.pathExists(proxyMapPath)) {
    console.error('❌ No proxy-map.json found. This script is only needed when you transcoded proxies from raw files.');
    process.exit(1);
  }
  if (!await fs.pathExists(transcriptPath)) {
    console.error(`❌ Transcript not found: ${transcriptPath}`);
    process.exit(1);
  }

  const rawMap = await fs.readJson(proxyMapPath);
  // Support both array format (current) and flat object format (legacy)
  const entries = Array.isArray(rawMap)
    ? rawMap
    : Object.entries(rawMap).map(([proxy, raw]) => ({ proxy, raw, videoStart: 0 }));

  const entry = entries[angle - 1];
  if (!entry) {
    console.error(`❌ No proxy-map entry for angle ${angle}. Map has ${entries.length} entry(ies).`);
    process.exit(1);
  }

  const rawPath = entry.raw;
  // videoStart: seconds into the raw file where the sync output begins.
  // Transcript timestamps are relative to the sync output (T=0), so adding
  // videoStart maps them back to positions in the raw file.
  const videoStart = entry.videoStart ?? 0;

  if (!await fs.pathExists(rawPath)) {
    console.error(`❌ Raw file not found: ${rawPath}`);
    process.exit(1);
  }

  console.log(`  Raw source:  ${rawPath}`);
  console.log(`  Sync offset: ${videoStart.toFixed(3)}s (added to all transcript timestamps)`);

  const transcript = await fs.readJson(transcriptPath);

  // Build clip list — hook segments first, then main content (mirrors cut-preview.js)
  const clips = [];
  for (const seg of transcript.segments) {
    if (!seg.hook || seg.cut) continue;
    if (seg.hookFrom !== undefined && seg.hookTo !== undefined) {
      clips.push({ start: seg.hookFrom + videoStart, end: seg.hookTo + videoStart });
    } else {
      clips.push(...getSubClips(seg).map(c => ({ start: c.start + videoStart, end: c.end + videoStart })));
    }
  }
  for (const seg of transcript.segments) {
    if (seg.hook || seg.cut) continue;
    clips.push(...getSubClips(seg).map(c => ({ start: c.start + videoStart, end: c.end + videoStart })));
  }

  if (!clips.length) {
    console.error('❌ No clips to export — all segments are cut.');
    process.exit(1);
  }
  console.log(`  Clips: ${clips.length}`);

  // Codec check: warn if stream copy may produce imprecise cuts
  const codec = await getVideoCodec(rawPath);
  const isAllIntra = ALL_INTRA_CODECS.has(codec.toLowerCase());
  if (!isAllIntra && !reencode) {
    console.warn(`  ⚠  Input codec "${codec}" is not all-intra — stream copy cuts may be imprecise at non-keyframes.`);
    console.warn(`     Pass --reencode to use -c:v libx264 -preset slow -crf 16 for frame-accurate cuts.`);
  }

  // Build concat demuxer input file — each clip is a separate entry even for the same source
  const tempDir = path.join(os.tmpdir(), `conform-${Date.now()}`);
  await fs.ensureDir(tempDir);
  const segmentsFile = path.join(tempDir, 'segments.txt');
  const lines = [];
  for (const clip of clips) {
    lines.push(`file '${rawPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
    lines.push(`inpoint ${clip.start.toFixed(6)}`);
    lines.push(`outpoint ${clip.end.toFixed(6)}`);
    lines.push('');
  }
  await fs.writeFile(segmentsFile, lines.join('\n'));

  await fs.ensureDir(path.dirname(outputPath));

  const encodeArgs = (reencode || !isAllIntra)
    ? ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-c:a', 'aac']
    : ['-c', 'copy'];

  try {
    await runFfmpeg([
      '-f', 'concat', '-safe', '0',
      '-i', segmentsFile,
      ...encodeArgs,
      '-avoid_negative_ts', 'make_zero',
      '-y', outputPath,
    ]);
    console.log(`  ✓ Final cut: ${outputPath}`);
  } finally {
    await fs.remove(tempDir).catch(() => {});
  }
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('/conform-to-raw.js') || _argv1.endsWith('/conform-to-raw')) {
  const args = parseArgs();
  conformToRaw(args).catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}
