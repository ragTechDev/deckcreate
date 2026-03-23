#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import Diarizer from './Diarizer.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--diarization' && args[i + 1]) result.diarizationJsonPath = args[++i];
    else if (args[i] === '--raw' && args[i + 1]) result.rawJsonPath = args[++i];
  }
  return result;
}

async function resolveArgs(cwd) {
  const cli = parseArgs();

  return {
    diarizationJsonPath: cli.diarizationJsonPath
      || path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'diarization.json'),
    rawJsonPath: cli.rawJsonPath
      || path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'transcript.raw.json'),
  };
}

async function main() {
  const cwd = process.cwd();
  const { diarizationJsonPath, rawJsonPath } = await resolveArgs(cwd);

  console.log('\nAssign Speakers');
  console.log(`  Diarization: ${diarizationJsonPath}`);
  console.log(`  Transcript:  ${rawJsonPath}`);
  console.log('');

  const diarizer = new Diarizer({ diarizationJsonPath, rawJsonPath });

  try {
    await diarizer.initForAssign();
    await diarizer.runAssignment();
    console.log('\nNext steps:');
    console.log('  Run "npm run edit-transcript" to regenerate transcript.doc.txt with speaker labels.');
    console.log('  Rename SPEAKER_00, SPEAKER_01, etc. to real names in the doc, then re-run edit-transcript.');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/')) {
  main();
}

export default main;
