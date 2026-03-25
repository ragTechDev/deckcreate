#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import Diarizer from './Diarizer.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--audio' && args[i + 1]) result.audioPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.diarizationJsonPath = args[++i];
    else if (args[i] === '--num-speakers' && args[i + 1]) result.numSpeakers = parseInt(args[++i]);
    else if (args[i] === '--python' && args[i + 1]) result.pythonBin = args[++i];
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
  const diarizationJsonPath = cli.diarizationJsonPath
    || path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'diarization.json');

  if (!audioPath) {
    console.error('❌ No audio file found. Use --audio <path> or place a file in public/transcribe/input/');
    process.exit(1);
  }

  if (!cli.numSpeakers) {
    console.error('❌ --num-speakers is required. Example: npm run diarize -- --num-speakers 2');
    process.exit(1);
  }

  return {
    audioPath,
    diarizationJsonPath,
    numSpeakers: cli.numSpeakers,
    pythonBin: cli.pythonBin,
  };
}

async function main() {
  const cwd = process.cwd();
  const { audioPath, diarizationJsonPath, numSpeakers, pythonBin } = await resolveArgs(cwd);

  console.log('\nSpeaker Diarization');
  console.log(`  Audio:  ${audioPath}`);
  console.log(`  Output: ${diarizationJsonPath}`);
  if (numSpeakers) console.log(`  Speakers: ${numSpeakers} (locked)`);
  console.log('');

  const diarizer = new Diarizer({ audioPath, diarizationJsonPath, numSpeakers, pythonBin });

  try {
    await diarizer.initForDiarize();
    await diarizer.runDiarization();
    console.log('\nNext step: npm run assign-speakers');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await diarizer.close();
  }
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/')) {
  main();
}

export default main;
