import { YoutubeTranscript } from 'youtube-transcript';

const FILLER_WORDS = [
  'uh', 'um', 'uhh', 'umm', 'uhm', 'er', 'err', 'ah', 'ahh',
  'like,', 'you know,', 'i mean,', 'sort of', 'kind of',
];

const FILLER_REGEX = new RegExp(
  '\\b(' + FILLER_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'gi'
);

class CaptionExtractor {
  constructor() {}

  async init() {}
  async close() {}

  // Fetch all timed caption segments for a video
  async fetchAllCaptions(videoId) {
    console.log(`Fetching captions for video ${videoId}`);

    // Step 0: Try youtube-transcript package (most reliable)
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      if (transcript && transcript.length > 0) {
        console.log(`  youtube-transcript succeeded with ${transcript.length} segments`);
        return transcript.map((s) => ({
          startSec: s.offset / 1000,
          endSec: (s.offset + s.duration) / 1000,
          text: s.text,
        }));
      }
    } catch (e) {
      console.log(`  youtube-transcript failed: ${e.message}, trying fallback...`);
    }

    // Step 1: Fetch the YouTube video page to get caption URLs + cookies
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageResponse = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!pageResponse.ok) {
      throw new Error(`Failed to fetch video page: ${pageResponse.status}`);
    }

    const setCookies = pageResponse.headers.getSetCookie
      ? pageResponse.headers.getSetCookie()
      : (pageResponse.headers.get('set-cookie') || '').split(/,(?=\s*\w+=)/);
    const cookieStr = setCookies
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');

    const html = await pageResponse.text();

    const playerResponseMatch = html.match(
      /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/
    );

    if (!playerResponseMatch) {
      throw new Error('Could not find ytInitialPlayerResponse');
    }

    const playerResponse = JSON.parse(playerResponseMatch[1]);
    const captionTracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    let captionData = null;

    if (captionTracks && captionTracks.length > 0) {
      // Prefer auto-generated English
      const rankedTracks = [...captionTracks].sort((a, b) => {
        const score = (t) => {
          let s = 0;
          if (t.languageCode === 'en') s += 10;
          if (t.kind === 'asr') s += 5;
          return s;
        };
        return score(b) - score(a);
      });

      for (const track of rankedTracks) {
        console.log(`  Trying track: ${track.languageCode} (${track.kind || 'manual'})`);
        captionData = await this.fetchCaptionData(track.baseUrl, cookieStr, videoId, track);
        if (captionData) break;
      }
    } else {
      console.log('  No caption tracks in page response (likely bot-detection) — trying InnerTube...');
    }

    if (!captionData) {
      console.log('  Trying InnerTube ANDROID/IOS fallback...');
      captionData = await this.fetchViaInnertube(videoId);
    }

    if (!captionData) {
      console.log('  Trying youtubei.js fallback...');
      const youtubeiSegments = await this.fetchViaYoutubei(videoId);
      if (!youtubeiSegments) throw new Error('Could not fetch caption data from any source');
      return youtubeiSegments;
    }

    // Step 3: Parse all segments into a unified timed array
    return this.parseAllSegments(captionData);
  }

  withQueryParam(url, key, value) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set(key, value);
      return parsed.toString();
    } catch {
      const join = url.includes('?') ? '&' : '?';
      return `${url}${join}${key}=${encodeURIComponent(value)}`;
    }
  }

  buildCaptionUrls(baseUrl, videoId, track = {}) {
    const urls = [];
    urls.push(baseUrl);
    urls.push(this.withQueryParam(baseUrl, 'fmt', 'json3'));
    urls.push(this.withQueryParam(baseUrl, 'fmt', 'srv3'));
    urls.push(this.withQueryParam(baseUrl, 'fmt', 'vtt'));
    urls.push(this.withQueryParam(baseUrl, 'fmt', 'ttml'));

    try {
      const parsed = new URL(baseUrl);
      const lang = track.languageCode || parsed.searchParams.get('lang') || 'en';
      const kind = track.kind || parsed.searchParams.get('kind');
      const name = parsed.searchParams.get('name');
      const v = parsed.searchParams.get('v') || videoId;

      const timedtext = new URL('https://www.youtube.com/api/timedtext');
      timedtext.searchParams.set('v', v);
      if (lang) timedtext.searchParams.set('lang', lang);
      if (kind) timedtext.searchParams.set('kind', kind);
      if (name) timedtext.searchParams.set('name', name);

      urls.push(timedtext.toString());
      urls.push(this.withQueryParam(timedtext.toString(), 'fmt', 'json3'));
      urls.push(this.withQueryParam(timedtext.toString(), 'fmt', 'srv3'));
    } catch {
      urls.push(`https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en`);
      urls.push(`https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=en&fmt=json3`);
    }

    return [...new Set(urls)];
  }

  async fetchCaptionData(baseUrl, cookieStr, videoId, track = {}) {
    const urls = this.buildCaptionUrls(baseUrl, videoId, track);
    const headerProfiles = [
      {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.youtube.com/',
        ...(cookieStr ? { Cookie: cookieStr } : {}),
      },
      {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    ];

    for (const url of urls) {
      for (const headers of headerProfiles) {
        try {
          const resp = await fetch(url, { headers });
          if (!resp.ok) continue;

          const text = (await resp.text()).trim();
          if (!text) continue;
          if (/^<!doctype html/i.test(text) || /^<html/i.test(text)) continue;

          return text;
        } catch {
          // Continue trying additional URL/header combinations.
        }
      }
    }

    return null;
  }
  async fetchViaInnertube(videoId) {
    const clients = [
      { clientName: 'ANDROID', clientVersion: '19.09.37', apiKey: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w', ua: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip' },
      { clientName: 'IOS', clientVersion: '19.09.3', apiKey: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc', ua: 'com.google.ios.youtube/19.09.3' },
    ];

    for (const client of clients) {
      try {
        const resp = await fetch(
          `https://www.youtube.com/youtubei/v1/player?key=${client.apiKey}&prettyPrint=false`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': client.ua },
            body: JSON.stringify({
              context: { client: { hl: 'en', gl: 'US', clientName: client.clientName, clientVersion: client.clientVersion } },
              videoId,
            }),
          }
        );

        if (!resp.ok) continue;
        const data = await resp.json();
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!tracks || tracks.length === 0) continue;

        let track = tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr');
        if (!track) track = tracks.find((t) => t.languageCode === 'en');
        if (!track) track = tracks[0];

        for (const fmt of ['json3', '']) {
          let url = track.baseUrl;
          if (fmt) url += (url.includes('?') ? '&' : '?') + `fmt=${fmt}`;
          const captionResp = await fetch(url);
          const text = await captionResp.text();
          if (text.length > 0) return text;
        }
      } catch (e) {
        console.log(`  ${client.clientName} error: ${e.message}`);
      }
    }
    return null;
  }

  async fetchViaYoutubei(videoId) {
    try {
      const { Innertube } = await import('youtubei.js');
      const yt = await Innertube.create();
      const info = await yt.getInfo(videoId);

      const captionTracks = info.captions?.caption_tracks;
      if (!captionTracks || captionTracks.length === 0) {
        console.log('  youtubei.js: no caption tracks in video info');
        return null;
      }

      // Caption track URLs contain embedded auth tokens — fetchable from any IP
      const track =
        captionTracks.find(t => t.language_code === 'en' && t.is_autogenerated) ||
        captionTracks.find(t => t.language_code === 'en') ||
        captionTracks[0];

      console.log(`  youtubei.js: using track ${track.language_code} (${track.is_autogenerated ? 'auto' : 'manual'})`);

      for (const fmt of ['json3', 'srv3', '']) {
        try {
          const url = new URL(track.base_url);
          if (fmt) url.searchParams.set('fmt', fmt);
          const resp = await fetch(url.toString());
          if (!resp.ok) continue;
          const text = await resp.text();
          if (!text || /^<!doctype html/i.test(text) || /^<html/i.test(text)) continue;
          return this.parseAllSegments(text);
        } catch { continue; }
      }

      return null;
    } catch (e) {
      console.log(`  youtubei.js failed: ${e.message}`);
      return null;
    }
  }

  // Parse caption data (XML or JSON) into array of { startSec, endSec, text }
  parseAllSegments(captionData) {
    const trimmed = captionData.trimStart();
    const isXml = trimmed.startsWith('<');

    if (isXml) {
      return this.parseXmlSegments(captionData);
    } else {
      return this.parseJsonSegments(captionData);
    }
  }

  parseJsonSegments(jsonStr) {
    const data = JSON.parse(jsonStr);
    const events = data.events || [];
    const segments = [];

    for (const event of events) {
      const startMs = event.tStartMs || 0;
      const durationMs = event.dDurationMs || 0;
      if (!event.segs) continue;

      const text = event.segs.map((s) => s.utf8 || '').join('').trim();
      if (!text || text === '\n') continue;

      segments.push({
        startSec: startMs / 1000,
        endSec: (startMs + durationMs) / 1000,
        text,
      });
    }

    return segments;
  }

  parseXmlSegments(xml) {
    const segments = [];

    // Try <p> elements first (srv3 format)
    const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let match;

    while ((match = pRegex.exec(xml)) !== null) {
      const startMs = parseInt(match[1], 10);
      const durationMs = parseInt(match[2], 10);
      const content = match[3];

      const sRegex = /<s[^>]*>([\s\S]*?)<\/s>/g;
      let sMatch;
      const words = [];
      while ((sMatch = sRegex.exec(content)) !== null) {
        const word = this.decodeHtml(sMatch[1].trim());
        if (word) words.push(word);
      }

      let text = words.length > 0
        ? words.join(' ')
        : this.decodeHtml(content.replace(/<[^>]+>/g, '').trim());

      if (text) {
        segments.push({
          startSec: startMs / 1000,
          endSec: (startMs + durationMs) / 1000,
          text,
        });
      }
    }

    // Fallback: <text> elements
    if (segments.length === 0) {
      const textRegex = /<text\s+start="([^"]+)"\s+dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
      while ((match = textRegex.exec(xml)) !== null) {
        const startSec = parseFloat(match[1]);
        const durSec = parseFloat(match[2]);
        const text = this.decodeHtml(match[3].replace(/<[^>]+>/g, '').trim());
        if (text) {
          segments.push({ startSec, endSec: startSec + durSec, text });
        }
      }
    }

    return segments;
  }

  // Main method: extract captions for a slide (both top and bottom)
  async extractSlideCaptions(videoId, topTimestamp, bottomTimestamp, removeFillers = true) {
    console.log(`Extracting slide captions for video ${videoId}`);
    console.log(`  Top timestamp: ${topTimestamp}s, Bottom timestamp: ${bottomTimestamp}s`);

    const allSegments = await this.fetchAllCaptions(videoId);
    console.log(`  Total caption segments: ${allSegments.length}`);

    if (allSegments.length === 0) {
      return { topCaption: '', bottomCaption: '' };
    }

    // Get the full time range with some context padding for sentence completion
    const minTime = Math.min(topTimestamp, bottomTimestamp);
    const maxTime = Math.max(topTimestamp, bottomTimestamp);
    const contextPadding = 5; // seconds of context before/after for sentence completion

    // Get segments in the padded window
    const paddedStart = Math.max(0, minTime - contextPadding);
    const paddedEnd = maxTime + contextPadding;

    const relevantSegments = allSegments.filter(
      (s) => s.endSec >= paddedStart && s.startSec <= paddedEnd
    );

    if (relevantSegments.length === 0) {
      console.log('  No caption segments found in time range');
      return { topCaption: '', bottomCaption: '' };
    }

    // Build full text with timing info for each word
    const timedWords = [];
    for (const seg of relevantSegments) {
      const words = seg.text.split(/\s+/).filter(Boolean);
      const wordDuration = words.length > 0 ? (seg.endSec - seg.startSec) / words.length : 0;
      words.forEach((word, i) => {
        timedWords.push({
          word,
          time: seg.startSec + i * wordDuration,
        });
      });
    }

    // Split into top half (around topTimestamp) and bottom half (around bottomTimestamp)
    const midpoint = (topTimestamp + bottomTimestamp) / 2;

    // Find words belonging to each half
    const topWords = timedWords.filter((w) => w.time <= midpoint);
    const bottomWords = timedWords.filter((w) => w.time > midpoint);

    // Build raw text for each half
    let topRaw = topWords.map((w) => w.word).join(' ');
    let bottomRaw = bottomWords.map((w) => w.word).join(' ');

    // Remove filler words if requested
    if (removeFillers) {
      topRaw = this.removeFillerWords(topRaw);
      bottomRaw = this.removeFillerWords(bottomRaw);
    }

    // Trim to complete sentences and clean up
    const topCaption = this.trimToSentences(topRaw, 'end');
    const bottomCaption = this.trimToSentences(bottomRaw, 'start');

    console.log(`  Top caption: "${topCaption}"`);
    console.log(`  Bottom caption: "${bottomCaption}"`);

    return { topCaption, bottomCaption };
  }

  // Transcribe a video: returns array of { timestamp, text } sentences
  // Options: { startTime, endTime, removeFillers, includeTimestamps }
  async transcribeVideo(videoId, options = {}) {
    const {
      startTime = null,
      endTime = null,
      removeFillers = true,
    } = options;

    console.log(`Transcribing video ${videoId}`);
    if (startTime !== null) console.log(`  Range: ${startTime}s - ${endTime || 'end'}s`);

    const allSegments = await this.fetchAllCaptions(videoId);
    console.log(`  Total caption segments: ${allSegments.length}`);

    if (allSegments.length === 0) {
      return { sentences: [], fullText: '' };
    }

    // Filter to time range if specified
    let segments = allSegments;
    if (startTime !== null || endTime !== null) {
      const rangeStart = startTime || 0;
      const rangeEnd = endTime || Infinity;
      segments = allSegments.filter(
        (s) => s.endSec >= rangeStart && s.startSec <= rangeEnd
      );
    }

    if (segments.length === 0) {
      return { sentences: [], fullText: '' };
    }

    // Build full text from segments, joining with spaces
    let fullText = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();

    if (removeFillers) {
      fullText = this.removeFillerWords(fullText);
    }

    // Split into sentences and assign timestamps
    // We need to map each sentence back to its approximate start time
    // First, build a word-to-time mapping from segments
    const timedWords = [];
    for (const seg of segments) {
      const words = seg.text.split(/\s+/).filter(Boolean);
      const wordDuration = words.length > 0 ? (seg.endSec - seg.startSec) / words.length : 0;
      words.forEach((word, i) => {
        timedWords.push({
          word: word.toLowerCase().replace(/[^a-z0-9']/g, ''),
          originalWord: word,
          time: seg.startSec + i * wordDuration,
        });
      });
    }

    // Split the cleaned fullText into sentences
    const rawSentences = this.splitIntoSentences(fullText);

    // For each sentence, find the timestamp of its first word
    let wordCursor = 0;
    const sentences = [];

    for (const sentenceText of rawSentences) {
      if (!sentenceText.trim()) continue;

      const sentenceWords = sentenceText.trim().split(/\s+/);
      const firstWord = sentenceWords[0].toLowerCase().replace(/[^a-z0-9']/g, '');

      // Find this word in timedWords starting from cursor
      let timestamp = null;
      for (let i = wordCursor; i < timedWords.length; i++) {
        if (timedWords[i].word === firstWord) {
          timestamp = timedWords[i].time;
          wordCursor = i + sentenceWords.length;
          break;
        }
      }

      // If we couldn't find an exact match, use the cursor position
      if (timestamp === null && wordCursor < timedWords.length) {
        timestamp = timedWords[wordCursor].time;
      } else if (timestamp === null) {
        timestamp = segments[0].startSec;
      }

      const text = sentenceText.trim();
      sentences.push({
        timestamp: Math.round(timestamp * 10) / 10,
        text: text.charAt(0).toUpperCase() + text.slice(1),
      });
    }

    console.log(`  Transcribed ${sentences.length} sentences`);

    return {
      sentences,
      fullText: sentences.map((s) => s.text).join(' '),
    };
  }

  // Split text into sentences using punctuation boundaries
  splitIntoSentences(text) {
    // Split on sentence-ending punctuation followed by a space and uppercase letter,
    // or just on . ! ? followed by space
    const sentences = [];
    let current = '';

    const words = text.split(' ');
    for (let i = 0; i < words.length; i++) {
      current += (current ? ' ' : '') + words[i];

      // Check if this word ends a sentence
      const endsWithPunctuation = /[.!?]$/.test(words[i]);
      const nextWordCapitalized = i + 1 < words.length && /^[A-Z]/.test(words[i + 1]);
      const isLastWord = i === words.length - 1;

      if (endsWithPunctuation && (nextWordCapitalized || isLastWord)) {
        sentences.push(current.trim());
        current = '';
      }
    }

    // Add any remaining text as a final sentence
    if (current.trim()) {
      sentences.push(current.trim());
    }

    return sentences;
  }

  // Legacy single-timestamp method (kept for backward compatibility)
  async extractCaptions(videoId, timestampSeconds) {
    const allSegments = await this.fetchAllCaptions(videoId);
    const windowStart = Math.max(0, timestampSeconds - 1);
    const windowEnd = timestampSeconds + 1;

    const relevant = allSegments.filter(
      (s) => s.endSec >= windowStart && s.startSec <= windowEnd
    );

    if (relevant.length === 0) return '';

    const text = relevant.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  removeFillerWords(text) {
    return text
      .replace(FILLER_REGEX, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.])/g, '$1')
      .trim();
  }

  // Trim text to complete sentences
  // direction: 'end' = trim incomplete sentence at the start, keep end
  // direction: 'start' = trim incomplete sentence at the end, keep start
  trimToSentences(text, keepSide) {
    if (!text) return '';

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();

    // Sentence-ending punctuation
    const sentenceEnders = /[.!?,;]/;

    if (keepSide === 'end') {
      // We want to keep the END of the text (closer to the timestamp)
      // Find the first sentence boundary and trim everything before it
      // Look for a sentence-ending punctuation followed by a space
      const firstBoundary = text.search(/[.!?,;]\s/);
      if (firstBoundary !== -1 && firstBoundary < text.length * 0.6) {
        text = text.substring(firstBoundary + 2);
      }
    } else if (keepSide === 'start') {
      // We want to keep the START of the text
      // Find the last sentence boundary and trim everything after it
      const lastPeriod = text.search(/[.!?,;]\s[^.!?,;]*$/);
      if (lastPeriod !== -1 && lastPeriod > text.length * 0.4) {
        text = text.substring(0, lastPeriod + 1);
      }
    }

    // Capitalize first letter
    text = text.trim();
    if (text) {
      text = text.charAt(0).toUpperCase() + text.slice(1);
    }

    return text;
  }

  decodeHtml(text) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
      .replace(/\n/g, ' ');
  }
}

import fs from 'fs-extra';
import path from 'path';

// Command line interface
if (process.argv[1].endsWith('CaptionExtractor.js')) {
  const videoId = process.argv[2];
  
  if (!videoId) {
    console.error('Usage: node CaptionExtractor.js <video-id>');
    process.exit(1);
  }

  async function generateTranscript() {
    const extractor = new CaptionExtractor();
    try {
      await extractor.init();
      
      console.log(`Generating transcript for video: ${videoId}`);
      const captions = await extractor.fetchAllCaptions(videoId);
      
      if (!captions || captions.length === 0) {
        console.log('No captions found for this video');
        return;
      }

      // Create output directory
      const outputDir = path.join(process.cwd(), 'transcripts');
      await fs.ensureDir(outputDir);
      
      // Generate transcript file
      const outputFile = path.join(outputDir, `${videoId}-transcript.txt`);
      const transcript = captions.map(caption => 
        `[${formatTime(caption.startSec)}] ${caption.text}`
      ).join('\n\n');
      
      await fs.writeFile(outputFile, transcript, 'utf8');
      console.log(`Transcript saved to: ${outputFile}`);
      console.log(`Found ${captions.length} caption segments`);
      
    } catch (error) {
      console.error('Error generating transcript:', error.message);
      process.exit(1);
    } finally {
      await extractor.close();
    }
  }

  function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  generateTranscript();
}

export default CaptionExtractor;
