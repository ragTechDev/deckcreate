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

    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('No caption tracks found for this video');
    }

    // Prefer auto-generated English
    let track = captionTracks.find((t) => t.languageCode === 'en' && t.kind === 'asr');
    if (!track) track = captionTracks.find((t) => t.languageCode === 'en');
    if (!track) track = captionTracks[0];

    console.log(`  Selected track: ${track.languageCode} (${track.kind || 'manual'})`);

    // Step 2: Fetch caption data — try with page cookies first, then InnerTube fallback
    let captionData = await this.fetchCaptionData(track.baseUrl, cookieStr);

    if (!captionData) {
      console.log('  Page cookies failed, trying InnerTube ANDROID fallback...');
      captionData = await this.fetchViaInnertube(videoId);
    }

    if (!captionData) {
      throw new Error('Could not fetch caption data');
    }

    // Step 3: Parse all segments into a unified timed array
    return this.parseAllSegments(captionData);
  }

  async fetchCaptionData(baseUrl, cookieStr) {
    for (const fmt of ['json3', '']) {
      let url = baseUrl;
      if (fmt) url += (url.includes('?') ? '&' : '?') + `fmt=${fmt}`;

      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': cookieStr,
          'Referer': 'https://www.youtube.com/',
        },
      });

      const text = await resp.text();
      if (text.length > 0) return text;
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

module.exports = CaptionExtractor;
