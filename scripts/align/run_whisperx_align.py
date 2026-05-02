#!/usr/bin/env python3
"""
Force-align an existing transcript.raw.json against local audio using WhisperX.

This script is intentionally file-based (in/out files) to avoid stdout parsing issues
from ML libraries that may print progress logs.
"""

import argparse
import gc
import json
import sys
from pathlib import Path

import torch


def eprint(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def normalize_segment(seg: dict) -> dict | None:
    text = (seg.get('text') or '').strip()
    if not text:
        return None
    start = float(seg.get('start', 0.0))
    end = float(seg.get('end', start + 0.01))
    if end <= start:
        end = start + 0.01
    return {"text": text, "start": start, "end": end}


def sanitize_word(word_obj: dict) -> dict | None:
    word = (word_obj.get('word') or word_obj.get('text') or '').strip()
    start = word_obj.get('start')
    end = word_obj.get('end')
    if not word or start is None or end is None:
        return None
    start_f = float(start)
    end_f = float(end)
    if end_f <= start_f:
        end_f = start_f + 0.01
    return {"word": word, "start": round(start_f, 3), "end": round(end_f, 3)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--raw', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--language', default='en')
    args = parser.parse_args()

    audio_path = Path(args.audio)
    raw_path = Path(args.raw)
    out_path = Path(args.out)

    if not audio_path.exists():
        eprint(f'Audio file not found: {audio_path}')
        return 1
    if not raw_path.exists():
        eprint(f'Raw transcript not found: {raw_path}')
        return 1

    try:
        import whisperx
    except Exception as exc:
        eprint(
            'WhisperX is not installed in this Python environment.\n'
            'Install with:\n'
            '  pip install whisperx faster-whisper\n'
            f'Import error: {exc}'
        )
        return 1

    try:
        raw = json.loads(raw_path.read_text(encoding='utf-8'))
        raw_segments = raw.get('segments', [])

        align_inputs = []
        align_idx_to_raw_idx = []
        for i, seg in enumerate(raw_segments):
            normalized = normalize_segment(seg)
            if normalized is None:
                continue
            align_inputs.append(normalized)
            align_idx_to_raw_idx.append(i)

        if not align_inputs:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(
                json.dumps({'segments': [], 'meta': {'language': args.language}}, ensure_ascii=True, indent=2),
                encoding='utf-8'
            )
            return 0

        def log_memory(label=''):
            try:
                with open('/proc/meminfo', 'r') as f:
                    meminfo = f.read()
                total = 0
                available = 0
                for line in meminfo.split('\n'):
                    if line.startswith('MemTotal:'):
                        total = int(line.split()[1]) // 1024
                    elif line.startswith('MemAvailable:'):
                        available = int(line.split()[1]) // 1024
                used = total - available
                pct = int(used / total * 100) if total > 0 else 0
                prefix = f'[{label}] ' if label else ''
                eprint(f'  {prefix}Memory: {pct}% used ({used}MB / {total}MB), {available}MB available')
            except Exception:
                pass

        eprint('Loading audio...')
        audio = whisperx.load_audio(str(audio_path))
        log_memory('after audio load')

        eprint(f'Loading WhisperX align model for language="{args.language}" on {args.device}...')
        model_a, metadata = whisperx.load_align_model(language_code=args.language, device=args.device)
        log_memory('after model load')

        # Process ONE segment at a time to isolate crashes
        aligned_segments = []
        total_inputs = len(align_inputs)

        for seg_idx in range(total_inputs):
            global_idx = align_idx_to_raw_idx[seg_idx]
            seg = align_inputs[seg_idx]
            seg_duration = seg['end'] - seg['start']
            word_count = len(seg['text'].split())
            # Sanity check: max 10 seconds per word (generous upper bound)
            max_reasonable_duration = max(30, word_count * 10)

            if seg_duration > max_reasonable_duration:
                eprint(f'WARNING: Segment {seg_idx} has suspicious duration {seg_duration:.1f}s for {word_count} words')
                eprint(f'  Text: "{seg["text"]}"')
                eprint(f'  Skipping alignment - using fallback timestamps')
                aligned_segments.append({
                    'raw_index': global_idx,
                    'start': seg['start'],
                    'end': seg['start'] + max(1.0, word_count * 0.5),  # Estimate ~0.5s per word
                    'text': seg['text'],
                    'words': [],
                })
                continue

            eprint(f'Aligning segment {seg_idx}/{total_inputs} (raw index {global_idx}): "{seg["text"][:50]}..."')

            try:
                with torch.no_grad():
                    result = whisperx.align(
                        [seg],
                        model_a,
                        metadata,
                        audio,
                        args.device,
                        return_char_alignments=False,
                    )
            except Exception as e:
                eprint(f'ERROR: Segment {seg_idx} (raw index {global_idx}) failed: {e}')
                eprint(f'  Text: "{seg["text"]}"')
                eprint(f'  Start: {seg["start"]}, End: {seg["end"]}')
                # Create fallback result
                aligned_segments.append({
                    'raw_index': global_idx,
                    'start': seg['start'],
                    'end': seg['end'],
                    'text': seg['text'],
                    'words': [],
                })
                continue

            batch_aligned = result.get('segments', []) if isinstance(result, dict) else []
            del result

            if batch_aligned:
                out_seg = batch_aligned[0]
                aligned_segments.append(out_seg)
            else:
                # No alignment output - use fallback
                aligned_segments.append({
                    'raw_index': global_idx,
                    'start': seg['start'],
                    'end': seg['end'],
                    'text': seg['text'],
                    'words': [],
                })

            # Periodic GC every 10 segments
            if seg_idx % 10 == 0:
                gc.collect()

        output_segments = []
        for aligned_idx, out_seg in enumerate(aligned_segments):
            if aligned_idx >= len(align_idx_to_raw_idx):
                break
            raw_idx = align_idx_to_raw_idx[aligned_idx]
            words_raw = out_seg.get('words', []) or []
            words = []
            for w in words_raw:
                sanitized = sanitize_word(w)
                if sanitized is not None:
                    words.append(sanitized)

            seg_start = out_seg.get('start')
            seg_end = out_seg.get('end')
            if seg_start is None or seg_end is None:
                if words:
                    seg_start = words[0]['start']
                    seg_end = words[-1]['end']
                else:
                    src = align_inputs[aligned_idx]
                    seg_start = src['start']
                    seg_end = src['end']

            output_segments.append({
                'raw_index': raw_idx,
                'start': round(float(seg_start), 3),
                'end': round(float(seg_end), 3),
                'text': out_seg.get('text', align_inputs[aligned_idx]['text']),
                'words': words,
            })

        payload = {
            'segments': output_segments,
            'meta': {
                'language': args.language,
                'device': args.device,
                'tool': 'whisperx',
            },
        }

        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding='utf-8')
        eprint(f'Alignment result written: {out_path}')
        return 0
    except Exception as exc:
        eprint(f'Forced alignment failed: {exc}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
