#!/usr/bin/env node
/**
 * Generate final speaker cutouts from user selections.
 *
 * Reads selections.json, copies selected frames to final cutout files,
 * removes background, and writes manifest.json for thumbnail generation.
 *
 * Usage:
 *   node scripts/thumbnail/generate-cutouts-from-selection.js
 *     [--selections public/thumbnail/selections.json]
 *     [--output-dir public/thumbnail]
 */

import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';

async function removeBackground(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const pythonScript = `
import sys, shutil
try:
    from PIL import Image
    from rembg import remove
    img = Image.open('${inputPath}')
    output = remove(img)
    if output.mode != 'RGBA':
        output = output.convert('RGBA')
    import numpy as np
    arr = np.array(output)
    mask = arr[:, :, 3] > 10
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    if len(rows) and len(cols):
        output = output.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))
    output.save('${outputPath}', 'PNG')
    print('OK')
except Exception as e:
    sys.stderr.write(f'rembg error: {e}\\n')
    try:
        shutil.copy('${inputPath}', '${outputPath}')
        print('FALLBACK')
    except Exception as e2:
        sys.stderr.write(f'copy error: {e2}\\n')
`;
    const proc = spawn('python3', ['-c', pythonScript]);
    let output = '';
    let errors = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => {
      errors += data.toString();
    });
    proc.on('close', () => {
      if (errors) process.stderr.write(`    [rembg stderr] ${errors.trim()}\n`);
      if (output.includes('OK')) {
        resolve(true);
      } else if (output.includes('FALLBACK')) {
        resolve(false); // copied without bg removal
      } else {
        resolve(false); // both rembg and fallback copy failed
      }
    });
  });
}

async function main() {
  const cwd = process.cwd();

  const selectionsPath = process.argv.find((arg) => arg.startsWith('--selections='))
    ? process.argv.find((arg) => arg.startsWith('--selections=')).split('=')[1]
    : 'public/thumbnail/candidates/selections.json';

  const outputDir = process.argv.find((arg) => arg.startsWith('--output-dir='))
    ? process.argv.find((arg) => arg.startsWith('--output-dir=')).split('=')[1]
    : 'public/thumbnail/cutouts';

  const fullSelectionsPath = path.resolve(cwd, selectionsPath);
  const fullOutputDir = path.resolve(cwd, outputDir);

  if (!fs.existsSync(fullSelectionsPath)) {
    console.error(`Selections file not found: ${fullSelectionsPath}`);
    console.error('Run the wizard thumbnail step first, or manually:');
    console.error('  npm run thumbnail:frames:select');
    process.exit(1);
  }

  const selectionsData = await fs.readJson(fullSelectionsPath);
  const selections = selectionsData.selections || [];

  if (selections.length === 0) {
    console.error('No selections found');
    process.exit(1);
  }

  console.log(`Generating ${selections.length} final cutout(s)...\n`);

  const manifest = {};

  // Create output dir before any Python writes to it
  await fs.ensureDir(fullOutputDir);

  for (const sel of selections) {
    const speaker = sel.speaker;
    // Use the previewPath from selection data which includes angle suffix
    // previewPath is relative to public/ (e.g. "thumbnail/candidates/natasha_candidate_0_angle1.png")
    const candidatePath = sel.previewPath
      ? path.join(cwd, 'public', sel.previewPath)
      : path.join(path.dirname(fullOutputDir), 'candidates', `${speaker.toLowerCase()}_candidate_${sel.selectedIndex}.png`);
    const cutoutPath = path.join(fullOutputDir, `${speaker.toLowerCase()}_cutout.png`);

    if (!fs.existsSync(candidatePath)) {
      console.error(`  ${speaker}: Candidate file not found: ${candidatePath}`);
      continue;
    }

    console.log(`  ${speaker}: Removing background...`);
    const success = await removeBackground(candidatePath, cutoutPath);

    if (fs.existsSync(cutoutPath)) {
      manifest[speaker] = {
        cutout: `thumbnail/cutouts/${speaker.toLowerCase()}_cutout.png`,
        frameTimestamp: sel.timestamp,
        selectedIndex: sel.selectedIndex,
      };
      if (success) {
        console.log(`  ✓ ${speaker}: background removed → ${cutoutPath}`);
      } else {
        console.log(`  ✓ ${speaker}: copied without background removal (install rembg to enable)`);
      }
    }
  }

  const manifestPath = path.join(fullOutputDir, 'manifest.json');
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  console.log(`\n✓ Cutouts generated`);
  console.log(`✓ Manifest written: ${manifestPath}`);
  console.log('\nNext: Generate the thumbnail:');
  console.log('  npm run thumbnail');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
