/**
 * Shared utilities for carousel generation.
 * Imported by carousel-wizard.js and shorts-wizard.js.
 */

import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { detectHDR, HDR_TONEMAP_VF, SDR_FORMAT_VF } from '../shared/hdr-detect.js';

// ── Doc stripping ─────────────────────────────────────────────────────────────

/**
 * Remove all Remotion-specific directive lines (> HOOK, > CAM, > SPEAKER,
 * > LowerThird, > Callout, > ChapterMarker, > CUT, > START, > END, etc.)
 * from a transcript.doc.txt string. Keeps segment lines, speaker headers,
 * # THUMBNAIL / # SPEAKERS sections, and blank lines.
 */
export function stripOverlaysFromDoc(content) {
  return content
    .split('\n')
    .filter(line => !/^\s*>/.test(line))
    .join('\n');
}

export function buildCarouselGuide() {
  return [
    '════════════════════════════════════════════════════════════════',
    '  CAROUSEL EDITOR  ─  Editing Guide',
    '════════════════════════════════════════════════════════════════',
    '',
    '  MARK CAROUSEL SLIDES',
    '    Use CAROUSEL START/END to define the slide range:',
    '      > CAROUSEL START',
    '      [8] First carousel slide segment...',
    '      [12] Last carousel slide segment...',
    '      > CAROUSEL END',
    '',
    '    Each pair of consecutive segments becomes one slide.',
    '    Top segment → top frame.  Bottom segment → bottom frame.',
    '',
    '  EDIT TEXT',
    '    Just retype any word. Changes are saved.',
    '',
    '  CUT WORDS (optional)',
    '    Wrap in curly braces to exclude:  {um}  {you know}',
    '',
    '  THUMBNAIL',
    '    Edit # THUMBNAIL section to customize the CTA slide:',
    '      title="Carousel title for the CTA slide"',
    '      extendedTitle="Longer title shown on CTA"',
    '      episodeNumber="001"',
    '',
    '════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
}

/**
 * Replace the editing guide header in a transcript.doc.txt with the
 * carousel-specific guide, and strip all Remotion directive lines.
 */
export function replaceWithCarouselGuide(content) {
  const thumbnailMatch = content.match(/# THUMBNAIL/);
  const speakersMatch = content.match(/# SPEAKERS/);

  let contentStart = content.length;
  if (thumbnailMatch) contentStart = Math.min(contentStart, thumbnailMatch.index);
  if (speakersMatch) contentStart = Math.min(contentStart, speakersMatch.index);

  const transcriptContent = stripOverlaysFromDoc(content.slice(contentStart));
  return buildCarouselGuide() + transcriptContent;
}

// ── Segment parsing ───────────────────────────────────────────────────────────

export function cleanSegmentText(text) {
  if (!text) return '';
  return text
    .replace(/\{\s*,(?:\s*,)*\s*\}/g, '')
    .replace(/\s*,(?:\s*,)+\s*/g, ' ')
    .replace(/\s*\.(?:\s*\.)+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSegmentLine(line) {
  const match = line.match(/^\[(\d+)\]\s*(.+)$/);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  let text = match[2].trim();
  text = text.replace(/\{[^}]*\}/g, '');
  text = cleanSegmentText(text);
  return { id, text };
}

/**
 * Parse a carousel transcript.doc.txt and return slide pairs.
 * jsonPath: path to the transcript.json whose segment timestamps will be used.
 * Returns: Array<{ top: Segment, bottom: Segment }>
 */
export async function extractCarouselSegments(docContent, jsonPath) {
  const transcript = await fs.readJson(jsonPath);
  const segments = transcript.segments;

  const lines = docContent.split('\n');
  const pairs = [];
  let inCarousel = false;
  let selectedSegments = [];
  let inHeader = true;

  for (const line of lines) {
    const trimmed = line.trim();

    if (inHeader && (
      trimmed.startsWith('# THUMBNAIL') ||
      trimmed.startsWith('# SPEAKERS') ||
      trimmed.startsWith('===') ||
      /^\[\d+\]/.test(trimmed)
    )) {
      inHeader = false;
    }
    if (inHeader) continue;

    if (/^>\s*CAROUSEL\s*START/i.test(trimmed) || trimmed === '> CAROUSEL') {
      inCarousel = true;
      continue;
    }
    if (/^>\s*CAROUSEL\s*END/i.test(trimmed)) {
      inCarousel = false;
      continue;
    }

    const parsed = parseSegmentLine(trimmed);
    if (parsed && inCarousel) {
      const seg = segments.find(s => s.id === parsed.id);
      if (seg && !seg.cut) {
        selectedSegments.push({ ...seg, text: parsed.text });
      }
    }
  }

  for (let i = 0; i < selectedSegments.length; i += 2) {
    if (selectedSegments[i + 1]) {
      pairs.push({ top: selectedSegments[i], bottom: selectedSegments[i + 1] });
    }
  }

  return pairs;
}

// ── Frame resolution ──────────────────────────────────────────────────────────

/**
 * Convert host paths to Docker container paths when running in Docker.
 */
export function resolveVideoPath(videoPath) {
  if (!videoPath) return videoPath;
  if (process.env.DOCKER_ENV === 'true' || process.env.DOCKER_ENV === true) {
    const inputMatch = videoPath.match(/\/.*?\/deckcreate\/input\/(.*)$/);
    if (inputMatch) return path.join('/app/input', inputMatch[1]);
    const homeMatch = videoPath.match(/\/home\/.*?\/deckcreate\/input\/(.*)$/);
    if (homeMatch) return path.join('/app/input', homeMatch[1]);
    const syncMatch = videoPath.match(/\/.*?\/deckcreate\/public\/(.*)$/);
    if (syncMatch) return path.join('/app/public', syncMatch[1]);
    if (videoPath.startsWith('/app/')) return videoPath;
  }
  return videoPath;
}

/**
 * Resolve the video file, seek timestamp, source dimensions, and closeup
 * viewport for a given speaker at a given transcript timestamp, using
 * camera-profiles.json. Falls back to fallbackVideoPath for unmatched speakers
 * or when cameraProfiles is null (single-video mode).
 *
 * @param {object|null} cameraProfiles  Parsed camera-profiles.json
 * @param {string|null} speaker         Speaker display name (e.g. "Natasha")
 * @param {number}      timestamp       Transcript timestamp in seconds
 * @param {string|null} fallbackVideoPath  Absolute path used when no profile match
 * @param {string}      cwd             Project root (for resolving videoSrc paths)
 */
export function resolveFrameSource(cameraProfiles, speaker, timestamp, fallbackVideoPath, cwd) {
  if (!cameraProfiles) {
    return { videoPath: fallbackVideoPath, effectiveTimestamp: timestamp,
             srcWidth: null, srcHeight: null, viewport: null, angleName: null };
  }

  const speakerProfile = speaker && cameraProfiles.speakers
    ? cameraProfiles.speakers[speaker]
    : null;

  if (speakerProfile && speakerProfile.angleName && cameraProfiles.angles) {
    const angleName = speakerProfile.angleName;
    const angle = cameraProfiles.angles[angleName];
    if (angle) {
      let viewport = speakerProfile.closeupViewport;
      if (speakerProfile.closeupViewportsByTime) {
        for (const tkv of speakerProfile.closeupViewportsByTime) {
          if (timestamp >= tkv.from && timestamp < tkv.to) { viewport = tkv.viewport; break; }
        }
      }
      return {
        videoPath: path.join(cwd, 'public', angle.videoSrc),
        effectiveTimestamp: timestamp + (angle.videoOffset || 0),
        srcWidth: angle.sourceWidth,
        srcHeight: angle.sourceHeight,
        viewport,
        angleName,
      };
    }
  }

  // Fallback: first available angle (wide shot)
  if (cameraProfiles.angles) {
    const firstAngleName = Object.keys(cameraProfiles.angles)[0];
    const firstAngle = cameraProfiles.angles[firstAngleName];
    if (firstAngle) {
      return {
        videoPath: path.join(cwd, 'public', firstAngle.videoSrc),
        effectiveTimestamp: timestamp + (firstAngle.videoOffset || 0),
        srcWidth: firstAngle.sourceWidth,
        srcHeight: firstAngle.sourceHeight,
        viewport: cameraProfiles.wideViewport || null,
        angleName: firstAngleName,
      };
    }
  }

  return {
    videoPath: fallbackVideoPath,
    effectiveTimestamp: timestamp,
    srcWidth: cameraProfiles.sourceWidth || null,
    srcHeight: cameraProfiles.sourceHeight || null,
    viewport: null,
    angleName: null,
  };
}

/**
 * Crop a raw frame file to the given CropViewport region, then resize to
 * outWidth × outHeight. Falls back to fit:cover resize when viewport is null.
 */
export async function applyViewportAndResize(sharp, framePath, viewport, srcWidth, srcHeight, outWidth, outHeight) {
  let pipeline = sharp(framePath);

  if (viewport && srcWidth && srcHeight) {
    const cropW = Math.round(srcWidth * viewport.w);
    const cropH = Math.round(srcHeight * viewport.h);
    const rawLeft = Math.round(srcWidth * viewport.cx - cropW / 2);
    const rawTop = Math.round(srcHeight * viewport.cy - cropH / 2);
    const left = Math.max(0, Math.min(rawLeft, srcWidth - cropW));
    const top = Math.max(0, Math.min(rawTop, srcHeight - cropH));
    pipeline = pipeline.extract({ left, top, width: cropW, height: cropH });
  }

  return pipeline
    .resize(outWidth, outHeight, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();
}

/**
 * Extract a single video frame at `timestamp` seconds using ffmpeg.
 * Applies HDR tonemapping when the source is HDR.
 */
export async function extractFrameWithFFmpeg(videoPath, timestamp, outputPath, cwd) {
  const isHDR = await detectHDR(videoPath);
  const vf = isHDR ? HDR_TONEMAP_VF : SDR_FORMAT_VF;
  if (isHDR) console.log('    (HDR video — applying tonemapping)');

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(timestamp),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', vf,
      '-pix_fmt', 'rgb24',
      '-y', outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'], cwd });

    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg failed: ${err}`));
    });
  });
}
