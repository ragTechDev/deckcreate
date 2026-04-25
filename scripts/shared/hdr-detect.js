/**
 * HDR detection and tonemapping utilities shared across camera/sync scripts.
 *
 * Uses ffprobe to read the video stream's color_transfer field. If it matches
 * a known HDR transfer function (HLG or PQ/HDR10), returns true.
 *
 * The HDR_TONEMAP_VF filter chain requires libzimg (zscale). This is included
 * in Homebrew ffmpeg and Debian bookworm's ffmpeg apt package.
 */

import { spawn } from 'child_process';

// ffprobe color_transfer values that indicate HDR encoding
const HDR_TRANSFERS = new Set([
  'arib-std-b67',   // HLG — Sony, Panasonic, iPhone
  'smpte2084',      // PQ / HDR10
  'smpte-st-2084',  // alternate ffprobe label for PQ
]);

/**
 * Returns true if the video's primary stream uses an HDR transfer function.
 * Falls back to false on ffprobe failure — treat unknown sources as SDR.
 *
 * @param {string} videoPath
 * @returns {Promise<boolean>}
 */
export async function detectHDR(videoPath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-show_streams', '-select_streams', 'v:0',
      '-print_format', 'json',
      videoPath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.on('close', () => {
      try {
        const { streams = [] } = JSON.parse(stdout);
        const transfer = streams[0]?.color_transfer ?? '';
        resolve(HDR_TRANSFERS.has(transfer));
      } catch {
        resolve(false);
      }
    });
    proc.on('error', () => resolve(false));
  });
}

/**
 * FFmpeg -vf filter string for HDR→SDR tonemapping via zscale.
 * Works for both HLG and PQ; zscale reads the embedded transfer metadata.
 * Output: yuv420p (8-bit BT.709).
 */
export const HDR_TONEMAP_VF = [
  'zscale=t=linear:npl=100',
  'format=gbrpf32le',
  'zscale=p=bt709',
  'tonemap=tonemap=hable:desat=0',
  'zscale=t=bt709:m=bt709:r=tv',
  'format=yuv420p',
].join(',');

/**
 * FFmpeg -vf filter string for SDR sources — forces yuv420p output without
 * any colour space conversion.
 */
export const SDR_FORMAT_VF = 'format=yuv420p';
