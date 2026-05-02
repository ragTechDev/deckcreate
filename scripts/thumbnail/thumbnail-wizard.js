#!/usr/bin/env node
/**
 * Thumbnail Creation Wizard — Step-by-step thumbnail generation with skip options.
 *
 * Usage: npm run thumbnail:wizard
 */

import readline from 'readline';
import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '../..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

function spawnStep(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      cwd,
      shell: process.platform === 'win32',
      ...opts,
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Exited with code ${code}`));
    });
    proc.on('error', e => reject(new Error(e.message)));
  });
}

function openFile(filePath) {
  const cmd = process.platform === 'win32' ? 'start ""'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    execSync(`${cmd} "${filePath}"`, { stdio: 'ignore', shell: true });
  } catch {
    // Silently ignore - image viewer not available (e.g., in Docker)
  }
}

async function confirm(q, defaultYes = true) {
  const hint = defaultYes ? '[Y/n/s]' : '[y/N/s]';
  const ans = (await ask(`  ${q} ${hint} `)).trim().toLowerCase();
  if (ans === 's') return 'skip';
  return defaultYes ? ans !== 'n' : ans === 'y';
}

function quit() {
  console.log('\nExiting wizard.\n');
  rl.close();
  process.exit(0);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         Thumbnail Creation Wizard                        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('This wizard will guide you through creating a thumbnail with');
  console.log('frame selection for each speaker. You can skip any step.');
  console.log('');
  console.log('  [Y] = Yes (default)');
  console.log('  [n] = No');
  console.log('  [s] = Skip this step');
  console.log('');

  const candidatesDir = path.join(cwd, 'public', 'thumbnail', 'candidates');
  const cutoutsDir    = path.join(cwd, 'public', 'thumbnail', 'cutouts');
  const candidatesPath = path.join(candidatesDir, 'candidates.json');
  const selectionsPath = path.join(candidatesDir, 'selections.json');
  const manifestPath   = path.join(cutoutsDir, 'manifest.json');
  const outputPath     = path.join(cwd, 'public', 'thumbnail', 'thumbnail.png');

  // Detect video file
  const syncOutputDir = path.join(cwd, 'public', 'sync', 'output');
  let videoFile = null;
  if (await fs.pathExists(syncOutputDir)) {
    const files = await fs.readdir(syncOutputDir);
    videoFile = files.find(f => f.endsWith('.mp4') && f.includes('synced'));
  }
  videoFile = videoFile || 'synced-output-1.mp4';
  const videoPath = path.join('public', 'sync', 'output', videoFile);

  // Check prerequisites
  const transcriptPath = path.join(cwd, 'public', 'edit', 'transcript.json');
  const cameraProfilesPath = path.join(cwd, 'public', 'camera', 'camera-profiles.json');

  if (!await fs.pathExists(transcriptPath)) {
    console.error('✗ Transcript not found. Run the main wizard first:');
    console.error('  npm run wizard');
    process.exit(1);
  }

  if (!await fs.pathExists(cameraProfilesPath)) {
    console.error('✗ Camera profiles not found. Run camera setup first:');
    console.error('  npm run wizard');
    process.exit(1);
  }

  // STEP 0: Define speaker frame boundaries
  console.log('\n─── STEP 0: Define Speaker Frame Boundaries ───────────────────────');
  console.log('Before extracting candidates, verify that each speaker\'s face box is');
  console.log('correctly positioned in the camera GUI. This ensures the right faces');
  console.log('are extracted for each speaker.\n');
  console.log('Important: The camera GUI will open in "thumbnail" mode. For each');
  console.log('speaker, ensure their face box is correctly assigned and positioned.');

  const thumbnailProfilesPath = path.join(cwd, 'public', 'thumbnail', 'camera-profiles.json');
  let haveThumbnailProfiles = await fs.pathExists(thumbnailProfilesPath);

  if (haveThumbnailProfiles) {
    const recheck = await confirm('Thumbnail camera profiles already exist. Re-configure?', false);
    if (recheck === 'skip') {
      console.log('  → Skipping frame boundary configuration');
    } else if (recheck) {
      haveThumbnailProfiles = false;
    }
  }

  if (!haveThumbnailProfiles) {
    // Copy main camera profiles as starting point
    await fs.ensureDir(path.dirname(thumbnailProfilesPath));
    const baseProfiles = await fs.readJson(cameraProfilesPath);
    await fs.writeJson(thumbnailProfilesPath, baseProfiles, { spaces: 2 });
    console.log('  ✓ Created editable thumbnail profiles from base camera profiles');

    // Prompt user to open camera GUI
    console.log('\n  Please open the camera GUI to verify speaker boundaries:');
    console.log('    http://localhost:3000/camera?mode=thumbnail');
    console.log('\n  Instructions:');
    console.log('    1. Ensure the dev server is running: npm run dev');
    console.log('    2. Open the URL above in your browser');
    console.log('    3. Verify each face box is correctly positioned for each speaker');
    console.log('    4. Click "Save profiles" when done (saves to thumbnail/camera-profiles.json)');
    console.log('');

    const ready = await confirm('Have you verified and saved the speaker boundaries?', false);
    if (!ready) {
      console.log('\n  Please run the wizard again after configuring boundaries.');
      quit();
    }

    if (!await fs.pathExists(thumbnailProfilesPath)) {
      console.error('\n  ✗ Thumbnail profiles not saved. Please save in the camera GUI.');
      quit();
    }

    console.log('  ✓ Frame boundaries configured');
  }

  // STEP 1: Extract candidate frames
  console.log('\n─── STEP 1: Extract Candidate Frames ───────────────────');
  console.log('Extract 3 candidate frames per speaker from speaking segments.');
  console.log('Frames with multiple faces are automatically rejected.');

  let haveCandidates = await fs.pathExists(candidatesPath);
  if (haveCandidates) {
    const recheck = await confirm('Candidate frames already exist. Re-extract?', false);
    if (recheck === 'skip') {
      console.log('  → Skipping extraction');
    } else if (recheck) {
      haveCandidates = false;
    }
  }

  if (!haveCandidates) {
    try {
      await spawnStep('python3', [
        'scripts/thumbnail/extract-speaker-candidates.py',
        '--transcript', transcriptPath,
        '--camera-profiles', thumbnailProfilesPath,
        '--video', videoPath,
        '--output-dir', candidatesDir,
        '--num-candidates', '6',
      ]);
      console.log('  ✓ Candidates extracted');
    } catch (err) {
      console.error(`  ✗ Extraction failed: ${err.message}`);
      const cont = await confirm('Continue anyway?', false);
      if (!cont) quit();
    }
  }

  if (!await fs.pathExists(candidatesPath)) {
    console.log('  ⚠ No candidates available — cannot continue');
    quit();
  }

  // STEP 2: Select frames
  console.log('\n─── STEP 2: Select Preferred Frames ──────────────────────');
  console.log('Choose your preferred frame for each speaker.');
  console.log('Open the image files manually to compare, then enter the number.');

  let haveSelections = await fs.pathExists(selectionsPath);
  if (haveSelections) {
    const recheck = await confirm('Frame selections already exist. Re-select?', false);
    if (recheck === 'skip') {
      console.log('  → Skipping selection');
    } else if (recheck) {
      haveSelections = false;
    }
  }

  if (!haveSelections) {
    const candidatesData = await fs.readJson(candidatesPath);
    const speakers = candidatesData.speakers || [];

    if (speakers.length === 0) {
      console.log('  ⚠ No speakers found in candidates');
      quit();
    }

    console.log(`\n  Found ${speakers.length} speaker(s) with candidate frames\n`);

    const selections = [];

    for (const speakerData of speakers) {
      const speaker = speakerData.speaker;
      const candidates = speakerData.candidates;

      if (candidates.length === 0) {
        console.log(`  ⚠ ${speaker}: No valid candidates`);
        continue;
      }

      console.log(`\n┌─ ${speaker} ─${'─'.repeat(50 - speaker.length)}┐`);
      console.log('│');
      console.log(`│  ${candidates.length} candidate frame(s) available:`);
      console.log('│');

      // Build a map of valid indices for validation
      const validIndices = new Set(candidates.map(c => c.index));

      for (const c of candidates) {
        const previewFile = path.basename(c.previewPath);
        const angle = c.angle || 'angle1';
        console.log(`│    [${c.index}] ${previewFile}`);
        console.log(`│        angle: ${angle}, timestamp: ${c.timestamp}s`);
      }
      console.log('│');
      console.log(`│  Location: ${candidatesDir}/`);
      console.log('│');

      // Get selection - use actual indices from candidates
      let selectedIndex = null;
      while (selectedIndex === null) {
        const indexList = candidates.map(c => c.index).join(',');
        const answer = (await ask(`│  Select frame index [${indexList}] (or 's' to skip): `)).trim().toLowerCase();
        if (answer === 's' || answer === 'skip') {
          selectedIndex = 'skip';
          break;
        }
        const idx = parseInt(answer, 10);
        if (!isNaN(idx) && validIndices.has(idx)) {
          selectedIndex = idx;
        } else {
          console.log(`│  Invalid selection. Valid indices: ${indexList}`);
        }
      }

      if (selectedIndex === 'skip') {
        console.log(`│  → Skipped ${speaker}`);
        console.log('└' + '─'.repeat(54) + '┘');
        continue;
      }

      const selected = candidates.find(c => c.index === selectedIndex);
      selections.push({
        speaker,
        selectedIndex,
        timestamp: selected.timestamp,
        previewPath: selected.previewPath,
      });
      console.log(`│  ✓ Selected: frame [${selectedIndex}] at ${selected.timestamp}s`);
      console.log('└' + '─'.repeat(54) + '┘');
    }

    if (selections.length === 0) {
      console.log('\n  ⚠ No frames selected — cannot continue');
      quit();
    }

    await fs.writeJson(selectionsPath, { selections }, { spaces: 2 });
    console.log(`\n  ✓ Selections saved (${selections.length} speaker(s))`);
  }

  // STEP 3: Generate cutouts
  console.log('\n─── STEP 3: Generate Final Cutouts ────────────────────────');
  console.log('Apply background removal to selected frames.');

  let haveCutouts = await fs.pathExists(manifestPath);
  if (haveCutouts) {
    const recheck = await confirm('Cutouts already exist. Regenerate?', false);
    if (recheck === 'skip') {
      console.log('  → Skipping cutout generation');
    } else if (recheck) {
      haveCutouts = false;
    }
  }

  if (!haveCutouts) {
    if (!await fs.pathExists(selectionsPath)) {
      console.log('  ⚠ No selections found — cannot generate cutouts');
      quit();
    }

    try {
      await spawnStep('node', [
        'scripts/thumbnail/generate-cutouts-from-selection.js',
        '--selections', selectionsPath,
        '--output-dir', cutoutsDir,
      ]);
      console.log('  ✓ Cutouts generated');
    } catch (err) {
      console.error(`  ✗ Cutout generation failed: ${err.message}`);
      const cont = await confirm('Continue anyway?', false);
      if (!cont) quit();
    }
  }

  // STEP 4: Generate thumbnail
  console.log('\n─── STEP 4: Generate Thumbnail ───────────────────────────');
  console.log('Compose the final thumbnail with speaker cutouts.');

  let haveThumbnail = await fs.pathExists(outputPath);
  if (haveThumbnail) {
    const recheck = await confirm('Thumbnail already exists. Regenerate?', false);
    if (recheck === 'skip') {
      console.log('  → Skipping thumbnail generation');
      rl.close();
      return;
    } else if (recheck) {
      haveThumbnail = false;
    }
  }

  if (!haveThumbnail) {
    // Load transcript for title
    const transcript = await fs.readJson(transcriptPath);
    const title = transcript.meta?.title || '';

    // Load selections for speaker names
    const selectionsData = await fs.readJson(selectionsPath);
    const speakerNames = selectionsData.selections.map(s => s.speaker);

    if (speakerNames.length === 0) {
      console.log('  ⚠ No speakers selected — cannot generate thumbnail');
      quit();
    }

    const args = [
      'scripts/thumbnail/generate-thumbnail.js',
      '--transcript', 'edit/transcript.json',
      '--camera-profiles', 'camera/camera-profiles.json',
      '--video', videoPath.replace(/^public\//, ''),
      '--output', path.join(cwd, 'public', 'thumbnail', 'thumbnail.png'),
      '--skip-extract',  // Use pre-selected cutouts, don't re-extract
      '--speakers', ...speakerNames,
    ];
    if (title) args.push('--title', title);

    try {
      await spawnStep('node', args);
      console.log(`\n  ✓ Thumbnail saved: public/thumbnail/thumbnail.png`);
      openFile(outputPath);
    } catch (err) {
      console.error(`  ✗ Thumbnail generation failed: ${err.message}`);
    }
  }

  // STEP 5: Clean up candidate files
  console.log('\n─── STEP 5: Clean Up Candidate Files ─────────────────────');

  const dirsToCheck = [
    { label: 'candidate frames', dir: candidatesDir },
    { label: 'speaker cutouts',  dir: cutoutsDir    },
  ];

  for (const { label, dir } of dirsToCheck) {
    if (!await fs.pathExists(dir)) continue;
    const files = await fs.readdir(dir);
    if (files.length === 0) continue;
    const totalSize = (await Promise.all(
      files.map(async f => (await fs.stat(path.join(dir, f))).size)
    )).reduce((a, b) => a + b, 0);
    const sizeMb = (totalSize / 1024 / 1024).toFixed(1);
    const clear = await confirm(
      `Clear ${label}? (${files.length} file(s), ~${sizeMb} MB)`,
      false,
    );
    if (clear === true) {
      await fs.emptyDir(dir);
      console.log(`  ✓ Cleared ${label}`);
    } else {
      console.log(`  → Kept ${label}`);
    }
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              Thumbnail Wizard Complete!                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  rl.close();
}

main().catch(err => {
  console.error('\n✗ Wizard error:', err.message);
  rl.close();
  process.exit(1);
});
