#!/usr/bin/env node
/**
 * Merge an edited short-form transcript doc into transcript.json.
 *
 * Usage:
 *   node scripts/shorts/merge-short-doc.js \
 *     --doc <path>                path to public/shorts/{id}/transcript.doc.txt
 *     --parent-transcript <path>  path to longform transcript.json (Path A)
 *                                 omit for Path B (dedicated recording)
 *     --id <string>               short ID
 *     [--cut-pauses]              auto-cut silences >= 0.5 s
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { mergeDocIntoTranscript, autoCutPauses } from '../edit-transcript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, '../..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--doc') args.doc = argv[++i];
    else if (argv[i] === '--parent-transcript') args.parentTranscript = argv[++i];
    else if (argv[i] === '--id') args.id = argv[++i];
    else if (argv[i] === '--cut-pauses') args.cutPauses = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.doc || !args.id) {
    console.error('Usage: merge-short-doc.js --doc <path> --id <id> [--parent-transcript <path>] [--cut-pauses]');
    process.exit(1);
  }

  const docPath = path.resolve(cwd, args.doc);
  if (!await fs.pathExists(docPath)) {
    console.error(`✗ doc not found: ${docPath}`);
    process.exit(1);
  }

  // Determine base transcript path
  let transcriptPath;
  if (args.parentTranscript) {
    transcriptPath = path.resolve(cwd, args.parentTranscript);
  } else {
    // Path B: dedicated recording transcript
    transcriptPath = path.join(cwd, 'public', 'shorts', 'transcribe', 'output', 'edit', 'transcript.json');
  }

  if (!await fs.pathExists(transcriptPath)) {
    console.error(`✗ base transcript not found: ${transcriptPath}`);
    process.exit(1);
  }

  const baseTranscript = await fs.readJson(transcriptPath);
  const docContent = await fs.readFile(docPath, 'utf8');

  // mergeDocIntoTranscript handles > START / > END and sets meta.videoStart / videoEnd
  let transcript = mergeDocIntoTranscript(baseTranscript, docContent);

  if (args.cutPauses) {
    transcript = autoCutPauses(transcript, 0.5);
  }

  // Inject short-form meta
  transcript = {
    ...transcript,
    meta: {
      ...transcript.meta,
      outputAspect: '9:16',
      ...(args.parentTranscript ? { parentTranscript: args.parentTranscript } : {}),
    },
  };

  const outDir = path.join(cwd, 'public', 'shorts', args.id);
  await fs.ensureDir(outDir);
  const outPath = path.join(outDir, 'transcript.json');
  await fs.writeJson(outPath, transcript, { spaces: 2 });

  console.log(`✓ Written: ${outPath}`);
  console.log(`  outputAspect: ${transcript.meta.outputAspect}`);
  console.log(`  videoStart:   ${transcript.meta.videoStart}`);
  console.log(`  videoEnd:     ${transcript.meta.videoEnd}`);
}

main().catch(err => {
  console.error('✗', err.message);
  process.exit(1);
});
