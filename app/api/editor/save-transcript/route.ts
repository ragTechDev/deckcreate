import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Transcript, TimeCut } from '../../../../remotion/types/transcript';

const TRANSCRIPT_PATH = join(process.cwd(), 'public', 'edit', 'transcript.json');
const DOC_PATH = join(process.cwd(), 'public', 'edit', 'transcript.doc.txt');

/**
 * Targeted update of transcript.doc.txt: replaces > CUT annotations per segment
 * with the current visualCuts from the saved transcript. All other human edits
 * (text corrections, > HOOK, > CAM, > LowerThird, > START/END) are preserved.
 */
function syncDocVisualCuts(docText: string, transcript: Transcript): string {
  const visualCutsBySegId = new Map<number, TimeCut[]>();
  for (const seg of transcript.segments) {
    visualCutsBySegId.set(seg.id, seg.visualCuts ?? []);
  }

  const lines = docText.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Remove stale > CUT lines (we'll reinsert them at the right position)
    if (/^    > CUT \d/.test(line)) {
      i++;
      continue;
    }

    result.push(line);

    // After a segment line, consume its annotation block, then reinsert > CUT lines
    const segMatch = line.trim().match(/^-?\[(\d+)\]/);
    if (segMatch) {
      const segId = parseInt(segMatch[1], 10);
      i++;

      // Consume all indented annotation lines (> HOOK, > CAM, > LowerThird, etc.)
      // Existing > CUT lines are skipped (handled above on the next iteration,
      // but they won't appear here since we already filtered them).
      while (i < lines.length && /^    >/.test(lines[i])) {
        if (!/^    > CUT \d/.test(lines[i])) {
          result.push(lines[i]);
        }
        i++;
      }

      // Insert visual cuts for this segment
      const vCuts = visualCutsBySegId.get(segId) ?? [];
      for (const cut of vCuts) {
        result.push(`    > CUT ${cut.from.toFixed(3)}-${cut.to.toFixed(3)}`);
      }
      continue; // i already advanced past annotations
    }

    i++;
  }

  return result.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const data: Transcript = await req.json();

    // Write transcript.json
    writeFileSync(TRANSCRIPT_PATH, JSON.stringify(data, null, 2));

    // Sync > CUT annotations in transcript.doc.txt
    try {
      const docText = readFileSync(DOC_PATH, 'utf8').replace(/\r\n/g, '\n');
      const updatedDoc = syncDocVisualCuts(docText, data);
      writeFileSync(DOC_PATH, updatedDoc);
    } catch (docErr) {
      // Doc sync is best-effort; don't fail the whole save if doc is missing
      console.warn('Doc sync skipped:', docErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Failed to save transcript:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
