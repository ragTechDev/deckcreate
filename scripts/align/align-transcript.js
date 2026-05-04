#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ALIGN_SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run_whisperx_align.py');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--audio' && args[i + 1]) result.audioPath = args[++i];
    else if (args[i] === '--raw' && args[i + 1]) result.rawPath = args[++i];
    else if (args[i] === '--python' && args[i + 1]) result.pythonBin = args[++i];
    else if (args[i] === '--device' && args[i + 1]) result.device = args[++i];
    else if (args[i] === '--language' && args[i + 1]) result.language = args[++i];
  }
  return result;
}

function stripPunctuation(text) {
  return text.trim().replace(/^[^\w']+|[^\w']+$/g, '');
}

function normalize(text) {
  return stripPunctuation(text).toLowerCase();
}

function isSpecialToken(token) {
  return /_[A-Z]+_/.test((token?.text || '').trim());
}

async function autoDetectFile(dir, extensions) {
  if (!await fs.pathExists(dir)) return null;
  const files = await fs.readdir(dir);
  const match = files.find((f) => extensions.includes(path.extname(f).toLowerCase()));
  return match ? path.join(dir, match) : null;
}

function spawnPython(pythonBin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Alignment python script failed with exit code ${code}`));
    });

    proc.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`Python not found ("${pythonBin}"). Install Python 3.9-3.12 or pass --python <path>.`));
      } else {
        reject(new Error(`Failed to run python alignment script: ${error.message}`));
      }
    });
  });
}

function remapTimeToNewSegment(time, oldStart, oldEnd, newStart, newEnd) {
  const oldDuration = Math.max(0.001, oldEnd - oldStart);
  const newDuration = Math.max(0.001, newEnd - newStart);
  const ratio = (time - oldStart) / oldDuration;
  const mapped = newStart + ratio * newDuration;
  return Math.max(newStart, Math.min(newEnd, mapped));
}

function assignTokenTimes(tokens, alignedWords, oldStart, oldEnd, newStart, newEnd) {
  const words = alignedWords.map((w) => ({
    ...w,
    normalized: normalize(w.word || ''),
  }));

  const nextTokens = tokens.map((token, idx) => ({
    ...token,
    __idx: idx,
    __normalized: normalize(token.text || ''),
  }));

  let searchStart = 0;
  let matched = 0;
  let wordLikeCount = 0;

  for (const token of nextTokens) {
    if (isSpecialToken(token) || !token.__normalized) continue;
    wordLikeCount++;

    let matchIndex = -1;
    for (let wi = searchStart; wi < words.length; wi++) {
      if (words[wi].normalized && words[wi].normalized === token.__normalized) {
        matchIndex = wi;
        break;
      }
    }

    if (matchIndex >= 0) {
      token.__alignedTime = words[matchIndex].start;
      token.__alignedEnd  = words[matchIndex].end;   // exact word-end boundary from WhisperX
      matched++;
      searchStart = matchIndex + 1;
    }
  }

  const coverage = wordLikeCount > 0 ? matched / wordLikeCount : 0;

  for (const token of nextTokens) {
    if (token.__alignedTime !== undefined) continue;

    const fallback = remapTimeToNewSegment(
      typeof token.t_dtw === 'number' ? token.t_dtw : oldStart,
      oldStart,
      oldEnd,
      newStart,
      newEnd,
    );

    if (coverage < 0.35) {
      token.__alignedTime = fallback;
      continue;
    }

    if (token.__normalized) {
      token.__alignedTime = fallback;
      continue;
    }

    const prevTimed = [...nextTokens].reverse().find((t) => t.__idx < token.__idx && t.__alignedTime !== undefined);
    const nextTimed = nextTokens.find((t) => t.__idx > token.__idx && t.__alignedTime !== undefined);

    if (prevTimed && nextTimed) {
      token.__alignedTime = (prevTimed.__alignedTime + nextTimed.__alignedTime) / 2;
    } else if (prevTimed) {
      token.__alignedTime = prevTimed.__alignedTime;
    } else if (nextTimed) {
      token.__alignedTime = nextTimed.__alignedTime;
    } else {
      token.__alignedTime = fallback;
    }
  }

  nextTokens.sort((a, b) => a.__idx - b.__idx);

  let last = newStart;
  return nextTokens.map((token) => {
    const raw = Math.max(newStart, Math.min(newEnd, token.__alignedTime));
    const t = Math.max(last, raw);
    last = t;
    const clean = { ...token };
    delete clean.__idx;
    delete clean.__normalized;
    delete clean.__alignedTime;
    const alignedEnd = clean.__alignedEnd;
    delete clean.__alignedEnd;
    const result = { ...clean, t_dtw: Number(t.toFixed(3)) };
    if (alignedEnd !== undefined) {
      // Clamp to [t_dtw, newEnd] so t_end is always a valid, monotonically sound boundary.
      result.t_end = Number(Math.min(newEnd, Math.max(t, alignedEnd)).toFixed(3));
    }
    return result;
  });
}

function applyAlignment(rawTranscript, alignedPayload) {
  const alignedByRawIndex = new Map(
    (alignedPayload?.segments || []).map((seg) => [seg.raw_index, seg])
  );

  let appliedSegments = 0;
  const updatedSegments = (rawTranscript.segments || []).map((seg, idx) => {
    const aligned = alignedByRawIndex.get(idx);
    if (!aligned) return seg;

    const oldStart = typeof seg.start === 'number' ? seg.start : aligned.start;
    const oldEnd = typeof seg.end === 'number' ? seg.end : aligned.end;
    const newStart = Math.max(0, Number(aligned.start));
    const newEnd = Math.max(newStart + 0.001, Number(aligned.end));

    const nextTokens = assignTokenTimes(
      Array.isArray(seg.tokens) ? seg.tokens : [],
      Array.isArray(aligned.words) ? aligned.words : [],
      oldStart,
      oldEnd,
      newStart,
      newEnd,
    );

    appliedSegments++;
    return {
      ...seg,
      start: Number(newStart.toFixed(3)),
      end: Number(newEnd.toFixed(3)),
      tokens: nextTokens,
    };
  });

  return {
    updated: {
      ...rawTranscript,
      meta: {
        ...(rawTranscript.meta || {}),
        alignment: {
          ...(rawTranscript.meta?.alignment || {}),
          provider: alignedPayload?.meta?.tool || 'whisperx',
          language: alignedPayload?.meta?.language || 'en',
          device: alignedPayload?.meta?.device || 'cpu',
          alignedAt: new Date().toISOString(),
        },
      },
      segments: updatedSegments,
    },
    appliedSegments,
  };
}

async function resolveArgs(cwd) {
  const cli = parseArgs();
  const audioPath = cli.audioPath
    || await autoDetectFile(path.join(cwd, 'public', 'transcribe', 'input'), ['.mp3', '.aac', '.wav', '.m4a']);

  const rawPath = cli.rawPath || path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'transcript.raw.json');

  if (!audioPath) {
    console.error('❌ No audio file found. Use --audio <path> or place a file in public/transcribe/input/.');
    process.exit(1);
  }

  if (!await fs.pathExists(rawPath)) {
    console.error(`❌ Raw transcript not found: ${rawPath}`);
    console.error('   Run "npm run transcribe" first.');
    process.exit(1);
  }

  return {
    audioPath,
    rawPath,
    pythonBin: cli.pythonBin || 'python3',
    language: cli.language || 'en',
    device: cli.device || 'cpu',
  };
}

async function main() {
  const cwd = process.cwd();
  const { audioPath, rawPath, pythonBin, language, device } = await resolveArgs(cwd);

  const tempOutputPath = path.join(os.tmpdir(), `deckcreate-alignment-${Date.now()}.json`);

  console.log('\nForced Alignment');
  console.log(`  Audio:      ${audioPath}`);
  console.log(`  Transcript: ${rawPath}`);
  console.log(`  Device:     ${device}`);
  console.log(`  Language:   ${language}`);
  console.log('');

  try {
    await spawnPython(pythonBin, [
      ALIGN_SCRIPT_PATH,
      '--audio', audioPath,
      '--raw', rawPath,
      '--out', tempOutputPath,
      '--device', device,
      '--language', language,
    ]);

    const raw = await fs.readJson(rawPath);
    const aligned = await fs.readJson(tempOutputPath);

    const { updated, appliedSegments } = applyAlignment(raw, aligned);

    await fs.writeJson(rawPath, updated, { spaces: 2 });

    console.log(`\n  ✓ Alignment applied to ${appliedSegments} segment(s).`);
    console.log(`  ✓ Updated transcript: ${rawPath}`);
    console.log('\nNext steps:');
    console.log('  - Run "npm run speakers:assign" (if multi-speaker)');
    console.log('  - Run "npm run transcript:init" to regenerate transcript.doc.txt');
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    console.error('\nHint: install Python deps for WhisperX in your active Python env:');
    console.error('  pip install whisperx faster-whisper');
    process.exit(1);
  } finally {
    await fs.remove(tempOutputPath).catch(() => {});
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/')) {
  main();
}

export default main;
