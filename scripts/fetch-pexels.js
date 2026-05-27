#!/usr/bin/env node
/**
 * scripts/fetch-pexels.js
 *
 * Search Pexels for a photo or video, pick a result, and download it to
 * public/assets/pexels/ so you can reference it as a FullscreenMedia overlay.
 *
 * Usage:
 *   npm run pexels:fetch
 *   node scripts/fetch-pexels.js
 *   node scripts/fetch-pexels.js -- --query "coffee shop" --type video --pick 1
 *
 * API key:  set PEXELS_API_KEY in .env.local (or any .env file)
 */

import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const CWD = process.cwd();
const PEXELS_PHOTO_BASE = 'https://api.pexels.com/v1';
const PEXELS_VIDEO_BASE = 'https://api.pexels.com/videos';
const OUTPUT_DIR = path.join(CWD, 'public', 'assets', 'pexels');

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { query: null, type: null, pick: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--query' && args[i + 1]) result.query = args[++i];
    else if (args[i] === '--type' && args[i + 1])  result.type  = args[++i];
    else if (args[i] === '--pick' && args[i + 1])  result.pick  = parseInt(args[++i]);
  }
  return result;
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

// ── Pexels API ─────────────────────────────────────────────────────────────────

async function pexelsGet(url, apiKey) {
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pexels API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function searchPhotos(query, apiKey, perPage = 8) {
  const url = `${PEXELS_PHOTO_BASE}/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  return pexelsGet(url, apiKey);
}

async function searchVideos(query, apiKey, perPage = 8) {
  const url = `${PEXELS_VIDEO_BASE}/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  return pexelsGet(url, apiKey);
}

// ── Result display ─────────────────────────────────────────────────────────────

function displayPhotos(photos) {
  console.log('\n┌─ Photos ──────────────────────────────────────────────────────────');
  photos.forEach((p, i) => {
    console.log(`│  [${i + 1}]  id:${p.id}  ${p.width}×${p.height}  by ${p.photographer}`);
    console.log(`│       ${p.url}`);
  });
  console.log('└───────────────────────────────────────────────────────────────────\n');
}

function displayVideos(videos) {
  console.log('\n┌─ Videos ──────────────────────────────────────────────────────────');
  videos.forEach((v, i) => {
    // pick the highest-res file
    const best = v.video_files
      .filter(f => f.file_type === 'video/mp4')
      .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
    const res = best ? `${best.width}×${best.height}` : 'unknown';
    console.log(`│  [${i + 1}]  id:${v.id}  ${res}  ${v.duration}s  by ${v.user.name}`);
    console.log(`│       ${v.url}`);
  });
  console.log('└───────────────────────────────────────────────────────────────────\n');
}

// ── Download ───────────────────────────────────────────────────────────────────

async function downloadFile(url, destPath) {
  await fs.ensureDir(path.dirname(destPath));
  // Use streaming pipeline so large video files aren't buffered in memory.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} — ${url}`);
  await pipeline(res.body, createWriteStream(destPath));
}

/**
 * Pick the best photo download URL.
 * Prefers original for full-quality renders; falls back to large2x.
 */
function bestPhotoUrl(photo) {
  return photo.src.original ?? photo.src.large2x ?? photo.src.large;
}

/**
 * Pick the best mp4 video file — closest to 1920-wide without going under
 * (avoids tiny preview files). For portrait/shortform, consider passing
 * preferWidth=1080 via options.
 */
function bestVideoFile(video, preferWidth = 1920) {
  const mp4s = video.video_files.filter(f => f.file_type === 'video/mp4' && f.link);
  if (!mp4s.length) throw new Error('No mp4 files available for this video');

  // Sort: prefer exactly preferWidth, then closest above, then closest below.
  const sorted = [...mp4s].sort((a, b) => {
    const diffA = (a.width ?? 0) - preferWidth;
    const diffB = (b.width ?? 0) - preferWidth;
    // Closest to preferWidth wins
    return Math.abs(diffA) - Math.abs(diffB);
  });
  return sorted[0];
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.error('\n  ✗  PEXELS_API_KEY not found in environment.');
    console.error('     Add it to .env.local:  PEXELS_API_KEY=your_key_here\n');
    process.exit(1);
  }

  const cli = parseArgs();

  // ── 1. Media type ──────────────────────────────────────────────────────────
  let mediaType = cli.type;
  if (!mediaType) {
    const ans = await ask('  Media type — photo / video  [photo]: ');
    mediaType = ans.trim() || 'photo';
  }
  const isVideo = mediaType.startsWith('v');
  const docMediaType = isVideo ? 'video' : 'image';

  // ── 2. Search query ────────────────────────────────────────────────────────
  let query = cli.query;
  if (!query) {
    query = (await ask('  Search query: ')).trim();
    if (!query) { rl.close(); return; }
  }

  console.log(`\n  Searching Pexels for "${query}" (${isVideo ? 'videos' : 'photos'})…`);

  const results = isVideo
    ? (await searchVideos(query, apiKey)).videos ?? []
    : (await searchPhotos(query, apiKey)).photos ?? [];

  if (!results.length) {
    console.log('  No results found. Try a different query.');
    rl.close();
    return;
  }

  if (isVideo) { displayVideos(results); } else { displayPhotos(results); }

  // ── 3. Pick ────────────────────────────────────────────────────────────────
  let pick = cli.pick;
  if (!pick) {
    const ans = await ask(`  Pick a result [1–${results.length}]: `);
    pick = parseInt(ans.trim());
  }

  if (isNaN(pick) || pick < 1 || pick > results.length) {
    console.log('  Invalid selection. Exiting.');
    rl.close();
    return;
  }

  const chosen = results[pick - 1];

  // ── 4. Preferred width for video ───────────────────────────────────────────
  let preferWidth = 1920;
  if (isVideo) {
    const widthAns = await ask('  Preferred video width  [1920 longform / 1080 shortform]: ');
    const parsed = parseInt(widthAns.trim());
    if (!isNaN(parsed) && parsed > 0) preferWidth = parsed;
  }

  // ── 5. Resolve download URL and filename ───────────────────────────────────
  let downloadUrl;
  let ext;
  let baseName;

  if (isVideo) {
    const file = bestVideoFile(chosen, preferWidth);
    downloadUrl = file.link;
    ext = 'mp4';
    baseName = `pexels-${chosen.id}-${file.width ?? preferWidth}w`;
  } else {
    downloadUrl = bestPhotoUrl(chosen);
    ext = downloadUrl.split('?')[0].split('.').pop() ?? 'jpg';
    baseName = `pexels-${chosen.id}`;
  }

  const filename = `${baseName}.${ext}`;
  const destPath = path.join(OUTPUT_DIR, filename);
  const publicPath = `assets/pexels/${filename}`;

  // ── 6. Download ────────────────────────────────────────────────────────────
  if (await fs.pathExists(destPath)) {
    console.log(`\n  Already downloaded: ${publicPath}`);
  } else {
    console.log(`\n  Downloading → public/${publicPath} …`);
    await downloadFile(downloadUrl, destPath);
    console.log('  ✓ Done');
  }

  // ── 7. Print the directive ─────────────────────────────────────────────────
  const durationAns = await ask('  Duration in seconds for the overlay  [5]: ');
  const duration = parseFloat(durationAns.trim()) || 5;

  const atAns = await ask('  at= word in the transcript (or leave blank to fill in later)  []: ');
  const atPart = atAns.trim() ? `at="${atAns.trim()}"` : 'at="WORD"';

  const mutedPart = (isVideo && docMediaType === 'video')
    ? await ask('  Mute the overlay video?  [y/N]: ').then(a => a.trim().toLowerCase() === 'y' ? '  muted="true"' : '')
    : '';

  console.log('\n  ─── Copy this line into your transcript.doc.txt ─────────────────────');
  console.log(`  > FullscreenMedia  ${atPart}  duration=${duration}  src="${publicPath}"  mediaType="${docMediaType}"${mutedPart}`);
  console.log('  ─────────────────────────────────────────────────────────────────────\n');

  // Also print the Pexels attribution (required by their licence)
  const credit = isVideo ? chosen.user?.name : chosen.photographer;
  const creditUrl = isVideo ? chosen.url : chosen.url;
  console.log(`  Attribution (Pexels licence):  Photo/Video by ${credit} — ${creditUrl}\n`);

  rl.close();
}

main().catch(err => {
  console.error('\n  ✗', err.message);
  rl.close();
  process.exit(1);
});
