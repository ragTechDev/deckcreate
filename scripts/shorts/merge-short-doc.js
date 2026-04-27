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

  // Clear all existing hook markers - shorts define their own hooks fresh
  transcript = {
    ...transcript,
    segments: transcript.segments.map(s => ({ ...s, hook: false, hookPhrase: undefined, hookFrom: undefined, hookTo: undefined, hookTitle: undefined })),
  };

  // Process > HOOK markers in the doc - mark corresponding segments as hooks
  // Only processes hooks between > START and > END cues
  // Syntax: > HOOK                           (entire segment)
  //         > HOOK "phrase"                  (specific phrase within segment)
  //         > HOOK "phrase" title="My Title" (with title for first hook)
  const docLines = docContent.split('\n');
  let pendingHookSegId = null;
  let firstHookTitle = null;
  let insideClipRange = false;

  for (const line of docLines) {
    const trimmed = line.trim();

    // Track START/END boundaries
    if (/^>\s*START\b/i.test(trimmed)) {
      insideClipRange = true;
      continue;
    }
    if (/^>\s*END\b/i.test(trimmed)) {
      insideClipRange = false;
      continue;
    }

    // Check for segment line
    const segMatch = trimmed.match(/^\[(\d+)\]/);
    if (segMatch) {
      pendingHookSegId = parseInt(segMatch[1], 10);
    }

    // Match: > HOOK, optionally "phrase", optionally title="..."
    // Only process if inside START/END range
    const hookMatch = trimmed.match(/^>\s*HOOK\b(?:\s+"([^"]+)")?(?:\s+title="([^"]+)")?/i);
    if (hookMatch && pendingHookSegId !== null && insideClipRange) {
      const phrase = hookMatch[1]; // undefined if no phrase quoted
      const title = hookMatch[2];    // undefined if no title specified

      // Store first hook title for video title display
      if (title && !firstHookTitle) {
        firstHookTitle = title;
      }

      transcript.segments = transcript.segments.map(s => {
        if (s.id !== pendingHookSegId) return s;

        if (phrase) {
          // Phrase matching - join tokens and search (handles multi-token words like "medi"+"ocr"+"ity")
          const tokenTexts = s.tokens.map(t => t.text);
          const searchPhrase = phrase.toLowerCase().trim();

          // Build search text by joining all tokens
          const fullText = tokenTexts.join('').toLowerCase();

          // Find phrase position
          const phraseIndex = fullText.indexOf(searchPhrase);

          if (phraseIndex === -1) {
            console.log(`  Warning: phrase "${phrase}" not found in segment [${s.id}]`);
            return { ...s, hook: true, hookTitle: title };
          }

          // Map character position back to token indices
          // Use ACTUAL token text lengths (not trimmed) to match phraseIndex
          let charPos = 0;
          let matchStart = -1;
          let matchEnd = -1;

          for (let i = 0; i < tokenTexts.length; i++) {
            const tokenLen = tokenTexts[i].length;
            const tokenStart = charPos;
            const tokenEnd = charPos + tokenLen;

            // Find first token that contains phrase start
            if (matchStart === -1 && tokenEnd > phraseIndex) {
              matchStart = i;
            }

            // Find last token that contains phrase end
            if (matchStart !== -1 && tokenStart < phraseIndex + searchPhrase.length) {
              matchEnd = i;
            }

            charPos = tokenEnd;
          }

          if (matchStart === -1 || matchEnd === -1) {
            console.log(`  Warning: phrase "${phrase}" not found in segment [${s.id}]`);
            return { ...s, hook: true, hookTitle: title };
          }

          // Calculate timings from matched tokens
          const hookFrom = s.tokens[matchStart].t_dtw;
          const lastToken = s.tokens[matchEnd];
          const hookTo = lastToken.t_end || lastToken.t_dtw + 0.4;

          console.log(`  Marked segment [${s.id}] as hook with phrase "${phrase}" (${hookFrom.toFixed(2)}s - ${hookTo.toFixed(2)}s)`);
          return {
            ...s,
            hook: true,
            hookPhrase: phrase,
            hookFrom,
            hookTo,
            hookTitle: title,
          };
        }

        // No phrase specified - use entire segment
        console.log(`  Marked segment [${s.id}] as hook (full segment)`);
        return { ...s, hook: true, hookTitle: title };
      });
    }
  }

  // Store first hook title in transcript meta for easy access
  if (firstHookTitle) {
    transcript.meta.hookTitle = firstHookTitle;
    console.log(`  First hook title: "${firstHookTitle}"`);
  }

  if (args.cutPauses) {
    transcript = autoCutPauses(transcript, 0.5);
  }

  // Compute output filename: <original-filename-without-extension>_<short-id>.mp4
  const videoSrc = transcript.meta.videoSrc || baseTranscript.meta.videoSrc || '';
  const originalFilename = path.basename(videoSrc, path.extname(videoSrc)) || 'output';
  const outName = `${originalFilename}_${args.id}.mp4`;

  // Inject short-form meta
  transcript = {
    ...transcript,
    meta: {
      ...transcript.meta,
      outputAspect: '9:16',
      outName,
      ...(args.parentTranscript ? { parentTranscript: args.parentTranscript } : {}),
    },
  };

  const outDir = path.join(cwd, 'public', 'shorts', args.id);
  await fs.ensureDir(outDir);
  const outPath = path.join(outDir, 'transcript.json');
  await fs.writeJson(outPath, transcript, { spaces: 2 });

  console.log(`✓ Written: ${outPath}`);
  console.log(`  outputAspect: ${transcript.meta.outputAspect}`);
  console.log(`  outName:      ${transcript.meta.outName}`);
  console.log(`  videoStart:   ${transcript.meta.videoStart}`);
  console.log(`  videoEnd:     ${transcript.meta.videoEnd}`);
}

main().catch(err => {
  console.error('✗', err.message);
  process.exit(1);
});
