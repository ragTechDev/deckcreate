#!/usr/bin/env node
/**
 * DeckCreate — Step-by-step video editing wizard.
 * Usage: npm run wizard
 */

import readline from 'readline';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createHelpers } from './shared/wizard-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const {
  ask, confirm, askYesNo, askQuestion,
  spawnStep, runStep, runParallel,
  progressBar, spinner, copyFileWithProgress,
  openFile, findFileIn, waitForHttp, isDockerEnv,
} = createHelpers(rl, cwd);

async function placeFiles(mode) {
  const videoExts = ['.mp4', '.mov', '.mkv'];
  const audioExts = ['.mp3', '.aac', '.wav', '.m4a'];
  const inputVideo = path.join(cwd, 'input', 'video');
  const inputAudio = path.join(cwd, 'input', 'audio');

  const needsVideo = mode !== 4;
  const needsAudio = mode !== 3;

  if (needsVideo) await fs.ensureDir(inputVideo);
  if (needsAudio) await fs.ensureDir(inputAudio);

  console.log('\n  ── Place your files ──────────────────────────────────');
  if (mode === 1 || mode === 2) {
    console.log('  Video file → input/video/   (.mp4 .mov .mkv)');
    console.log('  Audio file → input/audio/   (.mp3 .aac .wav .m4a)');
  } else if (mode === 3) {
    console.log('  Video file → input/video/   (.mp4 .mov .mkv)');
  } else {
    console.log('  Audio file → input/audio/   (.mp3 .aac .wav .m4a)');
  }
  await ask('  Press Enter when files are ready...');

  const videoFile = needsVideo ? await findFileIn(inputVideo, videoExts) : null;
  const audioFile = needsAudio ? await findFileIn(inputAudio, audioExts) : null;

  if (needsVideo && !videoFile) {
    console.error(`  ✗ No video file found in ${inputVideo}`); process.exit(1);
  }
  if (needsAudio && !audioFile) {
    console.error(`  ✗ No audio file found in ${inputAudio}`); process.exit(1);
  }

  return { videoFile, audioFile };
}


async function extractAudio(videoPath) {
  const outPath = path.join(cwd, 'public', 'transcribe', 'input', 'audio.wav');
  await fs.ensureDir(path.dirname(outPath));
  const spin = spinner('Extracting audio...');
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-y', outPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'], cwd });
    let err = '';
    let totalSecs = null;
    let buf = '';
    proc.stderr.on('data', d => {
      buf += d.toString();
      err += buf;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!totalSecs) {
          const m = line.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
          if (m) totalSecs = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
        }
        const tm = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
        if (tm && totalSecs) {
          const current = +tm[1] * 3600 + +tm[2] * 60 + +tm[3] + +tm[4] / 100;
          const pct = Math.min(99, Math.round(current / totalSecs * 100));
          spin.update(`Extracting audio...  ${progressBar(pct)} ${pct}%`);
        }
      }
    });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg failed:\n${err}`)));
    proc.on('error', e => reject(new Error(`ffmpeg not found — is ffmpeg installed? (${e.message})`)));
  });
  spin.stop(`✓ Extracted audio  ${progressBar(100)} 100%`);
  return outPath;
}

async function copyToTranscribeInput(filePath) {
  const dir = path.join(cwd, 'public', 'transcribe', 'input');
  await fs.ensureDir(dir);
  const dest = path.join(dir, path.basename(filePath));
  await copyFileWithProgress(filePath, dest, `Copying ${path.basename(filePath)}...`);
  return dest;
}

// ── Resume detection ──────────────────────────────────────────────────────────

async function detectExistingWork() {
  const p = (...parts) => path.join(cwd, ...parts);
  const [syncedVideoLegacy, syncedVideoMultiAngle, rawTranscript, diarization, transcriptDoc, transcriptJson, cameraProfiles] = await Promise.all([
    fs.pathExists(p('public', 'sync', 'output', 'synced-output.mp4')),
    fs.pathExists(p('public', 'sync', 'output', 'synced-output-1.mp4')), // multi-angle primary
    fs.pathExists(p('public', 'transcribe', 'output', 'raw', 'transcript.raw.json')),
    fs.pathExists(p('public', 'transcribe', 'output', 'raw', 'diarization.json')),
    fs.pathExists(p('public', 'edit', 'transcript.doc.txt')),
    fs.pathExists(p('public', 'edit', 'transcript.json')),
    fs.pathExists(p('public', 'camera', 'camera-profiles.json')),
  ]);
  const syncedVideo = syncedVideoLegacy || syncedVideoMultiAngle;

  let alignedTranscript = false;
  if (rawTranscript) {
    try {
      const rawJson = await fs.readJson(p('public', 'transcribe', 'output', 'raw', 'transcript.raw.json'));
      alignedTranscript = !!rawJson?.meta?.alignment?.provider;
    } catch {
      alignedTranscript = false;
    }
  }

  const inputDir = p('public', 'transcribe', 'input');
  const audioInInput = !!(await findFileIn(inputDir, ['.wav', '.mp3', '.aac', '.m4a']));
  const videoInInputPath = await findFileIn(inputDir, ['.mp4', '.mov', '.mkv']);
  const videoInInput = !!videoInInputPath;
  return {
    syncedVideo,
    rawTranscript,
    alignedTranscript,
    diarization,
    transcriptDoc,
    transcriptJson,
    cameraProfiles,
    audioInInput,
    videoInInput,
    videoInInputPath,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  DeckCreate — Video Editor');
  console.log('  ─────────────────────────\n');

  // ── Detect existing work ───────────────────────────────────────────────────
  const existing = await detectExistingWork();

  //  resumeStep: 0=fresh  1=audio ready (or sync done)  2=transcribed  3=doc generated  4=edits applied
  let resumeStep = 0;
  if (existing.syncedVideo)    resumeStep = 1; // sync done → next: extract audio + transcribe
  if (existing.audioInInput)   resumeStep = 1;
  if (existing.rawTranscript)  resumeStep = 2;
  if (existing.transcriptDoc)  resumeStep = 3;
  if (existing.transcriptJson) resumeStep = 4;

  /** ID of the step the user is redoing — controls which blocks run. */
  let redoStepId = null; // 'sync'|'transcribe'|'align'|'buildDoc'|'mergeDoc'|'camera'|'preview'|'remotion'

  if (resumeStep > 0) {
    console.log('  Found existing work from a previous session:');
    if (existing.transcriptJson) console.log('    ✓ Edits applied        — transcript.json');
    if (existing.transcriptDoc)  console.log('    ✓ Doc generated        — transcript.doc.txt');
    if (existing.alignedTranscript) console.log('    ✓ Forced alignment     — transcript.raw.json timings');
    if (existing.rawTranscript)  console.log('    ✓ Transcription done   — transcript.raw.json');
    if (existing.diarization)    console.log('    ✓ Diarization done     — diarization.json');
    if (existing.cameraProfiles) console.log('    ✓ Camera profiles      — camera-profiles.json');
    if (existing.audioInInput)   console.log('    ✓ Audio ready          — transcribe/input/');
    if (existing.syncedVideo)    console.log('    ✓ Sync done            — synced-output.mp4');

    const nextStepLabels = ['', 'Transcription', 'Build transcript doc', 'Edit & apply doc', 'Camera / preview / render'];
    console.log(`\n  Next step: ${nextStepLabels[resumeStep]}`);
    if (resumeStep === 4 && !existing.cameraProfiles) {
      console.log('  (Camera profiles missing — will prompt for camera setup after resume)');
    }

    console.log('\n  Options:');
    console.log(`  1. Resume from next step (${nextStepLabels[resumeStep]})`);
    console.log('  2. Jump to a specific step');
    console.log('  3. Start fresh (redo everything)');
    const menuChoice = (await ask('  > [1] ')).trim() || '1';

    if (menuChoice === '3') {
      resumeStep = 0;
    } else if (menuChoice === '2') {
      const stepDefs = [
        { id: 'sync',       label: 'Sync audio + video',                    done: existing.syncedVideo,        resumeAt: 0 },
        { id: 'optimize',   label: 'Re-optimise synced video for Remotion', done: false,                       resumeAt: 0 },
        { id: 'transcribe', label: 'Transcribe + Diarize',                  done: existing.rawTranscript,      resumeAt: 1 },
        { id: 'align',      label: 'Forced alignment',                      done: existing.alignedTranscript,  resumeAt: 1 },
        { id: 'buildDoc',   label: 'Build editable doc',                    done: existing.transcriptDoc,      resumeAt: 2 },
        { id: 'mergeDoc',   label: 'Merge doc → transcript.json',           done: existing.transcriptJson,     resumeAt: 3 },
        { id: 'camera',     label: 'Camera setup',                          done: existing.cameraProfiles,     resumeAt: 4 },
        { id: 'preview',    label: 'Cut preview (MP4)',                     done: false,                       resumeAt: 4 },
        { id: 'remotion',   label: 'Launch Remotion studio',                done: false,                       resumeAt: 4 },
        { id: 'conform',    label: 'Export final cut from raw (conform)',    done: false,                       resumeAt: 4 },
      ];
      console.log('\n  Which step would you like to run?');
      stepDefs.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.done ? '✓' : '○'} ${s.label}`);
      });
      const raw = (await ask('  > ')).trim();
      const stepIdx = parseInt(raw) - 1;
      if (stepIdx >= 0 && stepIdx < stepDefs.length) {
        const target = stepDefs[stepIdx];
        redoStepId = target.id;
        resumeStep = target.resumeAt;
        console.log(`\n  → Will run: ${target.label}`);
      } else {
        console.log('  Invalid choice — resuming from next step.');
      }
    }
    // menuChoice '1' or default: keep resumeStep unchanged (resume from next step)
  }

  // ── Mode and speaker setup ─────────────────────────────────────────────────
  let mode, numSpeakers, multiSpeaker;
  /** Number of camera angles (multi-angle shoot only). 1 = single angle (default). */
  let numAngles = 1;
  /** Absolute paths to extra angle video files (indices 1…N-1; index 0 is videoFile). */
  let additionalVideoFiles = [];
  /** Paths of all synced video outputs relative to /public — populated during sync. */
  let videoSrcsForRemotion = null;

  if (resumeStep === 0) {
    // Fresh start — ask everything
    console.log('\n  What are you working with?');
    console.log('  1. Separate video + audio files (need sync)');
    console.log('  2. Separate video + audio files (already in sync)');
    console.log('  3. Single video file (audio already combined)');
    console.log('  4. Audio file only (transcription only)');
    const modeStr = (await ask('  > ')).trim();
    mode = [1, 2, 3, 4].includes(parseInt(modeStr)) ? parseInt(modeStr) : 3;

    if (mode === 1) {
      console.log('\n  How many camera angles are you shooting with?');
      console.log('  (1 = single camera, 2+ = multi-angle: each angle synced to the same audio)');
      const anglesStr = (await ask('  > [1] ')).trim() || '1';
      numAngles = Math.max(1, parseInt(anglesStr) || 1);
    }

    console.log('\n  How many speakers are in this recording?');
    console.log('  (Enter 1 if solo or unknown)');
    numSpeakers = Math.max(1, parseInt((await ask('  > ')).trim()) || 1);
    multiSpeaker = numSpeakers > 1;
  } else {
    // Resuming — infer from existing files
    // Prefer any available video source (transcribe/input or sync/output)
    // so downstream video-dependent steps (camera/remotion) remain enabled.
    if (existing.videoInInput) mode = 3;
    else if (existing.syncedVideo) mode = 1;
    else mode = 4;
    multiSpeaker = existing.diarization;
    numSpeakers = multiSpeaker ? 2 : 1; // exact count only matters for a fresh diarize run

    // Check transcript for multi-angle videoSrcs to properly infer mode
    if ((mode === 4 || mode === 1) && existing.transcriptJson) {
      try {
        const transcript = await fs.readJson(path.join(cwd, 'public', 'edit', 'transcript.json'));
        const hasVideoSrcs = transcript?.meta?.videoSrcs && transcript.meta.videoSrcs.length > 0;
        const hasVideoSrc = transcript?.meta?.videoSrc;
        if (hasVideoSrcs || hasVideoSrc) {
          mode = 1; // Has video source(s), treat as synced video mode
          if (hasVideoSrcs) {
            numAngles = transcript.meta.videoSrcs.length;
            videoSrcsForRemotion = transcript.meta.videoSrcs;
          }
        }
      } catch {
        // ignore
      }
    }

    // If still no videoSrcs but we have synced videos, detect them from sync/output
    if (!videoSrcsForRemotion && existing.syncedVideo) {
      try {
        const syncOutputDir = path.join(cwd, 'public', 'sync', 'output');
        const files = await fs.readdir(syncOutputDir);
        const syncedVideos = files
          .filter(f => f.startsWith('synced-output-') && f.endsWith('.mp4'))
          .sort();
        if (syncedVideos.length > 0) {
          videoSrcsForRemotion = syncedVideos.map(f => `sync/output/${f}`);
          numAngles = syncedVideos.length;
          mode = 1;
        }
      } catch {
        // ignore
      }
    }

    if (resumeStep < 2 && !existing.diarization) {
      // Still need to transcribe/diarize — ask speaker count
      console.log('\n  How many speakers are in this recording?');
      console.log('  (Enter 1 if solo or unknown)');
      numSpeakers = Math.max(1, parseInt((await ask('  > ')).trim()) || 1);
      multiSpeaker = numSpeakers > 1;
    }
  }

  // ── File placement (fresh start only) ─────────────────────────────────────
  let videoFile = null, audioFile = null;
  let usingProxies = false;

  if (resumeStep === 0) {
    ({ videoFile, audioFile } = await placeFiles(mode));

    // Multi-angle: collect extra angle videos after the primary video is placed
    if (mode === 1 && numAngles > 1) {
      console.log('\n  ── Additional camera angle videos ────────────────────');
      const videoExts = ['.mp4', '.mov', '.mkv'];
      for (let angleIdx = 2; angleIdx <= numAngles; angleIdx++) {
        const angleDir = path.join(cwd, 'input', 'video', `angle${angleIdx}`);
        await fs.ensureDir(angleDir);
        console.log(`  Angle ${angleIdx}: place video file in input/video/angle${angleIdx}/`);
        await ask(`  Press Enter when angle ${angleIdx} video is ready...`);
        const angleFile = await findFileIn(angleDir, videoExts);
        if (!angleFile) {
          console.error(`  ✗ No video file found for angle ${angleIdx} in ${angleDir}`);
          process.exit(1);
        }
        additionalVideoFiles.push(angleFile);
      }
    }

    // ── Proxy transcode (optional) ──────────────────────────────────────────
    // Offer proxy transcoding for raw/large footage (ProRes, BRAW, >10 GB).
    // All downstream steps (sync, transcribe, Remotion) run on proxies.
    // The original raw paths are preserved in proxy-map.json for final export.
    if (mode !== 4) {
      console.log('');
      const wantProxy = await confirm(
        '  Does your video file need proxy transcoding?\n' +
        '  (Choose this if your footage is raw/ProRes/BRAW or larger than ~10 GB)',
        false,
      );
      if (wantProxy) {
        console.log('\n  ── Proxy transcode ───────────────────────────────────');
        const { transcodeProxies } = await import('./proxy/transcode-proxy.js');
        const allRaw = [videoFile, ...additionalVideoFiles];
        const proxyDir = path.join(cwd, 'input', 'video-proxy');
        const proxyPaths = await transcodeProxies(allRaw, proxyDir);
        videoFile = proxyPaths[0];
        additionalVideoFiles = proxyPaths.slice(1);
        usingProxies = true;
        console.log('  ✓ Proxies ready. All editing steps will use proxy files.');
        console.log('  Original raw files are stored in proxy-map.json and will be used at export time.');
      }
    }
  }

  // ── Determine video src for Remotion (relative to public/) ────────────────
  let videoSrcForRemotion = null;
  if (mode === 1) {
    // Multi-angle: primary is angle 1; single-angle keeps legacy filename
    videoSrcForRemotion = numAngles > 1
      ? 'sync/output/synced-output-1.mp4'
      : 'sync/output/synced-output.mp4';
  } else if (mode === 2 || mode === 3) {
    const vf = videoFile || existing.videoInInputPath;
    if (vf) videoSrcForRemotion = `transcribe/input/${path.basename(vf)}`;
  }

  // ── STEP: Sync (mode 1 only) — also runs prepare audio when resumeStep=0 ──
  let videoForExtract = videoFile;
  const syncOutputDir = path.join(cwd, 'public', 'sync', 'output');

  if (resumeStep === 0 && mode === 1) {
    console.log('\n  ── Sync audio and video ─────────────────────────────');

    if (numAngles > 1) {
      // Multi-angle: sync every video to the same audio using AudioSyncer.syncMultiple
      const { default: AudioSyncer } = await import('./sync/AudioSyncer.js');
      const allVideos = [videoFile, ...additionalVideoFiles];
      console.log(`  Syncing ${numAngles} camera angles to audio...`);
      let syncResults;
      let syncOk = false;
      while (!syncOk) {
        try {
          syncResults = await AudioSyncer.syncMultiple(allVideos, audioFile, syncOutputDir);
          syncOk = true;
        } catch (err) {
          console.error(`  ✗ Sync failed: ${err.message}`);
          const retry = await confirm('  Retry sync?');
          if (!retry) process.exit(1);
        }
      }
      videoForExtract = syncResults[0].outputPath;
      videoSrcsForRemotion = syncResults.map((_, i) => `sync/output/synced-output-${i + 1}.mp4`);
      console.log(`  ✓ Synced ${numAngles} angles:`);
      syncResults.forEach((r, i) => console.log(`    Angle ${i + 1}: ${path.basename(r.outputPath)}`));

      if (usingProxies) {
        const proxyMapPath = path.join(cwd, 'public', 'proxy', 'proxy-map.json');
        const proxyMap = await fs.readJson(proxyMapPath);
        syncResults.forEach((r, i) => { if (proxyMap[i]) proxyMap[i].videoStart = r.videoStart ?? 0; });
        await fs.writeJson(proxyMapPath, proxyMap, { spaces: 2 });
      }
    } else {
      if (usingProxies) {
        // Proxy path: use AudioSyncer directly to capture videoStart for proxy-map.json
        const { default: AudioSyncer } = await import('./sync/AudioSyncer.js');
        const outputPath = path.join(syncOutputDir, 'synced-output.mp4');
        await fs.ensureDir(syncOutputDir);
        const syncer = new AudioSyncer({ videoPath: videoFile, audioPath: audioFile, outputPath });
        await syncer.init();
        const { lagSeconds, snr, isReliable } = await syncer.computeLag();
        console.log(`  Best lag: ${lagSeconds.toFixed(3)}s  (SNR: ${snr.toFixed(1)}${isReliable ? '' : ' — LOW CONFIDENCE, verify output manually'})`);
        const trimPoints = await syncer.computeTrimPoints(lagSeconds);
        await syncer.produceOutput(trimPoints, true);
        await syncer.close();
        videoForExtract = outputPath;
        const proxyMapPath = path.join(cwd, 'public', 'proxy', 'proxy-map.json');
        const proxyMap = await fs.readJson(proxyMapPath);
        if (proxyMap[0]) proxyMap[0].videoStart = trimPoints.videoStart;
        await fs.writeJson(proxyMapPath, proxyMap, { spaces: 2 });
      } else {
        // Single angle: pass paths directly so no intermediate copy is needed
        await runStep(
          'npm run sync',
          'npm', ['run', 'sync', '--', '--video', videoFile, '--audio', audioFile],
          path.join(syncOutputDir, 'synced-output.mp4'),
        );
        videoForExtract = path.join(syncOutputDir, 'synced-output.mp4');
      }
    }
  }

  // ── STEP: Keyframe optimisation (post-sync, mode 1 only) ─────────────────
  // Re-encodes synced video with -g 60 -movflags +faststart so Remotion can
  // seek frame-by-frame without decoding back to sparse keyframes (~5h → ~35min).
  // Skipped for proxy files: the sync output is already H.264 with -g 60.
  if (resumeStep === 0 && mode === 1 && !usingProxies && (!redoStepId || redoStepId === 'optimize')) {
    console.log('\n  ── Optimise video for Remotion (keyframes) ──────────');
    const { optimizeForRemotion } = await import('./optimize/optimize-for-remotion.js');
    const pathsToOptimize = numAngles > 1
      ? syncResults.map(r => r.outputPath)
      : [path.join(syncOutputDir, 'synced-output.mp4')];
    await optimizeForRemotion(pathsToOptimize);
  }

  if (redoStepId === 'optimize') {
    redoStepId = null;
  }

  // ── STEP: Prepare audio ───────────────────────────────────────────────────
  // Runs on fresh start (resumeStep=0) OR when sync is done but audio not yet extracted
  // (resumeStep=1 && !existing.audioInInput — e.g. crash between sync and extract, or manual sync).
  const needsAudioExtract = resumeStep === 0 || (resumeStep === 1 && !existing.audioInInput);
  if (needsAudioExtract) {
    console.log('\n  ── Prepare audio for transcription ──────────────────');
    if (mode === 1 || mode === 3) {
      // When resuming after sync, videoForExtract may be null (fresh-start path wasn't run).
      // Infer from the existing sync output.
      if (!videoForExtract && existing.syncedVideo) {
        const syncDir = path.join(cwd, 'public', 'sync', 'output');
        const files = await fs.readdir(syncDir).catch(() => []);
        const primary = files.find(f => f === 'synced-output.mp4' || f === 'synced-output-1.mp4');
        if (primary) videoForExtract = path.join(syncDir, primary);
      }
      if (mode === 3) await copyToTranscribeInput(videoFile);
      await extractAudio(videoForExtract);
    } else if (mode === 2) {
      await copyToTranscribeInput(videoFile);
      await copyToTranscribeInput(audioFile);
    } else {
      await copyToTranscribeInput(audioFile);
    }
  }

  if (redoStepId === 'sync') {
    redoStepId = null;
  }

  // ── STEP: Choose Whisper model ────────────────────────────────────────────
  const rawTranscriptPath = path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'transcript.raw.json');
  const diarizationPath   = path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'diarization.json');
  const docPath           = path.join(cwd, 'public', 'edit', 'transcript.doc.txt');
  const transcriptPath    = path.join(cwd, 'public', 'edit', 'transcript.json');

  let whisperModel = 'medium.en';
  if (resumeStep < 2 && (!redoStepId || redoStepId === 'transcribe')) {
    console.log('\n  ── Whisper model ─────────────────────────────────────');
    console.log('  Choose a transcription model (for a ~36 min recording on CPU):\n');
    console.log('  1. tiny.en    ~5 min       Lower accuracy');
    console.log('  2. small.en   ~20–30 min   Good accuracy  (best speed/accuracy balance)');
    console.log('  3. medium.en  ~60–120 min  High accuracy  (default)');
    console.log('  4. large-v3   ~3–4 hrs     Highest accuracy\n');
    console.log('  The model is downloaded automatically on first use.');
    const modelChoice = (await ask('  > [3] ')).trim() || '3';
    const modelMap = { '1': 'tiny.en', '2': 'small.en', '3': 'medium.en', '4': 'large-v3' };
    whisperModel = modelMap[modelChoice] ?? 'medium.en';
    console.log(`  ✓ Using ${whisperModel}`);
  }
  const transcribeArgs = ['run', 'transcribe', '--', '--model', whisperModel];

  // ── STEP: Transcribe (+ diarize in parallel if multi-speaker) ─────────────
  const shouldTranscribe = resumeStep < 2 && (!redoStepId || redoStepId === 'transcribe');
  if (shouldTranscribe && multiSpeaker) {
    const diarizationAlreadyDone = existing.diarization;

    if (diarizationAlreadyDone) {
      // Diarization already complete — run transcription only
      console.log('\n  ── Transcribe ────────────────────────────────────────');
      console.log('  (Diarization already complete — skipping)');
      await runStep('npm run transcribe', 'npm', transcribeArgs, rawTranscriptPath);
    } else {
      console.log('\n  ── Transcribe + Diarize (parallel) ──────────────────');

    // ── Run transcription + diarization ───────────────────────────────────
    let diarizeArgs = ['run', 'diarize', '--', '--num-speakers', String(numSpeakers)];

    let results = await runParallel([
      { label: 'transcribe', cmd: 'npm', args: transcribeArgs },
      { label: 'diarize',    cmd: 'npm', args: diarizeArgs },
    ]);

    const transcribeResult = results.find(r => r.label === 'transcribe');
    let diarizeResult      = results.find(r => r.label === 'diarize');

    // ── Handle transcription failure ──────────────────────────────────────
    if (!transcribeResult.ok) {
      console.error(`\n  ✗ Transcription failed: ${transcribeResult.error.message}`);
      const retry = await confirm('  Retry transcription?');
      if (retry) {
        await runStep('npm run transcribe', 'npm', transcribeArgs, rawTranscriptPath);
      }
    }

    // ── Handle diarization failure — with Python venv recovery ────────────
    while (!diarizeResult.ok) {
      const errText = (diarizeResult.error?.stderr ?? '') + (diarizeResult.error?.message ?? '');
      const isPythonNotFound  = /python not found|command missing|ENOENT/i.test(errText);
      const isPythonWrongVersion = /not supported|3\.\d+.*required|requires python/i.test(errText);

      if (isPythonNotFound) {
        console.log('\n  ✗ Python was not found on this machine.');
        console.log('  Diarization requires Python 3.9–3.12.\n');
        console.log('  1. Download and install Python 3.12 from https://www.python.org/downloads/');
        console.log('     During install, check "Add python.exe to PATH".');
        console.log('     Or if you already have a Python 3.12 install, make sure py launcher is available.\n');
        console.log('  2. Once installed, open a NEW terminal and run:\n');
        console.log('       py -3.12 -m venv .venv');
        console.log('       .venv\\Scripts\\activate');
        console.log('       pip install -r scripts/diarize/requirements.txt\n');
        await ask('  Press Enter here when pip install has finished...');
        console.log('');
        console.log('  Enter the path to the Python executable inside the venv.');
        console.log('  If you used the commands above, the path is:');
        console.log('    .venv\\Scripts\\python.exe  (press Enter to use this default)\n');
        const pythonPath = (await ask('  Python path [.venv\\Scripts\\python.exe]: ')).trim()
          || '.venv\\Scripts\\python.exe';
        diarizeArgs = ['run', 'diarize', '--', '--num-speakers', String(numSpeakers), '--python', pythonPath];
      } else if (isPythonWrongVersion) {
        console.log('\n  ✗ Diarization requires Python 3.9–3.12 (your default Python is too new).');
        console.log('  Open a NEW terminal window and run:\n');
        console.log('    py -3.12 -m venv .venv');
        console.log('    .venv\\Scripts\\activate');
        console.log('    pip install -r scripts/diarize/requirements.txt\n');
        console.log('  If py -3.12 is not found, install Python 3.12 from https://www.python.org/downloads/\n');
        await ask('  Press Enter here when pip install has finished...');
        console.log('');
        console.log('  Enter the path to the Python executable inside the venv.');
        console.log('  If you used the commands above, the path is:');
        console.log('    .venv\\Scripts\\python.exe  (press Enter to use this default)\n');
        const pythonPath = (await ask('  Python path [.venv\\Scripts\\python.exe]: ')).trim()
          || '.venv\\Scripts\\python.exe';
        diarizeArgs = ['run', 'diarize', '--', '--num-speakers', String(numSpeakers), '--python', pythonPath];
      } else {
        console.error(`\n  ✗ Diarization failed: ${diarizeResult.error.message}`);
        const retry = await confirm('  Retry diarization?');
        if (!retry) break;
      }

      console.log('\n  → Re-running diarization...');
      const [retryResult] = await runParallel([
        { label: 'diarize', cmd: 'npm', args: diarizeArgs },
      ]);
      diarizeResult = retryResult;
    }

    if (diarizeResult.ok) {
      console.log(`\n  Output: ${rawTranscriptPath}`);
      console.log(`          ${diarizationPath}`);
    }
    } // end else (diarization not already done)
  } else if (shouldTranscribe) {
    console.log('\n  ── Transcribe ────────────────────────────────────────');
    await runStep('npm run transcribe', 'npm', transcribeArgs, rawTranscriptPath);
  }

  if (redoStepId === 'transcribe') {
    redoStepId = null;
  }

  // ── STEP: Forced alignment (after transcribe, before assignment/editing) ──
  const shouldRunAlignment = (() => {
    if (redoStepId === 'align') return true;    // force re-run even if already aligned
    if (redoStepId) return false;               // other redo targets: skip alignment
    return resumeStep < 3 && !(resumeStep >= 2 && existing.alignedTranscript);
  })();
  if (shouldRunAlignment) {
    console.log('\n  ── Forced alignment (WhisperX, CPU-local) ────────────');
    let alignArgs = ['run', 'transcript:align'];
    let alignOk = false;

    while (!alignOk) {
      try {
        await spawnStep('npm', alignArgs);
        console.log(`  ✓ Done — ${rawTranscriptPath}`);
        alignOk = true;
        break;
      } catch (err) {
        const errText = err.message || '';
        const isPythonNotFound = /python not found|command missing|ENOENT|WindowsApps\\python|permission denied/i.test(errText);
        const isPythonWrongVersion = /requires python 3\.9-3\.12|requires python 3\.9–3\.12|python 3\.(1[3-9]|[2-9][0-9])/i.test(errText);
        const isWhisperxMissing = /WhisperX is not installed|No module named ['"]whisperx['"]|could not import whisperx/i.test(errText);

        if (isPythonNotFound || isPythonWrongVersion || isWhisperxMissing) {
          console.log('\n  ✗ Forced alignment could not run with the current Python interpreter.');
          console.log('  Use a Python 3.12 virtual environment for alignment.\n');
          console.log('  1. Create and activate a venv (if not done already):\n');
          console.log('       py -3.12 -m venv .venv');
          console.log('       .venv\\Scripts\\activate');
          console.log('       python -m pip install --upgrade pip setuptools wheel');
          console.log('       python -m pip install whisperx faster-whisper\n');
          console.log('  2. Enter the Python path from that venv.');
          console.log('     If you used the commands above, it is:');
          console.log('       .venv\\Scripts\\python.exe  (press Enter to use this default)\n');

          const pythonPath = (await ask('  Python path [.venv\\Scripts\\python.exe]: ')).trim()
            || '.venv\\Scripts\\python.exe';
          alignArgs = ['run', 'transcript:align', '--', '--python', pythonPath];

          console.log('\n  → Re-running alignment...');
          continue;
        }

        console.error(`\n  ✗ Forced alignment failed: ${err.message}`);
        const retry = await confirm('  Retry alignment?');
        if (!retry) break;
      }
    }

    if (!alignOk) {
      console.log('  Continuing without forced alignment. You can run it later with:');
      console.log('    npm run transcript:align -- --python .venv\\Scripts\\python.exe');
    }
  } else if (resumeStep >= 2 && existing.alignedTranscript) {
    console.log('\n  ── Forced alignment ───────────────────────────────────');
    console.log('  (Already applied — skipping)');
  }

  if (redoStepId === 'align') {
    redoStepId = null;
  }

  // ── STEP: Assign speakers (multi-speaker only) ────────────────────────────
  const shouldBuildDoc = resumeStep < 3 && (!redoStepId || redoStepId === 'buildDoc');
  if (shouldBuildDoc && multiSpeaker) {
    console.log('\n  ── Assign speakers ───────────────────────────────────');
    const extraFlags = [
      ...(videoSrcForRemotion ? ['--video-src', videoSrcForRemotion] : []),
      ...(videoSrcsForRemotion ? ['--video-srcs', videoSrcsForRemotion.join(',')] : []),
    ];
    const offsetArgs = extraFlags.length > 0 ? ['--', ...extraFlags] : [];
    let assignOk = false;
    while (!assignOk) {
      try {
        await spawnStep('npm', ['run', 'speakers:assign']);
        await spawnStep('npm', ['run', 'transcript:init', ...offsetArgs]);
        assignOk = true;
      } catch (err) {
        console.error(`  ✗ ${err.message}`);
        const retry = await confirm('  Retry?');
        if (!retry) break;
      }
    }

    console.log(`  ✓ Done — ${docPath}`);
    console.log('\n  Open transcript.doc.txt and rename speakers in the SPEAKERS section at the top.');
    console.log(`  File: ${docPath}\n`);
    openFile(docPath);
    await ask('  Press Enter when done renaming speakers...');

    console.log('  Applying speaker names...');
    try {
      await spawnStep('npm', ['run', 'transcript:merge', ...offsetArgs]);
      // Regenerate doc with real speaker names in segment lines
      await spawnStep('npm', ['run', 'transcript:init', ...offsetArgs]);
      console.log('  ✓ Speaker names applied');
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }
  } else if (shouldBuildDoc) {
    // Single speaker: just generate the doc
    const singleExtraFlags = [
      ...(videoSrcForRemotion ? ['--video-src', videoSrcForRemotion] : []),
      ...(videoSrcsForRemotion ? ['--video-srcs', videoSrcsForRemotion.join(',')] : []),
    ];
    const offsetArgs = singleExtraFlags.length > 0 ? ['--', ...singleExtraFlags] : [];
    console.log('\n  ── Build editable transcript ─────────────────────────');
    await runStep('npm run transcript:init', 'npm', ['run', 'transcript:init', ...offsetArgs], docPath);
  }

  if (redoStepId === 'buildDoc') {
    redoStepId = null;
  }

  // ── STEP: Edit transcript ─────────────────────────────────────────────────
  if ((!redoStepId && resumeStep < 4) || redoStepId === 'mergeDoc') {
    console.log('\n  ── Edit transcript ───────────────────────────────────');
    console.log(`  Open and edit: ${docPath}`);
    console.log('  (See instructions at the top — cut words, fix text, mark segments CUT.)');
    openFile(docPath);
    await ask('  Press Enter when done editing...');

    const mergeExtraFlags = [
      ...(videoSrcForRemotion ? ['--video-src', videoSrcForRemotion] : []),
      ...(videoSrcsForRemotion ? ['--video-srcs', videoSrcsForRemotion.join(',')] : []),
    ];
    const mergeOffsetArgs = mergeExtraFlags.length > 0 ? ['--', ...mergeExtraFlags] : [];
    const cutPauses = await confirm('  Auto-cut silences longer than 0.5 s?', false);
    if (cutPauses) {
      await runStep(
        'npm run transcript:merge:cut-pauses',
        'npm', ['run', 'transcript:merge:cut-pauses', ...mergeOffsetArgs],
        transcriptPath,
      );
    } else {
      await runStep(
        'npm run transcript:merge',
        'npm', ['run', 'transcript:merge', ...mergeOffsetArgs],
        transcriptPath,
      );
    }
  }

  if (redoStepId === 'mergeDoc') {
    redoStepId = null;
  }

  // ── STEP: Camera setup (optional — skip for audio-only) ───────────────────
  async function runCameraSetup() {
    console.log('\n  ── Camera setup ──────────────────────────────────────');

    // Ask about dynamic angles (camera drooping/changing during filming)
    const useDynamicAngles = await askYesNo('  Does your camera switch angles while filming (e.g., drooping)?', false);
    let intervalMinutes = 5;
    let dynamicAngleIndices = null; // null = all angles, or array of indices

    if (useDynamicAngles) {
      console.log('  Dynamic angles mode: Capturing frames at intervals to account for camera movement.');
      const intervalInput = await askQuestion('  Enter sampling interval in minutes (default: 5): ');
      intervalMinutes = parseFloat(intervalInput) || 5;
      console.log(`  Using interval: ${intervalMinutes} minutes`);

      // If multi-angle, ask which specific angles need dynamic capture
      if (numAngles > 1 && videoSrcsForRemotion) {
        console.log('\n  Which angles need dynamic angle capture?');
        console.log('  (Some angles may be fixed while others move)');
        videoSrcsForRemotion.forEach((src, i) => {
          console.log(`    ${i + 1}. Angle ${i + 1}: ${path.basename(src)}`);
        });
        console.log(`    A. All angles`);
        const angleInput = await askQuestion('  Enter numbers (e.g., 1,3) or A for all (default: A): ');
        if (angleInput.trim() && angleInput.trim().toUpperCase() !== 'A') {
          dynamicAngleIndices = angleInput.split(',').map(s => parseInt(s.trim()) - 1).filter(n => !isNaN(n) && n >= 0 && n < numAngles);
          if (dynamicAngleIndices.length === 0) dynamicAngleIndices = null;
          else console.log(`  Dynamic angles enabled for: ${dynamicAngleIndices.map(i => `Angle ${i + 1}`).join(', ')}`);
        }
        if (!dynamicAngleIndices) console.log('  Dynamic angles enabled for all angles');
      }
      console.log('');
    }

    console.log('  Detecting faces in video frame(s)...');
    // Build the list of video paths to run face detection on.
    // Pass all synced output files so setup-camera can find them in Docker.
    const cameraDetectArgs = ['scripts/camera/setup-camera.js', '--detect-only'];
    if (videoSrcsForRemotion && videoSrcsForRemotion.length > 0) {
      const absPaths = videoSrcsForRemotion.map(rel => path.join(cwd, 'public', rel));
      cameraDetectArgs.push('--videos', ...absPaths);
    }
    if (useDynamicAngles) {
      cameraDetectArgs.push('--dynamic-angles', '--interval-minutes', String(intervalMinutes));
      if (dynamicAngleIndices) {
        cameraDetectArgs.push('--dynamic-angles-indices', dynamicAngleIndices.join(','));
      }
    } else {
      cameraDetectArgs.push('--no-dynamic-angles');
    }
    try {
      await spawnStep('node', cameraDetectArgs);
    } catch (err) {
      console.warn(`  ⚠ Face detection failed: ${err.message}`);
      console.log('  You can draw boxes manually in the GUI.');
    }

    // Spawn dev server and capture logs so startup failures are visible.
    let devLog = '';
    let devExitedCode = null;
    const devServer = spawn('npm', ['run', 'dev', '--', '--hostname', '0.0.0.0', '--port', '3000'], {
      cwd,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const appendDevLog = (chunk) => {
      devLog += chunk.toString();
      if (devLog.length > 6000) devLog = devLog.slice(-6000);
    };
    devServer.stdout.on('data', appendDevLog);
    devServer.stderr.on('data', appendDevLog);
    devServer.on('close', code => { devExitedCode = code; });

    const cameraUrl = 'http://127.0.0.1:3000/camera';
    const serverReady = await waitForHttp(cameraUrl, 90000, 700);

    console.log('\n  → Open http://localhost:3000/camera in your browser');
    if (isDockerEnv()) {
      console.log('  (Docker) Ensure you started wizard with: docker-compose run --rm --service-ports wizard');
    }
    if (!serverReady) {
      if (devExitedCode !== null) {
        console.log(`  ✗ Next.js dev server exited early (code ${devExitedCode}).`);
        if (devLog.trim()) {
          console.log('  Last server log lines:');
          console.log('  ─────────────────────────────────────────────────────');
          console.log(devLog.split('\n').slice(-12).map(l => `  ${l}`).join('\n'));
          console.log('  ─────────────────────────────────────────────────────');
        }
      } else {
        console.log('  ⚠ Server is running but /camera is still unreachable.');
        console.log('  If it does not load, confirm port 3000 is free and retry with --service-ports.');
      }
    }
    console.log('  Assign faces to speakers, then click Save profiles.\n');
    await ask('  Press Enter when done saving...');

    // Best-effort kill
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(devServer.pid), '/f', '/t'], {
          shell: true, stdio: 'ignore',
        });
      } else {
        process.kill(devServer.pid, 'SIGTERM');
      }
    } catch {
      console.log('  (Stop the dev server manually if it is still running)');
    }

    const profilePath = path.join(cwd, 'public', 'camera', 'camera-profiles.json');
    if (await fs.pathExists(profilePath)) {
      console.log(`  ✓ camera-profiles.json saved`);
    } else {
      console.log('  ⚠ camera-profiles.json not found — camera cuts will not be applied in Remotion');
    }
  }

  if (mode !== 4) {
    if (redoStepId === 'camera') {
      await runCameraSetup();
      redoStepId = null;
    } else if (resumeStep < 4) {
      // Fresh run: ask if they want camera setup (defaults to false)
      console.log('');
      const doCamera = await confirm('  Set up speaker closeup cuts? (camera)', false);
      if (doCamera) {
        await runCameraSetup();
      }
    } else if (resumeStep === 4 && !existing.cameraProfiles) {
      // Resume at step 4: prompt if camera profiles are missing
      console.log('');
      const doCamera = await confirm('  Camera profiles not found. Set up speaker closeup cuts now?', true);
      if (doCamera) {
        await runCameraSetup();
      } else {
        console.log('  Skipping camera setup. Run wizard again to set up camera cuts later.');
      }
    }
  }

  // ── STEP: Thumbnail frame selection (optional — skip for audio-only) ──────
  const thumbnailOutputPath = path.join(cwd, 'public', 'output', 'thumbnail.png');

  async function runThumbnailSelection() {
    console.log('\n  ── Thumbnail frame selection ────────────────────────');
    const thumbnailDir = path.join(cwd, 'public', 'transcribe', 'output', 'thumbnail');
    const candidatesPath = path.join(thumbnailDir, 'candidates.json');
    const selectionsPath = path.join(thumbnailDir, 'selections.json');

    // 1. Extract candidate frames
    console.log('\n  Step 1: Extracting 3 candidate frames per speaker...');
    const videoPath = videoSrcsForRemotion?.[0] || videoSrcForRemotion;
    const extractArgs = [
      'scripts/thumbnail/extract-speaker-candidates.py',
      '--transcript', path.join(cwd, 'public', 'edit', 'transcript.json'),
      '--camera-profiles', path.join(cwd, 'public', 'camera', 'camera-profiles.json'),
      '--video', path.join(cwd, 'public', videoPath || 'sync/output/synced-output-1.mp4'),
      '--output-dir', thumbnailDir,
      '--num-candidates', '3',
    ];
    await spawnStep('python3', extractArgs);

    // Load candidates for display
    const candidatesData = await fs.readJson(candidatesPath);
    const speakers = candidatesData.speakers || [];

    if (speakers.length === 0) {
      console.log('  ⚠ No candidate frames found — skipping thumbnail generation');
      return;
    }

    // 2. Show candidates and let user select
    console.log('\n  Step 2: Select preferred frame for each speaker');
    console.log('  Candidate previews will open in your image viewer.\n');

    const selections = [];

    for (const speakerData of speakers) {
      const speaker = speakerData.speaker;
      const candidates = speakerData.candidates;

      console.log(`\n  === ${speaker} ===`);
      console.log(`  Found ${candidates.length} valid candidate(s):\n`);

      for (const c of candidates) {
        console.log(`    [${c.index}] t=${c.timestamp}s`);
        const previewFullPath = path.join(thumbnailDir, path.basename(c.previewPath));
        if (await fs.pathExists(previewFullPath)) {
          openFile(previewFullPath);
        }
      }

      // Get user selection
      let selectedIndex = null;
      while (selectedIndex === null) {
        const answer = (await ask(`\n  Select frame [0-${candidates.length - 1}]: `)).trim();
        const idx = parseInt(answer, 10);
        if (!isNaN(idx) && idx >= 0 && idx < candidates.length) {
          selectedIndex = idx;
        } else {
          console.log('  Invalid selection. Please try again.');
        }
      }

      const selectedCandidate = candidates.find(c => c.index === selectedIndex);
      selections.push({
        speaker,
        selectedIndex,
        timestamp: selectedCandidate.timestamp,
        previewPath: selectedCandidate.previewPath,
      });
      console.log(`  ✓ Selected: frame [${selectedIndex}] at t=${selectedCandidate.timestamp}s`);
    }

    // Save selections
    await fs.writeJson(selectionsPath, { selections }, { spaces: 2 });
    console.log(`\n  ✓ Selections saved`);

    // 3. Generate cutouts from selections
    console.log('\n  Step 3: Generating final cutouts...');
    await spawnStep('node', [
      'scripts/thumbnail/generate-cutouts-from-selection.js',
      '--selections', selectionsPath,
      '--output-dir', thumbnailDir,
    ]);

    // 4. Generate thumbnail
    console.log('\n  Step 4: Generating thumbnail...');
    const transcript = await fs.readJson(path.join(cwd, 'public', 'edit', 'transcript.json'));
    const title = transcript.meta?.title || '';
    const speakerNames = selections.map(s => s.speaker);

    const thumbnailArgs = [
      'scripts/thumbnail/generate-thumbnail.js',
      '--transcript', 'public/edit/transcript.json',
      '--camera-profiles', 'public/camera/camera-profiles.json',
      '--video', videoPath || 'sync/output/synced-output-1.mp4',
      '--output', 'public/thumbnail/thumbnail.png',
      '--speakers', ...speakerNames,
    ];
    if (title) thumbnailArgs.push('--title', title);

    await spawnStep('node', thumbnailArgs);
  }

  if (mode !== 4) {
    if (redoStepId === 'thumbnail') {
      await runThumbnailSelection();
      redoStepId = null;
    } else if (!redoStepId) {
      console.log('');
      const doThumbnail = await confirm('  Generate thumbnail with frame selection?', false);
      if (doThumbnail) {
        await runThumbnailSelection();
      }
    }
  }

  // ── STEP: Cut preview — default review step before Remotion ─────────────
  // Fast ffmpeg export (~2-5 min). Review this before launching Remotion so
  // the full overlay render (30-45 min) only runs on an approved cut.
  if (mode !== 4 && (!redoStepId || redoStepId === 'preview')) {
    const previewPath = path.join(cwd, 'public', 'edit', 'preview-cut.mp4');
    console.log('\n  ── Review your edit (cut preview) ───────────────────');
    await runStep('npm run cut:preview', 'npm', ['run', 'cut:preview'], previewPath);
    openFile(previewPath);
    console.log(`  → Opened preview: ${previewPath}`);
    if (redoStepId === 'preview') redoStepId = null;
  }

  // ── STEP: Remotion (optional — skip for audio-only) ──────────────────────
  if (mode !== 4) {
    if (redoStepId === 'remotion') {
      console.log('\n  Starting Remotion...\n');
      await spawnStep('npm', ['run', 'remotion:studio']);
      redoStepId = null;
    } else if (!redoStepId) {
      console.log('');
      const doRemotion = await confirm('  Launch Remotion studio for final overlay render?', false);
      if (doRemotion) {
        console.log('\n  Starting Remotion...\n');
        await spawnStep('npm', ['run', 'remotion:studio']);
      }
    }
  }

  // ── STEP: Conform to raw (optional — only when proxy-map.json exists) ─────
  {
    const proxyMapPath = path.join(cwd, 'public', 'proxy', 'proxy-map.json');
    if (redoStepId === 'conform') {
      console.log('\n  ── Export final cut from raw ─────────────────────────');
      await spawnStep('node', [
        'scripts/conform/conform-to-raw.js',
        '--transcript', path.join(cwd, 'public', 'edit', 'transcript.json'),
        '--proxy-map', proxyMapPath,
        '--output', path.join(cwd, 'public', 'output', 'final-cut.mov'),
      ]);
      redoStepId = null;
    } else if (!redoStepId && mode !== 4 && await fs.pathExists(proxyMapPath)) {
      console.log('');
      const doConform = await confirm('  Export final cut from original raw files?', false);
      if (doConform) {
        console.log('\n  ── Export final cut from raw ─────────────────────────');
        await spawnStep('node', [
          'scripts/conform/conform-to-raw.js',
          '--transcript', path.join(cwd, 'public', 'edit', 'transcript.json'),
          '--proxy-map', proxyMapPath,
          '--output', path.join(cwd, 'public', 'output', 'final-cut.mov'),
        ]);
        console.log('  ✓ Final cut written to public/output/final-cut.mov');
      }
    }
  }

  console.log('\n  ✓ All done!\n');

  // ── STEP: Short-form clips (optional) ────────────────────────────────────
  const doShorts = await confirm('  Create short-form clips from this recording?', false);
  if (doShorts) {
    rl.close();
    await spawnStep('node', ['scripts/shorts-wizard.js', '--from-longform']);
    return;
  }

  rl.close();
}

main().catch(err => {
  console.error('\n✗ Wizard error:', err.message);
  rl.close();
  process.exit(1);
});
