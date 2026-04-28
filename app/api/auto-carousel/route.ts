import { NextRequest, NextResponse } from 'next/server';
import CaptionExtractor from '@/scripts/carousel/CaptionExtractor';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

interface Sentence {
  timestamp: number;
  text: string;
}

interface LLMCarousel {
  carouselTitle: string;
  slides: {
    topTimestamp: number;
    bottomTimestamp: number;
    topText: string;
    bottomText: string;
  }[];
}

interface OutputSlide {
  topTimestamp: number;
  bottomTimestamp: number;
  topText: string;
  bottomText: string;
}

interface OutputCarousel {
  carouselTitle: string;
  slides: OutputSlide[];
}

// ── Claude API call ─────────────────────────────────────────────────────

async function callClaude(prompt: string, maxTokens = 8192): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude API request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = data.content?.[0];
  return content?.text || '';
}

function hasApiKey(): boolean {
  return ANTHROPIC_API_KEY.length > 0;
}

// ── Single LLM prompt: select segments + clean for carousel engagement ──

function buildCarouselPrompt(
  sentences: Sentence[],
  numCarousels: number,
  slidesPerCarousel: number,
  videoDuration: number
): string {
  const transcriptText = sentences
    .map((s) => `[${s.timestamp}s] ${s.text}`)
    .join('\n');

  const firstTs = sentences[0]?.timestamp ?? 0;
  const lastTs = sentences[sentences.length - 1]?.timestamp ?? 0;
  const totalDuration = lastTs - firstTs;
  const idealSpacing = Math.floor(totalDuration / (numCarousels + 1));
  const minSpacing = Math.max(60, Math.floor(totalDuration / (numCarousels * 2)));

  return `You are a social media content strategist creating Instagram carousel posts from a video transcript.

TASK: Analyze this transcript and produce ${numCarousels} carousels, each with ${slidesPerCarousel} slides. Each slide has a top text and bottom text overlaid on a video screenshot.

IMPORTANT: The video is ${Math.floor(videoDuration)} seconds long. ALL timestamps must be between 0 and ${Math.floor(videoDuration)} seconds. Do NOT use timestamps beyond this range.

STEP 1 — SELECT SEGMENTS:
1. Identify ${numCarousels} that would make engaging carousel content
2. For each takeaway, select a ~30-60 second sequential segment from the transcript
3. Break each segment into ${slidesPerCarousel} slides with sequential timestamps

STEP 2 — CLEAN & FORMAT EACH SEGMENT FOR SLIDES:
- For each slide, pick two consecutive moments from the segment. Each moment becomes one line of text (topText and bottomText).
- Clean up the transcript text for each line:
  • Fix grammar errors and typos (e.g. "jarens" → "jargons", "I I don't" → "I don't").
  • Remove filler words (uh, um, hmm) ONLY if it doesn't change meaning.
  • Break long sentences into concise clauses. Each line should be 5-20 words, punchy and readable on a phone screen.
  • Do NOT use em dashes (—) in any text. Use a comma, period, or rephrase instead.
  • Remove pure filler ("Yeah.", "Right.", "Uh huh.") — skip those moments entirely.
  • Do NOT invent new content. Only clean up what's in the transcript.
- topTimestamp and bottomTimestamp must be actual timestamps from the transcript (the [Xs] values).
- Slides within a carousel must progress forward in time.
- Slide 1 of each carousel should be the hook — the most attention-grabbing line.

TRANSCRIPT:
${transcriptText}

Respond with ONLY valid JSON, no other text:
{
  "carousels": [
    {
      "carouselTitle": "Short Topic Title",
      "slides": [
        {
          "topTimestamp": 45,
          "bottomTimestamp": 48,
          "topText": "cleaned concise hook line",
          "bottomText": "cleaned concise follow-up line"
        },
        {
          "topTimestamp": 52,
          "bottomTimestamp": 55,
          "topText": "next concise point",
          "bottomText": "supporting detail"
        }
      ]
    }
  ]
}

Rules for slides:
- Timestamps must be SEQUENTIAL within each carousel (not jumping around)
- Each slide covers ~3-8 seconds of dialogue
- topText and bottomText should be punchy, quotable snippets
- Clean up filler words (um, uh, like) but keep the authentic voice
- Each carousel should tell a complete mini-story or make one clear point

Rules for slides:
- Timestamps must be SEQUENTIAL within each carousel (not jumping around)
- Each slide covers ~3-8 seconds of dialogue
- topText and bottomText should be punchy, quotable snippets
- Clean up filler words (um, uh, like) but keep the authentic voice
- Each carousel should tell a complete mini-story or make one clear point`;
}

// ── Parse LLM response ──────────────────────────────────────────────────

function parseLLMResponse(response: string, maxTimestamp: number): OutputCarousel[] {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in response');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.carousels || !Array.isArray(parsed.carousels)) {
    throw new Error('Invalid response format — missing carousels array');
  }

  const carousels: OutputCarousel[] = [];

  for (const c of parsed.carousels as LLMCarousel[]) {
    if (!c.slides || !Array.isArray(c.slides) || c.slides.length < 2) continue;

    const validSlides = c.slides.filter(
      (s) =>
        typeof s.topTimestamp === 'number' &&
        typeof s.bottomTimestamp === 'number' &&
        typeof s.topText === 'string' &&
        typeof s.bottomText === 'string' &&
        s.topText.trim().length > 0 &&
        s.bottomText.trim().length > 0 &&
        s.topTimestamp >= 0 &&
        s.topTimestamp <= maxTimestamp &&
        s.bottomTimestamp >= 0 &&
        s.bottomTimestamp <= maxTimestamp
    );

    if (validSlides.length >= 2) {
      carousels.push({
        carouselTitle: c.carouselTitle || 'Untitled',
        slides: validSlides,
      });
      console.log(`  Carousel "${c.carouselTitle}": ${validSlides.length} valid slides (filtered ${c.slides.length - validSlides.length} invalid)`);
    }
  }

  return carousels;
}

// ── API handler ─────────────────────────────────────────────────────────
//
// PRODUCTION (ANTHROPIC_API_KEY is set):
//   Single POST { videoId, numCarousels, slidesPerCarousel }
//   → transcribes, calls Claude with single prompt, returns carousels
//
// LOCAL TESTING (no API key):
//   Step 1: POST { videoId, numCarousels, slidesPerCarousel }
//     → returns { mode: "manual", prompt, ... }
//
//   Step 2: POST { step: "build", llmResponse }
//     → parses response, returns { success, carousels }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── Manual mode: user submits Claude response ─────────────────────
    if (body.step === 'build') {
      const { llmResponse, maxTimestamp = 3600 } = body;

      if (!llmResponse) {
        return NextResponse.json({ error: 'Missing llmResponse' }, { status: 400 });
      }

      let carousels: OutputCarousel[];
      try {
        carousels = parseLLMResponse(llmResponse, maxTimestamp);
      } catch (e) {
        return NextResponse.json(
          { error: `Failed to parse response: ${e instanceof Error ? e.message : 'unknown error'}` },
          { status: 400 }
        );
      }

      if (carousels.length === 0) {
        return NextResponse.json({ error: 'No valid carousels found in response.' }, { status: 400 });
      }

      console.log(`  Built ${carousels.length} carousels from manual response`);
      return NextResponse.json({ success: true, carousels });
    }

    // ── Step 1: Transcribe + generate prompt ──────────────────────────
    const {
      videoId,
      numCarousels = 3,
      slidesPerCarousel = 5,
    } = body;

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
    }

    console.log(`\n🤖 Auto-carousel: Transcribing video ${videoId}`);

    const extractor = new CaptionExtractor();
    await extractor.init();
    let transcription: { sentences: Sentence[]; fullText: string };
    try {
      transcription = await extractor.transcribeVideo(videoId, { removeFillers: true });
    } finally {
      await extractor.close();
    }

    if (!transcription.sentences || transcription.sentences.length === 0) {
      return NextResponse.json(
        { error: 'No captions found for this video' },
        { status: 400 }
      );
    }

    const rawSentences = transcription.sentences;
    console.log(`  Transcribed ${rawSentences.length} raw sentences`);

    // Calculate video duration from transcript (use conservative estimate to avoid YouTube errors)
    const maxTranscriptTime = rawSentences.length > 0
      ? Math.max(...rawSentences.map(s => s.timestamp))
      : 3600;
    // Use transcript end time minus 15s safety margin (YouTube may not buffer beyond transcript, and videos may be shorter)
    const videoDuration = Math.max(60, maxTranscriptTime - 15);
    console.log(`  Transcript ends at ${Math.floor(maxTranscriptTime)}s, using max timestamp ${Math.floor(videoDuration)}s for safety`);

    const prompt = buildCarouselPrompt(rawSentences, numCarousels, slidesPerCarousel, videoDuration);

    if (hasApiKey()) {
      // ── Production: call Claude directly ───────────────────────────
      console.log(`  Calling Claude (${CLAUDE_MODEL})...`);

      const llmResponse = await callClaude(prompt);
      console.log(`  Response: ${llmResponse.length} chars`);

      let carousels: OutputCarousel[];
      try {
        carousels = parseLLMResponse(llmResponse, videoDuration);
      } catch (e) {
        console.error('Failed to parse Claude response:', llmResponse.substring(0, 500));
        return NextResponse.json(
          { error: 'Failed to parse Claude response. Try again.' },
          { status: 500 }
        );
      }

      if (carousels.length === 0) {
        return NextResponse.json({ error: 'Claude did not return valid carousels. Try again.' }, { status: 500 });
      }

      console.log(`  Built ${carousels.length} carousels`);

      return NextResponse.json({
        success: true,
        carousels,
        transcription: {
          sentenceCount: rawSentences.length,
          fullText: transcription.fullText,
        },
      });
    }

    // ── Manual mode: return prompt for user ──────────────────────────
    console.log('  No ANTHROPIC_API_KEY — returning prompt for manual mode');

    return NextResponse.json({
      mode: 'manual',
      prompt,
      maxTimestamp: videoDuration,
      transcription: {
        sentenceCount: rawSentences.length,
        fullText: transcription.fullText,
      },
    });
  } catch (error) {
    console.error('Auto-carousel error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate auto-carousel' },
      { status: 500 }
    );
  }
}
