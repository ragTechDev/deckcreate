#!/usr/bin/env node
/**
 * DeckCreate — Merge a hand-edited lines.doc.txt back into lines.json.
 *
 * Usage:
 *   node scripts/line-captions/merge-line-captions.js --id <slug>
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '../..');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) result.id = args[++i];
  }
  return result;
}

/** Parses `=== NAME ===` headers and `[id]  text` lines out of a lines.doc.txt. */
function parseLineDoc(docContent) {
  const parsed = [];
  let currentSpeaker = null;

  for (const rawLine of docContent.split('\n')) {
    const headerMatch = rawLine.match(/^===\s*(.+?)\s*===$/);
    if (headerMatch) {
      currentSpeaker = headerMatch[1];
      continue;
    }
    const lineMatch = rawLine.match(/^\[(\d+)\]\s*(.*)$/);
    if (lineMatch) {
      parsed.push({ id: parseInt(lineMatch[1], 10), speaker: currentSpeaker, text: lineMatch[2].trim() });
    }
  }

  return parsed;
}

/**
 * Overwrites text on the matching lines.json entry per id. startMs/endMs/speaker
 * are left untouched — timing is best-effort and doesn't track rewording.
 */
function mergeLineText(linesDoc, parsedLines) {
  const byId = new Map(linesDoc.lines.map(l => [l.id, l]));
  const seenIds = new Set();

  for (const parsed of parsedLines) {
    const line = byId.get(parsed.id);
    if (!line) {
      console.warn(`  ⚠ Doc line [${parsed.id}] has no matching entry in lines.json — skipped`);
      continue;
    }
    line.text = parsed.text;
    seenIds.add(parsed.id);
  }

  for (const line of linesDoc.lines) {
    if (!seenIds.has(line.id)) {
      console.warn(`  ⚠ lines.json entry [${line.id}] was not found in the doc — its text is unchanged`);
    }
  }

  return linesDoc;
}

async function main() {
  const { id } = parseArgs();
  if (!id) {
    console.error('Usage: merge-line-captions.js --id <slug>');
    process.exit(1);
  }

  const clipDir = path.join(cwd, 'public', 'line-captions', id);
  const docPath = path.join(clipDir, 'lines.doc.txt');
  const linesJsonPath = path.join(clipDir, 'lines.json');

  const [docContent, linesDoc] = await Promise.all([
    fs.readFile(docPath, 'utf-8'),
    fs.readJson(linesJsonPath),
  ]);

  console.log('\nLine captions — merge');
  console.log(`  Doc:   ${path.relative(cwd, docPath)}`);
  console.log(`  Lines: ${path.relative(cwd, linesJsonPath)}`);
  console.log('');

  const parsedLines = parseLineDoc(docContent);
  const merged = mergeLineText(linesDoc, parsedLines);

  await fs.writeJson(linesJsonPath, merged, { spaces: 2 });

  console.log(`\n✓ Merged ${parsedLines.length} lines`);
  console.log(`\nNext step: npm run captions:render -- --id ${id}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

export { parseLineDoc, mergeLineText };
