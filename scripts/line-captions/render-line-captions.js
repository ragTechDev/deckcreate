#!/usr/bin/env node
/**
 * Render a line-caption clip.
 *
 * Usage:
 *   node scripts/line-captions/render-line-captions.js --id <slug>
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
    console.error('Usage: render-line-captions.js --id <slug>');
    console.error('Example: render-line-captions.js --id clip-1');
    process.exit(1);
  }

  const linesJsonPath = path.join(cwd, 'public', 'line-captions', args.id, 'lines.json');
  if (!await fs.pathExists(linesJsonPath)) {
    console.error(`✗ lines.json not found: ${linesJsonPath}`);
    console.error('Run captions:create (and captions:merge) first.');
    process.exit(1);
  }

  const outName = `${args.id}.mp4`;
  console.log(`Rendering line-caption clip: ${args.id}`);
  console.log(`Output file: ${outName}`);

  const renderArgs = [
    'remotion', 'render',
    'remotion/index.ts',
    `LineCaptionClip-${args.id}`,
    '--outName', outName,
    '--props', JSON.stringify({
      linesSrc: `line-captions/${args.id}/lines.json`,
      brandSrc: 'brand.json',
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
