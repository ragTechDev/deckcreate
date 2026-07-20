# rust-decode-spike

Two standalone Rust binaries answering issue #108: does `ffmpeg-the-third` or `gstreamer-rs`
decode-and-seek a real `.mp4` frame-accurately, and can each reach hardware codec paths
(VideoToolbox on Mac, NVENC/NVDEC on Windows+NVIDIA) without extra shims?

> **Temporary** — this crate lives under `spike/` and will be deleted when the spike concludes.
> See [issue #108](https://github.com/ragTechDev/deckcreate/issues/108) and `FINDINGS.md`.

Real results for **Mac M3** are already in `FINDINGS.md`. If you're on a **Mac M2** or a
**Windows machine with an NVIDIA GPU**, this is where you fill in the remaining rows — please
paste your output into `FINDINGS.md` (or a comment on #108) rather than just reporting pass/fail.

## Prerequisites

Rust stable toolchain via `rustup` (skip if you already have it):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version   # e.g. rustc 1.97.0
cargo --version
```

### macOS

```bash
brew install pkgconf ffmpeg gstreamer
```

(As of this writing, Homebrew's `gstreamer` formula bundles all `gst-plugins-*` into one ~217 MB
install — you do not need to separately install `gst-plugins-base`/`-good`/`-bad`.)

### Windows + NVIDIA

Not verified from this branch. You will need:
- FFmpeg dev libraries + `pkg-config` (e.g. via [vcpkg](https://vcpkg.io) or the
  [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) shared build) for the `ffmpeg-candidate`.
- GStreamer's official Windows installer (development package) for the `gstreamer-candidate`,
  including the `nvcodec` plugin (ships with the standard GStreamer Windows installer on machines
  with the NVIDIA Video Codec SDK runtime present).
- An NVIDIA GPU with current drivers for the `--hw` / `vtdec_hw`-equivalent path — see the TODOs
  in each candidate's `main.rs` for where the NVDEC/`nvh264dec` code needs to be added; it is not
  implemented in this branch because it cannot be verified on Mac hardware.

Document exactly what you had to install and any friction in `FINDINGS.md` — that's as much a
part of criterion #3 (build complexity) as whether it compiles.

## Fixtures

`fixtures/test-clip.mp4` (320×240, ~3s, H.264, committed) plus two reference RGB24 frames in
`fixtures/reference/` at t=0.5s and t=1.5s, extracted via the `ffmpeg` CLI at exact frame indices.
Regenerate with `./fixtures/generate_fixtures.sh` if needed (requires the `ffmpeg` CLI) — the
content is deterministic (`testsrc2` pattern), so a regenerated clip should still match.

## Run

Both candidates share the same CLI shape:

```
<binary> <clip.mp4> <timestamp_secs> <reference.ppm> [--hw]
```

```bash
# ffmpeg-the-third — software, then VideoToolbox/NVDEC hardware
cargo run --manifest-path ffmpeg-candidate/Cargo.toml -- \
  fixtures/test-clip.mp4 1.5 fixtures/reference/frame_at_1.5s.ppm
cargo run --manifest-path ffmpeg-candidate/Cargo.toml -- \
  fixtures/test-clip.mp4 1.5 fixtures/reference/frame_at_1.5s.ppm --hw

# gstreamer-rs — software, then VideoToolbox/NVDEC hardware
cargo run --manifest-path gstreamer-candidate/Cargo.toml -- \
  fixtures/test-clip.mp4 1.5 fixtures/reference/frame_at_1.5s.ppm
cargo run --manifest-path gstreamer-candidate/Cargo.toml -- \
  fixtures/test-clip.mp4 1.5 fixtures/reference/frame_at_1.5s.ppm --hw
```

Repeat with `fixtures/reference/frame_at_0.5s.ppm` and `0.5` for the second data point. Each run
prints `HARDWARE PATH: active/inactive` (when `--hw` is passed) and a final
`mean_abs_diff=... max_abs_diff=... -> PASS/FAIL` line — paste both lines into `FINDINGS.md`.

## Unit tests

```bash
cargo test --manifest-path ffmpeg-candidate/Cargo.toml
cargo test --manifest-path gstreamer-candidate/Cargo.toml
```

These only cover the pure PPM/pixel-compare helpers, not the decode paths themselves — the decode
paths are exercised end-to-end by the `cargo run` commands above against the committed fixtures,
which is the actual criteria-answering evidence for this spike.

## Layout

| Path | Purpose |
|---|---|
| `ffmpeg-candidate/` | Standalone crate, `ffmpeg-the-third` binding |
| `gstreamer-candidate/` | Standalone crate, `gstreamer-rs` binding |
| `fixtures/` | Committed test clip + reference frames (shared by both candidates) |
| `FINDINGS.md` | The actual deliverable — evaluation-criteria results per platform |

Each candidate is a fully independent `Cargo.toml` (no shared workspace), so you can build/run one
without the other's system dependencies installed.
