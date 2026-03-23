#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { convertVttToSrt } from './shared/vtt-to-srt.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--raw' && args[i + 1]) result.rawPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.outputPath = args[++i];
    else if (args[i] === '--merge-vtt' && args[i + 1]) result.vttPath = args[++i];
    else if (args[i] === '--merge-doc' && args[i + 1]) result.docPath = args[++i];
    else if (args[i] === '--auto-cut-pauses' && args[i + 1]) result.autoCutPauses = parseFloat(args[++i]);
  }
  return result;
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

// Strip leading/trailing punctuation, keep apostrophes for contractions
function stripPunctuation(text) {
  return text.trim().replace(/^[^\w']+|[^\w']+$/g, '');
}

function normalize(text) {
  return stripPunctuation(text).toLowerCase();
}

// Whisper BPE tokens carry their word boundary as a leading space:
// " j" starts a new word, "inx" continues the previous one → "jinx".
function joinTokenTexts(tokens) {
  let result = '';
  for (const t of tokens) {
    const stripped = stripPunctuation(t.text);
    if (!stripped) continue;
    result = (!result || t.text.startsWith(' '))
      ? (result ? `${result} ${stripped}` : stripped)
      : result + stripped;
  }
  return result;
}

// Whisper BPE emits contraction suffixes as space-prefixed tokens (" 'm", " 's").
// Re-attach them to the preceding word after joining.
function fixContractions(text) {
  return text.replace(/ '(m|s|t|re|ve|ll|d)\b/gi, "'$1");
}

// ─── Cut derivation ───────────────────────────────────────────────────────────

function deriveCuts(segment) {
  const cuts = [];
  let cutFrom = null;
  let cutReason = null;

  for (let i = 0; i <= segment.tokens.length; i++) {
    const token = segment.tokens[i];
    const isCut = token?.cut ?? false;

    if (!cutFrom && isCut) {
      cutFrom = token.t_dtw;
      cutReason = token.cutReason || 'filler';
    } else if (cutFrom && !isCut) {
      const cutTo = token ? token.t_dtw : segment.end;
      cuts.push({ from: cutFrom, to: cutTo, reason: cutReason });
      cutFrom = null;
      cutReason = null;
    }
  }

  return cuts;
}

// ─── Sentence merging ─────────────────────────────────────────────────────────

const SENTENCE_END = /[.!?](\s|$)/;
const MAX_WORDS = 20;
const PAUSE_THRESHOLD = 0.8;

function mergeIntoSentences(segments) {
  const sentences = [];
  let bucket = null;
  let wordCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const next = segments[i + 1];

    if (!bucket) {
      bucket = { ...seg, tokens: [...seg.tokens] };
      wordCount = seg.tokens.length || seg.text.split(/\s+/).filter(Boolean).length;
    } else {
      bucket.end = seg.end;
      bucket.text = bucket.text.trimEnd() + ' ' + seg.text.trimStart();
      bucket.tokens = [...bucket.tokens, ...seg.tokens];
      wordCount += seg.tokens.length || seg.text.split(/\s+/).filter(Boolean).length;
    }

    const endsWithPunctuation = SENTENCE_END.test(seg.text.trim());
    const longPause = next && (next.start - seg.end) > PAUSE_THRESHOLD;
    const tooLong = wordCount >= MAX_WORDS;

    if (endsWithPunctuation || longPause || tooLong || !next) {
      sentences.push({ ...bucket, id: sentences.length + 1 });
      bucket = null;
      wordCount = 0;
    }
  }

  return sentences;
}

// ─── Doc export ───────────────────────────────────────────────────────────────

function buildTextWithCuts(seg) {
  const hasCuts = seg.tokens.some(t => t.cut);

  // No cut tokens — rebuild from token boundaries to fix subword splits (e.g. "j inx" → "jinx").
  // Fall back to seg.text when the user has made structural word-count edits.
  if (!hasCuts) {
    const tokenText = fixContractions(joinTokenTexts(seg.tokens));
    if (!seg.text || !tokenText) return tokenText || seg.text;
    const segWords = seg.text.split(/\s+/).filter(Boolean);
    const tokWords = tokenText.split(/\s+/).filter(Boolean);
    if (tokWords.length < segWords.length) return tokenText;         // tokens merge subwords
    if (segWords.length < tokWords.length) return seg.text;          // user deleted words
    const wordsMatch = segWords.every((w, i) => normalize(w) === normalize(tokWords[i]));
    return wordsMatch ? tokenText : seg.text;                        // user changed words → trust seg.text
  }

  // Build parts list from tokens (cut markers + non-cut token words)
  const parts = [];
  let i = 0;
  while (i < seg.tokens.length) {
    const token = seg.tokens[i];
    const word = stripPunctuation(token.text);
    if (!word) { i++; continue; }

    if (token.cut) {
      const reason = token.cutReason || 'filler';
      const cutTokens = [];
      while (
        i < seg.tokens.length &&
        seg.tokens[i].cut &&
        (seg.tokens[i].cutReason || 'filler') === reason
      ) {
        cutTokens.push(seg.tokens[i]);
        i++;
      }
      const span = joinTokenTexts(cutTokens);
      if (span) parts.push(reason === 'filler' ? `{${span}}` : `{${span}:${reason}}`);
    } else {
      parts.push(word);
      i++;
    }
  }

  // Try to substitute corrected seg.text words into the non-cut positions
  const segTextWords = (seg.text || '').split(/\s+/).filter(Boolean);
  const nonCutCount = parts.filter(p => !p.startsWith('{')).length;

  if (segTextWords.length === nonCutCount) {
    // Word counts match — substitute seg.text words (may include corrections)
    let wi = 0;
    return fixContractions(parts.map(p => p.startsWith('{') ? p : segTextWords[wi++]).join(' '));
  }

  // Word counts differ (user replaced multiple tokens with fewer/more words) —
  // output corrected seg.text as a block, append any cut markers
  const cutMarkers = parts.filter(p => p.startsWith('{'));
  return fixContractions([seg.text, ...cutMarkers].filter(Boolean).join(' ') || parts.join(' '));
}

function findNearestToken(atSeconds, tokens) {
  if (!tokens.length) return null;
  let best = tokens[0];
  let bestDelta = Math.abs(tokens[0].t_dtw - atSeconds);
  for (const token of tokens) {
    const delta = Math.abs(token.t_dtw - atSeconds);
    if (delta < bestDelta) { bestDelta = delta; best = token; }
  }
  return best;
}

function buildGraphicLine(graphic, tokens) {
  const nearest = findNearestToken(graphic.at, tokens);
  let atValue;

  if (nearest) {
    const word = stripPunctuation(nearest.text);
    const tokenIdx = tokens.indexOf(nearest);
    const normalizedWord = word.toLowerCase();
    const occurrencesBefore = tokens
      .slice(0, tokenIdx)
      .filter(t => normalize(t.text) === normalizedWord).length;
    atValue = occurrencesBefore > 0 ? `"${word}:${occurrencesBefore + 1}"` : `"${word}"`;
  } else {
    atValue = String(graphic.at);
  }

  const pairs = [`at=${atValue}`, `duration=${graphic.duration}`];
  for (const [k, v] of Object.entries(graphic.props)) {
    pairs.push(typeof v === 'string' ? `${k}="${v}"` : `${k}=${v}`);
  }
  return `> ${graphic.type}  ${pairs.join('  ')}`;
}

function buildInstructionsBlock() {
  return [
    '════════════════════════════════════════════════════════════════',
    '  TRANSCRIPT EDITOR  ─  Editing Guide',
    '════════════════════════════════════════════════════════════════',
    '',
    '  EDIT TEXT       Just retype any word. Changes are saved.',
    '',
    '  CUT WORD(S)     Wrap in curly braces:  {um}  {you know}',
    '                  With reason:  {um:filler}  {well:pause}',
    '                  Reasons: filler (default), pause, offtopic, duplicate',
    '',
    '  CUT SEGMENT     Add CUT after the segment number:',
    '                    [3] CUT  original text...',
    '                    [3] CUT:offtopic  original text...',
    '',
    '  RENAME SPEAKER  Edit the name after the colon in SPEAKERS below.',
    '',
    '  GRAPHICS        Add a line starting with > after the segment:',
    '                    > LowerThird  at="word"  duration=3  name="Name"  title="Role"',
    '                    > Callout  at="word"  duration=2  text="Quote"',
    '                    > ChapterMarker  at="word"  duration=1',
    '',
    '════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
}

function buildSpeakersSection(transcript) {
  const speakers = [...new Set(transcript.segments.map(s => s.speaker).filter(Boolean))].sort();
  if (!speakers.length) return '';
  return '# SPEAKERS\n' + speakers.map(s => `${s}: ${s}`).join('\n') + '\n\n---\n\n';
}

function buildDoc(transcript) {
  const instructions = buildInstructionsBlock();
  const speakersSection = buildSpeakersSection(transcript);

  const lines = [];
  let lastSpeaker = null;

  for (const seg of transcript.segments) {
    const speaker = seg.speaker || 'SPEAKER';

    if (speaker !== lastSpeaker) {
      if (lastSpeaker !== null) lines.push('');
      lines.push(`=== ${speaker} ===`);
      lines.push('');
      lastSpeaker = speaker;
    }

    let segLine = `[${seg.id}]`;
    if (seg.cut) segLine += ` CUT${seg.cutReason ? ':' + seg.cutReason : ''}`;
    const text = buildTextWithCuts(seg);
    if (text) segLine += `  ${text}`;
    lines.push(segLine);

    for (const g of (seg.graphics || [])) {
      lines.push('    ' + buildGraphicLine(g, seg.tokens));
    }
  }

  return instructions + speakersSection + lines.join('\n') + '\n';
}

// ─── Doc merge ────────────────────────────────────────────────────────────────

function parseKv(str) {
  const result = {};
  const re = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    result[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return result;
}

function parseGraphicLine(line, tokens) {
  const spaceIdx = line.search(/\s/);
  const type = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const kvStr = spaceIdx === -1 ? '' : line.slice(spaceIdx);
  const kv = parseKv(kvStr);

  // Resolve at="word" or at="word:2" to absolute seconds via token t_dtw
  let at = 0;
  if (kv.at !== undefined) {
    const raw = kv.at;
    const colonIdx = raw.lastIndexOf(':');
    let word, occurrence;

    if (colonIdx > 0 && !isNaN(raw.slice(colonIdx + 1))) {
      word = raw.slice(0, colonIdx).toLowerCase();
      occurrence = parseInt(raw.slice(colonIdx + 1)) - 1;
    } else {
      word = raw.toLowerCase();
      occurrence = 0;
    }

    const matches = tokens.filter(t => normalize(t.text) === word);
    const token = matches[occurrence] ?? null;
    at = token ? token.t_dtw : parseFloat(raw) || 0;
  }

  const duration = parseFloat(kv.duration) || 3;
  const props = {};
  for (const [k, v] of Object.entries(kv)) {
    if (k !== 'at' && k !== 'duration') props[k] = v;
  }

  return { type, at, duration, props };
}

function applyTextPartsToTokens(rawText, tokens) {
  // Reset all cut flags first — doc is the source of truth
  const updated = tokens.map(t => ({ ...t, cut: false, cutReason: null }));

  // Find every {span} or {span:reason} marker and search for it in the token list
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(rawText)) !== null) {
    const inner = m[1];
    const colonIdx = inner.lastIndexOf(':');
    let span, reason;
    if (colonIdx > 0 && !inner.slice(colonIdx + 1).includes(' ')) {
      span = inner.slice(0, colonIdx);
      reason = inner.slice(colonIdx + 1);
    } else {
      span = inner;
      reason = 'filler';
    }

    const cutWords = span.split(/\s+/).filter(Boolean).map(w => normalize(w));
    if (!cutWords.length) continue;

    // Find first run of tokens matching the cut word sequence
    for (let i = 0; i <= updated.length - cutWords.length; i++) {
      const matches = cutWords.every((w, j) => normalize(updated[i + j].text) === w);
      if (matches) {
        for (let j = 0; j < cutWords.length; j++) {
          updated[i + j] = { ...updated[i + j], cut: true, cutReason: reason };
        }
        break;
      }
    }
  }

  // Apply word-level text corrections: align visible (non-cut) words from doc
  // with non-cut tokens and update token.text so corrections persist.
  const visibleWords = rawText.replace(/\{[^}]+\}/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const nonCutIndices = updated.reduce((acc, t, i) => { if (!t.cut) acc.push(i); return acc; }, []);
  if (visibleWords.length === nonCutIndices.length) {
    visibleWords.forEach((word, wi) => {
      updated[nonCutIndices[wi]] = { ...updated[nonCutIndices[wi]], text: word };
    });
  }

  return updated;
}

function parseSpeakerRenames(docContent) {
  const match = docContent.match(/^#\s*SPEAKERS\s*\n([\s\S]*?)\n---/m);
  if (!match) return {};
  const map = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const from = line.slice(0, colonIdx).trim();
    const to = line.slice(colonIdx + 1).trim();
    if (from && to && from !== to) map[from] = to;
  }
  return map;
}

function stripSpeakersSection(docContent) {
  // Strip everything from the start through the --- separator
  // (covers both the instructions block and the SPEAKERS section)
  return docContent.replace(/^[\s\S]*?\n---[ \t]*\n+/m, '');
}

function mergeDocIntoTranscript(transcript, docContent) {
  const renames = parseSpeakerRenames(docContent);
  const stripped = stripSpeakersSection(docContent);

  const byId = Object.fromEntries(transcript.segments.map(s => [s.id, s]));
  let applied = 0;
  let currentSpeaker = null;
  let pendingSeg = null;
  let pendingGraphicLines = [];

  function flushPending() {
    if (!pendingSeg) return;
    const graphics = pendingGraphicLines.map(l => parseGraphicLine(l, pendingSeg.tokens));
    byId[pendingSeg.id] = { ...pendingSeg, graphics };
    pendingSeg = null;
    pendingGraphicLines = [];
  }

  for (const line of stripped.split('\n')) {
    const trimmed = line.trim();

    // Speaker group header: === Speaker Name ===
    const speakerMatch = trimmed.match(/^===\s+(.+?)\s+===$/);
    if (speakerMatch) {
      flushPending();
      const rawSpeaker = speakerMatch[1];
      currentSpeaker = renames[rawSpeaker] ?? rawSpeaker;
      continue;
    }

    // Graphic line: > GraphicType ...
    if (trimmed.startsWith('>')) {
      if (pendingSeg) pendingGraphicLines.push(trimmed.slice(1).trim());
      continue;
    }

    // Segment line: [N]  text  or  [N] CUT  text  or  [N] CUT:reason  text
    const segMatch = trimmed.match(/^\[(\d+)\](.*)/);
    if (segMatch) {
      flushPending();
      const id = parseInt(segMatch[1]);
      const seg = byId[id];
      if (!seg) continue;

      let rest = segMatch[2].trim();
      let cut = false;
      let cutReason = null;

      const cutMatch = rest.match(/^CUT(?::(\w+))?\s*(.*)/i);
      if (cutMatch) {
        cut = true;
        cutReason = cutMatch[1]?.toLowerCase() || 'offtopic';
        rest = cutMatch[2];
      }

      const rawText = rest;
      const tokens = applyTextPartsToTokens(rawText, seg.tokens);
      const cleanText = rawText.replace(/\{[^}]+\}/g, '').replace(/\s{2,}/g, ' ').trim();
      const speaker = currentSpeaker ?? seg.speaker;

      pendingSeg = { ...seg, speaker, cut, cutReason: cutReason || null, text: cleanText, tokens };
      applied++;
      continue;
    }
  }

  flushPending();

  if (Object.keys(renames).length) {
    console.log(`  Speaker renames: ${Object.entries(renames).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
  }
  console.log(`  ${applied} segments merged.`);
  return { ...transcript, segments: transcript.segments.map(s => byId[s.id] ?? s) };
}

// ─── Pause auto-cut ───────────────────────────────────────────────────────────

/**
 * Adds time-range cuts to cuts[] for silence gaps between tokens that exceed
 * the threshold (seconds). Applied after deriveCuts so it doesn't conflict
 * with token-level cut flags. Existing pause cuts are replaced on each run.
 */
function autoCutPauses(transcript, threshold) {
  return {
    ...transcript,
    segments: transcript.segments.map(seg => {
      // Only consider non-cut tokens for gap detection
      const activeTokens = seg.tokens.filter(t => !t.cut);
      const pauseCuts = [];

      for (let i = 0; i < activeTokens.length - 1; i++) {
        const gap = activeTokens[i + 1].t_dtw - activeTokens[i].t_dtw;
        if (gap > threshold) {
          // Keep ~20% of gap as natural word tail (capped at 0.2s), cut the rest
          const tail = Math.min(0.2, gap * 0.2);
          pauseCuts.push({
            from: activeTokens[i].t_dtw + tail,
            to: activeTokens[i + 1].t_dtw,
            reason: 'pause',
          });
        }
      }

      if (!pauseCuts.length) return seg;

      // Merge token-derived cuts with pause cuts, sorted by time
      const allCuts = [...seg.cuts.filter(c => c.reason !== 'pause'), ...pauseCuts]
        .sort((a, b) => a.from - b.from);

      return { ...seg, cuts: allCuts };
    }),
  };
}

// ─── VTT helpers ──────────────────────────────────────────────────────────────

function secondsToVttTs(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(3);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(6, '0')}`;
}

function buildSentencesVtt(segments) {
  const lines = ['WEBVTT', ''];
  for (const seg of segments) {
    lines.push(`${secondsToVttTs(seg.start)} --> ${secondsToVttTs(seg.end)}`);
    lines.push(seg.text);
    lines.push('');
  }
  return lines.join('\n');
}

function parseVtt(content) {
  const segments = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].trim().match(
      /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})/
    );
    if (match) {
      const start = vttTsToSeconds(match[1]);
      const end = vttTsToSeconds(match[2]);
      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }
      segments.push({ start, end, text: textLines.join(' ') });
    } else { i++; }
  }
  return segments;
}

function vttTsToSeconds(ts) {
  const [hh, mm, ss] = ts.replace(',', '.').split(':');
  return parseInt(hh) * 3600 + parseInt(mm) * 60 + parseFloat(ss);
}

function applyVttCorrections(transcript, vttSegments) {
  for (const vttSeg of vttSegments) {
    let best = null;
    let bestDelta = Infinity;
    for (const seg of transcript.segments) {
      const delta = Math.abs(seg.start - vttSeg.start);
      if (delta < bestDelta) { bestDelta = delta; best = seg; }
    }
    if (best && bestDelta < 1.0) best.text = vttSeg.text;
  }
  return transcript;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cwd = process.cwd();
  const cli = parseArgs();

  const rawPath = cli.rawPath || path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'transcript.raw.json');
  const outputPath = cli.outputPath || path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.json');
  const sentencesVttPath = outputPath.replace(/\.json$/, '.sentences.vtt');
  const docPath = outputPath.replace(/\.json$/, '.doc.txt');

  if (!await fs.pathExists(rawPath)) {
    console.error(`❌ Raw transcript not found: ${rawPath}`);
    console.error('   Run "npm run transcribe" first.');
    process.exit(1);
  }

  const raw = await fs.readJson(rawPath);

  // Merge raw whisper segments into sentences
  const sentenceSegments = mergeIntoSentences(raw.segments);
  let transcript = { ...raw, segments: sentenceSegments };

  // If transcript.json already exists, preserve manual edits by sentence id
  if (await fs.pathExists(outputPath)) {
    const existing = await fs.readJson(outputPath);
    const byId = Object.fromEntries(existing.segments.map(s => [s.id, s]));
    transcript = {
      ...transcript,
      meta: { ...transcript.meta, ...existing.meta },
      segments: transcript.segments.map(seg => {
        const prev = byId[seg.id];
        if (!prev) return seg;
        const prevTokensByTdtw = Object.fromEntries(
          (prev.tokens || []).map(t => [t.t_dtw.toFixed(3), t])
        );
        const tokens = seg.tokens.map(t => {
          const p = prevTokensByTdtw[t.t_dtw.toFixed(3)];
          return p ? { ...t, text: p.text, cut: p.cut, cutReason: p.cutReason } : t;
        });
        return { ...seg, speaker: prev.speaker, cut: prev.cut, cutReason: prev.cutReason, text: prev.text, graphics: prev.graphics, tokens };
      }),
    };
    console.log(`Merged into existing ${path.basename(outputPath)} — manual edits preserved.`);
  }

  // Apply corrected VTT text if provided
  if (cli.vttPath) {
    if (!await fs.pathExists(cli.vttPath)) {
      console.error(`❌ VTT file not found: ${cli.vttPath}`); process.exit(1);
    }
    const vttContent = (await fs.readFile(cli.vttPath, 'utf8')).replace(/\r\n/g, '\n');
    transcript = applyVttCorrections(transcript, parseVtt(vttContent));
    console.log(`Applied VTT corrections.`);
  }

  // Merge doc edits if provided
  if (cli.docPath) {
    if (!await fs.pathExists(cli.docPath)) {
      console.error(`❌ Doc file not found: ${cli.docPath}`); process.exit(1);
    }
    // Normalise line endings — editors on Windows save CRLF which breaks block splitting
    const docContent = (await fs.readFile(cli.docPath, 'utf8')).replace(/\r\n/g, '\n');
    transcript = mergeDocIntoTranscript(transcript, docContent);
    console.log(`Applied doc edits.`);
  }

  // Always re-derive cuts[] from token flags
  transcript = {
    ...transcript,
    segments: transcript.segments.map(seg => ({ ...seg, cuts: deriveCuts(seg) })),
  };

  // Auto-cut inter-token pauses if threshold provided
  if (cli.autoCutPauses > 0) {
    transcript = autoCutPauses(transcript, cli.autoCutPauses);
    console.log(`Auto-cut pauses > ${cli.autoCutPauses}s`);
  }

  const sentencesVtt = buildSentencesVtt(transcript.segments);
  const sentencesSrtPath = sentencesVttPath.replace(/\.vtt$/, '.srt');

  await fs.writeJson(outputPath, transcript, { spaces: 2 });
  await fs.writeFile(sentencesVttPath, sentencesVtt, 'utf8');
  await fs.writeFile(sentencesSrtPath, convertVttToSrt(sentencesVtt), 'utf8');
  await fs.writeFile(docPath, buildDoc(transcript), 'utf8');

  console.log(`✓ ${outputPath}`);
  console.log(`✓ ${docPath}  ← edit here`);
  console.log(`✓ ${sentencesSrtPath}`);
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/')) {
  main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
}

export default main;
