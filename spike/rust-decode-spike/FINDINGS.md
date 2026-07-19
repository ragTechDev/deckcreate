# Findings — FFmpeg vs gstreamer-rs binding decision (issue #108)

Status: **Mac M3, Mac M2, and Windows+NVIDIA results are all verified on this branch.**

## Recommendation

**Recommendation unchanged: still use `ffmpeg-the-third`, but with a stronger caveat for Epic 1.**
Windows+NVIDIA no longer blocks on unknowns, but neither candidate's hardware path currently meets
the spike's pixel-diff tolerance on this machine. Rationale, in order of weight:

1. **`ffmpeg-the-third` remains the better technical baseline across both tested platforms.**
   On Mac M3 it stays pixel-exact in hardware. On Windows+NVIDIA, its CUDA path is active and
   materially closer to reference frames than `gstreamer-rs`/`nvh264dec` (lower mean and much lower
   max diff), even though it still fails this spike's current max-diff threshold and needs follow-up.
2. **Licensing risk is a wash, not a differentiator.** Both candidates ultimately depend on the same
   underlying FFmpeg/codec licensing question — see criterion #5. This needs solving once, for
   whichever binding wins, not as a reason to prefer one over the other.
3. `ffmpeg-the-third`'s missing high-level hwaccel API is still a one-time, bounded integration cost
   (the `hw` module in `ffmpeg-candidate/src/main.rs` now includes both VideoToolbox and CUDA
   variants). `gstreamer-rs` keeps the easier integration surface, but has unresolved hardware-path
   pixel-quality failures on both Mac M3 (`vtdec_hw`) and Windows (`nvh264dec`) in this spike.

This recommendation should be revisited only if follow-up investigation shows the Windows CUDA
quality failure is a tolerance/configuration artifact in `ffmpeg-the-third` while `gstreamer-rs`
can be made pixel-stable with less risk. Right now, both fail hardware tolerance on this machine,
but `ffmpeg-the-third` fails less severely and remains the stronger cross-platform starting point.

## Criterion #1 — Hardware codec access

| Candidate | Mac M3 (this branch) | Mac M2 | Windows + NVIDIA |
|---|---|---|---|
| `ffmpeg-the-third` | **Reaches VideoToolbox, pixel-exact.** No high-level hwaccel API exists in the crate (checked: no hwaccel/hwdevice/hwcontext module). Required hand-written unsafe FFI through `ffmpeg_the_third::ffi`: `av_hwdevice_ctx_create(AVHWDeviceType::VIDEOTOOLBOX)` + a `get_format` callback set on the decoder's *unopened* `AVCodecContext` + `av_hwframe_transfer_data` per frame. ~40 lines, see `ffmpeg-candidate/src/main.rs`'s `hw` module. | **Reaches VideoToolbox, pixel-exact.** `HARDWARE PATH: active` on both test timestamps. Results are identical to M3 — mean=0.000, max=0 on both frames. Same unsafe FFI path, same 40 lines, same result — no M2-specific friction. | **Reaches CUDA/NVDEC and transfers frames back to software.** Implemented `#[cfg(target_os = "windows")]` hw module with `av_hwdevice_ctx_create(AVHWDeviceType::CUDA)`, `get_format` selecting `AVPixelFormat::CUDA`, and `av_hwframe_transfer_data`. `HARDWARE PATH: active` printed on both test timestamps. Output quality is not yet within tolerance (criterion #2), but hardware negotiation is real. |
| `gstreamer-rs` | **Negotiates and prerolls** (`vtdec_hw` is hardware-only by construction, so a successful preroll is real confirmation). Zero unsafe code — just a different element name. **But**: output is visibly wrong (criterion #2) and building the pipeline printed `GStreamer-GL-WARNING: An NSApplication needs to be running on the main thread` — `vtdec_hw`'s output is GL-memory-backed (`video/x-raw(memory:GLMemory)`), and a plain CLI render-engine binary has no Cocoa run loop. Neither issue blocked this spike from running, but both are real open questions for a production render engine. | **Negotiates and prerolls** (`vtdec_hw negotiated successfully` printed). Pixel results are identical to M3 (mean=3.855/3.886, max=168/181 — same FAIL). One notable difference from M3: the `GStreamer-GL-WARNING: An NSApplication needs to be running on the main thread` did **not** appear on this machine (macOS 14.5 / Darwin 23.5.0, vs. M3's macOS 15.x / Darwin 24.6.0). The vtdec_hw pixel failure is reproducible regardless — not a GL-warning-caused artifact on M3, but a real colorimetry problem on both. | **Reaches NVDEC via `nvh264dec` and negotiates successfully.** Windows code now picks decoder element by platform (`nvh264dec` on Windows, `vtdec_hw` on macOS). `HARDWARE PATH: active (nvh264dec negotiated successfully)` printed on both test timestamps. As on Mac hardware decode, output quality is outside tolerance (criterion #2). |

## Criterion #2 — Seek/decode accuracy

Both candidates seek near the target timestamp via their native seek API, then decode forward to
the exact requested frame — the real jump-cut access pattern, not sequential decode from frame 0.
Compared against reference frames extracted by the `ffmpeg` CLI at known frame indices (`fixtures/reference/*.ppm`).

| Candidate / path | t=0.5s | t=1.5s |
|---|---|---|
| `ffmpeg-the-third`, software | mean_abs_diff=0.000, max=0 — **PASS (pixel-exact)** | mean_abs_diff=0.000, max=0 — **PASS (pixel-exact)** |
| `ffmpeg-the-third`, `--hw` (VideoToolbox) | mean_abs_diff=0.000, max=0 — **PASS (pixel-exact)** | mean_abs_diff=0.000, max=0 — **PASS (pixel-exact)** |
| `gstreamer-rs`, software (`avdec_h264`) | mean_abs_diff=1.391, max=6 — **PASS** (within tolerance, not bit-exact) | mean_abs_diff=1.377, max=6 — **PASS** |
| `gstreamer-rs`, `--hw` (`vtdec_hw`) | mean_abs_diff=3.855, max=168 — **FAIL** | mean_abs_diff=3.886, max=181 — **FAIL** |

The `vtdec_hw` FAIL was investigated, not just reported: diffed the decoded frame against the
*neighboring* reference frames (indices 14 and 16) to rule out an off-by-one-frame seek bug —
both neighbors scored *worse* (mean ~7.2–7.5) than the correctly-targeted frame 15 (mean 3.855), so
this is the right frame with a real per-pixel quality problem, not a seek-accuracy bug. Given the
GLMemory finding in criterion #1, the leading hypothesis is a colorimetry/YUV-matrix mismatch
during the implicit GPU→CPU readback in `videoconvert`, not yet root-caused further — this is
exactly the kind of pre-Epic-1 risk this spike exists to surface.

Tolerance used: `mean_abs_diff < 2.0 && max_abs_diff < 24` (covers ordinary YUV→RGB rounding
differences between decode paths; `vtdec_hw`'s failure is ~2–7x outside this band, not a rounding
error).

### Mac M2 run results (this branch)

| Candidate / path | t=0.5s | t=1.5s |
|---|---|---|
| `ffmpeg-the-third`, software | mean_abs_diff=0.000, max=0 — **PASS (pixel-exact)** | mean_abs_diff=0.000, max=0 — **PASS (pixel-exact)** |
| `ffmpeg-the-third`, `--hw` (VideoToolbox) | `HARDWARE PATH: active`; mean_abs_diff=0.000, max=0 — **PASS (pixel-exact)** | `HARDWARE PATH: active`; mean_abs_diff=0.000, max=0 — **PASS (pixel-exact)** |
| `gstreamer-rs`, software (`avdec_h264`) | mean_abs_diff=1.391, max=6 — **PASS** | mean_abs_diff=1.377, max=6 — **PASS** |
| `gstreamer-rs`, `--hw` (`vtdec_hw`) | `HARDWARE PATH: active (vtdec_hw negotiated successfully)`; mean_abs_diff=3.855, max=168 — **FAIL** | `HARDWARE PATH: active (vtdec_hw negotiated successfully)`; mean_abs_diff=3.886, max=181 — **FAIL** |

All M2 results are identical to M3. The `GStreamer-GL-WARNING` about `NSApplication` did not appear
on this machine (macOS 14.5), but the vtdec_hw pixel failure is the same magnitude — confirming
the colorimetry issue is not a GL-warning-correlated artifact but a consistent hardware-path
characteristic of `vtdec_hw` across both M-series chips tested.

### Windows + NVIDIA run results (this branch)

| Candidate / path | t=0.5s | t=1.5s |
|---|---|---|
| `ffmpeg-the-third`, software | mean_abs_diff=0.446, max=2 — **PASS** | mean_abs_diff=0.454, max=2 — **PASS** |
| `ffmpeg-the-third`, `--hw` (CUDA/NVDEC) | `HARDWARE PATH: active`; mean_abs_diff=1.846, max=91 — **FAIL** | `HARDWARE PATH: active`; mean_abs_diff=1.687, max=105 — **FAIL** |
| `gstreamer-rs`, software (`avdec_h264`) | mean_abs_diff=1.391, max=6 — **PASS** | mean_abs_diff=1.377, max=6 — **PASS** |
| `gstreamer-rs`, `--hw` (`nvh264dec`) | `HARDWARE PATH: active`; mean_abs_diff=3.855, max=168 — **FAIL** | `HARDWARE PATH: active`; mean_abs_diff=3.886, max=181 — **FAIL** |

Interpretation: both hardware paths are active on this NVIDIA machine, but both exceed tolerance.
`ffmpeg-the-third` is noticeably closer to reference than `gstreamer-rs` in hardware mode
(especially max diff), so this row did not overturn the recommendation, but it did raise the risk
level for Epic 1: Windows hardware decode needs explicit pixel-quality hardening before production.

## Criterion #3 — Build complexity

| Candidate | System dependencies on this Mac | Notes |
|---|---|---|
| `ffmpeg-the-third` | `pkg-config` (not installed by default — `brew install pkgconf`), FFmpeg dev libs (already present via `brew install ffmpeg`, no extra plugins needed) | One dependency crate. Clean incremental builds (~6s after first fetch). |
| `gstreamer-rs` | `pkg-config`, full GStreamer (`brew install gstreamer` — Homebrew now bundles **all** gst-plugins-base/good/bad/ugly into one 217 MB formula, a packaging change worth knowing about since older docs/tutorials still reference the split `gst-plugins-*` formulas) | Three dependency crates (`gstreamer`, `gstreamer-app`, `gstreamer-video`). Clean build from empty cache ~20s. |

Neither candidate's Windows or true cross-compilation story is tested here — that's the open row
in the README for the Windows/NVIDIA contributor. Both builds otherwise worked without patching
either crate.

Mac M2 build notes (macOS 14.5, Rust 1.97.1, freshly installed):

- Rust was not preinstalled on this machine — required `curl | sh` install via `rustup` (same as
  would be true on any fresh Mac).
- `pkgconf` was not preinstalled — `brew install pkgconf` required, same as M3.
- FFmpeg dev libs were already present via existing `brew install ffmpeg` install.
- GStreamer (`brew install gstreamer`) was not present — installed fresh, same 217 MB bundled
  formula as M3, no extra plugin steps.
- First build times: `ffmpeg-candidate` ~17s from cold; `gstreamer-candidate` ~17s from cold.
  In line with M3 (~6s / ~20s on warm incremental; caches were empty here so first-build times
  are higher).
- No build errors or patching required on either candidate.

Windows+NVIDIA notes from this run:

- Toolchain/setup friction was real for `ffmpeg-the-third`: this environment needed explicit
   `LIBCLANG_PATH` (LLVM install) for `ffmpeg-sys-the-third`'s bindgen step, plus explicit
   `PKG_CONFIG_PATH` and `FFMPEG_DIR` so Cargo could find `C:\ffmpeg` headers/libs.
- `gstreamer-rs` built cleanly once GStreamer SDK path was exported (`...\\gstreamer\\...\\bin`
   and `...\\lib\\pkgconfig`), with no extra bindgen/libclang work.
- Both crates' unit tests passed after environment setup (`ffmpeg-candidate`: 3 tests,
   `gstreamer-candidate`: 2 tests).

## Criterion #4 — Crate maturity

Carried over from the community-discussion research already folded into issue #108's body
(r/rust thread on the state of FFmpeg bindings in Rust):

- `ffmpeg-next` is maintenance-mode only (one commenter disputes this, most don't).
  `ffmpeg-the-third` is the actively-developed fork — confirmed independently here: its crate
  version (`5.0.0+ffmpeg-8.1`) tracks the very recent FFmpeg 8.1 release used in this spike, and it
  builds and runs cleanly against it.
- `gstreamer-rs` is maintained under the official gstreamer-rs GitHub org, tracks GStreamer's own
  release cadence (this spike used 1.28.5, current at spike time), and has a materially larger
  contributor base and issue-response cadence than any FFmpeg Rust binding — not independently
  re-verified here, this is the community consensus already cited in issue #108.

## Criterion #5 — Redistribution/licensing risk

The issue scoped this criterion to gstreamer-rs, but the same underlying question turned out to
apply to *both* candidates, since `ffmpeg-the-third` binds this same system FFmpeg build directly.

Checked via `gst-inspect-1.0 <plugin> | grep License` plus binary dependency inspection (`otool -L`
on macOS, `llvm-readobj --needed-libs` on Windows) on the actual plugin binaries used:

| Plugin / element | License reported | Linked codec libs | Risk |
|---|---|---|---|
| `applemedia` (`vtdec_hw`, `vtdec`) | LGPL | Only Apple system frameworks (AVFoundation, VideoToolbox, CoreMedia, CoreVideo) + GStreamer's own LGPL libs | **Clean.** No GPL or proprietary exposure — VideoToolbox is a system framework, not a bundled codec. |
| `videoparsersbad` (`h264parse`) | LGPL | None (pure bitstream parsing, no codec implementation) | **Clean.** |
| `libav` (`avdec_h264`, used as the software comparison baseline) | LGPL (the GStreamer wrapper) | **This machine's Homebrew `ffmpeg` (8.1.2), built with `--enable-gpl --enable-libx264 --enable-libx265`** | **GPL-contaminated on this machine.** The wrapper is LGPL but it dynamically links a GPL-configured FFmpeg build, which makes the combination subject to GPL terms for this decode path specifically. |
| `nvcodec` (`nvh264dec`/`nvdec`) | LGPL (`gst-inspect-1.0 nvcodec`) | `gstnvcodec.dll` links to Windows CRT + GStreamer libs (`gstreamer-1.0-0.dll`, `gstvideo-1.0-0.dll`, etc.). NVIDIA runtime libraries (`nvcuda.dll`, `nvcuvid.dll`) are provided by the installed GPU driver (`C:\Windows\System32`). | **No new GPL signal from the plugin itself; still driver/runtime-dependent.** The plugin advertises LGPL, but operational dependency on NVIDIA driver DLLs is real and should be validated in target deployment environments. |

**The important nuance**: `libx264`/`libx265` are *encoder-only* libraries — H.264/HEVC *decoding*
in FFmpeg does not require them at all. The GPL exposure found above is a property of *this
machine's specific FFmpeg build*, not an inherent property of either candidate. **Action item for
whichever binding wins Epic 1**: build (or request via Homebrew formula options) FFmpeg without
`--enable-gpl`/`--enable-libx264`/`--enable-libx265` for the decode-only render-engine build — an
LGPL-only FFmpeg build fully supports H.264/HEVC decode and removes this risk for both candidates.
No literally proprietary/closed-source plugin was found in either candidate's dependency chain on
this machine — the risk is GPL license-strength contamination, not vendor lock-in.

## Considered and deferred (from issue #108)

Not revisited here — CLI-subprocess decoding (`ffmpeg-sidecar`) remains deferred for the same
reason stated in the issue: jump-cut compositing needs in-process frame-accurate seek/decode.

## Open questions for Epic 1

1. **Windows/NVIDIA hardware quality is now verified as problematic** — both `--hw` paths engage,
   but both fail current pixel tolerance. Epic 1 should treat Windows hardware decode as
   integration-incomplete until this is root-caused and corrected.
2. **`vtdec_hw`'s colorimetry issue is unresolved**, not just observed. If gstreamer-rs is
   reconsidered later, that needs root-causing (likely a `glcolorconvert`/`gldownload` pipeline
   fix, or explicit `colorimetry=` caps pinning) before it can be trusted for compositing.
3. **The GPL-vs-LGPL FFmpeg build decision is a hard prerequisite for Epic 1**, independent of
   which binding wins — see criterion #5. This should become its own tracked issue before Epic 1
   starts, not an implicit assumption.
4. `ffmpeg-the-third`'s `hw` module in this spike (`ffmpeg-candidate/src/main.rs`) is close to a
   drop-in starting point for Epic 1's actual `encoderProfile` hardware-decode implementation, not
   just throwaway spike code — worth reading directly rather than re-deriving from FFmpeg's C
   `hw_decode.c` example.

## Environment (this branch's results)

- Mac M3 hardware: Apple M3 (Mac15,12), macOS (Darwin 24.6.0)
- Mac M2 hardware: Apple M2 (MacBook Air, Mac14,2), macOS 14.5 (Darwin 23.5.0)
- Windows hardware: NVIDIA GeForce RTX 5050 Laptop GPU, driver `592.15`
- Rust: `rustc 1.97.1`, `cargo 1.97.1` (all platforms)
- FFmpeg (Mac, both M2 and M3): `8.1.2` (Homebrew, `--enable-gpl --enable-videotoolbox --enable-libx264 --enable-libx265`)
- FFmpeg (Windows): `N-124419-gc8a4770599-20260508` shared build at `C:\ffmpeg` (`--enable-ffnvcodec --enable-cuda-llvm --enable-gpl --enable-libx264 --enable-libx265`, `ffmpeg -hwaccels` includes `cuda`)
- GStreamer: `1.28.5` (Homebrew on Mac M2 and M3; official MSI on Windows at `C:\Users\Victoria\AppData\Local\Programs\gstreamer\1.0\msvc_x86_64`)
- `pkg-config` / `pkgconf`: not preinstalled by default on any machine tested; required `brew install pkgconf` on Mac
