---
description: Carousel generation wizard for creating social media carousels from transcripts
---

# Carousel Wizard Workflow

Interactive wizard for generating social media carousels from `transcript.doc.txt` files.

## Entry Point

```bash
npm run carousel:wizard
```

## What it does

1. **Discovers transcripts** in `public/edit/transcript.doc.txt`
2. **Prompts for video source**:
   - YouTube: Extract frames from a YouTube video using timestamps
   - Local video: Use synced videos from long-form pipeline or prompt for new video files
3. **Parses transcript** to extract timestamps and text for slide captions
4. **Generates carousel** using the existing CarouselGenerator

## Video Source Options

### YouTube Mode
- User provides YouTube video ID
- Wizard extracts frames at transcript timestamps using Puppeteer
- Captions pulled from transcript.doc.txt segments

### Local Video Mode
- **Auto-detect**: Looks for synced videos in `public/sync/output/`
- **Manual input**: Prompts user to place video files in `input/video/`
- Uses FFmpeg to extract frames at specified timestamps

## Output

- Carousel slides saved to `public/output/{transcript-name}-carousel/`
- Each slide: 1080x1080 PNG with split-frame layout (top/bottom frames + captions)
