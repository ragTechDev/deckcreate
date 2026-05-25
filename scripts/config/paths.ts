/**
 * Centralized path resolution for all pipeline scripts.
 *
 * All helpers are pure functions — no filesystem reads, no side effects.
 * Pass `cwd` (defaults to `process.cwd()`) to get absolute paths.
 */

import path from 'path';

// ---------------------------------------------------------------------------
// Project / artifact store
// ---------------------------------------------------------------------------

export function projectFile(cwd: string = process.cwd()): string {
  return path.join(cwd, '.ragtech', 'project.json');
}

export function artifactDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.ragtech', 'artifacts');
}

// ---------------------------------------------------------------------------
// Transcribe pipeline
// ---------------------------------------------------------------------------

export function transcribeInput(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'transcribe', 'input');
}

export function transcribeRawDir(cwd: string = process.cwd()): string {
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

export function syncOutputDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'sync', 'output');
}

/** Single-angle synced video. */
export function syncedVideo(cwd: string = process.cwd()): string {
  return path.join(syncOutputDir(cwd), 'synced-output.mp4');
}

/** Multi-angle synced video (1-based index). */
export function syncedVideoAngle(index: number, cwd: string = process.cwd()): string {
  return path.join(syncOutputDir(cwd), `synced-output-${index}.mp4`);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export function cameraProfilesDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'camera');
}

export function cameraProfiles(cwd: string = process.cwd()): string {
  return path.join(cameraProfilesDir(cwd), 'camera-profiles.json');
}

// ---------------------------------------------------------------------------
// Shorts pipeline
// ---------------------------------------------------------------------------

export function shortsDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'shorts');
}

export function shortClipDir(clipId: string, cwd: string = process.cwd()): string {
  return path.join(shortsDir(cwd), clipId);
}

export function shortTranscript(clipId: string, cwd: string = process.cwd()): string {
  return path.join(shortClipDir(clipId, cwd), 'transcript.json');
}

export function shortDoc(clipId: string, cwd: string = process.cwd()): string {
  return path.join(shortClipDir(clipId, cwd), 'transcript.doc.txt');
}

export function shortsCameraProfiles(cwd: string = process.cwd()): string {
  return path.join(shortsDir(cwd), 'camera-profiles.json');
}

export function shortsTranscribeRawDir(cwd: string = process.cwd()): string {
  return path.join(shortsDir(cwd), 'transcribe', 'output', 'raw');
}

export function shortsTranscriptRaw(cwd: string = process.cwd()): string {
  return path.join(shortsTranscribeRawDir(cwd), 'transcript.raw.json');
}

// ---------------------------------------------------------------------------
// Carousel pipeline
// ---------------------------------------------------------------------------

export function carouselDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'carousel');
}

export function carouselClipDir(carouselId: string, cwd: string = process.cwd()): string {
  return path.join(carouselDir(cwd), carouselId);
}

export function carouselTranscript(carouselId: string, cwd: string = process.cwd()): string {
  return path.join(carouselClipDir(carouselId, cwd), 'transcript.json');
}

export function carouselDoc(carouselId: string, cwd: string = process.cwd()): string {
  return path.join(carouselClipDir(carouselId, cwd), 'transcript.doc.txt');
}

// ---------------------------------------------------------------------------
// Thumbnail pipeline
// ---------------------------------------------------------------------------

export function thumbnailDir(cwd: string = process.cwd()): string {
  return path.join(cwd, 'public', 'thumbnail');
}

export function thumbnailCameraProfiles(cwd: string = process.cwd()): string {
  return path.join(thumbnailDir(cwd), 'camera-profiles.json');
}
