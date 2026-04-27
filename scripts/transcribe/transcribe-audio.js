#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import Transcriber from './Transcriber.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--audio' && args[i + 1]) result.audioPath = args[++i];
    else if (args[i] === '--output-dir' && args[i + 1]) result.outputDir = args[++i];
    else if (args[i] === '--model' && args[i + 1]) result.model = args[++i];
    else if (args[i] === '--timestamp-offset' && args[i + 1]) result.timestampOffset = parseFloat(args[++i]);
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

  const audioPath = cli.audioPath
    || await autoDetectFile(path.join(cwd, 'public', 'transcribe', 'input'), ['.mp3', '.aac', '.wav', '.m4a']);
  const outputDir = cli.outputDir || path.join(cwd, 'public', 'transcribe', 'output', 'raw');

  if (!audioPath) {
    console.error('❌ No audio file found. Use --audio <path> or place a file in public/transcribe/input/');
    process.exit(1);
  }

  return { audioPath, outputDir, model: cli.model, timestampOffset: cli.timestampOffset || 0 };
}

async function main() {
  const cwd = process.cwd();
  const { audioPath, outputDir, model, timestampOffset } = await resolveArgs(cwd);

  console.log('\nTranscription');
  console.log(`  Audio:      ${audioPath}`);
  console.log(`  Output dir: ${outputDir}`);
  if (timestampOffset) console.log(`  Offset:     -${timestampOffset}s`);
  console.log('');

  const transcriber = new Transcriber({ audioPath, outputDir, model, timestampOffset });

  try {
    await transcriber.init();
    await transcriber.transcribe();
    console.log('\nNext steps:');
    console.log('  1. Optionally edit public/transcribe/output/raw/transcript.raw.vtt to correct word errors');
    console.log('  2. Run "npm run transcript:init" to produce transcript.json in public/edit/');
    console.log('     Or with corrected VTT: npm run transcript:init -- --merge-vtt public/transcribe/output/raw/transcript.raw.vtt');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await transcriber.close();
  }
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/')) {
  main();
}

export default main;
