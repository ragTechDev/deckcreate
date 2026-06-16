/**
 * Hardware detection abstraction.
 *
 * Exposes a typed `HardwareProfile` so downstream callers never need to
 * inspect `process.platform` or `process.arch` directly.  All hardware-
 * sensitive decisions (encoder selection, ML runtime selection) should
 * derive from this profile.
 *
 * Constraints (Phase 1):
 *  - No FFmpeg integration — encoder flags are recorded but not applied here.
 *  - No shelling-out for CUDA detection — derivation is purely from OS/arch.
 *  - Lightweight: synchronous reads of process.platform / process.arch only.
 */

/** Encoder profile selected by the hardware detection layer. */
export type EncoderProfile =
  | 'videotoolbox' // Apple Silicon / macOS VideoToolbox H.264
  | 'nvenc'        // NVIDIA NVENC H.264
  | 'libx264';     // Software fallback

/** Full typed hardware profile returned by detectHardware(). */
export interface HardwareProfile {
  /** NodeJS platform string, e.g. "darwin", "linux", "win32". */
  platform: string;
  /** CPU architecture string, e.g. "arm64", "x64". */
  arch: string;
  /**
   * True when running on macOS — VideoToolbox hardware-accelerated
   * encode/decode is available on all modern Apple Silicon and Intel Macs.
   */
  supportsVideoToolbox: boolean;
  /**
   * True when the environment is likely to have CUDA available.
   * Phase 1 heuristic: linux + x64 → assumed CUDA-capable.
   * A future phase can refine this with an `nvidia-smi` probe.
   */
  supportsCuda: boolean;
  /** Recommended H.264 encoder for this hardware environment. */
  encoderProfile: EncoderProfile;
}

/**
 * Derive a hardware profile from the current process environment.
 *
 * The function is async to allow future phases to add lightweight probes
 * (e.g. a non-blocking `nvidia-smi --query` or sysctl call) without
 * changing the caller's interface.
 *
 * Current Phase 1 logic is purely synchronous and derives everything from
 * `process.platform` and `process.arch`.
 */
export async function detectHardware(): Promise<HardwareProfile> {
  const platform = process.platform;
  const arch = process.arch;

  const supportsVideoToolbox = platform === 'darwin';
  // Phase 1 heuristic: CUDA is assumed on linux/x64 only.
  // A future phase can add a non-blocking nvidia-smi probe here.
  const supportsCuda = platform === 'linux' && arch === 'x64';

  let encoderProfile: EncoderProfile;
  if (supportsVideoToolbox) {
    encoderProfile = 'videotoolbox';
  } else if (supportsCuda) {
    encoderProfile = 'nvenc';
  } else {
    encoderProfile = 'libx264';
  }

  return {
    platform,
    arch,
    supportsVideoToolbox,
    supportsCuda,
    encoderProfile,
  };
}
