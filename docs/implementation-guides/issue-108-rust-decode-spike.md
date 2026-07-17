# Issue #108 — spike(rust/decode): FFmpeg vs gstreamer-rs binding decision

## Goal

Build the minimal Rust harness at `spike/rust-decode-spike/` needed to answer the five evaluation
criteria in [issue #108](https://github.com/ragTechDev/deckcreate/issues/108): can `ffmpeg-the-third`
or `gstreamer-rs` reach hardware codec paths (VideoToolbox / NVENC/NVDEC), decode frame-accurately,
build cleanly cross-platform, and (for GStreamer) avoid proprietary-codec redistribution risk.

Not a working compositor — two standalone binary crates (one per candidate), a committed test
fixture, and a `FINDINGS.md` that gets filled in as results land from each platform. This machine
is an Apple M3, so the Mac/VideoToolbox rows get real results in this branch. Mac M2 and
Windows/NVIDIA rows are scaffolded and stay open for the contributors who own that hardware to fill
in via the PR.

Follows the established spike convention from #93–#99 (`spike/<name>/`, standalone `Cargo.toml`
per crate, no root-level workspace, `spike(rust/<scope>):` commit prefix).

## Steps

### Step 1 — Scaffold layout, fixtures, and .gitignore

Create `spike/rust-decode-spike/` with:
- `fixtures/generate_fixtures.sh` — regenerates the test clip and reference frames deterministically
  via the `ffmpeg` CLI (`testsrc2` pattern, so pixel content per frame is reproducible).
- `fixtures/test-clip.mp4` — small (320×240, ~3s, H.264) committed fixture.
- `fixtures/reference/*.ppm` — one or two reference frames (raw RGB24 PPM) extracted at known
  timestamps, used as ground truth for the pixel-accuracy check.
- Append `spike/rust-decode-spike/*/target/` to the root `.gitignore`.

**Status check:** `test -f spike/rust-decode-spike/fixtures/test-clip.mp4 && grep -q 'spike/rust-decode-spike' .gitignore`

### Step 2 — ffmpeg-the-third candidate: software decode, seek, pixel verify

Create `spike/rust-decode-spike/ffmpeg-candidate/` (standalone `Cargo.toml`, depends on
`ffmpeg-the-third`). CLI: `ffmpeg-candidate <clip> <timestamp_secs> <reference.ppm> [--hw]`.
Software path: open input, seek near the target timestamp, decode forward to the exact frame,
convert to RGB24 via the software scaler, compare against the reference PPM (mean/max abs diff),
print PASS/FAIL.

**Status check:** `cargo run --manifest-path spike/rust-decode-spike/ffmpeg-candidate/Cargo.toml -- spike/rust-decode-spike/fixtures/test-clip.mp4 1.5 spike/rust-decode-spike/fixtures/reference/frame_at_1.5s.ppm | grep -q PASS`

### Step 3 — ffmpeg-the-third candidate: VideoToolbox hardware path

Add the `--hw` path: raw FFI through `ffmpeg_the_third::sys` to set `hw_device_ctx`
(`av_hwdevice_ctx_create` with `AVHWDeviceType::VIDEOTOOLBOX`) and a `get_format` callback on the
decoder's `AVCodecContext`, then `av_hwframe_transfer_data` to copy each decoded frame back to a
software `nv12` buffer before the same RGB24 compare. No high-level wrapper exists for this in the
crate — document exactly how much unsafe code this requires (this is the "without extra shims"
answer for criterion #1).

**Status check:** `cargo run --manifest-path spike/rust-decode-spike/ffmpeg-candidate/Cargo.toml -- spike/rust-decode-spike/fixtures/test-clip.mp4 1.5 spike/rust-decode-spike/fixtures/reference/frame_at_1.5s.ppm --hw | grep -q "HARDWARE PATH: active"`

### Step 4 — gstreamer-rs candidate: decode, seek, pixel verify (software + VideoToolbox)

Create `spike/rust-decode-spike/gstreamer-candidate/` (standalone `Cargo.toml`, depends on
`gstreamer`, `gstreamer-app`, `gstreamer-video`). CLI mirrors the ffmpeg candidate. Software path
uses `decodebin`; hardware path pins the pipeline to the `vtdec_hw` element (hardware-only —
pipeline fails fast if VideoToolbox isn't actually engaged, which is itself the criterion #1
answer for this candidate). Pull the frame via `appsink`, compare against the same reference PPM.
Scaffold (but do not require passing) a Windows branch using `nvh264dec`/`nvdec` element names
behind a comment, for the NVIDIA contributor to complete.

**Status check:** `cargo run --manifest-path spike/rust-decode-spike/gstreamer-candidate/Cargo.toml -- spike/rust-decode-spike/fixtures/test-clip.mp4 1.5 spike/rust-decode-spike/fixtures/reference/frame_at_1.5s.ppm --hw | grep -q PASS`

### Step 5 — FINDINGS.md and contributor README

Write `spike/rust-decode-spike/FINDINGS.md` covering all five evaluation criteria, with real
results filled in for Mac M3 (this machine) and open template rows for Mac M2 / Windows+NVIDIA.
Include the GStreamer plugin licensing research for criterion #5 (which plugin ships which codec,
under what license). Write `spike/rust-decode-spike/README.md` with exact per-platform setup +
run commands for the contributors who'll fill in the remaining rows.

**Status check:** `test -f spike/rust-decode-spike/FINDINGS.md && grep -q "Mac M2" spike/rust-decode-spike/FINDINGS.md && grep -q "Windows" spike/rust-decode-spike/FINDINGS.md`

### Step 6 — Update CLAUDE.md

Add a one-line pointer to the spike under a relevant section (Refactor Plan) so future agents know
it exists and where.

**Status check:** `grep -q 'rust-decode-spike' CLAUDE.md`

## Out of scope

- A working compositor or any production integration
- Full verification on Mac M2 or Windows/NVIDIA hardware (scaffolded for contributors, not run here)
- `ac-ffmpeg` or `ffmpeg-next` fallback candidates (only pursued if `ffmpeg-the-third` fails)
- The CLI-subprocess (`ffmpeg-sidecar`) alternative — explicitly deferred per issue #108
- Any change to files outside `spike/rust-decode-spike/`, `CLAUDE.md`, and `.gitignore`
