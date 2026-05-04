#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--transcript' && args[i + 1]) result.transcriptPath = args[++i];
    else if (args[i] === '--video' && args[i + 1]) result.videoPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.outputPath = args[++i];
  }
  return result;
}

function getSubClips(segment) {
  const clips = [];
  let cursor = segment.start;
  const sorted = [...segment.cuts].sort((a, b) => a.from - b.from);
  for (const cut of sorted) {
    if (cut.from > cursor) clips.push({ start: cursor, end: cut.from });
    cursor = cut.to;
  }
  if (cursor < segment.end) clips.push({ start: cursor, end: segment.end });
  return clips;
}

async function main() {
  const cwd = process.cwd();
  const cli = parseArgs();

  const transcriptPath = cli.transcriptPath
    || path.join(cwd, 'public', 'edit', 'transcript.json');
  const videoExts = ['.mp4', '.mov', '.mkv'];
  async function findVideo(...dirs) {
    for (const dir of dirs) {
      if (!await fs.pathExists(dir)) continue;
      const files = await fs.readdir(dir);
      const match = files.find(f => videoExts.includes(path.extname(f).toLowerCase()));
      if (match) return path.join(dir, match);
    }
    return null;
  }
  const videoPath = cli.videoPath
    || await findVideo(
      path.join(cwd, 'public', 'sync', 'output'),
      path.join(cwd, 'public', 'transcribe', 'input'),
    );
  const outputPath = cli.outputPath
    || path.join(cwd, 'public', 'edit', 'preview-cut.mp4');

  if (!await fs.pathExists(transcriptPath)) {
    console.error(`❌ Transcript not found: ${transcriptPath}`); process.exit(1);
  }
  if (!videoPath || !await fs.pathExists(videoPath)) {
    console.error('❌ Video not found. Place a video in public/sync/output/ or public/transcribe/input/, or pass --video <path>.');
    process.exit(1);
  }

  const transcript = await fs.readJson(transcriptPath);

  // Hook clips first (in document order), then main clips
  const clips = [];
  for (const seg of transcript.segments) {
    if (!seg.hook || seg.cut) continue;
    if (seg.hookFrom !== undefined && seg.hookTo !== undefined) {
      clips.push({ start: seg.hookFrom, end: seg.hookTo });
    } else {
      clips.push(...getSubClips(seg));
    }
  }
  for (const seg of transcript.segments) {
    if (seg.hook || seg.cut) continue;
    clips.push(...getSubClips(seg));
  }

  if (!clips.length) {
    console.error('❌ No clips to render — all segments are cut.');
    process.exit(1);
  }

  console.log(`Building preview from ${clips.length} clip(s)…`);

  // Use the concat demuxer with a list file — scales to any number of clips
  // without hitting FFmpeg's filter_complex graph size limits.
  const concatListPath = path.join(os.tmpdir(), `cut-preview-concat-${Date.now()}.txt`);
  const safePath = videoPath.replace(/\\/g, '/').replace(/'/g, "\\'");
  const lines = ['ffconcat version 1.0'];
  for (const c of clips) {
    lines.push(`file '${safePath}'`);
    lines.push(`inpoint ${c.start}`);
    lines.push(`outpoint ${c.end}`);
  }
  await fs.writeFile(concatListPath, lines.join('\n') + '\n');

  try {
    execSync(
      `ffmpeg -loglevel error -f concat -safe 0 -i "${concatListPath}" -c:v libx264 -preset fast -crf 18 -c:a aac -y "${outputPath}"`,
      { stdio: 'inherit' },
    );
  } finally {
    await fs.remove(concatListPath);
  }
  console.log(`✓ ${outputPath}`);
  console.log(`  Set src to 'edit/preview-cut.mp4' in Root.tsx to preview smoothly.`);
}

const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('/cut-preview.js') || _argv1.endsWith('/cut-preview')) {
  main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
}

export default main;
