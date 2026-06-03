#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GPU-accelerated transcription using faster-whisper (CUDA).
Outputs the same JSON format as the whisper.cpp workflow.
"""
import sys
import os
import json
import argparse
from pathlib import Path
from faster_whisper import WhisperModel

# Ensure UTF-8 output on Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True, help='Input audio file (WAV 16kHz)')
    parser.add_argument('--model', default='medium.en', help='Model name (tiny.en, small.en, medium.en, large-v3)')
    parser.add_argument('--output', required=True, help='Output JSON file path')
    parser.add_argument('--device', default='cuda', help='Device: cuda or cpu (default: cuda)')
    parser.add_argument('--timestamp-offset', type=float, default=0, help='Seconds to subtract from timestamps')
    return parser.parse_args()

def main():
    args = parse_args()
    
    print(f'Loading model "{args.model}" on {args.device}...')
    
    # Load model with GPU or CPU
    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type="float16" if args.device == "cuda" else "int8"
    )
    
    print(f'Transcribing {args.audio}...')
    
    # Transcribe with word-level timestamps
    segments, info = model.transcribe(
        args.audio,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,  # Voice activity detection
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    
    print(f'Language: {info.language} (probability: {info.language_probability:.2f})')
    
    # Convert to output format matching whisper.cpp
    result = []
    segment_id = 1
    
    for segment in segments:
        # Each segment
        segment_data = {
            'id': segment_id,
            'start': max(0, segment.start - args.timestamp_offset),
            'end': max(0, segment.end - args.timestamp_offset),
            'text': segment.text.strip(),
            'words': []
        }
        
        # Add word-level timestamps
        if segment.words:
            for word in segment.words:
                segment_data['words'].append({
                    'word': word.word.strip(),
                    'start': max(0, word.start - args.timestamp_offset),
                    'end': max(0, word.end - args.timestamp_offset),
                    'probability': word.probability
                })
        
        result.append(segment_data)
        segment_id += 1
    
    # Write output
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    
    print(f'[OK] Transcription complete: {len(result)} segments')
    print(f'[OK] Output: {output_path}')

if __name__ == '__main__':
    main()
