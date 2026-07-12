# audio-sync spike

Standalone Rust binary for FFT cross-correlation sync. Part of the RFC 0001 Rust rewrite spike (see [issue #93](https://github.com/ragTechDev/deckcreate/issues/93)).

> **Temporary** — this crate lives under `spike/` and will be deleted when the spike concludes.

## Prerequisites

Rust stable toolchain via `rustup`:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Then restart your shell (or run `source "$HOME/.cargo/env"`), and verify:

```bash
rustc --version   # e.g. rustc 1.79.0
cargo --version
```

No other dependencies — `rustfft` and `hound` are pure Rust and compile without any system libraries.

## Build

From the repo root:

```bash
cargo build --manifest-path spike/audio-sync/Cargo.toml
```

Or from inside the crate:

```bash
cd spike/audio-sync
cargo build
```

## Run

```bash
cargo run --manifest-path spike/audio-sync/Cargo.toml
# → audio-sync spike — not yet implemented
```

## Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `rustfft` | 6 | Pure-Rust FFT (no native deps, deterministic across platforms) |
| `hound` | 3 | WAV file reader/writer |

## Fixtures

Test WAV files are in `fixtures/`:

| File | Description |
|------|-------------|
| `fixtures/audio-track.wav` | Isolated audio track |
| `fixtures/video-audio.wav` | Audio extracted from video |
| `fixtures/baseline.json` | JS baseline offset for cross-validation |
