#!/usr/bin/env python3
"""
Extract the most expressive video frame per speaker, remove background.

For each speaker in the episode:
  1. Sample candidate frames during their hook/speaking segments
  2. Crop to their close-up viewport (from camera-profiles.json)
  3. Score expression via MediaPipe FaceMesh (MAR + EAR + brow raise)
  4. Select best frame, remove background with rembg
  5. Save as {output_dir}/{speaker_lower}_cutout.png

Also writes {output_dir}/manifest.json with per-speaker metadata.

Usage:
  python3 scripts/thumbnail/extract-speaker-frames.py \\
    --transcript public/edit/transcript.json \\
    --camera-profiles public/camera/camera-profiles.json \\
    --video public/sync/output/synced-output-1.mp4 \\
    --output-dir public/thumbnail/cutouts \\
    [--num-frames 8] \\
    [--speakers Natasha Saloni Victoria]

Dependencies:
  pip install mediapipe rembg opencv-python Pillow
"""

import sys
import os
import json
import math
import subprocess
import tempfile
import shutil
import argparse
from pathlib import Path


# ── HDR detection (port of scripts/shared/hdr-detect.js) ──────────────────────

HDR_TRANSFERS = {'arib-std-b67', 'smpte2084', 'smpte-st-2084'}

HDR_TONEMAP_VF = ','.join([
    'zscale=t=linear:npl=100',
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
])
SDR_FORMAT_VF = 'format=yuv420p'


def detect_hdr(video_path: str) -> bool:
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-show_streams', '-select_streams', 'v:0',
             '-print_format', 'json', video_path],
            capture_output=True, text=True, timeout=15,
        )
        data = json.loads(result.stdout)
        transfer = (data.get('streams') or [{}])[0].get('color_transfer', '')
        return transfer in HDR_TRANSFERS
    except Exception:
        return False


# ── FFmpeg frame extraction ────────────────────────────────────────────────────

def extract_frame(video_path: str, timestamp: float, output_path: str, is_hdr: bool) -> bool:
    vf = HDR_TONEMAP_VF if is_hdr else SDR_FORMAT_VF
    try:
        result = subprocess.run(
            ['ffmpeg', '-ss', str(timestamp), '-i', video_path,
             '-frames:v', '1', '-vf', vf, '-q:v', '2', '-y', output_path],
            capture_output=True, timeout=30,
        )
        return result.returncode == 0 and os.path.exists(output_path)
    except Exception as e:
        sys.stderr.write(f'  ffmpeg error at {timestamp:.2f}s: {e}\n')
        return False


# ── Candidate timestamp selection ─────────────────────────────────────────────

def get_candidate_timestamps(transcript: dict, speaker: str, num_frames: int = 8) -> list[float]:
    video_start = transcript.get('meta', {}).get('videoStart', 0) or 0
    segments = [
        s for s in transcript.get('segments', [])
        if s.get('speaker') == speaker and not s.get('cut', False)
    ]
    hook_segs  = [s for s in segments if s.get('hook')]
    other_segs = [s for s in segments if not s.get('hook')]

    timestamps = []

    # Hook segments first — these are the curated best moments
    for s in hook_segs:
        start = s.get('hookFrom') or s['start']
        end   = s.get('hookTo')   or s['end']
        mid   = start + (end - start) / 2
        timestamps.append(mid + video_start)

    # Fill remaining slots from evenly-spaced non-hook segments
    remaining = num_frames - len(timestamps)
    if remaining > 0 and other_segs:
        step = max(1, math.ceil(len(other_segs) / remaining))
        for s in other_segs[::step]:
            mid = s['start'] + (s['end'] - s['start']) / 2
            timestamps.append(mid + video_start)
            if len(timestamps) >= num_frames:
                break

    return timestamps[:num_frames]


# ── Close-up viewport crop ─────────────────────────────────────────────────────

def find_viewport_at_time(speaker_profile: dict, timestamp: float) -> dict | None:
    timed = speaker_profile.get('closeupViewportsByTime', [])
    for entry in timed:
        if entry.get('from', 0) <= timestamp <= entry.get('to', float('inf')):
            return entry.get('viewport')
    return speaker_profile.get('closeupViewport')


def crop_to_speaker(img, viewport: dict, expand_v: float = 0.10):
    from PIL import Image
    src_w, src_h = img.size
    cx = viewport['cx']
    cy = viewport['cy']
    w  = viewport['w']
    h  = min(1.0, viewport['h'] * (1 + expand_v))
    # Re-center vertically after expansion, clamped to image bounds
    cy = min(max(h / 2, cy), 1.0 - h / 2)

    x1 = int(max(0,     (cx - w / 2) * src_w))
    y1 = int(max(0,     (cy - h / 2) * src_h))
    x2 = int(min(src_w, (cx + w / 2) * src_w))
    y2 = int(min(src_h, (cy + h / 2) * src_h))
    return img.crop((x1, y1, x2, y2))


# ── Expression scoring via MediaPipe FaceMesh ──────────────────────────────────
# Scores "YouTube face" expressiveness:
#   MAR (mouth aspect ratio)  — open mouth scores higher
#   EAR (eye aspect ratio)    — wide eyes score higher
#   Brow raise                — raised eyebrows score higher

def score_expression(cropped_img) -> float:
    try:
        import mediapipe as mp
        import numpy as np

        img_rgb = cropped_img.convert('RGB')
        arr = np.array(img_rgb)

        with mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            min_detection_confidence=0.4,
            min_tracking_confidence=0.4,
        ) as fm:
            results = fm.process(arr)

        if not results.multi_face_landmarks:
            return 0.0

        lm = results.multi_face_landmarks[0].landmark

        # Mouth Aspect Ratio: upper lip (13) to lower lip (14), corners 78 & 308
        mouth_h = abs(lm[13].y - lm[14].y)
        mouth_w = abs(lm[78].x - lm[308].x) + 1e-6
        mar = mouth_h / mouth_w

        # Eye Aspect Ratio (average both eyes)
        # Left eye: top=159, bottom=145, corners=33,133
        ear_l = abs(lm[159].y - lm[145].y) / (abs(lm[33].x  - lm[133].x) + 1e-6)
        # Right eye: top=386, bottom=374, corners=362,263
        ear_r = abs(lm[386].y - lm[374].y) / (abs(lm[362].x - lm[263].x) + 1e-6)
        ear = (ear_l + ear_r) / 2

        # Eyebrow raise: larger y-gap from brow to eye top = more raised
        # Left brow=70, left eye top=159; right brow=300, right eye top=386
        brow_l = max(0.0, lm[159].y - lm[70].y)
        brow_r = max(0.0, lm[386].y - lm[300].y)
        brow = (brow_l + brow_r) / 2

        return float((mar * 1.5) + (ear * 0.8) + (brow * 0.7))

    except Exception as e:
        sys.stderr.write(f'  FaceMesh error: {e}\n')
        return 0.0


# ── Background removal ─────────────────────────────────────────────────────────

def remove_background(cropped_img):
    try:
        from rembg import remove
        return remove(cropped_img)
    except ImportError:
        sys.stderr.write(
            'rembg not installed. Run: pip install rembg\n'
            'Saving crop without background removal.\n'
        )
        return cropped_img.convert('RGBA')


# ── Per-speaker extraction ─────────────────────────────────────────────────────

def process_speaker(
    speaker: str,
    transcript: dict,
    camera_profiles: dict,
    video_path: str,
    output_dir: str,
    num_frames: int,
    is_hdr: bool,
    tmp_dir: str,
) -> dict | None:

    # Resolve which video + speaker profile to use (multi-angle aware)
    speaker_profile = None
    angle_name = None
    angle_video_path = video_path  # fallback: single-angle

    # Try multi-angle lookup: key format is "{Speaker}:{angleName}"
    angles = camera_profiles.get('angles', {})
    if angles:
        for angle_key, profile in camera_profiles.get('speakers', {}).items():
            if angle_key.split(':')[0] == speaker:
                speaker_profile = profile
                angle_name = profile.get('angleName')
                if angle_name and angle_name in angles:
                    rel = angles[angle_name].get('videoSrc', '')
                    if rel:
                        angle_video_path = os.path.join(os.getcwd(), 'public', rel)
                break
    else:
        # Single-angle: key is just the speaker name
        speaker_profile = camera_profiles.get('speakers', {}).get(speaker)

    if not speaker_profile:
        sys.stderr.write(f'  No camera profile found for {speaker} — skipping\n')
        return None

    viewport = speaker_profile.get('closeupViewport')
    if not viewport:
        sys.stderr.write(f'  No closeupViewport for {speaker} — skipping\n')
        return None

    # Sample candidate timestamps
    timestamps = get_candidate_timestamps(transcript, speaker, num_frames)
    if not timestamps:
        sys.stderr.write(f'  No speaking segments found for {speaker}\n')
        return None

    print(f'  Sampling {len(timestamps)} frames for {speaker}...')

    # Score each candidate frame
    from PIL import Image
    best_score = -1.0
    best_frame_ts = None
    best_crop = None

    for i, ts in enumerate(timestamps):
        frame_path = os.path.join(tmp_dir, f'{speaker.lower()}_{i}.jpg')
        if not extract_frame(angle_video_path, ts, frame_path, is_hdr):
            sys.stderr.write(f'  Frame extraction failed at {ts:.2f}s\n')
            continue

        try:
            img = Image.open(frame_path)
        except Exception as e:
            sys.stderr.write(f'  Could not open frame at {ts:.2f}s: {e}\n')
            continue

        # Use time-keyed viewport if available
        vp = find_viewport_at_time(speaker_profile, ts) or viewport
        crop = crop_to_speaker(img, vp)

        score = score_expression(crop)
        sys.stderr.write(f'    t={ts:.2f}s  score={score:.4f}\n')

        if score > best_score:
            best_score = score
            best_frame_ts = ts
            best_crop = crop

    if best_crop is None:
        sys.stderr.write(f'  No valid frames for {speaker}\n')
        return None

    print(f'  Best frame: t={best_frame_ts:.2f}s  score={best_score:.4f}')
    print(f'  Removing background...')

    cutout = remove_background(best_crop)

    out_filename = f'{speaker.lower()}_cutout.png'
    out_path = os.path.join(output_dir, out_filename)
    cutout.save(out_path, 'PNG')
    print(f'  Saved: {out_path}')

    return {
        'cutout': f'thumbnail/cutouts/{out_filename}',
        'score': round(best_score, 4),
        'frameTimestamp': round(best_frame_ts, 3),
        'sourceAngle': angle_name,
    }


# ── Main ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description='Extract expressive speaker frames for thumbnail')
    p.add_argument('--transcript',       required=True,  help='Path to transcript.json')
    p.add_argument('--camera-profiles',  required=True,  help='Path to camera-profiles.json')
    p.add_argument('--video',            required=True,  help='Path to video file')
    p.add_argument('--output-dir',       required=True,  help='Directory to save cutouts + manifest')
    p.add_argument('--num-frames',       type=int, default=8, help='Candidate frames per speaker')
    p.add_argument('--speakers',         nargs='+',      help='Subset of speakers to process')
    return p.parse_args()


def main():
    args = parse_args()

    # Load JSON inputs
    with open(args.transcript) as f:
        transcript = json.load(f)
    with open(args.camera_profiles) as f:
        camera_profiles = json.load(f)

    if not os.path.exists(args.video):
        sys.stderr.write(f'Video not found: {args.video}\n')
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)

    # Determine which speakers to process
    if args.speakers:
        speakers = args.speakers
    else:
        seen = {}
        for s in transcript.get('segments', []):
            sp = s.get('speaker')
            if sp and sp not in seen:
                seen[sp] = True
        speakers = list(seen.keys())

    print(f'Processing {len(speakers)} speaker(s): {", ".join(speakers)}')

    is_hdr = detect_hdr(args.video)
    print(f'HDR detected: {is_hdr}')

    manifest = {}
    tmp_dir = tempfile.mkdtemp(prefix='thumbnail_frames_')

    try:
        for speaker in speakers:
            print(f'\n[{speaker}]')
            result = process_speaker(
                speaker=speaker,
                transcript=transcript,
                camera_profiles=camera_profiles,
                video_path=args.video,
                output_dir=args.output_dir,
                num_frames=args.num_frames,
                is_hdr=is_hdr,
                tmp_dir=tmp_dir,
            )
            if result:
                manifest[speaker] = result
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    manifest_path = os.path.join(args.output_dir, 'manifest.json')
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f'\nManifest written: {manifest_path}')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
