/**
 * scripts/lib/resolve-pexels.js
 *
 * Scans a transcript for FullscreenMedia cues whose `src` prop is a Pexels URL,
 * downloads the asset to public/assets/pexels/, and rewrites src to the local path.
 *
 * Called automatically by edit-transcript.js during merge-doc when a PEXELS_API_KEY
 * is present in the environment (loaded from .env.local by edit-transcript.js).
 *
 * Supported URL forms in `src=`:
 *   https://www.pexels.com/video/{slug}-{id}/     ← page URL (browser address bar)
 *   https://www.pexels.com/photo/{slug}-{id}/     ← page URL
 *   https://images.pexels.com/photos/{id}/…       ← direct CDN photo
 *   https://videos.pexels.com/video-files/{id}/…  ← direct CDN video
 *
 * All four forms are downloaded locally. Direct CDN URLs are usable without
 * downloading, but local copies are more reliable for offline renders.
 */

import fs from 'fs-extra';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const PEXELS_PHOTO_API = 'https://api.pexels.com/v1';
const PEXELS_VIDEO_API = 'https://api.pexels.com/videos';

// ── URL detection ─────────────────────────────────────────────────────────────

/** Returns 'page-video', 'page-photo', 'cdn-video', 'cdn-photo', or null */
export function classifyPexelsUrl(src) {
  if (typeof src !== 'string') return null;
  if (/pexels\.com\/video\//i.test(src))                return 'page-video';
  if (/pexels\.com\/photo\//i.test(src))                return 'page-photo';
  if (/videos\.pexels\.com/i.test(src))                 return 'cdn-video';
  if (/images\.pexels\.com/i.test(src))                 return 'cdn-photo';
  return null;
}

/**
 * Extract the numeric Pexels ID from a page URL.
 * e.g. https://www.pexels.com/video/barista-making-coffee-3722329/ → 3722329
 */
export function extractPexelsId(url) {
  // ID is the last run of digits before an optional trailing slash or end of string
  const m = url.match(/(\d+)\/?$/);
  return m ? m[1] : null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function pexelsGet(url, apiKey) {
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pexels API ${res.status}: ${body.slice(0, 120)}`);
  }
  return res.json();
}

/** Returns the best-quality photo src URL for a given Pexels photo ID */
async function resolvePhotoSrc(id, apiKey) {
  const data = await pexelsGet(`${PEXELS_PHOTO_API}/photos/${id}`, apiKey);
  return data.src?.original ?? data.src?.large2x ?? data.src?.large;
}

/** Returns the best mp4 link closest to preferWidth for a given Pexels video ID */
async function resolveVideoSrc(id, apiKey, preferWidth = 1920) {
  const data = await pexelsGet(`${PEXELS_VIDEO_API}/videos/${id}`, apiKey);
  const mp4s = (data.video_files ?? []).filter(f => f.file_type === 'video/mp4' && f.link);
  if (!mp4s.length) throw new Error(`No mp4 files for Pexels video ${id}`);
  // Closest width to preferWidth wins
  return mp4s.sort((a, b) =>
    Math.abs((a.width ?? 0) - preferWidth) - Math.abs((b.width ?? 0) - preferWidth)
  )[0].link;
}

// ── Download ───────────────────────────────────────────────────────────────────

async function downloadFile(url, destPath) {
  await fs.ensureDir(path.dirname(destPath));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  await pipeline(res.body, createWriteStream(destPath));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Walk all FullscreenMedia graphics cues in a transcript, resolve any Pexels
 * `src` URLs to local files, and return the updated transcript.
 *
 * @param {object} transcript  - parsed transcript.json object
 * @param {object} options
 * @param {string} options.apiKey     - Pexels API key
 * @param {string} options.cwd        - project root (default: process.cwd())
 * @param {number} options.preferWidth - preferred video width in px (default: 1920)
 * @returns {{ transcript: object, changed: boolean }}
 */
export async function resolveAllPexelsAssets(transcript, { apiKey, cwd = process.cwd(), preferWidth = 1920 } = {}) {
  if (!apiKey) return { transcript, changed: false };

  const outputDir = path.join(cwd, 'public', 'assets', 'pexels');
  let changed = false;

  const updatedSegments = await Promise.all(
    transcript.segments.map(async (seg) => {
      if (!seg.graphics?.length) return seg;

      const updatedGraphics = await Promise.all(
        seg.graphics.map(async (cue) => {
          if (cue.type !== 'FullscreenMedia') return cue;
          const src = cue.props?.src;
          const kind = classifyPexelsUrl(src);
          if (!kind) return cue;   // not a Pexels URL — leave as-is

          try {
            let downloadUrl;
            let filename;

            if (kind === 'page-video') {
              const id = extractPexelsId(src);
              if (!id) throw new Error(`Could not extract ID from: ${src}`);
              downloadUrl = await resolveVideoSrc(id, apiKey, preferWidth);
              // Derive a width label from the resolved URL if possible
              const wMatch = downloadUrl.match(/[_-](\d{3,4})w?\./);
              const wLabel = wMatch ? `${wMatch[1]}w` : `${preferWidth}w`;
              filename = `pexels-${id}-${wLabel}.mp4`;

            } else if (kind === 'page-photo') {
              const id = extractPexelsId(src);
              if (!id) throw new Error(`Could not extract ID from: ${src}`);
              downloadUrl = await resolvePhotoSrc(id, apiKey);
              const ext = downloadUrl.split('?')[0].split('.').pop() ?? 'jpg';
              filename = `pexels-${id}.${ext}`;

            } else if (kind === 'cdn-video') {
              // Already a direct video URL — just download it
              downloadUrl = src;
              const cleanUrl = src.split('?')[0];
              filename = path.basename(cleanUrl) || `pexels-video-${Date.now()}.mp4`;

            } else {
              // cdn-photo — already a direct image URL
              downloadUrl = src;
              const cleanUrl = src.split('?')[0];
              const ext = cleanUrl.split('.').pop() ?? 'jpg';
              // Extract photo ID from CDN URL: /photos/{id}/...
              const idMatch = src.match(/\/photos\/(\d+)\//);
              filename = idMatch ? `pexels-${idMatch[1]}.${ext}` : `pexels-photo-${Date.now()}.${ext}`;
            }

            const destPath = path.join(outputDir, filename);
            const publicPath = `assets/pexels/${filename}`;

            if (await fs.pathExists(destPath)) {
              console.log(`  ✓ Already downloaded: ${publicPath}`);
            } else {
              console.log(`  ↓ Downloading Pexels asset → public/${publicPath}`);
              await downloadFile(downloadUrl, destPath);
              console.log(`  ✓ Saved: ${publicPath}`);
            }

            changed = true;
            return { ...cue, props: { ...cue.props, src: publicPath } };

          } catch (err) {
            // Non-fatal — leave the original src intact so the doc isn't corrupted
            console.warn(`  ⚠ Could not resolve Pexels asset (${src}): ${err.message}`);
            return cue;
          }
        })
      );

      return { ...seg, graphics: updatedGraphics };
    })
  );

  return {
    transcript: { ...transcript, segments: updatedSegments },
    changed,
  };
}
