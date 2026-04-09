import sharp from 'sharp';
import fs from 'fs-extra';
import path from 'path';

const IS_SERVERLESS = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL || process.env.NETLIFY);

// Set TEST_BLOCK_ALL_MEDIA=true in Netlify env vars to test whether Chrome crashes
// even when NO video data is allowed. If it still crashes → baseline Chromium OOM.
// If it doesn't crash → video streaming is the cause.
const TEST_BLOCK_ALL_MEDIA = process.env.TEST_BLOCK_ALL_MEDIA === 'true';

// Default to the chromium-v131 release which aligns with puppeteer v23's bundled Chrome.
// Override via CHROMIUM_BINARY_URL env var if needed.
const CHROMIUM_BINARY_URL =
  process.env.CHROMIUM_BINARY_URL ||
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';

class CarouselGenerator {
  constructor(config) {
    this.config = config;
    this.returnBase64 = config.returnBase64 || false;
    this.outputDir = this.returnBase64 
      ? null 
      : path.join(process.cwd(), 'public', 'output', config.name);
    this.browser = null;
  }

  async init() {
    if (this.outputDir) {
      await fs.ensureDir(this.outputDir);
    }

    if (IS_SERVERLESS) {
      const chromium = (await import('@sparticuz/chromium-min')).default;
      const executablePath = await chromium.executablePath(CHROMIUM_BINARY_URL);
      console.log(`Using serverless Chromium: ${executablePath}`);
      const { launch } = await import('puppeteer-core');
      // Use chromium.args as-is — they're tuned for Lambda.
      // Only add flags that don't conflict with chromium.args.
      this.browser = await launch({
        headless: true,
        executablePath,
        args: [
          ...chromium.args.filter(arg =>
            !arg.startsWith('--autoplay-policy') &&
            arg !== '--single-process'
          ),
          '--autoplay-policy=no-user-gesture-required',
          '--disable-blink-features=AutomationControlled',
          '--disable-notifications',
          '--disable-webgl',
          '--disable-webgl2',
        ],
        protocolTimeout: 60000,
        defaultViewport: null,
      });
    } else {
      const { launch } = await import('puppeteer');
      this.browser = await launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-dev-shm-usage',
          '--enable-features=NetworkService,NetworkServiceInProcess',
          '--force-device-scale-factor=1',
          '--high-dpi-support=1',
          '--start-maximized',
          '--disable-notifications',
          '--disable-gpu-memory-buffer-video-frames',
          '--autoplay-policy=no-user-gesture-required',
        ],
        protocolTimeout: 60000,
        defaultViewport: null,
      });
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async skipAds(page) {
    const maxWait = 30000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const adState = await page.evaluate(() => {
        const player = document.querySelector('.html5-video-player');
        const isAd = player && player.classList.contains('ad-showing');
        const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button');
        const overlay = document.querySelector('.ytp-ad-overlay-close-button');
        return { isAd, hasSkip: !!skipBtn, hasOverlay: !!overlay };
      });

      if (!adState.isAd && !adState.hasOverlay) break;

      if (adState.hasSkip) {
        console.log('  Ad — clicking skip...');
        try { await page.click('.ytp-skip-ad-button, .ytp-ad-skip-button'); } catch (_) {}
        await new Promise(r => setTimeout(r, 1500));
      } else if (adState.hasOverlay) {
        try { await page.click('.ytp-ad-overlay-close-button'); } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
      } else {
        console.log('  Waiting for ad to finish...');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async seekAndExtractFrame(page, timestamp) {
    console.log(`  Seeking to ${timestamp}s...`);

    // Log Chrome memory and request stats before unblocking video
    try {
      const metrics = await page.metrics();
      const nodeMem = process.memoryUsage();
      console.log(`  [mem] Chrome JS heap: ${Math.round(metrics.JSHeapUsedSize / 1024 / 1024)}MB used / ${Math.round(metrics.JSHeapTotalSize / 1024 / 1024)}MB total`);
      console.log(`  [mem] Node RSS: ${Math.round(nodeMem.rss / 1024 / 1024)}MB`);
      console.log(`  [req] Media requests so far: ${this.mediaRequestsAborted} aborted, ${this.mediaRequestsAllowed} allowed`);
    } catch (e) {
      console.log(`  [mem] Could not read metrics: ${e.message}`);
    }

    // Log total system memory from /proc/meminfo (Linux/Lambda)
    try {
      const { execSync } = await import('child_process');
      const meminfo = execSync('cat /proc/meminfo').toString();
      const total = meminfo.match(/MemTotal:\s+(\d+)/)?.[1];
      const available = meminfo.match(/MemAvailable:\s+(\d+)/)?.[1];
      if (total && available) {
        const totalMB = Math.round(parseInt(total) / 1024);
        const availMB = Math.round(parseInt(available) / 1024);
        const usedMB = totalMB - availMB;
        console.log(`  [mem] System: ${usedMB}MB used / ${totalMB}MB total (${availMB}MB available)`);
      }
    } catch (e) {
      console.log(`  [mem] Could not read /proc/meminfo: ${e.message}`);
    }

    // Unblock video requests so this specific segment can load
    if (!TEST_BLOCK_ALL_MEDIA) {
      this.allowVideoRequests = true;
    }

    try {
      // Skip any ads that may appear now that media requests are unblocked
      await this.skipAds(page);

      // Seek and pause at target timestamp
      await page.evaluate((ts) => {
        const video = document.querySelector('video');
        if (video) {
          video.currentTime = ts;
          video.pause();
        }
      }, timestamp);

      // Poll for readyState >= 2, logging the exact moment of any failure
      console.log('  Waiting for video to buffer...');
      let readyStateReached = false;
      let videoState = null;
      const pollStart = Date.now();
      while (Date.now() - pollStart < 20000) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const state = await page.evaluate(() => {
            const v = document.querySelector('video');
            if (!v) return null;
            return { readyState: v.readyState, currentTime: v.currentTime, networkState: v.networkState, videoWidth: v.videoWidth, videoHeight: v.videoHeight };
          });
          if (state) {
            videoState = state;
            if (state.readyState >= 2) { readyStateReached = true; break; }
          }
        } catch (e) {
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.error(`  [detach at ${elapsed}s] ${e.message}`);
          console.error(`  [detach] page url: ${page.url()}`);
          console.error(`  [detach] media requests: ${this.mediaRequestsAborted} aborted, ${this.mediaRequestsAllowed} allowed`);
          throw new Error(`Frame detached while waiting for video at ${timestamp}s (${elapsed}s elapsed): ${e.message}`);
        }
      }
      console.log(`  Video state: readyStateReached=${readyStateReached}`, videoState);

      if (!readyStateReached) {
        console.warn(`  WARNING: readyState ${videoState?.readyState ?? 'unknown'} after 20s — frame may be blank`);
      }

      // Capture the frame
      let screenshot = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        // Hide spinner on every attempt — it can reappear during buffering
        await page.evaluate(() => {
          ['.ytp-spinner', '.ytp-buffering-spinner'].forEach(sel => {
            document.querySelectorAll(sel).forEach(el => el.style.display = 'none');
          });
        }).catch(() => {});

        const videoElement = await page.$('video');
        if (!videoElement) throw new Error('Video element not found');

        const elementShot = await videoElement.screenshot({ type: 'png' });
        console.log(`  Screenshot attempt ${attempt + 1}: ${elementShot.length} bytes`);

        const { data, info } = await sharp(elementShot)
          .resize(100, 100, { fit: 'fill' })
          .raw()
          .toBuffer({ resolveWithObject: true });

        let nonBlack = 0;
        for (let i = 0; i < data.length; i += info.channels) {
          if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) nonBlack++;
        }
        const ratio = nonBlack / (info.width * info.height);
        console.log(`  Non-black pixel ratio: ${ratio.toFixed(3)}`);

        if (ratio < 0.01) {
          console.warn('  Blank frame, retrying in 3s...');
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        screenshot = elementShot;
        break;
      }

      if (!screenshot) throw new Error('Could not extract a non-blank video frame after multiple attempts');

      console.log('  Frame extracted successfully');
      return screenshot;
    } catch (e) {
      this.allowVideoRequests = false;
      throw e;
    }
    // Note: we intentionally leave allowVideoRequests = true after a successful
    // capture so the player stays happy between seeks. The initial block during
    // page setup was enough to prevent the HD streaming OOM.
  }

  wordWrapText(text, maxWidth, fontSize) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    words.forEach(word => {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      if (testLine.length * (fontSize * 0.6) > maxWidth) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    if (currentLine) lines.push(currentLine);
    
    return lines;
  }

  async loadNunitoFont() {
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'Nunito', 'static', 'Nunito-Bold.ttf');
    const fontBuffer = await fs.readFile(fontPath);
    return fontBuffer.toString('base64');
  }

  generateTextOverlaySVG(width, height, topText, bottomText, fontData) {
    const fontSize = 36;
    const padding = 30;
    const textBottomMargin = 20;
    const lineHeight = fontSize * 1.2;
    const halfHeight = height / 2;
    
    const topLines = this.wordWrapText(topText, width - (padding * 2), fontSize);
    const bottomLines = this.wordWrapText(bottomText, width - (padding * 2), fontSize);
    
    const topTextY = halfHeight - (topLines.length * lineHeight) - textBottomMargin;
    const bottomTextY = height - (bottomLines.length * lineHeight) - textBottomMargin;

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style type="text/css"><![CDATA[
            @font-face {
              font-family: 'Nunito';
              font-style: normal;
              font-weight: 700;
              src: url(data:font/truetype;charset=utf-8;base64,${fontData}) format('truetype');
            }
            text {
              font-family: 'Nunito', Arial, sans-serif;
            }
          ]]></style>
          <filter id="shadow">
            <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.8"/>
          </filter>
        </defs>
        
        <g filter="url(#shadow)">
          ${topLines.map((line, i) => `
            <text 
              x="${width / 2}" 
              y="${topTextY + (i * lineHeight)}" 
              font-family="Nunito, Arial, sans-serif" 
              font-size="${fontSize}" 
              font-weight="700" 
              fill="white" 
              text-anchor="middle"
              stroke="#000000"
              stroke-width="3"
              paint-order="stroke"
              letter-spacing="0.5"
              text-rendering="geometricPrecision"
            >${this.escapeXml(line)}</text>
          `).join('')}
        </g>
        
        <g filter="url(#shadow)">
          ${bottomLines.map((line, i) => `
            <text 
              x="${width / 2}" 
              y="${bottomTextY + (i * lineHeight)}" 
              font-family="Nunito, Arial, sans-serif" 
              font-size="${fontSize}" 
              font-weight="700" 
              fill="white" 
              text-anchor="middle"
              stroke="#000000"
              stroke-width="3"
              paint-order="stroke"
              letter-spacing="0.5"
              text-rendering="geometricPrecision"
            >${this.escapeXml(line)}</text>
          `).join('')}
        </g>
      </svg>
    `;

    return svg;
  }

  escapeXml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async generateSlide(slideConfig, slideNumber, page) {
    console.log(`Generating slide ${slideNumber}`);
    console.log(`  Top: ${slideConfig.topText}`);
    console.log(`  Bottom: ${slideConfig.bottomText}`);

    const width = 1080;
    const height = 1080;
    const halfHeight = height / 2;

    let topScreenshot, bottomScreenshot;
    
    try {
      topScreenshot = await this.seekAndExtractFrame(page, slideConfig.topTimestamp);
    } catch (error) {
      console.error(`  Failed to extract frame at ${slideConfig.topTimestamp}s:`, error.message);
      throw new Error(`Invalid timestamp ${slideConfig.topTimestamp}s - ${error.message}`);
    }

    try {
      bottomScreenshot = await this.seekAndExtractFrame(page, slideConfig.bottomTimestamp);
    } catch (error) {
      console.error(`  Failed to extract frame at ${slideConfig.bottomTimestamp}s:`, error.message);
      throw new Error(`Invalid timestamp ${slideConfig.bottomTimestamp}s - ${error.message}`);
    }

    // Use Sharp to resize and crop frames to fit each half
    const topFrame = await sharp(topScreenshot)
      .resize(width, halfHeight, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    const bottomFrame = await sharp(bottomScreenshot)
      .resize(width, halfHeight, { fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    // Generate text overlay SVG (no embedded images, just text)
    const fontData = await this.loadNunitoFont();
    const textOverlaySvg = this.generateTextOverlaySVG(
      width, height, slideConfig.topText, slideConfig.bottomText, fontData
    );
    const textOverlayBuffer = Buffer.from(textOverlaySvg);

    // Composite everything with Sharp: top frame + bottom frame + text overlay
    const composited = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([
        { input: topFrame, top: 0, left: 0 },
        { input: bottomFrame, top: halfHeight, left: 0 },
        { input: textOverlayBuffer, top: 0, left: 0 },
      ])
      .png()
      .toBuffer();

    if (this.returnBase64) {
      const base64 = `data:image/png;base64,${composited.toString('base64')}`;
      console.log(`✓ Generated slide ${slideNumber} (base64)`);
      
      return {
        base64,
        filename: `${this.config.name}-slide-${slideNumber}.png`
      };
    } else {
      const outputPath = path.join(
        this.outputDir,
        `slide-${slideNumber}.png`
      );
      
      await fs.writeFile(outputPath, composited);
      console.log(`✓ Saved: ${outputPath}`);
      return outputPath;
    }
  }

  async generateCtaSlide(ctaConfig, slideNumber) {
    console.log(`Generating CTA slide ${slideNumber}`);

    const width = 1080;
    const height = 1080;
    const bgColor = ctaConfig.bgColor || '#1a1a2e';
    const ctaText = ctaConfig.text || '';
    const thumbnailUrl = ctaConfig.thumbnailUrl || '';
    const platforms = ctaConfig.platforms || [];

    // Parse hex color to RGB
    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      } : { r: 26, g: 26, b: 46 };
    };

    const rgb = hexToRgb(bgColor);

    // Create base with background color
    let composite = sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: rgb.r, g: rgb.g, b: rgb.b, alpha: 1 },
      },
    }).png();

    const layers = [];

    // Fetch and add YouTube thumbnail if available
    if (thumbnailUrl) {
      try {
        const thumbResponse = await fetch(thumbnailUrl);
        if (thumbResponse.ok) {
          const thumbBuffer = Buffer.from(await thumbResponse.arrayBuffer());
          // Resize thumbnail to fit nicely in center (max 700px wide)
          const resizedThumb = await sharp(thumbBuffer)
            .resize(700, 394, { fit: 'inside' })
            .png()
            .toBuffer();

          const thumbMeta = await sharp(resizedThumb).metadata();
          const thumbX = Math.round((width - thumbMeta.width) / 2);
          const thumbY = Math.round((height / 2) - thumbMeta.height / 2 - 60);

          // Add rounded corners to thumbnail
          const roundedMask = Buffer.from(
            `<svg width="${thumbMeta.width}" height="${thumbMeta.height}">
              <rect x="0" y="0" width="${thumbMeta.width}" height="${thumbMeta.height}" rx="16" ry="16" fill="white"/>
            </svg>`
          );
          const roundedThumb = await sharp(resizedThumb)
            .composite([{ input: roundedMask, blend: 'dest-in' }])
            .png()
            .toBuffer();

          layers.push({ input: roundedThumb, top: thumbY, left: thumbX });
        }
      } catch (e) {
        console.log('  Could not fetch thumbnail:', e.message);
      }
    }

    // Platform icon SVGs (simple recognizable shapes)
    const platformIcons = {
      instagram: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="white" stroke="none"/></svg>`,
      youtube: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.13C5.12 19.56 12 19.56 12 19.56s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="white" stroke="none"/></svg>`,
      tiktok: `<svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78 2.92 2.92 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 3 15.57 6.33 6.33 0 0 0 9.37 22a6.33 6.33 0 0 0 6.37-6.22V9.4a8.16 8.16 0 0 0 3.85.96V7.1a4.85 4.85 0 0 1-1.59-.41z"/></svg>`,
      linkedin: `<svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>`,
      spotify: `<svg width="32" height="32" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="12" r="10" fill="none" stroke="white" stroke-width="2"/><path d="M8 15s3-1 4-1 4 1 4 1" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M7 12s3.5-1.5 5-1.5 5 1.5 5 1.5" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M6.5 9s4-2 5.5-2 5.5 2 5.5 2" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`,
      apple: `<svg width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83z"/><path d="M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`,
    };

    // Build CTA text and platform icons SVG overlay
    const fontData = await this.loadNunitoFont();
    const ctaFontSize = 32;
    const ctaLines = this.wordWrapText(ctaText, width - 120, ctaFontSize);
    const ctaStartY = height - 200;

    // Platform icons layout
    const iconSize = 40;
    const iconGap = 20;
    const totalIconsWidth = platforms.length * iconSize + (platforms.length - 1) * iconGap;
    const iconsStartX = (width - totalIconsWidth) / 2;
    const iconsY = ctaStartY + (ctaLines.length * ctaFontSize * 1.3) + 30;

    const platformIconsSvg = platforms.map((p, i) => {
      const icon = platformIcons[p.toLowerCase()];
      if (!icon) return '';
      const x = iconsStartX + i * (iconSize + iconGap);
      return `<g transform="translate(${x}, ${iconsY})">${icon.replace(/width="\d+"/, `width="${iconSize}"`).replace(/height="\d+"/, `height="${iconSize}"`)}</g>`;
    }).join('');

    const overlaySvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style type="text/css"><![CDATA[
            @font-face {
              font-family: 'Nunito';
              font-style: normal;
              font-weight: 700;
              src: url(data:font/truetype;charset=utf-8;base64,${fontData}) format('truetype');
            }
          ]]></style>
        </defs>
        ${ctaLines.map((line, i) => `
          <text
            x="${width / 2}"
            y="${ctaStartY + i * ctaFontSize * 1.3}"
            font-family="Nunito, Arial, sans-serif"
            font-size="${ctaFontSize}"
            font-weight="700"
            fill="white"
            text-anchor="middle"
          >${this.escapeXml(line)}</text>
        `).join('')}
        ${platformIconsSvg}
      </svg>
    `;

    layers.push({ input: Buffer.from(overlaySvg), top: 0, left: 0 });

    const composited = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: rgb.r, g: rgb.g, b: rgb.b, alpha: 1 },
      },
    })
      .composite(layers)
      .png()
      .toBuffer();

    if (this.returnBase64) {
      const base64 = `data:image/png;base64,${composited.toString('base64')}`;
      console.log(`✓ Generated CTA slide ${slideNumber} (base64)`);
      return {
        base64,
        filename: `${this.config.name}-cta-slide-${slideNumber}.png`,
      };
    } else {
      const outputPath = path.join(this.outputDir, `cta-slide-${slideNumber}.png`);
      await fs.writeFile(outputPath, composited);
      console.log(`✓ Saved CTA: ${outputPath}`);
      return outputPath;
    }
  }


  async generateCarousel() {
    console.log(`\n🎬 Generating carousel: ${this.config.name}`);
    console.log(`Total slides: ${this.config.slides.length}\n`);

    const outputPaths = [];
    const page = await this.browser.newPage();

    // Block video data (googlevideo.com media segments) during setup to prevent
    // YouTube from streaming HD video and exhausting Lambda memory.
    // seekAndExtractFrame toggles this per-frame.
    this.allowVideoRequests = false;
    this.mediaRequestsAborted = 0;
    this.mediaRequestsAllowed = 0;
    await page.setRequestInterception(true);
    const videoPageUrl = `https://www.youtube.com/watch?v=${this.config.videoId}`;
    page.on('request', req => {
      const url = req.url();

      // Block Google sign-in and YouTube's passive sign-in endpoint in any frame.
      // On Lambda (no session), this flow ultimately navigates/detaches the main frame.
      if (url.includes('accounts.google.com') || url.includes('youtube.com/signin')) {
        req.abort();
        return;
      }

      // Block any attempt to navigate the main frame away from the YouTube video page.
      if (req.isNavigationRequest()) {
        try {
          if (req.frame() === page.mainFrame()) {
            if (!url.startsWith(videoPageUrl) && url !== 'about:blank') {
              console.log(`[blocked main nav] ${url.slice(0, 120)}`);
              req.abort();
              return;
            }
          }
        } catch (_) {}
      }

      if (req.resourceType() === 'media') {
        if (!this.allowVideoRequests || TEST_BLOCK_ALL_MEDIA) {
          this.mediaRequestsAborted++;
          req.abort();
        } else {
          this.mediaRequestsAllowed++;
          req.continue();
        }
      } else {
        req.continue();
      }
    });
    if (TEST_BLOCK_ALL_MEDIA) {
      console.log('[TEST] TEST_BLOCK_ALL_MEDIA=true — all video requests will be blocked');
    }

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) console.log(`[nav] ${frame.url()}`);
    });

    page.on('error', err => console.log(`[page crash] ${err.message}`));
    page.on('pageerror', err => console.log(`[page js error] ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[console error] ${msg.text()}`);
    });
    page.on('framedetached', frame => {
      console.log(`[framedetached] isMain=${frame === page.mainFrame()} url=${frame.url()}`);
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    const firstTimestamp = this.config.slides[0].topTimestamp;
    const url = `https://www.youtube.com/watch?v=${this.config.videoId}&t=${firstTimestamp}s`;
    console.log(`Opening video: ${url}\n`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    console.log(`Landed on: ${page.url()}`);

    // Dismiss consent banner if present
    try {
      const consentBtn = await page.$('button[aria-label="Accept all"], form[action*="consent"] button');
      if (consentBtn) {
        console.log('Consent banner — dismissing...');
        await consentBtn.click();
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) { /* no banner */ }

    await page.waitForSelector('video', { timeout: 15000 });

    // Wait for YouTube player JS to expose the quality API
    await page.waitForFunction(
      () => {
        const p = document.querySelector('.html5-video-player');
        return p && typeof p.setPlaybackQuality === 'function';
      },
      { timeout: 15000 }
    ).catch(() => console.log('Player quality API not available'));

    // Set quality to 1080p via YouTube's internal JS API — no menu interaction needed
    await page.evaluate(() => {
      const player = document.querySelector('.html5-video-player');
      if (!player) return;
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange('hd1080', 'hd1080');
      } else if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality('hd1080');
      }
    });
    console.log('Quality set to 1080p');

    // Hide UI chrome so it doesn't bleed into screenshots
    await page.evaluate(() => {
      ['.ytp-chrome-top', '.ytp-chrome-bottom', '.ytp-gradient-top',
       '.ytp-gradient-bottom', '.ytp-watermark', '.ytp-pause-overlay',
       '.ytp-settings-menu', '#masthead-container', '#related', '#comments',
       '.ytp-spinner', '.ytp-buffering-spinner',
      ].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.style.display = 'none');
      });
    });

    for (let i = 0; i < this.config.slides.length; i++) {
      const slide = this.config.slides[i];
      const result = await this.generateSlide(slide, i + 1, page);
      outputPaths.push(result);
    }

    await page.close();
    console.log(`\n✅ Carousel complete! Generated ${outputPaths.length} slides`);
    if (this.outputDir) console.log(`Output directory: ${this.outputDir}\n`);

    return outputPaths;
  }
}

export default CarouselGenerator;
