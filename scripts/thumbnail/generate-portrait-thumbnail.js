#!/usr/bin/env node
/**
 * Generate Portrait Thumbnail from Landscape Thumbnail
 *
 * Creates a 1080x1920 portrait thumbnail by:
 * - Loading the landscape thumbnail
 * - Creating a blurred grid background from external images
 * - Centering the landscape thumbnail on the canvas
 * - Adding extended title text above the thumbnail
 *
 * Usage:
 *   node scripts/thumbnail/generate-portrait-thumbnail.js
 *     --input public/thumbnail/thumbnail.png
 *     --output public/thumbnail/thumbnail-portrait.png
 *     --extended-title "Your extended title here"
 *     [--bg-images-url "https://example.com/images"]
 */

import fs from 'fs-extra';
import path from 'path';
import { createCanvas, loadImage, registerFont } from 'canvas';
import https from 'https';
import http from 'http';

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const THUMBNAIL_WIDTH = 1080;  // Landscape thumbnail spans full width
const TITLE_Y = 400;          // Y position for the extended title
const THUMBNAIL_Y = 600;      // Y position for thumbnail (closer to title)

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    input: 'public/thumbnail/thumbnail.png',
    output: 'public/thumbnail/thumbnail-portrait.png',
    extendedTitle: '',
    bgImagesUrl: '',
    episodeNumber: '',
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) result.input = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.output = args[++i];
    else if (args[i] === '--extended-title' && args[i + 1]) result.extendedTitle = args[++i];
    else if (args[i] === '--bg-images-url' && args[i + 1]) result.bgImagesUrl = args[++i];
    else if (args[i] === '--episode-number' && args[i + 1]) result.episodeNumber = args[++i];
  }

  return result;
}

async function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });
    }).on('error', reject);
  });
}

async function downloadBackgroundImages(urls, maxCount = 4) {
  const images = [];

  // Handle comma-separated URLs
  const urlList = urls.split(',').map(u => u.trim()).filter(Boolean);
  console.log(`  URL list (${urlList.length} URLs):`, urlList);

  // Download each URL (up to maxCount)
  for (let i = 0; i < urlList.length && images.length < maxCount; i++) {
    try {
      console.log(`  Downloading image ${i + 1}/${urlList.length}: ${urlList[i].substring(0, 60)}...`);
      const buffer = await fetchImage(urlList[i]);
      images.push(buffer);
      console.log(`  ✓ Image ${i + 1} downloaded (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.warn(`  ✗ Failed to fetch background image ${i + 1}: ${err.message}`);
    }
  }

  console.log(`  Total images downloaded: ${images.length}`);
  return images;
}

async function generatePortraitThumbnail(args) {
  const cwd = process.cwd();
  const inputPath = path.resolve(cwd, args.input);
  const outputPath = path.resolve(cwd, args.output);

  // Check input exists
  if (!await fs.pathExists(inputPath)) {
    console.error(`Input thumbnail not found: ${inputPath}`);
    process.exit(1);
  }

  console.log('Generating portrait thumbnail...');
  console.log(`  Input: ${args.input}`);
  console.log(`  Output: ${args.output}`);
  if (args.extendedTitle) {
    console.log(`  Extended title: ${args.extendedTitle}`);
  }

  // Create canvas
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Fill with dark background as fallback
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Download and draw background if URL provided
  if (args.bgImagesUrl) {
    console.log('  Downloading background images...');
    const bgImages = await downloadBackgroundImages(args.bgImagesUrl, 4);

    if (bgImages.length > 0) {
      console.log(`  Drawing ${bgImages.length} background image(s)...`);

      // Determine layout: vertical stack (1-3 images) or 2x2 grid (4 images)
      const numImages = bgImages.length;
      let cols, rows, cellWidth, cellHeight;

      if (numImages <= 3) {
        // Vertical stack
        cols = 1;
        rows = numImages;
        cellWidth = CANVAS_WIDTH;
        cellHeight = CANVAS_HEIGHT / numImages;
      } else {
        // 2x2 grid
        cols = 2;
        rows = 2;
        cellWidth = CANVAS_WIDTH / 2;
        cellHeight = CANVAS_HEIGHT / 2;
      }

      for (let i = 0; i < numImages; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;

        try {
          const img = await loadImage(bgImages[i]);
          const cellX = col * cellWidth;
          const cellY = row * cellHeight;

          // Calculate cover scaling to maintain aspect ratio
          const imgAspect = img.width / img.height;
          const cellAspect = cellWidth / cellHeight;

          let drawWidth, drawHeight, drawX, drawY;

          if (imgAspect > cellAspect) {
            // Image is wider than cell - scale to fit height, crop width
            drawHeight = cellHeight;
            drawWidth = cellHeight * imgAspect;
            drawX = cellX + (cellWidth - drawWidth) / 2;
            drawY = cellY;
          } else {
            // Image is taller than cell - scale to fit width, crop height
            drawWidth = cellWidth;
            drawHeight = cellWidth / imgAspect;
            drawX = cellX;
            drawY = cellY + (cellHeight - drawHeight) / 2;
          }

          // Draw image with maintained aspect ratio (cover mode)
          ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
        } catch (err) {
          // Fill with fallback color if image fails to load
          ctx.fillStyle = `hsl(${(i * 30) % 360}, 40%, 25%)`;
          ctx.fillRect(col * cellWidth, row * cellHeight, cellWidth, cellHeight);
        }
      }

      // Apply heavy blur to background
      const tempCanvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(canvas, 0, 0);

      // Reset and redraw blurred background
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      // Apply blur filter when drawing the temp canvas back
      ctx.filter = 'blur(60px)';
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.filter = 'none';

      // Add dark overlay for better contrast
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  } else {
    // Default gradient background
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#2a1a3e');
    gradient.addColorStop(0.5, '#1a1a3e');
    gradient.addColorStop(1, '#0d1b2a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // Draw episode number pill FIRST (above extended title)
  if (args.episodeNumber) {
    console.log(`  Adding episode pill: EP ${args.episodeNumber}`);

    const pillText = `EP ${args.episodeNumber}`;
    const pillPaddingX = 36;
    const pillPaddingY = 18;
    const pillFontSize = 48;

    // Set up font for measurement
    ctx.font = `bold ${pillFontSize}px "Liberation Sans", "DejaVu Sans", sans-serif`;
    const textMetrics = ctx.measureText(pillText);
    const textWidth = textMetrics.width;
    const textHeight = pillFontSize;

    // Pill dimensions
    const pillWidth = textWidth + (pillPaddingX * 2);
    const pillHeight = textHeight + (pillPaddingY * 2);
    const pillX = (CANVAS_WIDTH - pillWidth) / 2;
    const pillY = TITLE_Y - pillHeight - 30; // 30px gap above title

    // Draw white pill background
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 3;

    // Rounded rectangle
    const cornerRadius = pillHeight / 2;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillWidth, pillHeight, cornerRadius);
    ctx.fill();

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Draw black text on pill
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pillText, pillX + pillWidth / 2, pillY + pillHeight / 2);
  }

  // Draw extended title (so it's behind the thumbnail shadow but visible)
  console.log(`  Checking extendedTitle: "${args.extendedTitle}"`);
  if (args.extendedTitle) {
    console.log(`  Adding extended title: "${args.extendedTitle}"`);

    // Set up text style
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Use Liberation Sans which exists in Docker container
    ctx.font = 'bold 56px "Liberation Sans", "DejaVu Sans", sans-serif';

    // Word wrap
    const maxWidth = CANVAS_WIDTH - 120;
    const words = args.extendedTitle.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    // Draw lines
    const lineHeight = 72;
    const startY = TITLE_Y;

    // Add text lift effect with layered shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 25;
    ctx.shadowOffsetY = 5;

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], CANVAS_WIDTH / 2, startY + (i * lineHeight));
    }

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  // Load and draw the landscape thumbnail (full width)
  console.log('  Composing thumbnail...');
  const thumbnailImg = await loadImage(inputPath);

  // Calculate scaled dimensions to span full width
  const thumbWidth = THUMBNAIL_WIDTH;
  const thumbHeight = (thumbnailImg.height / thumbnailImg.width) * thumbWidth;

  const thumbX = 0; // Full width, no horizontal padding
  const thumbY = THUMBNAIL_Y;

  // Add shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 20;

  // Draw thumbnail
  ctx.drawImage(thumbnailImg, thumbX, thumbY, thumbWidth, thumbHeight);

  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Save output
  await fs.ensureDir(path.dirname(outputPath));
  const buffer = canvas.toBuffer('image/png');
  await fs.writeFile(outputPath, buffer);

  console.log(`✓ Portrait thumbnail saved: ${args.output}`);
  process.exit(0);
}

async function loadFromTranscript(args) {
  const cwd = process.cwd();
  const transcriptPath = path.join(cwd, 'public', 'edit', 'transcript.json');

  if (!await fs.pathExists(transcriptPath)) {
    return args;
  }

  try {
    const transcript = await fs.readJson(transcriptPath);
    const thumb = transcript.meta?.thumbnail;

    if (!thumb) {
      return args;
    }

    // Fill in missing values from transcript.json
    if (!args.extendedTitle && thumb.extendedTitle) {
      args.extendedTitle = thumb.extendedTitle;
      console.log(`  Loaded extendedTitle from transcript: "${args.extendedTitle}"`);
    }

    if (!args.episodeNumber && thumb.episodeNumber) {
      args.episodeNumber = thumb.episodeNumber;
      console.log(`  Loaded episodeNumber from transcript: ${args.episodeNumber}`);
    }

    if (!args.bgImagesUrl && thumb.bg?.length) {
      args.bgImagesUrl = thumb.bg.join(',');
      console.log(`  Loaded ${thumb.bg.length} background image(s) from transcript`);
    }

    return args;
  } catch (err) {
    console.warn(`  Warning: Could not read transcript.json: ${err.message}`);
    return args;
  }
}

async function main() {
  let args = parseArgs();

  // Auto-fill from transcript.json if values not provided via CLI
  args = await loadFromTranscript(args);

  try {
    await generatePortraitThumbnail(args);
  } catch (err) {
    console.error('Error generating portrait thumbnail:', err.message);
    process.exit(1);
  }
}

main();
