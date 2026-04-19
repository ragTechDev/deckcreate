#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--raw' && args[i + 1]) result.rawPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.outputPath = args[++i];
  }
  return result;
}


function buildGuestInstructions() {
  return [
    '═══════════════════════════════════════════════════════════════════',
    '  PODCAST TRANSCRIPT REVIEW — Guest Copy',
    '═══════════════════════════════════════════════════════════════════',
    '',
    'Hi! Below is the transcript of our conversation. Please review and',
    'mark anything you\'d prefer to remove.',
    '',
    'HOW TO MARK CUTS:',
    '  • Word/phrase: Wrap in {curly braces} — like {um} or {you know}',
    '  • Entire line: Add "CUT" at the start — like "CUT [3] I said something..."',
    '  • Note: Don\'t change the [numbers] — they\'re timestamps',
    '',
    '───────────────────────────────────────────────────────────────────',
    '',
  ].join('\n');
}

function buildGuestFooter() {
  return [
    '',
    '───────────────────────────────────────────────────────────────────',
    '',
    'QUICK REFERENCE: Common things guests cut',
    '  • Filler words: um, uh, like, you know, I mean, sort of',
    '  • False starts: "Sorry, let me rephrase..."',
    '  • Tangents that went too far',
    '  • Personal details they forgot were mentioned',
    '',
    '═══════════════════════════════════════════════════════════════════',
    '',
    'SAVE YOUR EDITS:',
    '  1. Save this file after marking your cuts',
    '  2. Send it back to the host',
    '  3. Host will run: npm run merge-guest-review',
    '',
  ].join('\n');
}

function buildGuestReview(transcript) {
  const instructions = buildGuestInstructions();
  const lines = [];
  let lastSpeaker = null;

  for (const seg of transcript.segments) {
    if (seg.cut) continue; // Skip already-cut segments

    const speaker = seg.speaker || 'SPEAKER';
    const text = seg.text?.trim() || '';
    if (!text) continue;

    // Group consecutive segments from same speaker into paragraphs
    if (speaker !== lastSpeaker) {
      if (lastSpeaker !== null) lines.push('');
      lines.push(`${speaker}:`);
      lines.push('');
      lastSpeaker = speaker;
    }

    lines.push(text);
  }

  const footer = buildGuestFooter();
  return instructions + lines.join('\n') + footer;
}

async function main() {
  const cwd = process.cwd();
  const cli = parseArgs();

  const editPath = cli.editPath || cli.rawPath || path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.json');
  const outputPath = cli.outputPath || path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.guest.txt');

  if (!await fs.pathExists(editPath)) {
    console.error(`❌ Edited transcript not found: ${editPath}`);
    console.error('   Run "npm run edit-transcript" first.');
    process.exit(1);
  }

  const transcript = await fs.readJson(editPath);

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, buildGuestReview(transcript), 'utf8');

  console.log(`✓ Guest review transcript: ${outputPath}`);
  console.log('  Share this file with your guest for review.');
}

const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('/guest-review.js') || _argv1.endsWith('/guest-review')) {
  main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
}

export default main;
