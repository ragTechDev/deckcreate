#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
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
    || path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.json');
  const videoPath = cli.videoPath
    || path.join(cwd, 'public', 'sync', 'output', 'synced-output.mp4');
  const outputPath = cli.outputPath
    || path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'preview-cut.mp4');

  if (!await fs.pathExists(transcriptPath)) {
    console.error(`❌ Transcript not found: ${transcriptPath}`); process.exit(1);
  }
  if (!await fs.pathExists(videoPath)) {
    console.error(`❌ Video not found: ${videoPath}`); process.exit(1);
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

  // Build ffmpeg filter_complex for video + audio concat
  const vFilters = clips.map((c, i) =>
    `[0:v]trim=start=${c.start}:end=${c.end},setpts=PTS-STARTPTS[v${i}]`
  );
  const aFilters = clips.map((c, i) =>
    `[0:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS[a${i}]`
  );
  const concatInputs = clips.map((_, i) => `[v${i}][a${i}]`).join('');
  const filterComplex = [
    ...vFilters,
    ...aFilters,
    `${concatInputs}concat=n=${clips.length}:v=1:a=1[outv][outa]`,
  ].join(';');

  const cmd = [
    'ffmpeg',
    `-i "${videoPath}"`,
    `-filter_complex "${filterComplex}"`,
    `-map "[outv]" -map "[outa]"`,
    `-c:v libx264 -preset fast -crf 18`,
    `-c:a aac`,
    `-y "${outputPath}"`,
  ].join(' ');

  execSync(cmd, { stdio: 'inherit' });
  console.log(`✓ ${outputPath}`);
  console.log(`  Set src to 'transcribe/output/edit/preview-cut.mp4' in Root.tsx to preview smoothly.`);
}

import { fileURLToPath } from 'url';
const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('/cut-preview.js') || _argv1.endsWith('/cut-preview')) {
  main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
}

export default main;
