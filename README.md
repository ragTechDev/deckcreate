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

## Video Editor Pipeline

Local transcription is powered by [`@remotion/install-whisper-cpp`](https://www.remotion.dev/docs/install-whisper-cpp), which compiles and runs Whisper on-device with word-level timestamps. Speaker diarization uses [`diarize`](https://github.com/FoxNoseTech/diarize) (wespeaker + silero-vad) via a Python subprocess — no API key required.

### Directory layout

```
public/
  sync/
    video/                          ← drop source video here
    audio/                          ← drop cleaned audio here
    output/                         ← synced-output.mp4
  transcribe/
    input/                          ← drop audio to transcribe here
    output/
      raw/                          ← machine output, don't edit directly
        transcript.raw.vtt          ←   word-level VTT (optional word correction)
        transcript.raw.json         ←   structured JSON with token timestamps
      edit/                         ← your working files
        transcript.doc.txt          ←   human-readable edit file (cuts, speakers, graphics)
        transcript.json             ←   Remotion reads this to render
        transcript.sentences.vtt/.srt
```

### Full workflow

```
npm run sync            # 1. align cleaned audio to raw video
npm run transcribe      # 2. whisper → transcript.raw.json
npm run diarize         # 3. diarize → speaker labels in transcript.raw.json
npm run edit-transcript # 4. generate transcript.doc.txt for editing
# edit transcript.doc.txt
npm run merge-doc       # 5. merge edits → transcript.json (Remotion input)
```

---

### Step 1 — Sync audio to video

Place a video in `public/sync/video/` and a cleaned audio file in `public/sync/audio/`, then run:

```bash
npm run sync
```

Output: `public/sync/output/synced-output.mp4`

---

### Step 2 — Transcribe

Place an audio file (`.mp3`, `.aac`, `.wav`, or `.m4a`) in `public/transcribe/input/`, then run:

```bash
npm run transcribe
```

Or specify paths explicitly:

```bash
npm run transcribe -- --audio <path> --output-dir <dir> --model tiny.en
```

Outputs to `public/transcribe/output/raw/`:
- `transcript.raw.vtt` — word-level VTT, open in any text editor to fix mis-heard words
- `transcript.raw.json` — structured JSON with token timestamps; consumed by later steps

The `tiny.en` model is used by default. `whisper.cpp` and its models are downloaded on first run to `whisper.cpp/` in the project root (gitignored). Available models: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large-v1` through `large-v3-turbo`.

#### Troubleshooting: Whisper Build Errors

`@remotion/install-whisper-cpp` compiles the Whisper C++ binary at runtime (on first `npm run transcribe`), not at `npm install`. Build failures look like:

```
Error: Could not find 'main' binary
make: *** [Makefile:...] Error 1
```

| Issue | Fix |
|---|---|
| Missing C++ build tools on Windows | Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and select the "C++ build tools" workload |
| Missing `make` / `cmake` on macOS/Linux | Run `xcode-select --install` (macOS) or `sudo apt install build-essential cmake` (Linux) |
| `whisper.cpp/` in a broken state | Delete the `whisper.cpp/` directory and re-run `npm run transcribe` |

---

### Step 3 — Diarize (assign speakers)

This step identifies who is speaking and writes speaker labels (`SPEAKER_00`, `SPEAKER_01`, …) into `transcript.raw.json`. It requires Python 3.9–3.12 and no account or API key.

> **Python version:** `diarize` depends on `torch<2.9`, which is only available for Python ≤3.12. Python 3.13+ will not work.

#### One-time setup

**1. Install Python 3.12** if not already available. Check what you have:

```powershell
py --list        # Windows
python3 --version  # macOS / Linux
```

It is recommended to use a dedicated venv to avoid conflicts with your system Python:

```powershell
# Windows (PowerShell)
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r scripts/diarize/requirements.txt
```

```bash
# macOS / Linux
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r scripts/diarize/requirements.txt
```

**2. Install Python dependencies** (if not using the venv activate above):

```bash
pip install -r scripts/diarize/requirements.txt
```

This installs the `diarize` package and its dependencies (torch, torchaudio, wespeaker, silero-vad). Models download automatically on first run.

#### Running diarization

```bash
npm run diarize
```

If using a venv or `python` is not on your PATH:

```bash
# Windows
npm run diarize -- --python .venv\Scripts\python.exe

# macOS / Linux
npm run diarize -- --python .venv/bin/python
```

If you know the exact number of speakers in advance, pass it for more accurate results:

```bash
npm run diarize -- --num-speakers 3
```

**Output:** Speaker labels written back into `public/transcribe/output/raw/transcript.raw.json`.

---

### Step 4 — Edit transcript

Generate the human-readable edit file:

```bash
npm run edit-transcript
```

This produces `public/transcribe/output/edit/transcript.doc.txt` with speaker labels (`SPEAKER_00`, `SPEAKER_01`, …) and inline cut markers. Open it in any text editor.

To merge a corrected VTT (if you fixed word errors in `transcript.raw.vtt`):

```bash
npm run edit-transcript -- --merge-vtt public/transcribe/output/raw/transcript.raw.vtt
```

Re-running `edit-transcript` is safe — it preserves manual edits (`speaker`, `cut`, `cutReason`, `graphics`) by segment ID and only refreshes timestamps and tokens from the raw source.

---

### Step 5 — Merge edits

After editing `transcript.doc.txt` (renaming speakers, marking cuts, adding graphics cues):

```bash
npm run merge-doc
```

With automatic pause cutting:

```bash
npm run merge-doc:cut-pauses    # cuts inter-word silences longer than 0.5s
```

**Output:** `public/transcribe/output/edit/transcript.json` — the final Remotion input.

#### transcript.doc.txt format

```
SPEAKER_00  [25]
I'm Natasha and I'm a software engineer.

SPEAKER_01  [26]
Welcome to ragTech. We are three engineers {um} breaking down tech for everyone.

SPEAKER_00  [27]  CUT:offtopic
Oh so that would be nice.
```

- Rename `SPEAKER_00` etc. to real names — a single find-replace covers the whole file
- `{word}` marks a filler cut; `{word:reason}` marks a cut with a custom reason
- `CUT` or `CUT:reason` on the header line cuts the entire segment
- Graphics cues use `> TypeName  at="word"  duration=3  key=value` on lines after the text

#### transcript.json structure

```jsonc
{
  "segments": [
    {
      "id": 25,
      "start": 42.1, "end": 45.8,
      "speaker": "Natasha",
      "text": "I'm Natasha and I'm a software engineer.",
      "cut": false,
      "cutReason": null,
      "graphics": []
    },
    {
      "id": 26,
      "start": 46.0, "end": 52.3,
      "speaker": "Saloni",
      "text": "Welcome to ragTech.",
      "cut": false,
      "cutReason": null,
      "graphics": [
        {
          "type": "LowerThird",
          "at": 46.0, "duration": 3.0,
          "props": { "name": "Saloni", "title": "Software Developer" }
        }
      ]
    }
  ]
}
```

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
