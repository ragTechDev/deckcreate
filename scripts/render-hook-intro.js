#!/usr/bin/env node

import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { checkMediaUrls } from './lib/checkMediaUrls.js';

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
    skipUrlCheck: false,
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
    else if (a === '--skip-url-check')                 out.skipUrlCheck      = true;
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

/** Matches isSpokenToken() in remotion/lib/tokens.ts — must stay in sync. */
function isSpokenToken(token) {
  const trimmed = (token?.text || '').trim();
  if (trimmed === '' || /_[A-Z]+_/.test(trimmed)) return false;
  if (/^[.,?_\s]*$/.test(trimmed.replace(/ /g, ''))) return false;
  return true;
}

/**
 * Mirrors hookClipEnd() in remotion/lib/hookTiming.ts — must stay in sync.
 *
 * Key difference from the old implementation:
 *  - Uses t_end (word audio-tail end) instead of t_dtw (word start) for the
 *    last-spoken-token extension. This accounts for the full duration of the
 *    final word in the hook clip, giving ~0.5 s of additional coverage per hook.
 *  - Extension applies to bounded hooks too (not only unbounded).
 *  - Token lookup is scoped to [sourceStart, baseEnd], not the whole segment.
 */
function computeHookClipEnd(seg, nextHookStart) {
  const sourceStart = seg.hookFrom ?? seg.start;
  const baseEnd = seg.hookTo ?? seg.end;
  const isBounded = seg.hookTo !== undefined && seg.hookTo !== null;

  let sourceEnd = baseEnd;

  // Extend to cover the last spoken token's audio tail (t_end, not t_dtw).
  const tokensInWindow = (seg.tokens || []).filter(
    t => isSpokenToken(t) && t.t_dtw >= sourceStart && t.t_dtw <= baseEnd,
  );
  const lastSpokenToken = tokensInWindow.sort((a, b) => (b.t_end ?? 0) - (a.t_end ?? 0))[0];
  if (lastSpokenToken?.t_end) {
    const tEnd = nextHookStart !== undefined
      ? Math.min(lastSpokenToken.t_end, nextHookStart)
      : lastSpokenToken.t_end;
    sourceEnd = Math.max(sourceEnd, tEnd);
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

/**
 * Builds de-overlapped hook sections and returns the total frame count.
 * Mirrors buildHookSections() in remotion/lib/hookTiming.ts: if a section's
 * trimBefore would fall before the previous section's trimAfter (caused by
 * t_end extension or bridging), it is advanced to avoid a backward source seek.
 */
function computeHookDurationFrames(transcript) {
  const hookSegments = (transcript.segments || []).filter(s => s.hook && !s.cut);
  let totalFrames = 0;
  let prevTrimAfter = -1;

  for (let i = 0; i < hookSegments.length; i++) {
    const seg = hookSegments[i];
    const next = hookSegments[i + 1];
    const nextHookStart = next ? (next.hookFrom ?? next.start) : undefined;
    const sourceStart = seg.hookFrom ?? seg.start;
    const sourceEnd = computeHookClipEnd(seg, nextHookStart);

    const rawTrimBefore = Math.floor(sourceStart * FPS);
    const rawTrimAfter  = Math.max(Math.ceil(sourceEnd * FPS), rawTrimBefore + 1);

    // De-overlap: advance trimBefore if this section would overlap the previous one.
    const trimBefore = prevTrimAfter >= 0 ? Math.max(rawTrimBefore, prevTrimAfter) : rawTrimBefore;
    if (trimBefore < rawTrimAfter) {
      totalFrames += rawTrimAfter - trimBefore;
      prevTrimAfter = rawTrimAfter;
    }
    // Sections where trimBefore >= trimAfter after de-overlap are zero-duration
    // edge cases (two hooks whose source windows touch exactly); skip them.
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

  if (!cli.skipUrlCheck) {
    process.stdout.write('[render-hook-intro] Checking external media URLs...');
    const urlIssues = await checkMediaUrls(transcriptPath);
    if (urlIssues.length > 0) {
      console.log(' FAILED\n');
      console.error(`[render-hook-intro] ${urlIssues.length} URL(s) will be blocked during render:\n`);
      for (const { url, reason } of urlIssues) {
        console.error(`  [${reason}]`);
        console.error(`  ${url}\n`);
      }
      console.error('[render-hook-intro] Fix: download blocked images to public/assets/ and update transcript references.');
      console.error('[render-hook-intro] To skip this check: --skip-url-check\n');
      process.exit(1);
    }
    console.log(' OK');
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
