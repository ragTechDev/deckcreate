#!/usr/bin/env node
/**
 * DeckCreate — Create line-caption artifacts from a raw short-form portrait video.
 *
 * Usage:
 *   node scripts/line-captions/create-line-captions.js --video <path> [--num-speakers N] [--id <slug>]
 */

import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import Transcriber from '../transcribe/Transcriber.js';
import { chunkIntoLines } from './chunkLines.js';
import { stampMetadata } from '../config/metadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '../..');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--video' && args[i + 1]) result.videoPath = args[++i];
    else if (args[i] === '--num-speakers' && args[i + 1]) result.numSpeakers = parseInt(args[++i], 10);
    else if (args[i] === '--id' && args[i + 1]) result.id = args[++i];
  }
  return result;
}

async function resolveClipId(explicitId) {
  const lineCaptionsDir = path.join(cwd, 'public', 'line-captions');
  await fs.ensureDir(lineCaptionsDir);
  if (explicitId) return explicitId;

  const existingIds = (await fs.readdir(lineCaptionsDir))
    .filter(d => /^clip-\d+$/.test(d))
    .map(d => parseInt(d.replace('clip-', ''), 10));
  const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
  return `clip-${nextId}`;
}

function spawnNode(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      cwd,
      shell: process.platform === 'win32',
    });
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`))));
    proc.on('error', e => reject(new Error(`Failed to spawn ${scriptPath}: ${e.message}`)));
  });
}

function extractAudio(videoPath, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-y', outPath,
    ], { stdio: ['ignore', 'ignore', 'inherit'], cwd });
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
    proc.on('error', e => reject(new Error(`Failed to spawn ffmpeg: ${e.message}`)));
  });
}

function buildLineDoc(linesDoc) {
  const lines = [];
  let lastSpeaker = null;

  for (const line of linesDoc.lines) {
    if (line.speaker !== lastSpeaker) {
      if (lastSpeaker !== null) lines.push('');
      lines.push(`=== ${line.speaker} ===`);
      lines.push('');
      lastSpeaker = line.speaker;
    }
    lines.push(`[${line.id}]  ${line.text}`);
  }

  return lines.join('\n') + '\n';
}

async function main() {
  const { videoPath, numSpeakers, id: explicitId } = parseArgs();

  if (!videoPath) {
    console.error('Usage: create-line-captions.js --video <path> [--num-speakers N] [--id <slug>]');
    process.exit(1);
  }
  if (!await fs.pathExists(videoPath)) {
    console.error(`❌ Video file not found: ${videoPath}`);
    process.exit(1);
  }

  const id = await resolveClipId(explicitId);
  const clipDir = path.join(cwd, 'public', 'line-captions', id);
  await fs.ensureDir(clipDir);

  console.log('\nLine captions — create');
  console.log(`  Video:    ${videoPath}`);
  console.log(`  Clip id:  ${id}`);
  if (numSpeakers) console.log(`  Speakers: ${numSpeakers}`);
  console.log('');

  const sourcePath = path.join(clipDir, `source${path.extname(videoPath)}`);
  console.log('Step 1/5: Copying source video...');
  await fs.copy(videoPath, sourcePath);

  const audioPath = path.join(clipDir, 'audio.wav');
  console.log('Step 2/5: Extracting audio...');
  await extractAudio(sourcePath, audioPath);

  const transcribeOutputDir = path.join(clipDir, 'transcribe', 'raw');
  const rawJsonPath = path.join(transcribeOutputDir, 'transcript.raw.json');
  console.log('Step 3/5: Transcribing...');
  const transcriber = new Transcriber({ audioPath, outputDir: transcribeOutputDir });
  try {
    await transcriber.init();
    await transcriber.transcribe();
  } finally {
    await transcriber.close();
  }

  console.log('Step 4/5: Aligning word timestamps...');
  await spawnNode(path.join(cwd, 'scripts', 'align', 'align-transcript.js'), [
    '--audio', audioPath, '--raw', rawJsonPath,
  ]);

  if (numSpeakers && numSpeakers > 1) {
    const diarizationJsonPath = path.join(transcribeOutputDir, 'diarization.json');
    console.log(`Diarizing ${numSpeakers} speakers...`);
    await spawnNode(path.join(cwd, 'scripts', 'diarize', 'diarize-audio.js'), [
      '--audio', audioPath, '--output', diarizationJsonPath, '--num-speakers', String(numSpeakers),
    ]);
    await spawnNode(path.join(cwd, 'scripts', 'diarize', 'assign-speakers.js'), [
      '--diarization', diarizationJsonPath, '--raw', rawJsonPath,
    ]);
  }

  console.log('Step 5/5: Chunking into 3-word lines...');
  const rawTranscript = await fs.readJson(rawJsonPath);
  const lines = chunkIntoLines(rawTranscript.segments);

  const linesDoc = {
    meta: {
      title: rawTranscript.meta.title || id,
      duration: rawTranscript.meta.duration,
      fps: rawTranscript.meta.fps,
      videoSrc: `line-captions/${id}/${path.basename(sourcePath)}`,
    },
    lines,
  };

  const linesJsonPath = path.join(clipDir, 'lines.json');
  const linesDocPath = path.join(clipDir, 'lines.doc.txt');
  await fs.writeJson(linesJsonPath, stampMetadata(linesDoc, cwd), { spaces: 2 });
  await fs.writeFile(linesDocPath, buildLineDoc(linesDoc), 'utf-8');

  console.log(`\n✓ Wrote ${lines.length} caption lines`);
  console.log(`  ${path.relative(cwd, linesJsonPath)}`);
  console.log(`  ${path.relative(cwd, linesDocPath)}`);
  console.log('\nNext steps:');
  console.log(`  1. Edit ${path.relative(cwd, linesDocPath)} — reword lines as needed (keep [id] markers as-is)`);
  console.log(`  2. Run: npm run captions:merge -- --id ${id}`);
  console.log(`  3. Run: npm run captions:render -- --id ${id}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

export { buildLineDoc };
