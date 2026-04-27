#!/usr/bin/env node
/**
 * Render a short-form clip with output filename from transcript meta.
 *
 * Usage:
 *   node scripts/shorts/render-short.js --id <short-id>
 *
 * The output filename is read from transcript.meta.outName (set by merge-short-doc.js).
 * Falls back to <short-id>.mp4 if outName is not set.
 */

import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '../..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--id') args.id = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.id) {
    console.error('Usage: render-short.js --id <short-id>');
    console.error('Example: render-short.js --id mediocrity');
    process.exit(1);
  }

  const transcriptPath = path.join(cwd, 'public', 'shorts', args.id, 'transcript.json');
  if (!await fs.pathExists(transcriptPath)) {
    console.error(`✗ Transcript not found: ${transcriptPath}`);
    console.error('Run shorts:wizard first to create the short.');
    process.exit(1);
  }

  const transcript = await fs.readJson(transcriptPath);
  const outName = transcript.meta?.outName || `${args.id}.mp4`;

  console.log(`Rendering short: ${args.id}`);
  console.log(`Output file: ${outName}`);

  const renderArgs = [
    'remotion', 'render',
    'remotion/index.ts',
    'ShortFormClip',
    '--outName', outName,
    '--props', JSON.stringify({
      src: transcript.meta?.videoSrc || 'sync/output/synced-output-1.mp4',
      transcriptSrc: `shorts/${args.id}/transcript.json`,
      cameraProfilesSrc: 'shorts/camera-profiles.json',
      brandSrc: 'brand.json',
      hookMusicSrc: 'sounds/hook-music.mp3',
    }),
  ];

  console.log(`\nRunning: npx ${renderArgs.join(' ')}`);

  await new Promise((resolve, reject) => {
    const proc = spawn('npx', renderArgs, {
      stdio: 'inherit',
      cwd,
      shell: process.platform === 'win32',
    });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Render exited ${code}`)));
    proc.on('error', e => reject(e));
  });

  console.log(`\n✓ Rendered: public/renders/${outName}`);
}

main().catch(err => {
  console.error('✗', err.message);
  process.exit(1);
});
