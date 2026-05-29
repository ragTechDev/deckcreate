#!/usr/bin/env node
/**
 * Render the full longform episode (ragTechVodcast composition).
 *
 * Duration is derived automatically via Remotion's calculateMetadata, so no
 * frame-range pre-calculation is needed here.
 *
 * Usage:
 *   npm run render:episode -- [options]
 *
 * Options:
 *   --transcript <path>        transcript.json path (default: public/edit/transcript.json)
 *   --camera-profiles <path>   camera-profiles.json path relative to public/
 *                              (default: camera/camera-profiles.json)
 *   --out <path>               Output video path (default: public/renders/episode.mp4)
 *   --hook-music <src>         Hook music path relative to public/
 *                              (default: sounds/jazz-cafe-music.mp3)
 *   --no-hook-music            Disable hook music overlay
 *   --concurrency <n>          Remotion render concurrency (default: unset, uses Remotion default)
 *   --timeout <ms>             Per-frame timeout in ms (default: 300000)
 *   --frames <range>           Frame range to render, e.g. 0-67337 (default: all frames)
 *   --overwrite                Overwrite existing output file
 *   --entry <path>             Remotion entry file (default: remotion/index.ts)
 *   --composition <id>         Remotion composition id (default: ragTechVodcast)
 *   --help, -h                 Show this help
 */

import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { checkMediaUrls } from './lib/checkMediaUrls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    transcriptPath:    null,
    cameraProfilesSrc: 'camera/camera-profiles.json',
    outputPath:        null,
    entry:             'remotion/index.ts',
    compositionId:     'ragTechVodcast',
    hookMusicSrc:      'sounds/jazz-cafe-music.mp3',
    concurrency:       null,
    timeout:           300000,
    frames:            null,
    overwrite:         false,
    skipUrlCheck:      false,
    help:              false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if      (a === '--transcript'      && args[i + 1]) out.transcriptPath    = args[++i];
    else if (a === '--camera-profiles' && args[i + 1]) out.cameraProfilesSrc = args[++i];
    else if (a === '--out'             && args[i + 1]) out.outputPath        = args[++i];
    else if (a === '--entry'           && args[i + 1]) out.entry             = args[++i];
    else if (a === '--composition'     && args[i + 1]) out.compositionId     = args[++i];
    else if (a === '--hook-music'      && args[i + 1]) out.hookMusicSrc      = args[++i];
    else if (a === '--no-hook-music')                  out.hookMusicSrc      = '';
    else if (a === '--concurrency'     && args[i + 1]) out.concurrency       = parseInt(args[++i], 10);
    else if (a === '--skip-url-check')                 out.skipUrlCheck      = true;
    else if (a === '--timeout'         && args[i + 1]) out.timeout           = parseInt(args[++i], 10);
    else if (a === '--frames'          && args[i + 1]) out.frames            = args[++i];
    else if (a === '--overwrite')                      out.overwrite         = true;
    else if (a === '--help' || a === '-h')             out.help              = true;
  }

  return out;
}

function printHelp() {
  console.log(`
Render the full longform episode

Usage:
  npm run render:episode -- [options]

Options:
  --transcript <path>        transcript.json path (default: public/edit/transcript.json)
  --camera-profiles <path>   Camera profiles path relative to public/
                             (default: camera/camera-profiles.json)
  --out <path>               Output video path (default: public/renders/episode.mp4)
  --hook-music <src>         Hook music path relative to public/
                             (default: sounds/jazz-cafe-music.mp3)
  --no-hook-music            Disable hook music overlay
  --concurrency <n>          Remotion render concurrency
  --timeout <ms>             Per-frame timeout in ms (default: 300000)
  --frames <range>           Frame range to render, e.g. 0-67337 (default: all frames)
  --overwrite                Overwrite existing output file
  --entry <path>             Remotion entry file (default: remotion/index.ts)
  --composition <id>         Remotion composition id (default: ragTechVodcast)
  --help, -h                 Show this help
`);
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
    proc.on('error', err => reject(err));
  });
}

function toPublicRelative(publicDir, absPath) {
  const rel = path.relative(publicDir, absPath).replace(/\\/g, '/');
  if (rel.startsWith('..')) throw new Error(`Path must be inside public/: ${absPath}`);
  return rel;
}

async function main() {
  const cli = parseArgs();

  if (cli.help) { printHelp(); return; }

  const transcriptPath = path.resolve(
    PROJECT_ROOT,
    cli.transcriptPath || path.join('public', 'edit', 'transcript.json'),
  );
  const outputPath = path.resolve(
    PROJECT_ROOT,
    cli.outputPath || path.join('public', 'renders', 'episode.mp4'),
  );
  const publicDir = path.join(PROJECT_ROOT, 'public');

  if (!await fs.pathExists(transcriptPath)) {
    throw new Error(`Transcript not found: ${transcriptPath}`);
  }

  if (!cli.skipUrlCheck) {
    process.stdout.write('[render:episode] Checking external media URLs...');
    const urlIssues = await checkMediaUrls(transcriptPath);
    if (urlIssues.length > 0) {
      console.log(' FAILED\n');
      console.error(`[render:episode] ${urlIssues.length} URL(s) will be blocked during render:\n`);
      for (const { url, reason } of urlIssues) {
        console.error(`  [${reason}]`);
        console.error(`  ${url}\n`);
      }
      console.error('[render:episode] Fix: download blocked images to public/assets/ and update transcript references.');
      console.error('[render:episode] To skip this check: --skip-url-check\n');
      process.exit(1);
    }
    console.log(' OK');
  }

  const transcript = await fs.readJson(transcriptPath);

  const transcriptSrc = toPublicRelative(publicDir, transcriptPath);

  const props = {
    transcriptSrc,
    cameraProfilesSrc: cli.cameraProfilesSrc,
  };
  if (cli.hookMusicSrc) props.hookMusicSrc = cli.hookMusicSrc;
  if (transcript.meta?.videoSrc) props.src = transcript.meta.videoSrc;

  console.log(`\n[render:episode] Transcript     : ${transcriptPath}`);
  console.log(`[render:episode] Composition    : ${cli.compositionId}`);
  console.log(`[render:episode] Camera profiles: ${cli.cameraProfilesSrc}`);
  if (cli.hookMusicSrc) {
    console.log(`[render:episode] Hook music     : ${cli.hookMusicSrc}`);
  }
  if (cli.frames) {
    console.log(`[render:episode] Frames         : ${cli.frames}`);
  }
  console.log(`[render:episode] Output         : ${outputPath}\n`);

  await fs.ensureDir(path.dirname(outputPath));

  const remotionArgs = [
    'remotion', 'render',
    cli.entry,
    cli.compositionId,
    outputPath,
    '--props', JSON.stringify(props),
    '--timeout', String(cli.timeout),
    '--image-format', 'jpeg',
  ];
  if (cli.overwrite)    remotionArgs.push('--overwrite');
  if (cli.concurrency)  remotionArgs.push('--concurrency', String(cli.concurrency));
  if (cli.frames)       remotionArgs.push('--frames', cli.frames);

  await run('npx', remotionArgs, PROJECT_ROOT);

  console.log(`\n[render:episode] Done. Output: ${outputPath}`);
}

main().catch(err => {
  console.error(`\n[render:episode] Error: ${err.message}`);
  process.exit(1);
});
