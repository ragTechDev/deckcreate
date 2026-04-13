#!/usr/bin/env python3
"""
Detect faces in a still image using MediaPipe.

Supports both API generations:
  - mp.solutions (mediapipe < ~0.10.20, bundled model, no download)
  - Tasks API   (mediapipe >= 0.10.20, downloads BlazeFace ~800 KB on first run,
                 cached next to this script)

Usage: detect-faces.py <image_path> [--num-speakers N]
  --num-speakers N  Iteratively lower detection confidence until N faces are found.

Output (stdout): JSON array of { x, y, w, h, score } normalised 0–1, left-to-right.
"""
import sys
import json
import os

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
MODEL_CACHE = os.path.join(SCRIPT_DIR, 'blaze_face_short_range.tflite')
MODEL_URL   = (
    'https://storage.googleapis.com/mediapipe-models/'
    'face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
)

# Confidence thresholds tried in order when enforcing a speaker count
THRESHOLDS = [0.7, 0.5, 0.35, 0.2, 0.1]


# ── Arg parsing ───────────────────────────────────────────────────────────────

def parse_args():
    args = sys.argv[1:]
    result = {'image_path': None, 'num_speakers': None}
    i = 0
    while i < len(args):
        if args[i] == '--num-speakers' and i + 1 < len(args):
            result['num_speakers'] = int(args[i + 1])
            i += 2
        else:
            result['image_path'] = args[i]
            i += 1
    return result


# ── Detection backends ────────────────────────────────────────────────────────

def _detect_solutions(img_rgb_array, threshold: float) -> list[dict]:
    """Legacy mp.solutions API — model bundled in pip package."""
    import mediapipe as mp
    with mp.solutions.face_detection.FaceDetection(
        model_selection=1,
        min_detection_confidence=threshold,
    ) as det:
        results = det.process(img_rgb_array)

    if not results.detections:
        return []

    faces = []
    for d in results.detections:
        bb    = d.location_data.relative_bounding_box
        score = d.score[0] if d.score else 1.0
        faces.append({
            'x': round(max(0.0, bb.xmin),   4),
            'y': round(max(0.0, bb.ymin),   4),
            'w': round(min(1.0, bb.width),  4),
            'h': round(min(1.0, bb.height), 4),
            'score': round(float(score), 3),
        })
    return faces


def _ensure_model() -> str:
    if os.path.exists(MODEL_CACHE):
        return MODEL_CACHE
    sys.stderr.write('Downloading face detection model (one-time, ~800 KB)...\n')
    import urllib.request
    try:
        urllib.request.urlretrieve(MODEL_URL, MODEL_CACHE)
    except Exception as e:
        raise RuntimeError(
            f'Failed to download model: {e}\n'
            f'Download manually from:\n  {MODEL_URL}\n'
            f'and place it at:\n  {MODEL_CACHE}'
        ) from e
    sys.stderr.write(f'  Saved: {MODEL_CACHE}\n')
    return MODEL_CACHE


def _detect_tasks(image_path: str, threshold: float) -> list[dict]:
    """Tasks API (mediapipe >= 0.10.20) — downloads model on first run."""
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    base_options = mp_python.BaseOptions(model_asset_path=_ensure_model())
    options      = mp_vision.FaceDetectorOptions(
        base_options=base_options,
        min_detection_confidence=threshold,
    )

    with mp_vision.FaceDetector.create_from_options(options) as detector:
        mp_image = mp.Image.create_from_file(image_path)
        result   = detector.detect(mp_image)
        img_w, img_h = mp_image.width, mp_image.height

    faces = []
    for detection in result.detections:
        bb    = detection.bounding_box
        score = detection.categories[0].score if detection.categories else 1.0
        faces.append({
            'x': round(max(0.0, bb.origin_x / img_w), 4),
            'y': round(max(0.0, bb.origin_y / img_h), 4),
            'w': round(min(1.0, bb.width    / img_w), 4),
            'h': round(min(1.0, bb.height   / img_h), 4),
            'score': round(float(score), 3),
        })
    return faces


# ── Main detection with speaker-count enforcement ─────────────────────────────

def detect_faces(image_path: str, num_speakers: int | None = None) -> list[dict]:
    import mediapipe as mp
    use_solutions = hasattr(mp, 'solutions') and hasattr(mp.solutions, 'face_detection')

    if not use_solutions:
        sys.stderr.write('mp.solutions not available — using Tasks API\n')

    if use_solutions:
        import numpy as np
        from PIL import Image
        img_array = np.array(Image.open(image_path).convert('RGB'))

    def run(threshold: float) -> list[dict]:
        if use_solutions:
            return _detect_solutions(img_array, threshold)
        return _detect_tasks(image_path, threshold)

    # Iteratively lower threshold until we reach the required speaker count
    faces: list[dict] = []
    for threshold in THRESHOLDS:
        faces = run(threshold)
        if num_speakers is None or len(faces) >= num_speakers:
            break
        sys.stderr.write(
            f'  Found {len(faces)} face(s), need {num_speakers} '
            f'— retrying at confidence {THRESHOLDS[THRESHOLDS.index(threshold) + 1] if threshold != THRESHOLDS[-1] else threshold}...\n'
        )

    if num_speakers and len(faces) > num_speakers:
        # More detected than needed — keep the most confident ones
        faces.sort(key=lambda f: f['score'], reverse=True)
        faces = faces[:num_speakers]

    if num_speakers and len(faces) < num_speakers:
        sys.stderr.write(
            f'  Warning: detected only {len(faces)} of {num_speakers} expected face(s). '
            'Draw the missing box(es) manually in the /camera GUI.\n'
        )

    faces.sort(key=lambda f: f['x'])
    return faces


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    args = parse_args()
    if not args['image_path']:
        print(json.dumps({'error': 'Usage: detect-faces.py <image_path> [--num-speakers N]'}), flush=True)
        sys.exit(1)

    try:
        result = detect_faces(args['image_path'], args['num_speakers'])
        print(json.dumps(result), flush=True)
    except Exception as exc:
        sys.stderr.write(f'detect-faces error: {exc}\n')
        print(json.dumps({'error': str(exc)}), flush=True)
        sys.exit(1)
