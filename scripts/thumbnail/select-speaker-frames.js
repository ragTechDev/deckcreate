#!/usr/bin/env node
/**
 * Interactive CLI for selecting speaker frames from candidates.
 *
 * Reads candidates.json, presents options per speaker, writes selections.json
 * with chosen frames, then generates final cutouts.
 *
 * Usage:
 *   node scripts/thumbnail/select-speaker-frames.js
 *     [--candidates public/thumbnail/candidates.json]
 *     [--output public/thumbnail/selections.json]
 */

const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

const { execSync } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function selectFrameForSpeaker(speaker, candidates, baseDir) {
  console.log(`\n=== ${speaker} ===`);
  console.log(`Found ${candidates.length} candidate frame(s):\n`);

  // Display options
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const previewPath = path.join(baseDir, c.previewPath);
    const angle = c.angle || 'angle1';
    console.log(`  [${i}] ${path.basename(previewPath)}`);
    console.log(`      angle: ${angle}, timestamp: ${c.timestamp}s`);
  }

  // Auto-open previews if on macOS
  if (process.platform === 'darwin') {
    console.log('\n  Opening previews in Preview app...');
    for (const c of candidates) {
      const previewPath = path.join(baseDir, c.previewPath);
      if (fs.existsSync(previewPath)) {
        try {
          execSync(`open "${previewPath}"`, { stdio: 'ignore' });
        } catch {}
      }
    }
  }

  // Get selection
  let selection = null;
  while (selection === null) {
    const answer = await ask(`\nSelect frame [0-${candidates.length - 1}]: `);
    const idx = parseInt(answer, 10);
    if (!isNaN(idx) && idx >= 0 && idx < candidates.length) {
      selection = candidates[idx];
    } else {
      console.log('  Invalid selection. Please try again.');
    }
  }

  const angleInfo = selection.angle ? ` (${selection.angle})` : '';
  console.log(`  ✓ Selected: frame [${selection.index}]${angleInfo} at t=${selection.timestamp}s`);
  return selection;
}

async function main() {
  const cwd = process.cwd();

  const candidatesPath = process.argv.find((arg) => arg.startsWith('--candidates='))
    ? process.argv.find((arg) => arg.startsWith('--candidates=')).split('=')[1]
    : 'public/thumbnail/candidates/candidates.json';

  const outputPath = process.argv.find((arg) => arg.startsWith('--output='))
    ? process.argv.find((arg) => arg.startsWith('--output=')).split('=')[1]
    : 'public/thumbnail/candidates/selections.json';

  const fullCandidatesPath = path.resolve(cwd, candidatesPath);
  const fullOutputPath = path.resolve(cwd, outputPath);

  if (!fs.existsSync(fullCandidatesPath)) {
    console.error(`Candidates file not found: ${fullCandidatesPath}`);
    console.error('Run the extraction first:');
    console.error('  docker compose run --rm thumbnail npm run thumbnail:candidates:extract');
    process.exit(1);
  }

  const candidatesData = await fs.readJson(fullCandidatesPath);
  const speakers = candidatesData.speakers || [];

  if (speakers.length === 0) {
    console.error('No speakers found in candidates file');
    process.exit(1);
  }

  console.log(`Found ${speakers.length} speaker(s) with candidate frames\n`);
  console.log('For each speaker, choose your preferred frame.');
  console.log('Previews will open in your default image viewer.\n');

  const selections = [];

  for (const speakerData of speakers) {
    const selection = await selectFrameForSpeaker(
      speakerData.speaker,
      speakerData.candidates,
      path.dirname(fullCandidatesPath)
    );
    selections.push({
      speaker: speakerData.speaker,
      selectedIndex: selection.index,
      timestamp: selection.timestamp,
      previewPath: selection.previewPath,
    });
  }

  // Write selections
  await fs.writeJson(fullOutputPath, { selections }, { spaces: 2 });
  console.log(`\n✓ Selections saved: ${fullOutputPath}`);

  console.log('\nNext: Generate final cutouts from selections:');
  console.log('  docker compose run --rm thumbnail npm run thumbnail:cutouts:generate');

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
