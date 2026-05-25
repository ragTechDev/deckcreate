/**
 * Centralized path resolution for all pipeline scripts.
 *
 * All helpers are pure functions — no filesystem reads, no side effects.
 * Pass `cwd` (defaults to `process.cwd()`) to get absolute paths.
 *
 * Internal dir helpers (not exported) are kept private to allow restructuring
 * without breaking callers. Export only the paths scripts actually reference.
 */

import path from 'path';
import { PROJECT_DIR, PROJECT_FILENAME } from './project';
import { ARTIFACTS_DIR } from './artifacts';

// ---------------------------------------------------------------------------
// Project / artifact store
// ---------------------------------------------------------------------------

export function projectFile(cwd: string = process.cwd()): string {
  return path.join(cwd, PROJECT_DIR, PROJECT_FILENAME);
}

export function artifactDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ARTIFACTS_DIR);
}

// ---------------------------------------------------------------------------
// Transcribe pipeline
// ---------------------------------------------------------------------------

/** Directory where raw audio/video input files are placed before transcription. */
export function transcribeInput(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'transcribe', 'input');
}

function transcribeRawDir(cwd: string): string {
  return path.join(cwd, 'public', 'transcribe', 'output', 'raw');
}

export function transcriptRaw(cwd: string = process.cwd()): string {
  return path.join(transcribeRawDir(cwd), 'transcript.raw.json');
}

export function diarizationOutput(cwd: string = process.cwd()): string {
  return path.join(transcribeRawDir(cwd), 'diarization.json');
}

export function hookQaDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'transcribe', 'output', 'hook-qa');
}

// ---------------------------------------------------------------------------
// Edit / longform output
// ---------------------------------------------------------------------------

export function transcriptOutput(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'edit', 'transcript.json');
}

export function transcriptDoc(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'edit', 'transcript.doc.txt');
}

// ---------------------------------------------------------------------------
// Sync pipeline
// ---------------------------------------------------------------------------

export function syncVideoDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'sync', 'video');
}

export function syncAudioDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'sync', 'audio');
}

/** Directory containing synced output videos. Use for readdir; prefer {@link syncedVideo} or {@link syncedVideoAngle} for specific files. */
export function syncOutputDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'sync', 'output');
}

/**
 * Single-angle synced video (`synced-output.mp4`).
 * For multi-angle recordings use {@link syncedVideoAngle} instead.
 */
export function syncedVideo(cwd: string = process.cwd()): string {
  return path.join(syncOutputDir(cwd), 'synced-output.mp4');
}

/**
 * Multi-angle synced video — produces `synced-output-{index}.mp4`.
 * Index is 1-based. Throws if index < 1.
 * For single-angle recordings use {@link syncedVideo} instead.
 */
export function syncedVideoAngle(index: number, cwd: string = process.cwd()): string {
  if (index < 1) throw new RangeError(`syncedVideoAngle: index must be ≥ 1, got ${index}`);
  return path.join(syncOutputDir(cwd), `synced-output-${index}.mp4`);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function cameraProfilesDir(cwd: string): string {
  return path.join(cwd, 'public', 'camera');
}

export function cameraProfiles(cwd: string = process.cwd()): string {
  return path.join(cameraProfilesDir(cwd), 'camera-profiles.json');
}

// ---------------------------------------------------------------------------
// Shorts pipeline
// ---------------------------------------------------------------------------

/** Root shorts directory. Use for existence checks and readdir. */
export function shortsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'shorts');
}

export function shortClipDir(id: string, cwd: string = process.cwd()): string {
  if (!id) throw new TypeError('shortClipDir: id must not be empty');
  return path.join(shortsDir(cwd), id);
}

export function shortTranscript(id: string, cwd: string = process.cwd()): string {
  return path.join(shortClipDir(id, cwd), 'transcript.json');
}

export function shortDoc(id: string, cwd: string = process.cwd()): string {
  return path.join(shortClipDir(id, cwd), 'transcript.doc.txt');
}

export function shortsCameraProfiles(cwd: string = process.cwd()): string {
  return path.join(shortsDir(cwd), 'camera-profiles.json');
}

function shortsTranscribeRawDir(cwd: string): string {
  return path.join(shortsDir(cwd), 'transcribe', 'output', 'raw');
}

export function shortsTranscriptRaw(cwd: string = process.cwd()): string {
  return path.join(shortsTranscribeRawDir(cwd), 'transcript.raw.json');
}

// ---------------------------------------------------------------------------
// Carousel pipeline
// ---------------------------------------------------------------------------

function carouselDir(cwd: string): string {
  return path.join(cwd, 'public', 'carousel');
}

export function carouselClipDir(id: string, cwd: string = process.cwd()): string {
  if (!id) throw new TypeError('carouselClipDir: id must not be empty');
  return path.join(carouselDir(cwd), id);
}

export function carouselTranscript(id: string, cwd: string = process.cwd()): string {
  return path.join(carouselClipDir(id, cwd), 'transcript.json');
}

export function carouselDoc(id: string, cwd: string = process.cwd()): string {
  return path.join(carouselClipDir(id, cwd), 'transcript.doc.txt');
}

// ---------------------------------------------------------------------------
// Thumbnail pipeline
// ---------------------------------------------------------------------------

function thumbnailDir(cwd: string): string {
  return path.join(cwd, 'public', 'thumbnail');
}

export function thumbnailCameraProfiles(cwd: string = process.cwd()): string {
  return path.join(thumbnailDir(cwd), 'camera-profiles.json');
}
