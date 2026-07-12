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
import { mergeDocIntoTranscript, autoCutPauses, deriveCuts, isSpecialToken, WORD_DURATION_ESTIMATE } from '../edit-transcript.js';

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

/**
 * Rewrite doc lines, inserting resolved hookFrom-hookTo on each > HOOK line so the
 * user can see and fine-tune the timing without having to inspect transcript.json.
 * Matches longform behaviour in edit-transcript.js buildDoc().
 */
function rewriteDocWithHookTimings(docLines, segments) {
  const byId = Object.fromEntries(segments.map(s => [s.id, s]));
  let pendingSegId = null;
  let insideClipRange = false;

  return docLines.map(line => {
    const trimmed = line.trim();

    if (/^>\s*START\b/i.test(trimmed)) { insideClipRange = true; return line; }
    if (/^>\s*END\b/i.test(trimmed))   { insideClipRange = false; return line; }

    const segMatch = trimmed.match(/^\[(\d+)\]/);
    if (segMatch) { pendingSegId = parseInt(segMatch[1], 10); return line; }

    if (/^>\s*HOOK\b/i.test(trimmed) && pendingSegId !== null && insideClipRange) {
      const seg = byId[pendingSegId];
      if (seg && seg.hook && seg.hookFrom !== undefined && seg.hookTo !== undefined) {
        const titleMatch     = trimmed.match(/title="([^"]+)"/i);
        const placementMatch = trimmed.match(/placement="(upper|middle)"/i);
        const indent = line.match(/^(\s*)/)[1];

        let newLine = `${indent}> HOOK`;
        if (seg.hookPhrase) newLine += ` "${seg.hookPhrase}"`;
        newLine += ` ${seg.hookFrom.toFixed(3)}-${seg.hookTo.toFixed(3)}`;
        if (titleMatch)     newLine += ` title="${titleMatch[1]}"`;
        if (placementMatch) newLine += ` placement="${placementMatch[1]}"`;
        return newLine;
      }
    }

    return line;
  });
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

  // Re-derive cuts[] time ranges from token cut flags (same as main merge flow)
  transcript = {
    ...transcript,
    segments: transcript.segments.map(seg => ({ ...seg, cuts: deriveCuts(seg) })),
  };

  // Clear all existing hook markers - shorts define their own hooks fresh
  transcript = {
    ...transcript,
    segments: transcript.segments.map(s => ({ ...s, hook: false, hookPhrase: undefined, hookFrom: undefined, hookTo: undefined, hookTitle: undefined })),
    meta: { ...transcript.meta, hookTitle: undefined, hookTitlePlacement: undefined },
  };

  // Process > HOOK markers in the doc - mark corresponding segments as hooks
  // Only processes hooks between > START and > END cues
  // Syntax: > HOOK                                                              (entire segment)
  //         > HOOK "phrase"                                                     (specific phrase)
  //         > HOOK "phrase" 12.450-15.300                                       (explicit timing override)
  //         > HOOK "phrase" title="My Title"                                    (with title)
  //         > HOOK "phrase" 12.450-15.300 title="My Title" placement="upper"   (all options)
  // After merge, resolved times are written back to the doc so they can be fine-tuned.
  const docLines = docContent.split('\n');
  let pendingHookSegId = null;
  let firstHookTitle = null;
  let firstHookTitlePlacement = null;
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

    // Match: > HOOK, optionally "phrase", optionally explicit from-to timing,
    // optionally title="...", optionally placement="upper|middle"
    // Only process if inside START/END range
    const hookMatch = trimmed.match(/^>\s*HOOK\b(?:\s+"([^"]+)")?(?:\s+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?))?(?:\s+title="([^"]+)")?(?:\s+placement="(upper|middle)")?/i);
    if (hookMatch && pendingHookSegId !== null && insideClipRange) {
      const phrase        = hookMatch[1];               // undefined if no phrase quoted
      const explicitFrom  = hookMatch[2] !== undefined ? parseFloat(hookMatch[2]) : undefined;
      const explicitTo    = hookMatch[3] !== undefined ? parseFloat(hookMatch[3]) : undefined;
      const title         = hookMatch[4];               // undefined if no title specified
      const placement     = hookMatch[5];               // undefined if no placement specified

      // Store first hook title (and placement) for video title display
      if (title && !firstHookTitle) {
        firstHookTitle = title;
        firstHookTitlePlacement = placement || null;
      }

      transcript.segments = transcript.segments.map(s => {
        if (s.id !== pendingHookSegId) return s;

        // Priority 1: explicit timing overrides token resolution
        if (explicitFrom !== undefined && explicitTo !== undefined) {
          console.log(`  Marked segment [${s.id}] as hook with explicit timing (${explicitFrom.toFixed(2)}s - ${explicitTo.toFixed(2)}s)`);
          return {
            ...s,
            hook: true,
            hookPhrase: phrase || null,
            hookFrom: explicitFrom,
            hookTo: explicitTo,
            hookTitle: title,
          };
        }

        if (phrase) {
          // Priority 2: phrase matching — join tokens and search (handles multi-token words like "medi"+"ocr"+"ity")
          const tokenTexts = s.tokens.map(t => t.text);
          const searchPhrase = phrase.toLowerCase().trim();

          // Build search text by joining all tokens
          const fullText = tokenTexts.join('').toLowerCase();

          // Find phrase position
          const phraseIndex = fullText.indexOf(searchPhrase);

          if (phraseIndex !== -1) {
            // Map character position back to token indices
            let charPos = 0;
            let matchStart = -1;
            let matchEnd = -1;

            for (let i = 0; i < tokenTexts.length; i++) {
              const tokenLen = tokenTexts[i].length;
              const tokenStart = charPos;
              const tokenEnd = charPos + tokenLen;

              if (matchStart === -1 && tokenEnd > phraseIndex) matchStart = i;
              if (matchStart !== -1 && tokenStart < phraseIndex + searchPhrase.length) matchEnd = i;

              charPos = tokenEnd;
            }

            if (matchStart !== -1 && matchEnd !== -1) {
              const hookFrom = s.tokens[matchStart].t_dtw;
              const lastToken = s.tokens[matchEnd];
              const hookTo = lastToken.t_end || lastToken.t_dtw + WORD_DURATION_ESTIMATE;

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
          }

          console.log(`  Warning: phrase "${phrase}" not found in segment [${s.id}] — hooking full segment`);
        }

        // Priority 3: no phrase / phrase not found — derive bounds from segment token edges
        // so the timing is written back to the doc and can be fine-tuned.
        const realTokens = s.tokens.filter(t => !isSpecialToken(t));
        const firstTok = realTokens[0];
        const lastTok  = realTokens[realTokens.length - 1];
        const hookFrom = firstTok ? firstTok.t_dtw : s.start;
        const hookTo   = lastTok
          ? (lastTok.t_end ?? (lastTok.t_dtw + WORD_DURATION_ESTIMATE))
          : s.end;

        console.log(`  Marked segment [${s.id}] as hook (full segment, ${hookFrom.toFixed(2)}s - ${hookTo.toFixed(2)}s)`);
        return {
          ...s,
          hook: true,
          hookPhrase: phrase || null,
          hookTitle: title,
          hookFrom,
          hookTo,
        };
      });
    }
  }

  // Store first hook title (and placement) in transcript meta for easy access
  if (firstHookTitle) {
    transcript.meta.hookTitle = firstHookTitle;
    console.log(`  First hook title: "${firstHookTitle}"`);
    if (firstHookTitlePlacement) {
      transcript.meta.hookTitlePlacement = firstHookTitlePlacement;
      console.log(`  Hook title placement: "${firstHookTitlePlacement}"`);
    }
  }

  // Write resolved hook timings back to the doc so they can be fine-tuned without
  // inspecting transcript.json — mirrors longform behaviour in edit-transcript.js buildDoc().
  const rewrittenLines = rewriteDocWithHookTimings(docLines, transcript.segments);
  await fs.writeFile(docPath, rewrittenLines.join('\n'), 'utf8');
  console.log(`✓ Wrote hook timings back to doc: ${docPath}`);

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
