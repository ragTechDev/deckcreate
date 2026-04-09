#!/usr/bin/env node

import path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';

const FPS = 60;
const HOOK_TAIL_PAD_UNBOUNDED_SECONDS = 0.16;
const HOOK_TAIL_PAD_BOUNDED_SECONDS = 0.02;
const DEFAULT_DRIFT_THRESHOLD_MS = 180;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    transcriptPath: null,
    outDir: null,
    entry: 'remotion/index.ts',
    compositionId: 'ragTechVodcast',
    outputVideo: null,
    pythonBin: 'python',
    device: 'cpu',
    language: 'en',
    driftThresholdMs: DEFAULT_DRIFT_THRESHOLD_MS,
    skipRender: false,
    keepTemp: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--transcript' && args[i + 1]) out.transcriptPath = args[++i];
    else if (a === '--out-dir' && args[i + 1]) out.outDir = args[++i];
    else if (a === '--entry' && args[i + 1]) out.entry = args[++i];
    else if (a === '--composition' && args[i + 1]) out.compositionId = args[++i];
    else if (a === '--output-video' && args[i + 1]) out.outputVideo = args[++i];
    else if (a === '--python' && args[i + 1]) out.pythonBin = args[++i];
    else if (a === '--device' && args[i + 1]) out.device = args[++i];
    else if (a === '--language' && args[i + 1]) out.language = args[++i];
    else if (a === '--drift-threshold-ms' && args[i + 1]) out.driftThresholdMs = Number(args[++i]);
    else if (a === '--skip-render') out.skipRender = true;
    else if (a === '--keep-temp') out.keepTemp = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }

  return out;
}

function printHelp() {
  console.log(`\nHook segment QA

Renders hooks-only output, retranscribes + force-aligns that render,
and compares observed tokens/timing against expected hook tokens.

Usage:
  npm run hook-qa -- [options]

Options:
  --transcript <path>          Input transcript.json
                               Default: public/transcribe/output/edit/transcript.json
  --out-dir <path>             Output directory for QA artifacts
                               Default: public/transcribe/output/hook-qa
  --entry <path>               Remotion entry file (for render)
                               Default: remotion/index.ts
  --composition <id>           Remotion composition id
                               Default: ragTechVodcast
  --output-video <filename>    Output rendered video filename (inside out-dir)
                               Default: hooks-only.mp4
  --python <bin>               Python binary for WhisperX align
                               Default: python
  --device <device>            WhisperX device (cpu/cuda)
                               Default: cpu
  --language <code>            WhisperX language code
                               Default: en
  --drift-threshold-ms <ms>    Timing drift threshold for mismatch reporting
                               Default: 180
  --skip-render                Skip Remotion render and reuse --output-video
  --keep-temp                  Keep intermediate hook-transcript.json
  --help, -h                   Show this help
`);
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with exit code ${code}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

function normalizeTokenText(text) {
  return (text || '')
    .trim()
    .replace(/^[^\w']+|[^\w']+$/g, '')
    .toLowerCase();
}

function isSpokenToken(token) {
  const trimmed = (token?.text || '').trim();
  if (trimmed === '' || /_[A-Z]+_/.test(trimmed)) return false;
  if (/^[.,?_\s]*$/.test(trimmed.replace(/ /g, ''))) return false;
  return normalizeTokenText(trimmed) !== '';
}

function getHookClipRange(segment) {
  const sourceStart = segment.hookFrom ?? segment.start;
  const baseEnd = segment.hookTo ?? segment.end;
  const isBoundedHook = segment.hookTo !== undefined && segment.hookTo !== null;

  let sourceEnd = baseEnd;
  if (!isBoundedHook) {
    const lastSpokenToken = (segment.tokens || [])
      .filter(isSpokenToken)
      .sort((a, b) => (b.t_end ?? 0) - (a.t_end ?? 0))[0];

    if (lastSpokenToken?.t_end) {
      sourceEnd = Math.max(baseEnd, lastSpokenToken.t_end);
    }
  }

  sourceEnd += isBoundedHook
    ? HOOK_TAIL_PAD_BOUNDED_SECONDS
    : HOOK_TAIL_PAD_UNBOUNDED_SECONDS;

  return { sourceStart, sourceEnd };
}

function toClipFrames(sourceStart, sourceEnd, fps) {
  const trimBefore = Math.floor(sourceStart * fps);
  const trimAfter = Math.ceil(sourceEnd * fps);
  return Math.max(1, trimAfter - trimBefore);
}

function buildExpectedHookTokens(transcript, fps) {
  const hookSegments = (transcript.segments || []).filter((s) => s.hook && !s.cut);
  const expectedTokens = [];
  const clips = [];

  let cumulativeFrames = 0;
  for (const seg of hookSegments) {
    const { sourceStart, sourceEnd } = getHookClipRange(seg);
    const durationFrames = toClipFrames(sourceStart, sourceEnd, fps);
    const outputStartSec = cumulativeFrames / fps;

    const spoken = (seg.tokens || [])
      .filter(isSpokenToken)
      .filter((t) => t.t_dtw >= sourceStart && t.t_dtw < sourceEnd)
      .sort((a, b) => a.t_dtw - b.t_dtw);

    for (const t of spoken) {
      const expectedStartSec = outputStartSec + Math.max(0, t.t_dtw - sourceStart);
      const expectedEndSec = outputStartSec + Math.max(0, (t.t_end ?? (t.t_dtw + 0.4)) - sourceStart);
      expectedTokens.push({
        segmentId: seg.id,
        rawText: t.text,
        text: normalizeTokenText(t.text),
        expectedStartSec,
        expectedEndSec,
        sourceTdtw: t.t_dtw,
        sourceTend: t.t_end ?? null,
      });
    }

    clips.push({
      segmentId: seg.id,
      sourceStart,
      sourceEnd,
      durationFrames,
      outputStartFrame: cumulativeFrames,
      outputEndFrame: cumulativeFrames + durationFrames,
    });

    cumulativeFrames += durationFrames;
  }

  return {
    hookSegments,
    clips,
    expectedTokens: expectedTokens.filter((t) => t.text !== ''),
    hookDurationFrames: cumulativeFrames,
  };
}

function flattenObservedTokens(rawTranscript) {
  const observed = [];
  for (const seg of rawTranscript.segments || []) {
    for (const t of seg.tokens || []) {
      if (!isSpokenToken(t)) continue;
      const text = normalizeTokenText(t.text);
      if (!text) continue;
      observed.push({
        segmentId: seg.id,
        rawText: t.text,
        text,
        startSec: t.t_dtw,
        endSec: t.t_end ?? (t.t_dtw + 0.4),
      });
    }
  }
  observed.sort((a, b) => a.startSec - b.startSec);
  return observed;
}

function compareTokens(expected, observed, driftThresholdMs) {
  const missing = [];
  const matched = [];
  const timingMismatches = [];
  const substitutions = [];
  const extras = [];

  const n = expected.length;
  const m = observed.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(''));

  for (let i = 1; i <= n; i++) {
    dp[i][0] = i;
    back[i][0] = 'del';
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = j;
    back[0][j] = 'ins';
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = expected[i - 1].text === observed[j - 1].text;
      const diagCost = dp[i - 1][j - 1] + (same ? 0 : 1);
      const delCost = dp[i - 1][j] + 1;
      const insCost = dp[i][j - 1] + 1;

      let bestCost = diagCost;
      let bestOp = same ? 'match' : 'sub';
      if (delCost < bestCost) {
        bestCost = delCost;
        bestOp = 'del';
      }
      if (insCost < bestCost) {
        bestCost = insCost;
        bestOp = 'ins';
      }

      dp[i][j] = bestCost;
      back[i][j] = bestOp;
    }
  }

  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const op = back[i][j] || (i > 0 ? 'del' : 'ins');
    if (op === 'match' || op === 'sub') {
      ops.push({ op, expectedIndex: i - 1, observedIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (op === 'del') {
      ops.push({ op, expectedIndex: i - 1 });
      i -= 1;
    } else {
      ops.push({ op, observedIndex: j - 1 });
      j -= 1;
    }
  }
  ops.reverse();

  for (const row of ops) {
    if (row.op === 'match') {
      const exp = expected[row.expectedIndex];
      const obs = observed[row.observedIndex];
      const driftMs = Math.round((obs.startSec - exp.expectedStartSec) * 1000);
      const out = {
        expectedIndex: row.expectedIndex,
        observedIndex: row.observedIndex,
        segmentId: exp.segmentId,
        text: exp.rawText,
        expectedStartSec: Number(exp.expectedStartSec.toFixed(3)),
        observedStartSec: Number(obs.startSec.toFixed(3)),
        driftMs,
      };
      matched.push(out);
      if (Math.abs(driftMs) > driftThresholdMs) {
        timingMismatches.push(out);
      }
    } else if (row.op === 'sub') {
      const exp = expected[row.expectedIndex];
      const obs = observed[row.observedIndex];
      substitutions.push({
        expectedIndex: row.expectedIndex,
        observedIndex: row.observedIndex,
        segmentId: exp.segmentId,
        expectedText: exp.rawText,
        expectedNormalized: exp.text,
        observedText: obs.rawText,
        observedNormalized: obs.text,
        expectedStartSec: Number(exp.expectedStartSec.toFixed(3)),
        observedStartSec: Number(obs.startSec.toFixed(3)),
      });
    } else if (row.op === 'del') {
      const exp = expected[row.expectedIndex];
      missing.push({
        expectedIndex: row.expectedIndex,
        segmentId: exp.segmentId,
        text: exp.rawText,
        normalized: exp.text,
        expectedStartSec: Number(exp.expectedStartSec.toFixed(3)),
      });
    } else {
      const obs = observed[row.observedIndex];
      extras.push({
        observedIndex: row.observedIndex,
        text: obs.rawText,
        normalized: obs.text,
        observedStartSec: Number(obs.startSec.toFixed(3)),
      });
    }
  }

  return { missing, timingMismatches, matched, extras, substitutions };
}

// ---------------------------------------------------------------------------
// Diagnostic enhancements
// ---------------------------------------------------------------------------

function buildSegmentMetadata(hookSegments, clips) {
  return hookSegments.map((seg, idx) => {
    const clip = clips[idx];
    const isBounded = seg.hookTo !== undefined && seg.hookTo !== null;
    const spokenTokens = (seg.tokens || []).filter(isSpokenToken);
    const tokensInRange = spokenTokens.filter(
      (t) => t.t_dtw >= clip.sourceStart && t.t_dtw < clip.sourceEnd,
    );
    const lastSpoken = tokensInRange.length > 0
      ? tokensInRange.reduce((latest, t) => (t.t_dtw > latest.t_dtw ? t : latest))
      : null;
    return {
      segmentId: seg.id,
      speaker: seg.speaker,
      text: seg.text ? seg.text.substring(0, 120) + (seg.text.length > 120 ? '…' : '') : '',
      hookFrom: seg.hookFrom ?? null,
      hookTo: seg.hookTo ?? null,
      isBounded,
      sourceStart: Number(clip.sourceStart.toFixed(3)),
      sourceEnd: Number(clip.sourceEnd.toFixed(3)),
      durationSec: Number((clip.sourceEnd - clip.sourceStart).toFixed(3)),
      durationFrames: clip.durationFrames,
      totalTokens: (seg.tokens || []).length,
      spokenTokenCount: spokenTokens.length,
      spokenTokensInRangeCount: tokensInRange.length,
      lastSpokenTdtw: lastSpoken ? Number(lastSpoken.t_dtw.toFixed(3)) : null,
      lastSpokenTend: lastSpoken?.t_end ? Number(lastSpoken.t_end.toFixed(3)) : null,
      tailPadApplied: isBounded ? HOOK_TAIL_PAD_BOUNDED_SECONDS : HOOK_TAIL_PAD_UNBOUNDED_SECONDS,
    };
  });
}

const BOUNDARY_PROXIMITY_SEC = 0.5;

function buildPerSegmentBreakdown(clips, diff, expectedTokens) {
  const bySegment = {};
  for (const clip of clips) {
    bySegment[clip.segmentId] = {
      segmentId: clip.segmentId,
      sourceStart: Number(clip.sourceStart.toFixed(3)),
      sourceEnd: Number(clip.sourceEnd.toFixed(3)),
      matchedCount: 0,
      missingCount: 0,
      substitutionCount: 0,
      timingMismatchCount: 0,
      extraCount: 0,
      missing: [],
      timingMismatches: [],
    };
  }

  for (const m of diff.matched) {
    if (bySegment[m.segmentId]) bySegment[m.segmentId].matchedCount++;
  }

  for (const m of diff.missing) {
    const entry = bySegment[m.segmentId];
    if (!entry) continue;
    entry.missingCount++;
    const exp = expectedTokens[m.expectedIndex];
    const sourceTdtw = exp?.sourceTdtw;
    let nearBoundary = null;
    if (sourceTdtw != null) {
      const distToEnd = entry.sourceEnd - sourceTdtw;
      const distToStart = sourceTdtw - entry.sourceStart;
      if (distToEnd <= BOUNDARY_PROXIMITY_SEC) nearBoundary = 'tail';
      else if (distToStart <= BOUNDARY_PROXIMITY_SEC) nearBoundary = 'head';
    }
    entry.missing.push({
      ...m,
      sourceTdtw: sourceTdtw != null ? Number(sourceTdtw.toFixed(3)) : null,
      nearBoundary,
      distToClipEndSec: sourceTdtw != null ? Number((entry.sourceEnd - sourceTdtw).toFixed(3)) : null,
    });
  }

  for (const s of diff.substitutions) {
    if (bySegment[s.segmentId]) bySegment[s.segmentId].substitutionCount++;
  }

  for (const t of diff.timingMismatches) {
    const entry = bySegment[t.segmentId];
    if (!entry) continue;
    entry.timingMismatchCount++;
    entry.timingMismatches.push(t);
  }

  return Object.values(bySegment);
}

function analyzeDriftTrends(diff, clips) {
  const bySegment = {};
  for (const clip of clips) {
    bySegment[clip.segmentId] = { drifts: [] };
  }

  for (const m of diff.matched) {
    if (bySegment[m.segmentId]) bySegment[m.segmentId].drifts.push(m.driftMs);
  }

  const trends = [];
  for (const clip of clips) {
    const { drifts } = bySegment[clip.segmentId];
    if (drifts.length === 0) {
      trends.push({ segmentId: clip.segmentId, matchedTokens: 0, note: 'no matched tokens' });
      continue;
    }
    const sorted = [...drifts].sort((a, b) => a - b);
    const mean = Math.round(drifts.reduce((s, d) => s + d, 0) / drifts.length);
    const median = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const allPositive = drifts.every((d) => d > 0);
    const allNegative = drifts.every((d) => d < 0);
    let direction = 'mixed';
    if (allPositive) direction = 'late (observed after expected)';
    else if (allNegative) direction = 'early (observed before expected)';

    let monotonic = drifts.length >= 3;
    for (let k = 1; k < drifts.length && monotonic; k++) {
      if (drifts[k] < drifts[k - 1] - 20) monotonic = false;
    }

    trends.push({
      segmentId: clip.segmentId,
      matchedTokens: drifts.length,
      meanDriftMs: mean,
      medianDriftMs: median,
      minDriftMs: min,
      maxDriftMs: max,
      direction,
      monotonicallyIncreasing: monotonic,
    });
  }
  return trends;
}

const ARCHITECTURE_HINTS = {
  tailClipping: {
    description: 'Tokens missing near the end of a hook clip — the clip ends too early.',
    investigate: [
      'remotion/components/SegmentPlayer.tsx → getHookSubClips(): check sourceEnd calculation',
      'HOOK_TAIL_PAD_BOUNDED_SECONDS (0.02) / HOOK_TAIL_PAD_UNBOUNDED_SECONDS (0.16) — may need increase',
      'Check if segment.hookTo is set too early in transcript.doc.txt',
      'For unbounded hooks, verify last spoken token t_end is used (not just t_dtw)',
    ],
  },
  headClipping: {
    description: 'Tokens missing near the start of a hook clip — the clip starts too late.',
    investigate: [
      'remotion/components/SegmentPlayer.tsx → getHookSubClips(): check sourceStart = hookFrom ?? segment.start',
      'Verify hookFrom value in transcript.doc.txt is correct',
    ],
  },
  systematicDrift: {
    description: 'All tokens in a segment are consistently early or late by a similar amount.',
    investigate: [
      'scripts/hook-qa.js → buildExpectedHookTokens(): verify outputStartSec accumulation matches Remotion frame mapping',
      'remotion/components/SegmentPlayer.tsx → buildSections(): check hook section frame math',
      'remotion/Composition.tsx → verify hookDuration calculation matches QA script',
      'Check for off-by-one in frame boundary rounding (Math.floor vs Math.ceil)',
    ],
  },
  accumulatingDrift: {
    description: 'Drift increases monotonically through a segment — timing offset is compounding.',
    investigate: [
      'scripts/hook-qa.js → buildExpectedHookTokens(): cumulativeFrames accumulation may diverge from Remotion',
      'remotion/components/SegmentPlayer.tsx → SectionGroupPlayer: trimBefore rounding may introduce per-frame drift',
      'Check FPS consistency (script uses 60, verify Remotion composition fps matches)',
    ],
  },
  asrNoise: {
    description: 'Substitutions and extras are ASR transcription differences, not rendering bugs. Usually safe to ignore.',
    investigate: [
      'No code fix needed — Whisper/WhisperX transcription variation',
      'If excessive, consider tuning Whisper model or increasing --drift-threshold-ms',
    ],
  },
};

function buildDiagnostics(segBreakdown, driftTrends, diff) {
  const conclusions = [];

  const tailClipped = segBreakdown.filter(
    (s) => s.missing.some((m) => m.nearBoundary === 'tail'),
  );
  if (tailClipped.length > 0) {
    conclusions.push({
      pattern: 'tailClipping',
      severity: 'high',
      affectedSegments: tailClipped.map((s) => s.segmentId),
      detail: tailClipped.map((s) => ({
        segmentId: s.segmentId,
        tailMissing: s.missing.filter((m) => m.nearBoundary === 'tail'),
      })),
      ...ARCHITECTURE_HINTS.tailClipping,
    });
  }

  const headClipped = segBreakdown.filter(
    (s) => s.missing.some((m) => m.nearBoundary === 'head'),
  );
  if (headClipped.length > 0) {
    conclusions.push({
      pattern: 'headClipping',
      severity: 'high',
      affectedSegments: headClipped.map((s) => s.segmentId),
      detail: headClipped.map((s) => ({
        segmentId: s.segmentId,
        headMissing: s.missing.filter((m) => m.nearBoundary === 'head'),
      })),
      ...ARCHITECTURE_HINTS.headClipping,
    });
  }

  const systematicDriftSegs = driftTrends.filter(
    (t) =>
      t.matchedTokens >= 3 &&
      t.direction !== 'mixed' &&
      Math.abs(t.meanDriftMs) > 100,
  );
  if (systematicDriftSegs.length > 0) {
    conclusions.push({
      pattern: 'systematicDrift',
      severity: 'medium',
      affectedSegments: systematicDriftSegs.map((s) => s.segmentId),
      detail: systematicDriftSegs.map((s) => ({
        segmentId: s.segmentId,
        meanDriftMs: s.meanDriftMs,
        direction: s.direction,
      })),
      ...ARCHITECTURE_HINTS.systematicDrift,
    });
  }

  const accumulatingSegs = driftTrends.filter(
    (t) =>
      t.monotonicallyIncreasing &&
      t.matchedTokens >= 3 &&
      Math.abs(t.maxDriftMs - t.minDriftMs) > 100,
  );
  if (accumulatingSegs.length > 0) {
    conclusions.push({
      pattern: 'accumulatingDrift',
      severity: 'high',
      affectedSegments: accumulatingSegs.map((s) => s.segmentId),
      detail: accumulatingSegs.map((s) => ({
        segmentId: s.segmentId,
        minDriftMs: s.minDriftMs,
        maxDriftMs: s.maxDriftMs,
        spread: s.maxDriftMs - s.minDriftMs,
      })),
      ...ARCHITECTURE_HINTS.accumulatingDrift,
    });
  }

  if (diff.substitutions.length > 0 || diff.extras.length > 0) {
    conclusions.push({
      pattern: 'asrNoise',
      severity: 'low',
      substitutionCount: diff.substitutions.length,
      extraCount: diff.extras.length,
      ...ARCHITECTURE_HINTS.asrNoise,
    });
  }

  return { conclusions, architectureReference: ARCHITECTURE_HINTS };
}

function toPublicRelative(publicDir, absPath) {
  const rel = path.relative(publicDir, absPath).replace(/\\/g, '/');
  if (rel.startsWith('..')) {
    throw new Error(`Path must be inside public/: ${absPath}`);
  }
  return rel;
}

async function main() {
  const cwd = process.cwd();
  const cli = parseArgs();

  if (cli.help) {
    printHelp();
    return;
  }

  const transcriptPath = path.resolve(
    cwd,
    cli.transcriptPath || path.join('public', 'transcribe', 'output', 'edit', 'transcript.json'),
  );
  const outDir = path.resolve(
    cwd,
    cli.outDir || path.join('public', 'transcribe', 'output', 'hook-qa'),
  );

  const outputVideo = path.resolve(outDir, cli.outputVideo || 'hooks-only.mp4');
  const rawOutDir = path.join(outDir, 'raw');
  const reportPath = path.join(outDir, 'hook-qa-report.json');
  const tempTranscriptPath = path.join(outDir, 'hook-transcript.json');

  if (!await fs.pathExists(transcriptPath)) {
    throw new Error(`Transcript not found: ${transcriptPath}`);
  }

  await fs.ensureDir(outDir);
  await fs.ensureDir(rawOutDir);

  const transcript = await fs.readJson(transcriptPath);
  const { expectedTokens, hookDurationFrames, hookSegments, clips } = buildExpectedHookTokens(transcript, FPS);

  if (hookSegments.length === 0) {
    throw new Error('No hook segments found in transcript.');
  }

  if (hookDurationFrames <= 0) {
    throw new Error('Computed hook duration is 0 frames.');
  }

  const hookOnlyTranscript = {
    ...transcript,
    segments: hookSegments,
  };

  await fs.writeJson(tempTranscriptPath, hookOnlyTranscript, { spaces: 2 });

  const publicDir = path.join(cwd, 'public');
  const transcriptSrc = toPublicRelative(publicDir, tempTranscriptPath);

  if (!cli.skipRender) {
    const src = transcript.meta?.videoSrc || 'sync/output/synced-output.mp4';
    const props = {
      src,
      transcriptSrc,
      hookMusicSrc: '',
    };

    console.log('\n[Hook QA] Rendering hooks-only video...');
    await run('npx', [
      'remotion',
      'render',
      cli.entry,
      cli.compositionId,
      outputVideo,
      '--props',
      JSON.stringify(props),
      '--frames',
      `0-${hookDurationFrames - 1}`,
      '--overwrite',
    ], cwd);
  }

  if (!await fs.pathExists(outputVideo)) {
    throw new Error(`Rendered video not found: ${outputVideo}`);
  }

  console.log('\n[Hook QA] Transcribing rendered hooks...');
  await run('node', [
    'scripts/transcribe/transcribe-audio.js',
    '--audio', outputVideo,
    '--output-dir', rawOutDir,
  ], cwd);

  const rawPath = path.join(rawOutDir, 'transcript.raw.json');

  console.log('\n[Hook QA] Force-aligning rendered hooks transcript...');
  await run('node', [
    'scripts/align/align-transcript.js',
    '--audio', outputVideo,
    '--raw', rawPath,
    '--python', cli.pythonBin,
    '--device', cli.device,
    '--language', cli.language,
  ], cwd);

  const observedRaw = await fs.readJson(rawPath);
  const observedTokens = flattenObservedTokens(observedRaw);

  const diff = compareTokens(expectedTokens, observedTokens, cli.driftThresholdMs);

  const segmentMeta = buildSegmentMetadata(hookSegments, clips);
  const segBreakdown = buildPerSegmentBreakdown(clips, diff, expectedTokens);
  const driftTrends = analyzeDriftTrends(diff, clips);
  const diagnostics = buildDiagnostics(segBreakdown, driftTrends, diff);

  const report = {
    meta: {
      createdAt: new Date().toISOString(),
      transcriptPath,
      outputVideo,
      rawAlignedPath: rawPath,
      reportPath,
      fps: FPS,
      hookDurationFrames,
      hookDurationSec: Number((hookDurationFrames / FPS).toFixed(3)),
      driftThresholdMs: cli.driftThresholdMs,
      hookSegmentCount: hookSegments.length,
      clips,
    },
    summary: {
      expectedSpokenTokens: expectedTokens.length,
      observedSpokenTokens: observedTokens.length,
      missingTokenCount: diff.missing.length,
      substitutionCount: diff.substitutions.length,
      timingMismatchCount: diff.timingMismatches.length,
      extraObservedTokenCount: diff.extras.length,
      pass: diff.missing.length === 0 && diff.timingMismatches.length === 0,
    },
    diagnostics,
    segmentMetadata: segmentMeta,
    perSegmentBreakdown: segBreakdown,
    driftTrends,
    missingTokens: diff.missing,
    substitutions: diff.substitutions,
    timingMismatches: diff.timingMismatches,
    extraObservedTokens: diff.extras,
    matchedSample: diff.matched.slice(0, 200),
  };

  await fs.writeJson(reportPath, report, { spaces: 2 });

  console.log('\n[Hook QA] Done.');
  console.log(`  Report: ${reportPath}`);
  console.log(`  Video:  ${outputVideo}`);
  console.log(`  Raw:    ${rawPath}`);
  console.log(`  Missing tokens: ${report.summary.missingTokenCount}`);
  console.log(`  Substitutions:  ${report.summary.substitutionCount}`);
  console.log(`  Timing mismatches: ${report.summary.timingMismatchCount}`);
  if (diagnostics.conclusions.length > 0) {
    console.log(`  Diagnostics:`);
    for (const c of diagnostics.conclusions) {
      console.log(`    [${c.severity.toUpperCase()}] ${c.pattern}: ${c.description}`);
      if (c.affectedSegments) console.log(`      Segments: ${c.affectedSegments.join(', ')}`);
    }
  }

  if (!cli.keepTemp) {
    await fs.remove(tempTranscriptPath).catch(() => {});
  }

  if (!report.summary.pass) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`❌ Hook QA failed: ${err.message}`);
  process.exit(1);
});
