#!/usr/bin/env node
/**
 * Pre-flight check: verify all external media URLs in a transcript are
 * fetchable and not blocked by Cross-Origin-Resource-Policy headers.
 *
 * Used by render-episode.js and render-hook-intro.js before starting Remotion.
 * Can also be run standalone: node scripts/lib/checkMediaUrls.js --transcript <path>
 */

import fs from 'fs-extra';

const TIMEOUT_MS = 8000;
const RESTRICTIVE_CORP = new Set(['same-origin', 'same-site']);

function extractUrls(obj) {
  const urls = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      if (/^https?:\/\//.test(v)) urls.add(v);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(obj);
  return [...urls];
}

// Mimic the User-Agent Remotion's Chromium sends so servers that gate on UA are caught.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Use GET (not HEAD) — some servers return 200 for HEAD but block GET,
    // or return different headers. Abort after receiving response headers to
    // avoid downloading full image bodies.
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'follow',
    });
    // Abort the body download immediately — we only need the headers.
    await res.body?.cancel();
    const corp = res.headers.get('cross-origin-resource-policy');
    if (corp && RESTRICTIVE_CORP.has(corp.trim().toLowerCase())) {
      return { url, ok: false, reason: `Cross-Origin-Resource-Policy: ${corp}` };
    }
    if (!res.ok) {
      return { url, ok: false, reason: `HTTP ${res.status}` };
    }
    return { url, ok: true };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { url, ok: false, reason: `Timed out after ${TIMEOUT_MS}ms` };
    }
    return { url, ok: false, reason: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check all external URLs in transcript for CORP blocks and HTTP errors.
 * Returns an array of { url, ok, reason } — only failed URLs are returned.
 *
 * @param {string} transcriptPath  Absolute path to transcript.json
 * @param {{ concurrency?: number }} [opts]
 */
export async function checkMediaUrls(transcriptPath, { concurrency = 8 } = {}) {
  const transcript = await fs.readJson(transcriptPath);
  const urls = extractUrls(transcript);
  if (urls.length === 0) return [];

  const failed = [];
  // Process in batches to avoid hammering servers
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(checkUrl));
    failed.push(...results.filter(r => !r.ok));
  }
  return failed;
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

import path from 'path';

const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('/checkMediaUrls.js') || _argv1.endsWith('/checkMediaUrls')) {
  const args = process.argv.slice(2);
  const transcriptIdx = args.indexOf('--transcript');
  const transcriptPath = transcriptIdx !== -1
    ? path.resolve(process.cwd(), args[transcriptIdx + 1])
    : path.resolve(process.cwd(), 'public/edit/transcript.json');

  if (!await fs.pathExists(transcriptPath)) {
    console.error(`Transcript not found: ${transcriptPath}`);
    process.exit(1);
  }

  console.log(`\nChecking media URLs in ${transcriptPath}...\n`);
  const failed = await checkMediaUrls(transcriptPath);

  if (failed.length === 0) {
    console.log('✓ All external URLs OK\n');
  } else {
    console.log(`✗ ${failed.length} URL(s) will fail during render:\n`);
    for (const { url, reason } of failed) {
      console.log(`  [${reason}]`);
      console.log(`  ${url}\n`);
    }
    process.exit(1);
  }
}
