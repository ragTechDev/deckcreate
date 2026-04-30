#!/usr/bin/env python3
"""
Extract 3 candidate video frames per speaker for thumbnail selection.

For each speaker in the episode:
  1. Sample candidate frames during their speaking segments
  2. Crop to their close-up viewport (from camera-profiles.json)
  3. Save all candidates as preview images
  4. Write manifest with candidate metadata for CLI selection

Usage:
  python3 scripts/thumbnail/extract-speaker-candidates.py \
    --transcript public/edit/transcript.json \
    --camera-profiles public/camera/camera-profiles.json \
    --video public/sync/output/synced-output-1.mp4 \
    --output-dir public/thumbnail/candidates \
    [--num-candidates 3] \
    [--speakers Natasha Victoria Inch]

Dependencies:
  pip install mediapipe opencv-python Pillow
"""

import sys
import os
import json
import subprocess
import tempfile
import shutil
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional

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
        streams = data.get('streams', [])
        if not streams:
            return False
        color_transfer = streams[0].get('color_transfer', '').lower()
        return color_transfer in HDR_TRANSFERS
    except Exception as e:
        sys.stderr.write(f'  HDR detection failed: {e}\n')
        return False


def extract_frame(video_path: str, timestamp: float, output_path: str, is_hdr: bool) -> bool:
    vf = HDR_TONEMAP_VF if is_hdr else SDR_FORMAT_VF
    vf += ',scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2'

    cmd = [
        'ffmpeg', '-y', '-ss', str(timestamp), '-i', video_path,
        '-vf', vf, '-vframes', '1', '-q:v', '2',
        '-pix_fmt', 'yuvj420p', output_path,
    ]
    result = subprocess.run(cmd, capture_output=True)
    return result.returncode == 0


# ── Frame sampling ─────────────────────────────────────────────────────────────

def get_candidate_timestamps(transcript: dict, speaker: str, num_candidates: int) -> List[float]:
    segments = transcript.get('segments', [])
    speaking_segments = [
        s for s in segments
        if s.get('speaker') == speaker and not s.get('cut', False)
    ]

    if not speaking_segments:
        return []

    timestamps = []
    if len(speaking_segments) >= num_candidates:
        step = len(speaking_segments) / num_candidates
        for i in range(num_candidates):
            idx = int(i * step)
            seg = speaking_segments[idx]
            timestamps.append((seg['start'] + seg['end']) / 2)
    else:
        # Need more frames than segments - sample multiple times per segment
        min_segment_duration = 0.5  # Minimum seconds between samples within a segment

        for seg in speaking_segments:
            seg_duration = seg['end'] - seg['start']
            # Calculate how many samples we can fit in this segment
            samples_in_seg = max(1, int(seg_duration / min_segment_duration))
            # Distribute samples evenly: start, middle, end positions
            for i in range(samples_in_seg):
                if samples_in_seg == 1:
                    t = (seg['start'] + seg['end']) / 2
                else:
                    # Linear interpolation from start+10% to end-10%
                    pad = seg_duration * 0.1
                    t = seg['start'] + pad + (seg['end'] - seg['start'] - 2 * pad) * (i / (samples_in_seg - 1))
                timestamps.append(round(t, 3))
                if len(timestamps) >= num_candidates:
                    break
            if len(timestamps) >= num_candidates:
                break

        # If still not enough, fall back to repeating midpoints of longest segments
        while len(timestamps) < num_candidates and speaking_segments:
            # Sort by duration, pick longest unused segments
            sorted_segs = sorted(speaking_segments, key=lambda s: s['end'] - s['start'], reverse=True)
            for seg in sorted_segs:
                if len(timestamps) >= num_candidates:
                    break
                timestamps.append((seg['start'] + seg['end']) / 2)

    return timestamps[:num_candidates]


# ── Viewport crop ──────────────────────────────────────────────────────────────

def find_viewport_at_time(speaker_profile: dict, timestamp: float) -> Optional[dict]:
    timed = speaker_profile.get('closeupViewportsByTime', [])
    for entry in timed:
        if entry.get('from', 0) <= timestamp <= entry.get('to', float('inf')):
            return entry.get('viewport')
    return speaker_profile.get('closeupViewport')


def _detect_face_bbox(img):
    """Return (face_top_px, face_bottom_px, n_faces) or None on error."""
    try:
        import mediapipe as mp
        import numpy as np

        arr = np.array(img.convert('RGB'))
        crop_h = img.size[1]

        with mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=0.5
        ) as detector:
            results = detector.process(arr)
            n = len(results.detections) if results.detections else 0
            if n == 0:
                return (0, crop_h, 0)
            det = results.detections[0]
            bb = det.location_data.relative_bounding_box
            face_top = int(max(0, bb.ymin * crop_h))
            face_bottom = int(min(crop_h, (bb.ymin + bb.height) * crop_h))
            return face_top, face_bottom, n
    except Exception:
        return None


def crop_to_speaker(img, viewport: dict):
    """Crop to head + 1.5× head height below chin.

    Returns (cropped_img, single_face_found: bool).
    Uses viewport for horizontal bounds and to isolate the speaker, then
    face detection for a precise vertical crop from head-top to chin + 1.5× head height.
    Falls back to the raw viewport crop if face detection fails.
    """
    src_w, src_h = img.size

    cx = viewport['cx']
    cy = viewport['cy']
    w = viewport['w']
    h = viewport['h']

    x1 = int(max(0, (cx - w / 2) * src_w))
    x2 = int(min(src_w, (cx + w / 2) * src_w))

    # Generous vertical window: slightly above the face top, well below for body
    y1 = int(max(0, (cy - h * 0.7) * src_h))
    y2 = int(min(src_h, (cy + h * 2.0) * src_h))

    initial_crop = img.crop((x1, y1, x2, y2))
    crop_w, crop_h = initial_crop.size

    bbox = _detect_face_bbox(initial_crop)

    if bbox is not None:
        face_top, face_bottom, n_faces = bbox
        if n_faces != 1:
            return initial_crop, False
        head_h = face_bottom - face_top
        new_top = max(0, face_top - int(0.7 * head_h))
        new_bottom = min(crop_h, face_bottom + int(1.5 * head_h))
        return initial_crop.crop((0, new_top, crop_w, new_bottom)), True

    # Fallback: use raw viewport crop (detection unavailable)
    vp_y1 = int(max(0, (cy - h / 2) * src_h))
    vp_y2 = int(min(src_h, (cy + h / 2) * src_h))
    return img.crop((x1, vp_y1, x2, vp_y2)), True


# ── Main extraction ────────────────────────────────────────────────────────────

def get_all_angle_videos(camera_profiles: dict, default_video: str) -> List[tuple]:
    """Get all available angle videos from camera profiles.

    Returns list of (video_path, angle_name, angle_config) tuples.
    """
    angles = camera_profiles.get('angles', {})
    if not angles:
        # Single angle fallback
        return [(default_video, 'angle1', {})]

    result = []
    for angle_name, angle_config in angles.items():
        video_src = angle_config.get('videoSrc')
        if video_src:
            video_path = os.path.join('public', video_src)
            result.append((video_path, angle_name, angle_config))

    # If no angles configured, use default
    if not result:
        return [(default_video, 'angle1', {})]

    return result


def get_speaker_profile(speaker: str, camera_profiles: dict, angle_name: str):
    """Get speaker profile, trying angle-specific first then generic."""
    speakers_config = camera_profiles.get('speakers', {})

    # Try angle-specific key first
    angle_key = f"{speaker}:{angle_name}"
    if angle_key in speakers_config:
        return speakers_config[angle_key]

    # Try generic key
    if speaker in speakers_config:
        return speakers_config[speaker]

    # Search for any key starting with speaker name
    for key, profile in speakers_config.items():
        if key.startswith(f"{speaker}:") or key == speaker:
            return profile

    return None


def process_speaker_angle(
    speaker: str,
    angle_name: str,
    angle_video_path: str,
    transcript: dict,
    camera_profiles: dict,
    is_hdr: bool,
    output_dir: str,
    num_candidates: int,
    global_index_start: int = 0,
) -> List[Dict[str, Any]]:
    """Extract candidates from a single angle for a speaker."""
    from PIL import Image

    speaker_profile = get_speaker_profile(speaker, camera_profiles, angle_name)

    if not speaker_profile:
        sys.stderr.write(f'  No camera profile for {speaker} on {angle_name} — skipping angle\n')
        return []

    viewport = speaker_profile.get('closeupViewport')
    if not viewport:
        sys.stderr.write(f'  No closeupViewport for {speaker} on {angle_name} — skipping angle\n')
        return []

    timestamps = get_candidate_timestamps(transcript, speaker, num_candidates)
    if not timestamps:
        sys.stderr.write(f'  No speaking segments for {speaker} on {angle_name}\n')
        return []

    print(f'  Sampling from {angle_name}...')

    candidates = []
    with tempfile.TemporaryDirectory() as tmp_dir:
        for i, ts in enumerate(timestamps):
            global_idx = global_index_start + i
            frame_path = os.path.join(tmp_dir, f'{speaker.lower()}_{angle_name}_{i}.jpg')

            if not extract_frame(angle_video_path, ts, frame_path, is_hdr):
                sys.stderr.write(f'    Frame extraction failed at {ts:.2f}s\n')
                continue

            try:
                img = Image.open(frame_path)
            except Exception as e:
                sys.stderr.write(f'    Could not open frame at {ts:.2f}s: {e}\n')
                continue

            vp = find_viewport_at_time(speaker_profile, ts) or viewport
            crop, face_detected = crop_to_speaker(img, vp)

            if not face_detected:
                sys.stderr.write(f'    Frame at {ts:.2f}s: multiple/no faces — skipping\n')
                continue

            # Save candidate preview
            preview_filename = f'{speaker.lower()}_candidate_{global_idx}_{angle_name}.png'
            preview_path = os.path.join(output_dir, preview_filename)
            crop.save(preview_path, 'PNG')

            candidates.append({
                'index': global_idx,
                'timestamp': round(ts, 3),
                'angle': angle_name,
                'previewPath': f'thumbnail/candidates/{preview_filename}',
            })
            print(f'    [{global_idx}] {angle_name}: t={ts:.2f}s')

    return candidates


def process_speaker(
    speaker: str,
    transcript: dict,
    camera_profiles: dict,
    default_video_path: str,
    is_hdr: bool,
    output_dir: str,
    num_candidates: int = 6,
) -> Optional[Dict[str, Any]]:
    """Extract candidates from ALL angles for a speaker."""

    # Get all available angles
    angle_videos = get_all_angle_videos(camera_profiles, default_video_path)

    print(f'\n[{speaker}]')
    print(f'  Extracting from {len(angle_videos)} angle(s)...')

    all_candidates = []
    global_index = 0

    for video_path, angle_name, angle_config in angle_videos:
        # Check if HDR for this specific video
        angle_hdr = detect_hdr(video_path) if os.path.exists(video_path) else is_hdr

        angle_candidates = process_speaker_angle(
            speaker, angle_name, video_path,
            transcript, camera_profiles,
            angle_hdr, output_dir, num_candidates,
            global_index
        )

        all_candidates.extend(angle_candidates)
        global_index += num_candidates

    if not all_candidates:
        sys.stderr.write(f'  No valid frames for {speaker} from any angle\n')
        return None

    return {
        'speaker': speaker,
        'candidates': all_candidates,
    }


# ── Main ───────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description='Extract candidate speaker frames for thumbnail selection')
    p.add_argument('--transcript', required=True, help='Path to transcript.json')
    p.add_argument('--camera-profiles', required=True, help='Path to camera-profiles.json')
    p.add_argument('--video', required=True, help='Path to video file')
    p.add_argument('--output-dir', required=True, help='Directory to save candidate previews')
    p.add_argument('--num-candidates', type=int, default=6, help='Number of candidate frames per speaker')
    p.add_argument('--speakers', nargs='+', help='Specific speakers to process (default: all in transcript)')
    return p.parse_args()


def main():
    args = parse_args()

    # Load inputs
    with open(args.transcript, 'r') as f:
        transcript = json.load(f)
    with open(args.camera_profiles, 'r') as f:
        camera_profiles = json.load(f)

    # Determine speakers
    if args.speakers:
        speakers = args.speakers
    else:
        segments = transcript.get('segments', [])
        speakers = sorted(set(s.get('speaker') for s in segments if s.get('speaker')))

    if not speakers:
        sys.stderr.write('No speakers found\n')
        sys.exit(1)

    print(f'Extracting {args.num_candidates} candidate frames per speaker...')
    print(f'Speakers: {", ".join(speakers)}')

    os.makedirs(args.output_dir, exist_ok=True)

    is_hdr = detect_hdr(args.video)
    if is_hdr:
        print('HDR video detected — applying tonemapping')

    results = []
    for speaker in speakers:
        print(f'\n[{speaker}]')
        result = process_speaker(
            speaker, transcript, camera_profiles, args.video,
            is_hdr, args.output_dir, args.num_candidates
        )
        if result:
            results.append(result)

    # Write candidates manifest
    manifest_path = os.path.join(args.output_dir, 'candidates.json')
    with open(manifest_path, 'w') as f:
        json.dump({'speakers': results}, f, indent=2)

    print(f'\n✓ Candidates manifest written: {manifest_path}')
    print('Run the selection script to choose preferred frames:')
    print(f'  npm run thumbnail:frames:select')


if __name__ == '__main__':
    main()
