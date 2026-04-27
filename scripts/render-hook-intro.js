#!/usr/bin/env node

import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';

const FPS = 60;
// Must match remotion/components/PodcastIntro.tsx
const INTRO_DURATION_FRAMES = 420;
const HOOK_TAIL_PAD_UNBOUNDED_SECONDS = 0.16;
const HOOK_TAIL_PAD_BOUNDED_SECONDS = 0.02;
const HOOK_BRIDGE_MAX_GAP_SECONDS = 1.0;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    transcriptPath: null,
    cameraProfilesSrc: 'camera/camera-profiles.json',
    outputPath: null,
    entry: 'remotion/index.ts',
    compositionId: 'ragTechVodcast',
    hookMusicSrc: 'sounds/jazz-cafe-music.mp3',
    overwrite: false,
    help: false,
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
    else if (a === '--overwrite')                      out.overwrite         = true;
    else if (a === '--help' || a === '-h')             out.help              = true;
  }

  return out;
}

function printHelp() {
  console.log(`
Render hook + podcast intro

Renders the hook clips followed by the 7-second podcast intro from the
longform video. Segments in the transcript must be annotated with > HOOK.

Usage:
  npm run render:hook-intro -- [options]

Options:
  --transcript <path>        transcript.json path (default: public/edit/transcript.json)
  --camera-profiles <path>   Camera profiles path relative to public/
                             (default: camera/camera-profiles.json)
  --out <path>               Output video path
                             (default: public/renders/hook-intro.mp4)
  --hook-music <src>         Hook music path relative to public/
                             (default: sounds/jazz-cafe-music.mp3)
  --no-hook-music            Disable hook music
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

function isSpokenToken(token) {
  const trimmed = (token?.text || '').trim();
  if (trimmed === '' || /_[A-Z]+_/.test(trimmed)) return false;
  if (/^[.,?_\s]*$/.test(trimmed.replace(/ /g, ''))) return false;
  return trimmed.replace(/^[^\w']+|[^\w']+$/g, '').toLowerCase() !== '';
}

/** Mirrors hookClipEnd() in Composition.tsx and getHookSubClips() in SegmentPlayer.tsx. */
function computeHookClipEnd(seg, nextHookStart) {
  const baseEnd = seg.hookTo ?? seg.end;
  const isBounded = seg.hookTo !== undefined && seg.hookTo !== null;

  let sourceEnd = baseEnd;
  if (!isBounded) {
    const latestSpoken = (seg.tokens || [])
      .filter(isSpokenToken)
      .reduce((max, t) => Math.max(max, t.t_dtw), -Infinity);
    if (Number.isFinite(latestSpoken) && latestSpoken > baseEnd) {
      const drift = latestSpoken - baseEnd;
      sourceEnd = baseEnd + Math.min(1.5, drift + 0.4);
    }
  }

  const hasSpokenAfterEnd = (seg.tokens || []).some(
    t => isSpokenToken(t) && t.t_dtw > sourceEnd + 0.02,
  );
  const endsAtTail = !hasSpokenAfterEnd;
  const canBridge = nextHookStart !== undefined
    && nextHookStart > sourceEnd
    && nextHookStart - sourceEnd <= HOOK_BRIDGE_MAX_GAP_SECONDS;
  if (endsAtTail && canBridge) sourceEnd = nextHookStart;

  const withPad = sourceEnd + (isBounded ? HOOK_TAIL_PAD_BOUNDED_SECONDS : HOOK_TAIL_PAD_UNBOUNDED_SECONDS);
  return nextHookStart !== undefined ? Math.min(withPad, nextHookStart) : withPad;
}

function computeHookDurationFrames(transcript) {
  const hookSegments = (transcript.segments || []).filter(s => s.hook && !s.cut);
  let totalFrames = 0;
  for (let i = 0; i < hookSegments.length; i++) {
    const seg = hookSegments[i];
    const next = hookSegments[i + 1];
    const nextHookStart = next ? (next.hookFrom ?? next.start) : undefined;
    const sourceStart = seg.hookFrom ?? seg.start;
    const sourceEnd = computeHookClipEnd(seg, nextHookStart);
    totalFrames += Math.max(1, Math.ceil(sourceEnd * FPS) - Math.floor(sourceStart * FPS));
  }
  return { hookSegments, totalFrames };
}

function toPublicRelative(publicDir, absPath) {
  const rel = path.relative(publicDir, absPath).replace(/\\/g, '/');
  if (rel.startsWith('..')) throw new Error(`Path must be inside public/: ${absPath}`);
  return rel;
}

async function main() {
  const cwd = process.cwd();
  const cli = parseArgs();

  if (cli.help) { printHelp(); return; }

  const transcriptPath = path.resolve(
    cwd,
    cli.transcriptPath || path.join('public', 'edit', 'transcript.json'),
  );
  const outputPath = path.resolve(
    cwd,
    cli.outputPath || path.join('public', 'renders', 'hook-intro.mp4'),
  );

  if (!await fs.pathExists(transcriptPath)) {
    throw new Error(`Transcript not found: ${transcriptPath}`);
  }

  const transcript = await fs.readJson(transcriptPath);
  const { hookSegments, totalFrames: hookFrames } = computeHookDurationFrames(transcript);

  if (hookSegments.length === 0) {
    throw new Error('No hook segments found in transcript. Annotate segments with > HOOK in the doc.');
  }

  const totalFrames = hookFrames + INTRO_DURATION_FRAMES;

  console.log(`\n[render-hook-intro] Hook segments : ${hookSegments.length}`);
  console.log(`[render-hook-intro] Hook frames   : ${hookFrames} (${(hookFrames / FPS).toFixed(2)}s)`);
  console.log(`[render-hook-intro] Intro frames  : ${INTRO_DURATION_FRAMES} (${(INTRO_DURATION_FRAMES / FPS).toFixed(2)}s)`);
  console.log(`[render-hook-intro] Total frames  : ${totalFrames} (${(totalFrames / FPS).toFixed(2)}s)`);
  console.log(`[render-hook-intro] Output        : ${outputPath}\n`);

  const publicDir = path.join(cwd, 'public');
  const transcriptSrc = toPublicRelative(publicDir, transcriptPath);

  const props = {
    transcriptSrc,
    cameraProfilesSrc: cli.cameraProfilesSrc,
    hookMusicSrc: cli.hookMusicSrc,
  };
  if (transcript.meta?.videoSrc) props.src = transcript.meta.videoSrc;

  await fs.ensureDir(path.dirname(outputPath));

  const remotionArgs = [
    'remotion', 'render',
    cli.entry,
    cli.compositionId,
    outputPath,
    '--props', JSON.stringify(props),
    '--frames', `0-${totalFrames - 1}`,
  ];
  if (cli.overwrite) remotionArgs.push('--overwrite');

  await run('npx', remotionArgs, cwd);

  console.log(`\n[render-hook-intro] Done. Output: ${outputPath}`);
}

main().catch(err => {
  console.error(`\n[render-hook-intro] Error: ${err.message}`);
  process.exit(1);
});
