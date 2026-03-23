#!/usr/bin/env python3
"""
Thin diarize package wrapper.
Usage: python diarize.py <audio_path> [num_speakers]
Writes progress to stderr, JSON result to stdout.
"""

import sys
import json


def check_python_version():
    major, minor = sys.version_info[:2]
    if (major, minor) > (3, 12):
        print(
            json.dumps({'error':
                f'Python {major}.{minor} is not supported. diarize requires Python 3.9–3.12 '
                '(torch<2.9 is unavailable for Python 3.13+). '
                'Create a 3.12 venv and pass it with --python:\n'
                '  py -3.12 -m venv .venv\n'
                '  .venv\\Scripts\\activate\n'
                '  pip install -r scripts/requirements.txt\n'
                '  npm run diarize -- --python .venv\\Scripts\\python.exe'
            }),
            file=sys.stdout,
        )
        sys.exit(1)


def main():
    check_python_version()

    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: python diarize.py <audio_path> [num_speakers]'}))
        sys.exit(1)

    audio_path = sys.argv[1]
    num_speakers = int(sys.argv[2]) if len(sys.argv) > 2 else None

    try:
        from diarize import diarize
    except ImportError as e:
        print(
            json.dumps({'error':
                f'diarize not installed: {e}. '
                'Run: pip install -r scripts/diarize/requirements.txt'
            }),
            file=sys.stdout,
        )
        sys.exit(1)

    import os
    if not os.path.exists(audio_path):
        print(json.dumps({'error': f'Audio file not found: {audio_path}'}))
        sys.exit(1)

    print(f'Diarizing {audio_path}...', file=sys.stderr, flush=True)
    if num_speakers:
        print(f'Speaker count locked to {num_speakers}.', file=sys.stderr, flush=True)

    # The diarize package prints download progress to stdout, which would corrupt
    # the JSON output that Node reads. Redirect stdout → stderr for the duration
    # of the call so all package noise goes to the terminal via stderr instead.
    try:
        _real_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            result = diarize(audio_path, **({'num_speakers': num_speakers} if num_speakers else {}))
        finally:
            sys.stdout = _real_stdout
    except Exception as e:
        print(json.dumps({'error': f'Diarization failed: {e}'}))
        sys.exit(1)

    turns = [
        {
            'speaker': seg.speaker,
            'start': round(float(seg.start), 3),
            'end': round(float(seg.end), 3),
        }
        for seg in result.segments
    ]

    print(
        f'Done. {result.num_speakers} speaker(s), {len(turns)} turns.',
        file=sys.stderr,
        flush=True,
    )
    print(json.dumps(turns))


if __name__ == '__main__':
    main()
