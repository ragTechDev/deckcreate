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

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **UI Library**: Mantine 8
- **Styling**: Tailwind CSS 4
- **Fonts**: Nunito (Google Fonts)
- **Automation**: Puppeteer with Stealth Plugin
- **Image Processing**: Sharp

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
