#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import AudioSyncer from './AudioSyncer.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--video' && args[i + 1]) result.videoPath = args[++i];
    else if (args[i] === '--audio' && args[i + 1]) result.audioPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.outputPath = args[++i];
    else if (args[i] === '--window-seconds' && args[i + 1]) result.windowSeconds = parseFloat(args[++i]);
  }
  return result;
}

async function autoDetectFile(dir, extensions) {
  if (!await fs.pathExists(dir)) return null;
  const files = await fs.readdir(dir);
  const match = files.find((f) => extensions.includes(path.extname(f).toLowerCase()));
  return match ? path.join(dir, match) : null;
}

async function resolveArgs(cwd) {
  const cli = parseArgs();

  const videoPath = cli.videoPath
    || await autoDetectFile(path.join(cwd, 'public', 'video'), ['.mov', '.mp4', '.avi', '.mkv']);
  const audioPath = cli.audioPath
    || await autoDetectFile(path.join(cwd, 'public', 'audio'), ['.mp3', '.aac', '.wav', '.m4a']);
  const outputPath = cli.outputPath
    || path.join(cwd, 'public', 'output', 'synced-output.mp4');

  if (!videoPath) {
    console.error('❌ No video file found. Use --video <path> or place a video in public/video/');
    process.exit(1);
  }
  if (!audioPath) {
    console.error('❌ No audio file found. Use --audio <path> or place an audio file in public/audio/');
    process.exit(1);
  }

  return { videoPath, audioPath, outputPath, windowSeconds: cli.windowSeconds || null };
}

async function main() {
  const cwd = process.cwd();
  const { videoPath, audioPath, outputPath, windowSeconds } = await resolveArgs(cwd);

  console.log('\n🎬 Audio-Video Sync');
  console.log(`  Video:  ${videoPath}`);
  console.log(`  Audio:  ${audioPath}`);
  console.log(`  Output: ${outputPath}`);
  if (windowSeconds) console.log(`  Window: ${windowSeconds}s (cross-correlation window)`);
  console.log('');

  const syncer = new AudioSyncer({ videoPath, audioPath, outputPath, windowSeconds });

  try {
    await syncer.init();
    await syncer.sync();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await syncer.close();
  }
}

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/')) {
  main();
}

export default main;
