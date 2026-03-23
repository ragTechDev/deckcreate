# Deckcreate

Transform YouTube videos into stunning carousel images for Instagram, TikTok, and LinkedIn.

## Features

- 🎨 **Mobile-First UI** - Beautiful, responsive interface built with Mantine
- 🎬 **YouTube Integration** - Extract high-quality frames from any YouTube video
- 📝 **Text Overlays** - Add custom text to your carousel slides
- 🎯 **Dual-Frame Slides** - Each slide shows two video frames stacked vertically
- 🤖 **Auto-Extract Captions** - Automatically extract YouTube auto-captions for each slide with filler word removal
- 🖼️ **Custom Branding** - Optional logo overlay on slides
- 🚀 **CLI Support** - Generate carousels via command line or web interface
- 📦 **Batch Processing** - Generate multiple carousels from a single config

## Getting Started

### Installation

```bash
npm install
```

### Run the Web Interface

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the carousel generator interface.

### Using Auto-Extract Captions

The web interface includes an **Auto-extract Captions** feature that pulls YouTube auto-generated captions directly into your slides:

1. Enter a YouTube URL or video ID
2. Set the **Top Frame Timestamp** and **Bottom Frame Timestamp** for a slide
3. Click **Auto-extract Captions** — this fetches the captions spoken between the two timestamps and populates both text fields automatically
4. Edit the extracted text as needed before generating

**How it works:**
- Captions between the two timestamps are split into top and bottom halves at the midpoint
- Partial sentences are completed using surrounding caption context (±5 seconds)
- Top and bottom captions never overlap or duplicate each other
- The **Remove filler words** toggle (on by default) strips out "uh", "um", "er", and similar filler words

### Generate via CLI

Create a `carousel-config.json` file in the project root:

```json
{
  "name": "my-carousel",
  "videoId": "dQw4w9WgXcQ",
  "showLogo": true,
  "slides": [
    {
      "topTimestamp": 10,
      "bottomTimestamp": 15,
      "topText": "First frame text",
      "bottomText": "Second frame text"
    }
  ]
}
```

Then run:

```bash
npm run generate
```

### Bulk Generation

Create a `carousel-bulk-config.json` file:

```json
{
  "transcriptName": "my-video",
  "videoId": "dQw4w9WgXcQ",
  "showLogo": true,
  "carousels": [
    {
      "name": "Carousel 1",
      "description": "First carousel",
      "slides": [...]
    }
  ]
}
```

Then run:

```bash
npm run generate:bulk
```

## Transcribing Audio

Local transcription is powered by [`@remotion/install-whisper-cpp`](https://www.remotion.dev/docs/install-whisper-cpp), which compiles and runs Whisper on-device with word-level timestamps. The workflow is split into two passes to keep word correction separate from structural editing.

```
Audio → transcript.raw.vtt  ← pass 1: correct words in any text editor
      → transcript.raw.json ← pass 2: mark cuts, add speakers & graphics cues
                ↓
         transcript.json     ← Remotion reads this to render the video
```

### Pass 1 — Transcribe

Place an audio file (`.mp3`, `.aac`, `.wav`, or `.m4a`) in `public/audio-to-transcribe/`, then run:

```bash
npm run transcribe
```

Or specify paths explicitly:

```bash
npm run transcribe -- --audio <path> --output-dir <dir> --model tiny.en
```

Outputs to `public/output/`:
- `transcript.raw.vtt` — clean, minimal format for word correction
- `transcript.raw.json` — full structured format with word-level timestamps, cut markers, and graphics cue fields

The `tiny.en` model is used by default. `whisper.cpp` and its models are downloaded on first run to `whisper.cpp/` in the project root (gitignored). Available models: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large-v1` through `large-v3-turbo`.

### Pass 2 — Edit transcript

After correcting words in `transcript.raw.vtt`, merge the corrections back and produce the working `transcript.json`:

```bash
# Initialise transcript.json from raw (no VTT corrections)
npm run edit-transcript

# Merge corrected VTT text into transcript.json
npm run edit-transcript -- --merge-vtt public/output/transcript.raw.vtt
```

Re-running `edit-transcript` is safe — it preserves manual edits (`speaker`, `cut`, `cutReason`, `graphics`) by segment ID and only refreshes timestamps and tokens from the raw source.

Open `transcript.json` to mark cuts and add graphics cues:

```jsonc
{
  "segments": [
    {
      "id": 2,
      "start": 3.4, "end": 5.1,
      "speaker": "Host",
      "text": "Um, so today we're going to...",
      "cut": true,           // ← mark to skip in render
      "cutReason": "filler", // filler | pause | offtopic | duplicate
      "graphics": []
    },
    {
      "id": 3,
      "start": 5.1, "end": 10.8,
      "speaker": "Guest",
      "text": "We're covering the new RAG architecture.",
      "cut": false,
      "cutReason": null,
      "graphics": [
        {
          "type": "LowerThird",       // maps to remotion/components/graphics/LowerThird.tsx
          "at": 5.1, "duration": 3.0,
          "props": { "name": "Dr. Jane Smith", "title": "AI Researcher" }
        }
      ]
    }
  ]
}
```

### Troubleshooting: Whisper Build Errors

`@remotion/install-whisper-cpp` compiles the Whisper C++ binary at runtime (on first `npm run transcribe`), not at `npm install`. Build failures look like:

```
Error: Could not find 'main' binary
make: *** [Makefile:...] Error 1
```

**Common causes and fixes:**

| Issue | Fix |
|---|---|
| Missing C++ build tools on Windows | Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and select the "C++ build tools" workload |
| Missing `make` / `cmake` on macOS/Linux | Run `xcode-select --install` (macOS) or `sudo apt install build-essential cmake` (Linux) |
| `whisper.cpp/` in a broken state | Delete the `whisper.cpp/` directory and re-run `npm run transcribe` |

### Docker-Based Alternative (Recommended for CI / Cross-Platform Use)

If you hit persistent native build errors, a Docker container eliminates the need for local C++ tooling entirely and gives a reproducible environment. **This is strongly recommended** if you are running in CI, sharing the project across different OSes, or cannot resolve the build errors above.

The project includes `Dockerfile.transcribe` and `docker-compose.transcribe.yml` for exactly this purpose.

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

```bash
# Build the image (only needed once, or after dependency changes)
docker compose -f docker-compose.transcribe.yml build

# Run transcription — reads from public/audio-to-transcribe/, writes to public/output/
docker compose -f docker-compose.transcribe.yml run --rm transcribe
```

- Native compilation of the Whisper binary happens inside the Linux container — no host build tools needed.
- Downloaded Whisper models are cached in a named Docker volume (`whisper-models`) so they are not re-downloaded on each run.
- Input/output directories are bind-mounted from the host, so files are accessible normally after the container exits.

## Testing

The project includes comprehensive tests for all scripts:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Coverage

- **CaptionExtractor.js** - Tests YouTube caption fetching, parsing, and text processing
- **CarouselGenerator.js** - Tests image generation, Puppeteer automation, and SVG overlay creation
- **generate-carousel.js** - Tests CLI interface for single and bulk carousel generation

Tests use Jest with mocking for external dependencies (Puppeteer, Sharp, file system) to ensure fast, reliable unit tests.

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **UI Library**: Mantine 8
- **Styling**: Tailwind CSS 4
- **Fonts**: Nunito (Google Fonts)
- **Automation**: Puppeteer with Stealth Plugin
- **Image Processing**: Sharp
- **Testing**: Jest with comprehensive test coverage

## Brand Colors

- **Primary**: `#fc8b94` (Coral Pink)
- **Secondary**: `#a2d4d1` (Mint Green)
- **Accent**: `#ffefae` (Soft Yellow)
- **Brown**: `#d4a89a` (Light Brown)
- **Brown Dark**: `#8b5a49` (Dark Brown)

## Output

Generated carousel slides using CLI are saved to `public/output/[carousel-name]/` as PNG files (1080x1080px).

## License

MIT
