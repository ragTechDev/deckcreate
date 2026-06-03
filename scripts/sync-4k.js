#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import AudioSyncer from './sync/AudioSyncer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '..');

const videoPaths = [
  path.join(cwd, 'input/video-backup/Wide Shot.MP4'),
  path.join(cwd, 'input/video-backup/angle2/SalVIc.MP4'),
  path.join(cwd, 'input/video-backup/angle3/SudNat.MP4'),
];

const audioPath = path.join(cwd, 'input/audio/Stereo Mix.wav');
const outputDir = path.join(cwd, 'public/sync/output');

console.log('\n🎬 Multi-angle 4K Sync');
console.log('  Videos:');
videoPaths.forEach((v, i) => console.log(`    Angle ${i + 1}: ${v}`));
console.log(`  Audio:  ${audioPath}`);
console.log(`  Output: ${outputDir}`);
console.log('');

try {
  const results = await AudioSyncer.syncMultiple(videoPaths, audioPath, outputDir);
  console.log('\n✅ Sync complete!');
  console.log('  Output files:');
  results.forEach((r) => {
    console.log(`    ${r.outputPath}`);
    console.log(`      ${r.sourceWidth}×${r.sourceHeight}, videoStart: ${r.videoStart.toFixed(3)}s`);
  });
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
