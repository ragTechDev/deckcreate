#!/usr/bin/env node
/**
 * Generate a YouTube thumbnail for the current episode.
 *
 * Flow:
 *   1. Read transcript.json → extract hook text (≤4 words)
 *   2. Run extract-speaker-frames.py → cutouts + manifest.json
 *   3. Auto-select layout variant (deterministic from hook text) or use --layout
 *   4. Invoke: npx remotion still remotion/index.ts PodcastThumbnail <output>
 *   5. Post-process with sharp (saturation + brightness boost)
 *
 * Usage:
 *   node scripts/thumbnail/generate-thumbnail.js [options]
 *
 * Options:
 *   --transcript <path>      relative to /public (default: transcribe/output/edit/transcript.json)
 *   --camera-profiles <path> relative to /public (default: transcribe/output/camera/camera-profiles.json)
 *   --video <path>           relative to /public (default: sync/output/synced-output-1.mp4)
 *   --num-frames <n>         candidate frames per speaker (default: 8)
 *   --speakers <a> <b>       specific speakers to include
 *   --layout <variant>       left|right|center (default: auto from hook text)
 *   --skip-extract           skip face extraction, use existing manifest.json
 *   --output <path>          absolute output path (default: public/output/thumbnail.png)
 *   --open                   open result in Preview.app after render
 */

import path from 'path';
import fs from 'fs-extra';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    transcript:     'transcribe/output/edit/transcript.json',
    cameraProfiles: 'transcribe/output/camera/camera-profiles.json',
    video:          'sync/output/synced-output-1.mp4',
    numFrames:      8,
    speakers:       null,
    layout:         null,
    skipExtract:    false,
    output:         path.join(cwd, 'public', 'output', 'thumbnail.png'),
    open:           false,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case '--transcript':     result.transcript     = args[++i]; break;
      case '--camera-profiles':result.cameraProfiles = args[++i]; break;
      case '--video':          result.video          = args[++i]; break;
      case '--num-frames':     result.numFrames      = parseInt(args[++i], 10); break;
      case '--layout':         result.layout         = args[++i]; break;
      case '--skip-extract':   result.skipExtract    = true; break;
      case '--output':         result.output         = args[++i]; break;
      case '--open':           result.open           = true; break;
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

// ── Hook text extraction ──────────────────────────────────────────────────────

function truncate4(phrase) {
  const words = phrase.trim().split(/\s+/).slice(0, 4);
  if (words.length === 4) words[3] = words[3].replace(/[,;]$/, '');
  return words.join(' ');
}

function resolveHookText(transcript) {
  const segments = transcript.segments ?? [];

  // Tier 1: hook segment with explicit hookPhrase + resolved hookFrom
  const t1 = segments
    .filter(s => s.hook && s.hookPhrase && s.hookFrom != null)
    .sort((a, b) => b.hookPhrase.split(/\s+/).length - a.hookPhrase.split(/\s+/).length)[0];
  if (t1) return truncate4(t1.hookPhrase);

  // Tier 2: first hook segment with text
  const t2 = segments.find(s => s.hook && s.text?.trim());
  if (t2) return truncate4(t2.text.trim());

  // Tier 3: title or fallback
  return truncate4(transcript.meta?.title ?? 'RAG Tech Podcast');
}

// ── Layout variant selection ──────────────────────────────────────────────────

const VARIANTS = ['left', 'right', 'center'];

function autoVariant(hookText) {
  return VARIANTS[hookText.charCodeAt(0) % 3];
}

// ── Face extraction ───────────────────────────────────────────────────────────

function runFaceExtraction({ transcript, cameraProfiles, video, numFrames, speakers, outputDir }) {
  const scriptPath = path.join(__dirname, 'extract-speaker-frames.py');
  const pyArgs = [
    scriptPath,
    '--transcript',      path.join(cwd, 'public', transcript),
    '--camera-profiles', path.join(cwd, 'public', cameraProfiles),
    '--video',           path.join(cwd, 'public', video),
    '--output-dir',      outputDir,
    '--num-frames',      String(numFrames),
  ];
  if (speakers?.length) pyArgs.push('--speakers', ...speakers);

  execFileSync('python3', pyArgs, { stdio: 'inherit', cwd });
}

// ── Remotion still render ─────────────────────────────────────────────────────

function renderThumbnail(outputPath, props) {
  const result = spawnSync('npx', [
    'remotion', 'still',
    'remotion/index.ts',
    'PodcastThumbnail',
    outputPath,
    '--props', JSON.stringify(props),
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
  const outputDir      = path.join(cwd, 'public', 'transcribe', 'output', 'thumbnail');

  // 1. Load transcript → hook text
  if (!await fs.pathExists(transcriptPath)) {
    console.error(`Transcript not found: ${transcriptPath}`);
    console.error('Run the transcription pipeline first, or pass --transcript <path>');
    process.exit(1);
  }
  const transcript = await fs.readJson(transcriptPath);
  const hookText   = resolveHookText(transcript);
  console.log(`✓ Hook text: "${hookText}"`);

  // 2. Face extraction
  if (!args.skipExtract) {
    const videoPath = path.join(cwd, 'public', args.video);
    if (!await fs.pathExists(videoPath)) {
      console.warn(`  Video not found: ${videoPath} — skipping face extraction`);
      console.warn('  Pass --skip-extract if you already have cutouts, or --video <path>');
    } else {
      console.log('Extracting speaker frames...');
      await fs.ensureDir(outputDir);
      runFaceExtraction({
        transcript:     args.transcript,
        cameraProfiles: args.cameraProfiles,
        video:          args.video,
        numFrames:      args.numFrames,
        speakers:       args.speakers,
        outputDir,
      });
    }
  } else {
    console.log('  Skipping face extraction (--skip-extract)');
  }

  // 3. Layout variant
  const layoutVariant = args.layout ?? autoVariant(hookText);
  console.log(`✓ Layout: ${layoutVariant}`);

  // 4. Build props for Remotion
  const props = {
    transcriptSrc:  args.transcript,
    brandSrc:       'brand.json',
    manifestSrc:    'transcribe/output/thumbnail/manifest.json',
    layoutVariant,
    ...(args.speakers?.length ? { speakerNames: args.speakers } : {}),
  };

  // 5. Render
  await fs.ensureDir(path.dirname(args.output));
  console.log('Rendering thumbnail...');
  renderThumbnail(args.output, props);

  // 6. Post-process
  if (await fs.pathExists(args.output)) {
    await postProcess(args.output);
    console.log(`✓ Thumbnail saved → ${args.output}`);
  } else {
    console.warn('  Output file not found after render — check remotion still output');
    process.exit(1);
  }

  // 7. Open
  if (args.open) {
    spawnSync('open', [args.output]);
  }
}

main().catch(err => {
  console.error(err.message ?? err);
  process.exit(1);
});
