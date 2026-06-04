# Carousel Generation — Architecture Reference

Two carousel generation paths exist. Both produce the same output format (1080×1080 PNG slides), but differ in how slides are sourced: manual (user-defined timestamps) vs. auto (LLM-selected from transcript).

---

## Shared Output Format

Each slide is a **1080×1080 PNG** composed of:
- **Top half** (1080×540): video frame extracted at `topTimestamp`
- **Bottom half** (1080×540): video frame extracted at `bottomTimestamp`
- **Text overlay**: SVG-rendered caption centered across both halves (Nunito font, white with drop shadow)
- **Optional CTA slide**: solid background + logo + platform icons + Techybara mascot

Frame extraction uses **Puppeteer** to load the real YouTube player, seek to the target timestamp, and screenshot the `<video>` element. Three attempts are made per frame; blank frames (all-black or all-white) are retried.

---

## Path A — Manual Carousel

**Entry point:** `/carousel` page → `CarouselForm.tsx`

```
User pastes YouTube URL
  → extractVideoId()          parse URL → videoId
  → getVideoTitle()           YouTube oEmbed → video title

[Optional] Auto-extract captions:
  POST /api/extract-captions
    → CaptionExtractor.extractSlideCaptions(videoId, topTimestamp, bottomTimestamp)
    → fetchAllCaptions()        youtube-transcript package (primary)
                                YouTube page HTML + InnerTube API (fallback)
    → split captions at timestamp midpoint → topCaption, bottomCaption
    → strip filler words (uh, um, like, etc.)

User fills or edits slide table:
  topTimestamp (HH:MM:SS) | bottomTimestamp (HH:MM:SS) | topText | bottomText
  (repeats for each slide)

User clicks Generate:
  POST /api/generate-carousel
    body: { name, videoId, showLogo, slides[], ctaSlide? }
    → CarouselGenerator(config).generateCarousel()
    → for each slide:
        seekAndExtractFrame(page, topTimestamp)   → PNG buffer
        seekAndExtractFrame(page, bottomTimestamp) → PNG buffer
        sharp: resize each frame to 1080×540
        sharp: composite [topFrame, bottomFrame, SVG text overlay]
        → base64 PNG
    → if ctaSlide: generateCtaSlide(ctaConfig)
    ← { success, slides: [{ base64, filename }] }

Browser: download individual PNGs or ZIP
```

**Key files:**
- `app/components/CarouselForm.tsx` — UI
- `app/api/extract-captions/route.ts` — caption extraction endpoint
- `app/api/generate-carousel/route.ts` — generation endpoint
- `scripts/carousel/CarouselGenerator.js` — Puppeteer + sharp compositor
- `scripts/carousel/CaptionExtractor.js` — YouTube caption fetching
- `app/utils/youtube.ts` — `extractVideoId`, `getVideoTitle`, `timeToSeconds`

---

## Path B — Auto Bulk Carousel (LLM-assisted)

**Entry point:** `/auto-carousel` page → `AutoCarouselForm.tsx`

```
User pastes YouTube URL + sets:
  numCarousels (default: 3)
  slidesPerCarousel (default: 5)
  CTA config (optional)

Step 1 — Transcribe:
  POST /api/auto-carousel
    body: { videoId, numCarousels, slidesPerCarousel }
    → CaptionExtractor.transcribeVideo(videoId, { removeFillers: true })
    → fetchAllCaptions() → merge into sentences with timestamps
    → { sentences: [{ timestamp, text }], fullText }

Step 2 — LLM selection:
  [If ANTHROPIC_API_KEY set — production mode]
    buildCarouselPrompt(sentences, numCarousels, slidesPerCarousel, videoDuration)
      → formats transcript as "[Ns] sentence" lines
      → instructs Claude to:
          • select numCarousels engaging segments
          • break each into slidesPerCarousel slides
          • assign sequential topTimestamp/bottomTimestamp from transcript
          • clean grammar, remove fillers, limit to 5–20 words per line
          • make slide 1 of each carousel a hook
    POST https://api.anthropic.com/v1/messages
      model: claude-sonnet-4-20250514 (or CLAUDE_MODEL env var)
      max_tokens: 8192
    parseLLMResponse(response, videoDuration)
      → extract JSON from response text
      → validate each slide: numeric timestamps in [0, videoDuration], non-empty text
      → drop carousels with < 2 valid slides
    ← { success, carousels[], transcription: { sentenceCount, fullText } }

  [If no API key — manual mode]
    ← { mode: "manual", prompt, maxTimestamp, transcription }
    User copies prompt → pastes into Claude → copies JSON response
    POST /api/auto-carousel { step: "build", llmResponse, maxTimestamp }
      → parseLLMResponse() → same validation
    ← { success, carousels[] }

Step 3 — Review & edit:
  UI displays carousels in accordion; user can edit text or delete carousels

Step 4 — Generate:
  for each selected carousel:
    POST /api/generate-carousel (same endpoint as Path A)
      body: { name, videoId, slides, showLogo, ctaSlide? }
    ← base64 PNG slides

Browser: download per-carousel ZIP or individual PNGs
```

**Key files:**
- `app/components/AutoCarouselForm.tsx` — UI (810 lines, decompose target Phase 8)
- `app/api/auto-carousel/route.ts` — transcribe + LLM + parse
- `app/api/generate-carousel/route.ts` — shared generation endpoint (same as Path A)
- `scripts/carousel/CaptionExtractor.js` — `transcribeVideo()` + `fetchAllCaptions()`
- `scripts/carousel/CarouselGenerator.js` — shared Puppeteer + sharp compositor

---

## CaptionExtractor — Caption Sources (priority order)

1. **`youtube-transcript` npm package** — most reliable; fetches English captions directly
2. **YouTube page HTML parse** — fetches `youtube.com/watch?v=ID`, extracts `ytInitialPlayerResponse`, parses XML caption track
3. **InnerTube API** — `youtube.com/youtubei/v1/player` fallback with browser-mimicking headers

Filler words stripped: `uh, um, uhh, umm, uhm, er, err, ah, ahh, like,` `you know,` `i mean,` `sort of` `kind of`

---

## CarouselGenerator — Slide Composition Pipeline

```
for each slide in config.slides:
  1. open YouTube watch page in Puppeteer
  2. skipAds() — polls for ad overlay, clicks skip button up to 30 s
  3. seekAndExtractFrame(topTimestamp):
       video.currentTime = ts; video.pause()
       waitForFunction: readyState >= 2 (timeout 20 s)
       hide UI chrome (spinner, controls, gradients, watermark)
       videoElement.screenshot() → PNG buffer
       verify non-blank: sample 100×100 thumbnail, check >1% non-black & non-white pixels
       retry up to 3× on blank frame
  4. seekAndExtractFrame(bottomTimestamp) — same process
  5. sharp(topFrame).resize(1080, 540)
     sharp(bottomFrame).resize(1080, 540)
  6. generateTextOverlaySVG(topText, bottomText):
       Nunito font, white fill, drop shadow
       word-wrap to fit 1080px wide
       vertically centered on each half
  7. sharp composite: [topFrame, bottomFrame, svgOverlay]
     → 1080×1080 PNG
  8. returnBase64=true → base64 string
     returnBase64=false → write to public/output/{name}/slide-{n}.png
```

---

## CLI Script

`scripts/carousel/carousel-wizard.js` — interactive terminal wizard, supports both YouTube URLs and local video files. Outputs to `public/carousel/` and `public/output/`. Can compile slides to PDF via `compile-pdf.js`.

Not used by the web UI — web UI uses the API routes above.

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Enables production LLM mode in Path B | unset → manual mode |
| `CLAUDE_MODEL` | Claude model for carousel analysis | `claude-sonnet-4-20250514` |

---

## CLI — Local sync path (camera-profiles aware)

`carousel-wizard.js` Path A supports extracting frames from `public/sync/output/` using `camera-profiles.json`:

```
npm run carousel:wizard
  → Choose: 1. YouTube  2. Local synced video

Option 2 workflow:
  1. Wizard loads public/edit/transcript.json + transcript.doc.txt
  2. Duplicates doc to public/carousel/{id}/transcript.doc.txt
       • Guide header replaced with carousel-specific instructions
       • All Remotion directives stripped (> HOOK, > CAM, > SPEAKER,
         > LowerThird, > Callout, > ChapterMarker, > CUT, > START, > END)
       • Only segment lines and speaker headers are kept
  3. User opens doc, adds > CAROUSEL START / > CAROUSEL END markers
  4. Wizard parses marked segments → pairs (top/bottom) per slide
  5. Video source resolution:
       If public/camera-profiles.json exists:
         → Uses angle defined per speaker (speakerProfile.angleName)
         → Applies closeupViewport crop (or time-keyed variant)
         → Applies per-angle videoOffset to seek timestamp
         → Falls back to first angle for unmatched speakers
       Else:
         → User picks a single video from sync/output/
  6. For each slide:
       extractFrameWithFFmpeg(videoPath, effectiveTimestamp)  → raw PNG
       applyViewportAndResize(frame, closeupViewport, srcW, srcH, 1080, 540)
         → crop to closeup region, resize to 1080×540
       composite: [topFrame, bottomFrame, SVG text overlay] → 1080×1080 PNG
  7. CTA slide generated (same as YouTube path)
  8. Optional PDF compilation
```

The `carousel-config.json` saved per carousel now includes:
- `cameraProfilesPath` — path to camera-profiles.json (when used)
- `topSpeaker` / `bottomSpeaker` per slide — used to resolve angle on regeneration

---

## Known Gaps / Future Work

- `CarouselForm.tsx` (web UI) has no local video/transcript source — both web paths require a YouTube `videoId`. Local sync is CLI-only.
- `AutoCarouselForm.tsx` is 810 lines — decompose target in Phase 8.
- No prompt caching on the Claude API call in `/api/auto-carousel`; large transcripts make repeated calls expensive.
- Frame extraction quality depends on YouTube's buffer time; the 20 s readyState timeout can cause blank frames on slow connections.
