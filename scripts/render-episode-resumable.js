#!/usr/bin/env node
/**
 * Resumable episode render with Cloudflare WARP detection.
 *
 * Splits the composition into chunks. When WARP activates mid-chunk the
 * current render is killed immediately (instead of waiting for the 5-min
 * timeout), the script waits for WARP to turn off, then retries only that
 * chunk. A progress file survives machine restarts so you never lose more
 * than one chunk of work.
 *
 * Usage:
 *   npm run render:episode:resume -- [options]
 *   npm run render:episode:chunk -- --chunk <n> [options]
 *   npm run render:episode:chunk -- --chunks <n>-<m> [options]
 *
 * Options: (same as render:episode, plus)
 *   --chunk-size <n>   Frames per chunk  (default: 20000 ≈ 5.5 min @ 60 fps)
 *   --total-frames <n> Skip the compositions query and use this value
 *   --reset            Discard saved progress and start fresh
 *   --chunk <n>        Render only chunk n (0-based index); skips concat
 *   --chunks <n>-<m>   Render only chunks n through m inclusive (0-based); skips concat
 */

import path from 'path';
import fs from 'fs-extra';
import readline from 'readline';
import { spawn, execSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { checkMediaUrls } from './lib/checkMediaUrls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

const WARP_CLI = '/usr/local/bin/warp-cli';
const DEFAULT_CHUNK_SIZE = 20000;
const CHUNKS_DIR = path.join(PROJECT_ROOT, 'public', 'renders', '.chunks');
const PROGRESS_FILE = path.join(CHUNKS_DIR, 'progress.json');

// Set in main() before rendering starts; false = skip all warp-cli calls
let warpMonitoringEnabled = false;

// ── WARP ─────────────────────────────────────────────────────────────────────

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

function isWarpActive() {
  if (!warpMonitoringEnabled) return false;
  try {
    const out = execSync(`${WARP_CLI} status`, {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return /\bConnected\b/i.test(out) && !/Disconnected/i.test(out);
  } catch {
    return false;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForWarpOff() {
  if (!isWarpActive()) return;
  console.log('\n[resume-render] Cloudflare WARP is active — render paused.');
  console.log('[resume-render] Disable WARP and rendering will continue automatically.\n');
  while (isWarpActive()) {
    await sleep(5000);
  }
  await sleep(2000); // let the network interface settle
  console.log('[resume-render] WARP is off — resuming...\n');
}

// ── Composition metadata ─────────────────────────────────────────────────────

function queryTotalFrames(entry, compositionId, props) {
  console.log('[resume-render] Querying composition duration (takes ~30 s)...');
  const result = spawnSync('npx', [
    'remotion', 'compositions', entry,
    '--props', JSON.stringify(props),
  ], {
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
    timeout: 180_000,
  });

  const output = (result.stdout ?? '') + (result.stderr ?? '');
  for (const line of output.split('\n')) {
    if (!line.includes(compositionId)) continue;
    const matches = [...line.matchAll(/\b(\d{5,})\b/g)];
    if (matches.length > 0) {
      return Math.max(...matches.map(m => parseInt(m[1], 10)));
    }
  }
  if (result.status !== 0) {
    throw new Error(
      `npx remotion compositions failed (code ${result.status}).\n` +
      `Pass --total-frames N to skip this query.\n` +
      output.slice(0, 2000),
    );
  }
  throw new Error(
    `Frame count for "${compositionId}" not found in compositions output.\n` +
    `Pass --total-frames N to skip this query.\n` +
    output.slice(0, 2000),
  );
}

// ── Chunk render ─────────────────────────────────────────────────────────────

async function renderChunk(config, chunk) {
  const { entry, compositionId, props, timeout, concurrency } = config;
  const { startFrame, endFrame, file, index } = chunk;

  for (let attempt = 1; ; attempt++) {
    await waitForWarpOff();

    if (attempt > 1) {
      console.log(`[resume-render] Retry attempt ${attempt} for frames ${startFrame}–${endFrame}`);
    }

    const { code, warpKilled } = await new Promise((resolve, reject) => {
      let warpKilled = false;

      // Pipe output so we can scan for ERR_NETWORK_CHANGED while still
      // displaying the Remotion progress bar on the real TTY.
      const proc = spawn('npx', [
        'remotion', 'render',
        entry, compositionId, file,
        '--props', JSON.stringify(props),
        '--timeout', String(timeout),
        '--image-format', 'jpeg',
        '--frames', `${startFrame}-${endFrame}`,
        '--overwrite',
        ...(concurrency ? ['--concurrency', String(concurrency)] : []),
      ], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

      const kill = (reason) => {
        if (warpKilled) return;
        warpKilled = true;
        process.stdout.write(`\n[resume-render] ${reason} — stopping render...\n`);
        proc.kill('SIGTERM');
      };

      // Relay output to terminal and scan for network-change errors.
      // ERR_NETWORK_CHANGED means WARP just turned on (even if it turns off
      // before the next warp-cli poll), leaving in-flight requests dead.
      const scan = (chunk) => {
        if (!warpKilled && chunk.toString().includes('ERR_NETWORK_CHANGED')) {
          kill('ERR_NETWORK_CHANGED detected');
        }
      };
      proc.stdout.on('data', buf => { process.stdout.write(buf); scan(buf); });
      proc.stderr.on('data', buf => { process.stderr.write(buf); scan(buf); });

      // Poll every 2 s as a backup (catches WARP states not reflected in output)
      const watcher = setInterval(() => {
        if (isWarpActive()) kill('WARP detected');
      }, 2000);

      proc.on('close', code => { clearInterval(watcher); resolve({ code, warpKilled }); });
      proc.on('error', err  => { clearInterval(watcher); reject(err); });
    });

    if (code === 0) return;

    if (warpKilled || isWarpActive()) {
      await waitForWarpOff();
      continue; // always retry WARP-caused failures
    }

    // Non-WARP failure: give up after 3 attempts so a real bug doesn't loop forever
    if (attempt >= 3) {
      throw new Error(`Chunk ${index} (frames ${startFrame}–${endFrame}) failed with exit code ${code} after ${attempt} attempts`);
    }
    console.log(`[resume-render] Chunk failed (code ${code}), retrying...`);
  }
}

// ── Progress persistence ──────────────────────────────────────────────────────

// Paths in progress.json are stored relative to PROJECT_ROOT so the file is
// portable across machines. In memory, chunks always carry absolute paths.

function resolveChunkPaths(progress) {
  progress.chunks = progress.chunks.map(c => ({
    ...c,
    file: path.isAbsolute(c.file) ? c.file : path.resolve(PROJECT_ROOT, c.file),
  }));
  return progress;
}

async function saveProgress(progress) {
  const serialisable = {
    ...progress,
    chunks: progress.chunks.map(c => ({
      ...c,
      file: path.relative(PROJECT_ROOT, c.file),
    })),
  };
  await fs.writeJson(PROGRESS_FILE, serialisable, { spaces: 2 });
}

// ── Concatenation ─────────────────────────────────────────────────────────────

async function concatenateChunks(chunks, outputFile) {
  console.log(`\n[resume-render] Concatenating ${chunks.length} chunk(s)...`);

  if (chunks.length === 1) {
    await fs.copy(chunks[0].file, outputFile, { overwrite: true });
    return;
  }

  const listFile = path.join(CHUNKS_DIR, 'concat.txt');
  await fs.writeFile(
    listFile,
    chunks.map(c => `file '${c.file.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8',
  );

  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', // re-encode audio to avoid boundary glitches
      '-y', outputFile,
    ], { cwd: PROJECT_ROOT, stdio: 'inherit' });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    proc.on('error', reject);
  });
}

// ── Args ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    transcriptPath:    null,
    cameraProfilesSrc: 'camera/camera-profiles.json',
    outputPath:        null,
    entry:             'remotion/index.ts',
    compositionId:     'ragTechVodcast',
    hookMusicSrc:      'sounds/jazz-cafe-music.mp3',
    timeout:           300000,
    chunkSize:         DEFAULT_CHUNK_SIZE,
    totalFrames:       null,
    concurrency:       null,
    reset:             false,
    skipUrlCheck:      false,
    chunkIndex:        null,
    chunkRange:        null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if      (a === '--transcript'      && args[i+1]) out.transcriptPath    = args[++i];
    else if (a === '--camera-profiles' && args[i+1]) out.cameraProfilesSrc = args[++i];
    else if (a === '--out'             && args[i+1]) out.outputPath        = args[++i];
    else if (a === '--entry'           && args[i+1]) out.entry             = args[++i];
    else if (a === '--composition'     && args[i+1]) out.compositionId     = args[++i];
    else if (a === '--hook-music'      && args[i+1]) out.hookMusicSrc      = args[++i];
    else if (a === '--no-hook-music')                out.hookMusicSrc      = '';
    else if (a === '--timeout'         && args[i+1]) out.timeout           = parseInt(args[++i], 10);
    else if (a === '--chunk-size'      && args[i+1]) out.chunkSize         = parseInt(args[++i], 10);
    else if (a === '--total-frames'    && args[i+1]) out.totalFrames       = parseInt(args[++i], 10);
    else if (a === '--concurrency'     && args[i+1]) out.concurrency       = parseInt(args[++i], 10);
    else if (a === '--skip-url-check')               out.skipUrlCheck      = true;
    else if (a === '--reset')                        out.reset             = true;
    else if (a === '--warp')                         out.warp              = true;
    else if (a === '--no-warp')                      out.noWarp            = true;
    else if (a === '--chunk'           && args[i+1]) out.chunkIndex        = parseInt(args[++i], 10);
    else if (a === '--chunks'          && args[i+1]) {
      const [from, to] = args[++i].split('-').map(Number);
      out.chunkRange = { from, to };
    }
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cli = parseArgs();

  const transcriptPath = path.resolve(
    PROJECT_ROOT,
    cli.transcriptPath ?? path.join('public', 'edit', 'transcript.json'),
  );
  const outputPath = path.resolve(
    PROJECT_ROOT,
    cli.outputPath ?? path.join('public', 'renders', 'episode.mp4'),
  );
  const publicDir = path.join(PROJECT_ROOT, 'public');

  if (!await fs.pathExists(transcriptPath)) {
    throw new Error(`Transcript not found: ${transcriptPath}`);
  }

  if (!cli.skipUrlCheck) {
    process.stdout.write('[resume-render] Checking media URLs...');
    const issues = await checkMediaUrls(transcriptPath);
    if (issues.length > 0) {
      console.log(' FAILED');
      issues.forEach(({ url, reason }) => console.error(`  [${reason}] ${url}`));
      process.exit(1);
    }
    console.log(' OK');
  }

  const transcript = await fs.readJson(transcriptPath);
  const transcriptSrc = path.relative(publicDir, transcriptPath).replace(/\\/g, '/');

  const props = { transcriptSrc, cameraProfilesSrc: cli.cameraProfilesSrc };
  if (cli.hookMusicSrc)          props.hookMusicSrc = cli.hookMusicSrc;
  if (transcript.meta?.videoSrc) props.src = transcript.meta.videoSrc;

  if (cli.reset) {
    await fs.remove(CHUNKS_DIR);
    console.log('[resume-render] Progress reset.');
  }
  await fs.ensureDir(CHUNKS_DIR);

  // Load or initialise progress
  let progress;
  if (!cli.reset && await fs.pathExists(PROGRESS_FILE)) {
    progress = resolveChunkPaths(await fs.readJson(PROGRESS_FILE));
    const done = progress.chunks.filter(c => c.done).length;
    console.log(`[resume-render] Resuming: ${done}/${progress.chunks.length} chunks done`);
  } else {
    const totalFrames = cli.totalFrames ?? queryTotalFrames(cli.entry, cli.compositionId, props);
    const totalChunks = Math.ceil(totalFrames / cli.chunkSize);
    progress = {
      totalFrames,
      chunkSize: cli.chunkSize,
      chunks: Array.from({ length: totalChunks }, (_, i) => ({
        index: i,
        startFrame: i * cli.chunkSize,
        endFrame: Math.min((i + 1) * cli.chunkSize - 1, totalFrames - 1),
        file: path.join(CHUNKS_DIR, `chunk-${String(i).padStart(3, '0')}.mp4`),
        done: false,
      })),
    };
    await saveProgress(progress);
    console.log(`[resume-render] ${totalFrames} frames → ${totalChunks} chunks × ${cli.chunkSize}`);
  }

  // ── WARP monitoring setup ────────────────────────────────────────────────
  // Preference is saved in progress.json so resuming never re-prompts.
  if (progress.warpMonitoring !== undefined) {
    warpMonitoringEnabled = progress.warpMonitoring;
    if (warpMonitoringEnabled) console.log('[resume-render] WARP monitoring enabled (saved)');
  } else if (cli.noWarp) {
    warpMonitoringEnabled = false;
  } else if (cli.warp) {
    warpMonitoringEnabled = true;
  } else if (fs.existsSync(WARP_CLI)) {
    const answer = process.stdin.isTTY
      ? await ask('[resume-render] Cloudflare WARP detected — enable WARP monitoring? [y/N] ')
      : 'n';
    warpMonitoringEnabled = answer.trim().toLowerCase() === 'y';
    console.log(`[resume-render] WARP monitoring ${warpMonitoringEnabled ? 'enabled' : 'disabled'}`);
  }
  // warp-cli not found → warpMonitoringEnabled stays false, no message needed
  progress.warpMonitoring = warpMonitoringEnabled;
  await saveProgress(progress);

  const config = { entry: cli.entry, compositionId: cli.compositionId, props, timeout: cli.timeout, concurrency: cli.concurrency };

  const isTargeted = cli.chunkIndex !== null || cli.chunkRange !== null;

  if (isTargeted) {
    const desc = cli.chunkIndex !== null
      ? `chunk ${cli.chunkIndex}`
      : `chunks ${cli.chunkRange.from}–${cli.chunkRange.to}`;
    console.log(`[resume-render] Targeted mode: rendering ${desc} only (concat skipped)`);
  }

  for (const chunk of progress.chunks) {
    if (isTargeted) {
      const inRange =
        (cli.chunkIndex !== null && chunk.index === cli.chunkIndex) ||
        (cli.chunkRange !== null && chunk.index >= cli.chunkRange.from && chunk.index <= cli.chunkRange.to);
      if (!inRange) continue;
    }

    if (chunk.done) {
      console.log(`[resume-render] Chunk ${chunk.index + 1}/${progress.chunks.length} already complete, skipping`);
      continue;
    }
    console.log(`\n[resume-render] Chunk ${chunk.index + 1}/${progress.chunks.length}: frames ${chunk.startFrame}–${chunk.endFrame}`);
    await renderChunk(config, chunk);
    chunk.done = true;
    await saveProgress(progress);
    console.log(`[resume-render] Chunk ${chunk.index + 1}/${progress.chunks.length} saved`);
  }

  if (isTargeted) {
    const done = progress.chunks.filter(c => c.done).length;
    console.log(`\n[resume-render] Targeted render complete. ${done}/${progress.chunks.length} chunks done.`);
    if (done === progress.chunks.length) {
      console.log('[resume-render] All chunks done — run render:episode:resume (no --chunk/--chunks) to concatenate.');
    }
    return;
  }

  await concatenateChunks(progress.chunks, outputPath);

  await fs.remove(CHUNKS_DIR);
  console.log(`\n[resume-render] Done. Output: ${outputPath}`);
}

main().catch(err => {
  console.error(`\n[resume-render] Error: ${err.message}`);
  process.exit(1);
});
