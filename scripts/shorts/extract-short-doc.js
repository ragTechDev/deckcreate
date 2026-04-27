#!/usr/bin/env node
/**
 * Extract a short-form transcript doc from a longform transcript.
 *
 * Usage:
 *   node scripts/shorts/extract-short-doc.js \
 *     --transcript <path>   path to longform transcript.json
 *     --from <seconds>      clip start (float)
 *     --to <seconds>        clip end (float)
 *     --id <string>         short ID, e.g. "short-1"
 *     [--carry-graphics]    keep > GRAPHIC lines; default strips them
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '../..');

const GRAPHIC_TYPES = [
  'LowerThird', 'NameTitle', 'Callout', 'ChapterMarker', 'ChapterMarkerEnd',
  'ConceptExplainer', 'ImageWindow', 'GifWindow', 'AIOverlay', 'CodingOverlay',
  'EngineeringOverlay', 'LanguageOverlay', 'FrameworkOverlay', 'InfrastructureOverlay',
  'PracticeOverlay', 'RoleOverlay', 'EducationOverlay', 'AwardsOverlay', 'RagtechOverlay',
];
const GRAPHIC_RE = new RegExp(`^>\\s*(${GRAPHIC_TYPES.join('|')})\\b`, 'i');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--transcript') args.transcript = argv[++i];
    else if (argv[i] === '--from') args.from = parseFloat(argv[++i]);
    else if (argv[i] === '--to') args.to = parseFloat(argv[++i]);
    else if (argv[i] === '--id') args.id = argv[++i];
    else if (argv[i] === '--carry-graphics') args.carryGraphics = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.transcript || args.from == null || args.to == null || !args.id) {
    console.error('Usage: extract-short-doc.js --transcript <path> --from <s> --to <s> --id <id>');
    process.exit(1);
  }

  const transcriptPath = path.resolve(cwd, args.transcript);
  const docPath = transcriptPath.replace(/\.json$/, '.doc.txt');

  if (!await fs.pathExists(transcriptPath)) {
    console.error(`✗ transcript.json not found: ${transcriptPath}`);
    process.exit(1);
  }
  if (!await fs.pathExists(docPath)) {
    console.error(`✗ transcript.doc.txt not found: ${docPath}`);
    process.exit(1);
  }

  const transcript = await fs.readJson(transcriptPath);
  const segments = transcript.segments ?? [];

  const docText = await fs.readFile(docPath, 'utf8');
  const lines = docText.split('\n');

  // Map segment id → segment object for fast lookup
  const segById = new Map(segments.map(s => [String(s.id), s]));

  // Find line indices for the clip's start and end segments
  const SEGMENT_LINE_RE = /^\s*-?\[(\d+)\]/;
  let startLineIdx = -1;
  let endLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SEGMENT_LINE_RE);
    if (!m) continue;
    const seg = segById.get(m[1]);
    if (!seg) continue;

    if (startLineIdx === -1 && seg.start >= args.from) {
      startLineIdx = i;
    }
    if (seg.end <= args.to) {
      endLineIdx = i;
    }
  }

  if (startLineIdx === -1) {
    console.error(`✗ No segment found with start >= ${args.from}`);
    process.exit(1);
  }
  if (endLineIdx === -1) {
    console.error(`✗ No segment found with end <= ${args.to}`);
    process.exit(1);
  }

  // Insert > START before startLineIdx, > END after endLineIdx
  // Work on a mutable array; adjust endLineIdx after the START insertion
  const out = [...lines];
  out.splice(startLineIdx, 0, '> START');
  // endLineIdx shifts by 1 due to the START insertion; insert END after that
  out.splice(endLineIdx + 2, 0, '> END');

  // Filter unwanted cue lines
  const filtered = out.filter(line => {
    if (/^>\s*CAM\b/i.test(line)) return false;
    if (/^>\s*HOOK\b/i.test(line)) return false;
    if (!args.carryGraphics && GRAPHIC_RE.test(line)) return false;
    return true;
  });

  const outDir = path.join(cwd, 'public', 'shorts', args.id);
  await fs.ensureDir(outDir);
  const outPath = path.join(outDir, 'transcript.doc.txt');
  await fs.writeFile(outPath, filtered.join('\n'), 'utf8');

  console.log(`✓ Written: ${outPath}`);
}

main().catch(err => {
  console.error('✗', err.message);
  process.exit(1);
});
