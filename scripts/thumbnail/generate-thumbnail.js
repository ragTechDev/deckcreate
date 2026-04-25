#!/usr/bin/env node
/**
 * Generate a YouTube thumbnail for the current episode.
 *
 * Flow:
 *   1. Read transcript.json → title
 *   2. Auto-select layout variant (deterministic from title) or use --layout
 *   3. Invoke: npx remotion still remotion/index.ts PodcastThumbnail <output>
 *   4. Post-process with sharp (saturation + brightness boost)
 *
 * Usage:
 *   node scripts/thumbnail/generate-thumbnail.js [options]
 *
 * Options:
 *   --transcript <path>  relative to /public (default: edit/transcript.json)
 *   --layout <variant>   left|right|center (default: auto from title)
 *   --speakers <a> <b>   specific speakers to include
 *   --output <path>      absolute output path (default: public/thumbnail/thumbnail.png)
 *   --open               open result in Preview.app after render
 */

import path from 'path';
import fs from 'fs-extra';
import { spawnSync } from 'child_process';
const cwd = process.cwd();

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    transcript: 'edit/transcript.json',
    layout:     null,
    speakers:   null,
    output:     path.join(cwd, 'public', 'thumbnail', 'thumbnail.png'),
    open:       false,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--transcript': result.transcript = args[++i]; break;
      case '--layout':     result.layout     = args[++i]; break;
      case '--output':     result.output     = args[++i]; break;
      case '--open':       result.open       = true; break;
      case '--speakers': {
        const names = [];
        while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          names.push(args[++i]);
        }
        result.speakers = names.length ? names : null;
        break;
      }
    }
    i++;
  }
  return result;
}

// ── Layout variant selection ──────────────────────────────────────────────────

const VARIANTS = ['left', 'right', 'center'];

function autoVariant(title) {
  return VARIANTS[title.charCodeAt(0) % 3];
}

// ── Remotion still render ─────────────────────────────────────────────────────

function renderThumbnail(outputPath, props) {
  const result = spawnSync('npx', [
    'remotion', 'still',
    'remotion/index.ts',
    'PodcastThumbnail',
    outputPath,
    '--props', JSON.stringify(props),
    '--public-dir', 'public',
  ], { stdio: 'inherit', cwd });

  if (result.status !== 0) {
    throw new Error('remotion still render failed');
  }
}

// ── Post-process ──────────────────────────────────────────────────────────────

async function postProcess(filePath) {
  const { default: sharp } = await import('sharp');
  const tempPath = filePath.replace(/\.png$/, '_raw.png');
  await fs.rename(filePath, tempPath);
  await sharp(tempPath)
    .modulate({ saturation: 1.15, brightness: 1.05 })
    .toFile(filePath);
  await fs.remove(tempPath);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  const transcriptPath = path.join(cwd, 'public', args.transcript);

  if (!await fs.pathExists(transcriptPath)) {
    console.error(`Transcript not found: ${transcriptPath}`);
    process.exit(1);
  }
  const transcript = await fs.readJson(transcriptPath);

  const title = transcript.meta?.thumbnail?.title ?? '';
  if (title) console.log(`✓ Title: "${title}"`);

  // Use thumbnail overrides from transcript.meta.thumbnail if available
  const thumb = transcript.meta?.thumbnail;
  const layoutVariant = args.layout ?? thumb?.layoutVariant ?? autoVariant(title);
  console.log(`✓ Layout: ${layoutVariant}`);

  // Determine speakers from transcript segments
  const speakersInTranscript = [...new Set((transcript.segments || []).map(s => s.speaker).filter(Boolean))];
  console.log(`✓ Speakers: ${speakersInTranscript.join(', ')}`);

  // Identify guest speaker (not a regular host), with thumbnail override support
  const regularHosts = ['Natasha', 'Victoria'];
  const thumbMiddleSpeakers = thumb?.middleSpeakers;
  let middleSpeakers;
  if (thumbMiddleSpeakers?.length) {
    middleSpeakers = thumbMiddleSpeakers;
  } else {
    const guestSpeakers = speakersInTranscript.filter(s => !regularHosts.includes(s));
    middleSpeakers = guestSpeakers.length > 0 ? guestSpeakers : speakersInTranscript.slice(0, 1);
  }
  console.log(`✓ Middle speaker(s): ${middleSpeakers.join(', ')}`);

  const props = {
    transcriptSrc: args.transcript,
    brandSrc:      'brand.json',
    manifestSrc:   'thumbnail/cutouts/manifest.json',
    layoutVariant,
    title,
    middleSpeakers,
    ...(thumb?.bg?.length ? { backgroundSrcs: thumb.bg } : {}),
    ...(args.speakers?.length ? { speakerNames: args.speakers } : {}),
  };

  await fs.ensureDir(path.dirname(args.output));
  console.log('Rendering thumbnail...');
  renderThumbnail(args.output, props);

  if (await fs.pathExists(args.output)) {
    await postProcess(args.output);
    console.log(`✓ Thumbnail saved → ${args.output}`);
  } else {
    console.warn('  Output file not found after render — check remotion still output');
    process.exit(1);
  }

  if (args.open) {
    spawnSync('open', [args.output]);
  }
}

main().catch(err => {
  console.error(err.message ?? err);
  process.exit(1);
});
