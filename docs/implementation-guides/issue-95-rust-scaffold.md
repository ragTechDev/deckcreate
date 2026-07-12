# Issue #95 — spike(rust/scaffold): create spike/audio-sync Cargo binary crate

## Goal

Create a minimal, buildable Cargo binary crate at `spike/audio-sync/` as a clean skeleton for subsequent Rust spike issues (#96, #97, #98). No algorithm logic — stubs only.

## Steps

### Step 1 — Create Cargo.toml

Create `spike/audio-sync/Cargo.toml` as a standalone manifest (no workspace).

**Status check:** `test -f spike/audio-sync/Cargo.toml`

### Step 2 — Create src/main.rs and src/lib.rs stubs

Create `spike/audio-sync/src/main.rs` with stub `main()` and `spike/audio-sync/src/lib.rs` as an empty file.

**Status check:** `test -f spike/audio-sync/src/main.rs && test -f spike/audio-sync/src/lib.rs`

### Step 3 — Add spike/audio-sync/target/ to .gitignore

Append `spike/audio-sync/target/` to the root `.gitignore` so build artifacts are not tracked.

**Status check:** `grep -q 'spike/audio-sync/target/' .gitignore`

### Step 4 — Add spike/audio-sync/README.md

Create setup and usage instructions for peers who need to install Rust.

**Status check:** `test -f spike/audio-sync/README.md`

### Step 5 — Verify build

Run `cargo build --manifest-path spike/audio-sync/Cargo.toml` and confirm exit 0.

**Status check:** `cargo build --manifest-path spike/audio-sync/Cargo.toml && echo OK`

### Step 6 — Commit

Commit `Cargo.toml`, `Cargo.lock`, `src/main.rs`, `src/lib.rs`, `README.md`, and `.gitignore` change.

**Status check:** `git log --oneline -1 | grep -q 'spike(rust/scaffold)'`

## Out of scope

- Any algorithm logic
- Root-level `Cargo.toml` workspace
- CI configuration
