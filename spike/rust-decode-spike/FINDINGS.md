# Findings — FFmpeg vs gstreamer-rs binding decision (issue #108)

Status: **Mac results verified on this branch (Apple M3). Mac M2 and Windows/NVIDIA rows are open
for the contributors who own that hardware — see `README.md` for exact run commands.**

## Recommendation

**Use `ffmpeg-the-third`**, contingent on the Windows/NVIDIA row below not turning up a
disqualifying result. Rationale, in order of weight:

1. **Correctness under real testing beat convenience.** `ffmpeg-the-third`'s hardware path required
   writing unsafe FFI glue ourselves, but that glue is now prototyped and it decodes pixel-exact
   frames on real VideoToolbox hardware. `gstreamer-rs`'s hardware path needed zero unsafe code —
   just naming `vtdec_hw` — but produced visibly wrong pixel output in this spike (see criterion
   #1/#2 below) that would need real debugging before it's trustworthy. A harder integration that
   demonstrably works beat an easier one that doesn't, yet.
2. **Licensing risk is a wash, not a differentiator.** Both candidates ultimately depend on the same
   underlying FFmpeg/codec licensing question — see criterion #5. This needs solving once, for
   whichever binding wins, not as a reason to prefer one over the other.
3. `ffmpeg-the-third`'s missing high-level hwaccel API is a one-time, bounded integration cost (the
   `hw` module in `ffmpeg-candidate/src/main.rs` is a ~40-line working reference for Epic 1).
   `gstreamer-rs`'s GL-pipeline colorimetry issue and its macOS main-thread requirement are open
   unknowns of unclear size.

This recommendation should be revisited if the Windows/NVIDIA contributor finds `nvh264dec`
(gstreamer-rs) meaningfully easier or more correct than the raw NVDEC FFI path on that platform —
Mac and Windows don't have to land on the same binding, but a split adds real maintenance cost, so
that bar should be high.

## Criterion #1 — Hardware codec access

| Candidate | Mac M3 (this branch) | Mac M2 | Windows + NVIDIA |
|---|---|---|---|
| `ffmpeg-the-third` | **Reaches VideoToolbox, pixel-exact.** No high-level hwaccel API exists in the crate (checked: no hwaccel/hwdevice/hwcontext module). Required hand-written unsafe FFI through `ffmpeg_the_third::ffi`: `av_hwdevice_ctx_create(AVHWDeviceType::VIDEOTOOLBOX)` + a `get_format` callback set on the decoder's *unopened* `AVCodecContext` + `av_hwframe_transfer_data` per frame. ~40 lines, see `ffmpeg-candidate/src/main.rs`'s `hw` module. | _Open — run `ffmpeg-candidate` with `--hw`, see README_ | _Open — needs a `hw_nvdec` module analogous to `hw::attach_videotoolbox`, swapping `AVHWDeviceType::VIDEOTOOLBOX` for `AVHWDeviceType::CUDA`. Not attempted here; left as a TODO in `main.rs`._ |
| `gstreamer-rs` | **Negotiates and prerolls** (`vtdec_hw` is hardware-only by construction, so a successful preroll is real confirmation). Zero unsafe code — just a different element name. **But**: output is visibly wrong (criterion #2) and building the pipeline printed `GStreamer-GL-WARNING: An NSApplication needs to be running on the main thread` — `vtdec_hw`'s output is GL-memory-backed (`video/x-raw(memory:GLMemory)`), and a plain CLI render-engine binary has no Cocoa run loop. Neither issue blocked this spike from running, but both are real open questions for a production render engine. | _Open_ | _Open — swap `vtdec_hw` for `nvh264dec` (nvcodec plugin, not present in this Mac's GStreamer build — expected, it's NVIDIA-only)._ |

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

## Criterion #3 — Build complexity

| Candidate | System dependencies on this Mac | Notes |
|---|---|---|
| `ffmpeg-the-third` | `pkg-config` (not installed by default — `brew install pkgconf`), FFmpeg dev libs (already present via `brew install ffmpeg`, no extra plugins needed) | One dependency crate. Clean incremental builds (~6s after first fetch). |
| `gstreamer-rs` | `pkg-config`, full GStreamer (`brew install gstreamer` — Homebrew now bundles **all** gst-plugins-base/good/bad/ugly into one 217 MB formula, a packaging change worth knowing about since older docs/tutorials still reference the split `gst-plugins-*` formulas) | Three dependency crates (`gstreamer`, `gstreamer-app`, `gstreamer-video`). Clean build from empty cache ~20s. |

Neither candidate's Windows or true cross-compilation story is tested here — that's the open row
in the README for the Windows/NVIDIA contributor. Both builds otherwise worked without patching
either crate.

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

Checked via `gst-inspect-1.0 <plugin> | grep License` and `otool -L` on the actual `.dylib`s used:

| Plugin / element | License reported | Linked codec libs | Risk |
|---|---|---|---|
| `applemedia` (`vtdec_hw`, `vtdec`) | LGPL | Only Apple system frameworks (AVFoundation, VideoToolbox, CoreMedia, CoreVideo) + GStreamer's own LGPL libs | **Clean.** No GPL or proprietary exposure — VideoToolbox is a system framework, not a bundled codec. |
| `videoparsersbad` (`h264parse`) | LGPL | None (pure bitstream parsing, no codec implementation) | **Clean.** |
| `libav` (`avdec_h264`, used as the software comparison baseline) | LGPL (the GStreamer wrapper) | **This machine's Homebrew `ffmpeg` (8.1.2), built with `--enable-gpl --enable-libx264 --enable-libx265`** | **GPL-contaminated on this machine.** The wrapper is LGPL but it dynamically links a GPL-configured FFmpeg build, which makes the combination subject to GPL terms for this decode path specifically. |
| `nvcodec` (`nvh264dec`/`nvdec`) | Not present in this Mac build (NVIDIA-only plugin, expected) | — | _Open — Windows contributor should run the same `gst-inspect-1.0 nvcodec` + `otool`/`ldd` check on that machine._ |

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

1. **Windows/NVIDIA row is unverified** — both candidates need `--hw`/`nvh264dec` runs on real
   NVIDIA hardware before this recommendation is fully load-bearing across the target matrix.
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

- Hardware: Apple M3 (Mac15,12), macOS (Darwin 24.6.0)
- Rust: `rustc 1.97.0`, `cargo 1.97.0`
- FFmpeg: `8.1.2` (Homebrew, `--enable-gpl --enable-videotoolbox --enable-libx264 --enable-libx265`)
- GStreamer: `1.28.5` (Homebrew, bundled all-plugins formula)
- `pkg-config`: not preinstalled — required `brew install pkgconf` for either candidate to build
