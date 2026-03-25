#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';

// "HH:MM:SS.mmm" → "HH:MM:SS,mmm"  (SRT uses comma)
function vttTsToSrtTs(ts) {
  return ts.replace('.', ',');
}

export function convertVttToSrt(vttContent) {
  const lines = vttContent.split('\n');
  const cues = [];
  let i = 0;

  // Skip WEBVTT header and any header metadata block
  while (i < lines.length && !lines[i].trim().match(/^\d{2}:\d{2}:\d{2}/)) i++;

  while (i < lines.length) {
    const timingMatch = lines[i].trim().match(
      /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})/
    );
    if (timingMatch) {
      const start = vttTsToSrtTs(timingMatch[1].replace(',', '.'));
      const end = vttTsToSrtTs(timingMatch[2].replace(',', '.'));
      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        // Strip VTT-only tags (<c>, <b>, positioning cues, etc.)
        textLines.push(lines[i].trim().replace(/<[^>]+>/g, ''));
        i++;
      }
      if (textLines.length) cues.push({ start, end, text: textLines.join('\n') });
    } else {
      i++;
    }
  }

  return cues
    .map((cue, idx) => `${idx + 1}\n${cue.start} --> ${cue.end}\n${cue.text}`)
    .join('\n\n') + '\n';
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const outputPath = args[1];

  if (!inputPath) {
    console.error('Usage: vtt-to-srt <input.vtt> [output.srt]');
    process.exit(1);
  }

  if (!await fs.pathExists(inputPath)) {
    console.error(`❌ File not found: ${inputPath}`);
    process.exit(1);
  }

  const vttContent = await fs.readFile(inputPath, 'utf8');
  const srtContent = convertVttToSrt(vttContent);

  const outPath = outputPath || inputPath.replace(/\.vtt$/i, '.srt');
  await fs.writeFile(outPath, srtContent, 'utf8');
  console.log(`✓ ${outPath}`);
}

const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('/vtt-to-srt.js') || _argv1.endsWith('/vtt-to-srt')) {
  main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
}
