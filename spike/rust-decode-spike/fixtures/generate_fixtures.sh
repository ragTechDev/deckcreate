#!/usr/bin/env bash
# Regenerates test-clip.mp4 and the reference PPM frames used by both spike candidates.
# Requires the `ffmpeg` CLI. Deterministic: testsrc2 content at a given frame index is
# reproducible across machines/ffmpeg versions, so re-running this should reproduce
# byte-identical fixtures (verify with `shasum` before committing a regenerated fixture).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$DIR"
REF="$OUT/reference"
mkdir -p "$REF"

FPS=30
DURATION=3
WIDTH=320
HEIGHT=240
GOP=15 # smaller than the clip length so seeking to 0.5s/1.5s is not itself a keyframe

echo "Generating $OUT/test-clip.mp4 (${WIDTH}x${HEIGHT} @ ${FPS}fps, ${DURATION}s, GOP=${GOP})..."
ffmpeg -y -f lavfi -i "testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${DURATION}" \
  -pix_fmt yuv420p -c:v libx264 -g "$GOP" -an \
  "$OUT/test-clip.mp4"

# Frame 15 (t=0.5s) and frame 45 (t=1.5s) at 30fps. -vsync 0 + select=eq(n,N) pulls an exact
# frame index instead of relying on -ss seek behavior, so this is the ground truth regardless
# of how any given decoder's seek implementation rounds.
for pair in "15:0.5s" "45:1.5s"; do
  frame="${pair%%:*}"
  label="${pair##*:}"
  echo "Extracting frame ${frame} (t=${label}) -> reference/frame_at_${label}.ppm"
  ffmpeg -y -i "$OUT/test-clip.mp4" \
    -vf "select='eq(n\,${frame})'" -fps_mode passthrough -pix_fmt rgb24 -frames:v 1 -update 1 \
    "$REF/frame_at_${label}.ppm"
done

echo "Done. Fixture files:"
ls -la "$OUT/test-clip.mp4" "$REF"
