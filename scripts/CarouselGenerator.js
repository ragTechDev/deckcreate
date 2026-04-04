import sharp from 'sharp';
import fs from 'fs-extra';
import path from 'path';

let puppeteer;
let isStealthPluginLoaded = false;

async function loadPuppeteer() {
  if (!puppeteer) {
    puppeteer = (await import('puppeteer-extra')).default;
    if (!isStealthPluginLoaded) {
      const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
      puppeteer.use(StealthPlugin());
      isStealthPluginLoaded = true;
    }
  }
  return puppeteer;
}

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
    const pptr = await loadPuppeteer();
    this.browser = await pptr.launch({
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
        '--disable-notifications'
      ],
      protocolTimeout: 60000,
      defaultViewport: null
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async seekAndExtractFrame(page, timestamp) {
    console.log(`  Seeking to ${timestamp}s...`);
    
    // Clear any existing error state and reload if necessary
    await page.evaluate(() => {
      const errorElements = document.querySelectorAll('.ytp-error, .ytp-error-content-wrap');
      errorElements.forEach(el => el.remove());
    });

    await page.evaluate((ts) => {
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = ts;
        video.pause();
      }
    }, timestamp);

    // Wait longer for YouTube to buffer to the target timestamp
    await new Promise(resolve => setTimeout(resolve, 4000));

    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) {
        video.pause();
        video.removeAttribute('autoplay');
        video.playbackRate = 0;
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    const isPaused = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) {
        video.pause();
        return video.paused;
      }
      return false;
    });

    console.log(`  Video paused: ${isPaused}`);

    // Wait for video to be ready at the target timestamp
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check again for errors after seeking (errors may appear during playback)
    const errorInfo = await page.evaluate(() => {
      const errorElements = document.querySelectorAll('.ytp-error, .ytp-error-content-wrap');
      const video = document.querySelector('video');
      
      return {
        hasErrorElements: errorElements.length > 0,
        hasVideoError: video && video.error ? true : false,
        videoReadyState: video ? video.readyState : null,
        videoCurrentTime: video ? video.currentTime : null,
        videoNetworkState: video ? video.networkState : null,
      };
    });

    console.log(`  Error check:`, errorInfo);

    // If video reset to 0, YouTube likely triggered anti-scraping - reload and retry
    if (errorInfo.videoCurrentTime === 0 && timestamp > 10) {
      console.log(`  Video reset detected - reloading page and retrying...`);
      await page.reload({ waitUntil: 'load' });
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Navigate to the timestamp directly in URL
      const videoUrl = page.url().split('&t=')[0];
      await page.goto(`${videoUrl}&t=${Math.floor(timestamp)}s&vq=hd1080`, { waitUntil: 'load' });
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      // Re-check after reload
      const retryErrorInfo = await page.evaluate(() => {
        const errorElements = document.querySelectorAll('.ytp-error, .ytp-error-content-wrap');
        const video = document.querySelector('video');
        return {
          hasErrorElements: errorElements.length > 0,
          hasVideoError: video && video.error ? true : false,
          videoCurrentTime: video ? video.currentTime : null,
        };
      });
      
      console.log(`  After reload:`, retryErrorInfo);
      
      if (retryErrorInfo.hasErrorElements || retryErrorInfo.hasVideoError) {
        throw new Error(`YouTube error detected after seeking to ${timestamp}s - timestamp may be beyond video duration`);
      }
    } else if (errorInfo.hasErrorElements || errorInfo.hasVideoError) {
      throw new Error(`YouTube error detected after seeking to ${timestamp}s - timestamp may be beyond video duration`);
    }

    // Wait for video to have at least a current frame buffered (readyState >= 2)
    console.log('  Waiting for video to buffer...');
    const readyStateReached = await page.evaluate(() => {
      return new Promise((resolve) => {
        const video = document.querySelector('video');
        if (!video) { resolve(false); return; }
        if (video.readyState >= 2) { resolve(true); return; }
        const onReady = () => { video.removeEventListener('canplay', onReady); resolve(true); };
        video.addEventListener('canplay', onReady);
        setTimeout(() => { video.removeEventListener('canplay', onReady); resolve(false); }, 8000);
      });
    });

    const videoState = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return null;
      return {
        readyState: video.readyState,
        currentTime: video.currentTime,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        networkState: video.networkState,
        src: video.currentSrc ? video.currentSrc.slice(0, 80) : 'none',
      };
    });
    console.log(`  Video state before capture: readyStateReached=${readyStateReached}`, videoState);

    if (!readyStateReached || (videoState && videoState.readyState < 2)) {
      console.warn('  WARNING: Video readyState < 2 — frame may be blank');
    }

    console.log('  Extracting video frame...');

    let screenshot = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const frameResult = await page.evaluate(() => {
        const video = document.querySelector('video');
        if (!video) throw new Error('Video element not found');
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          return { dataUrl: null, reason: `video dimensions zero (${video.videoWidth}x${video.videoHeight})` };
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');

        let tainted = false;
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch (e) {
          return { dataUrl: null, reason: `drawImage failed: ${e.message}` };
        }

        let dataUrl;
        try {
          dataUrl = canvas.toDataURL('image/png');
        } catch (e) {
          tainted = true;
          return { dataUrl: null, reason: `toDataURL failed (likely tainted canvas / CORS): ${e.message}` };
        }

        if (!dataUrl || dataUrl === 'data:,' || dataUrl.length < 100) {
          return { dataUrl: null, reason: 'dataUrl empty or too short' };
        }

        // Sample pixels to detect blank (all-black or all-transparent) frames
        const imageData = ctx.getImageData(0, 0, Math.min(canvas.width, 200), Math.min(canvas.height, 200));
        const pixels = imageData.data;
        let nonBlackPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i], g = pixels[i+1], b = pixels[i+2], a = pixels[i+3];
          if (a > 10 && (r > 10 || g > 10 || b > 10)) nonBlackPixels++;
        }
        const totalPixels = pixels.length / 4;
        const nonBlackRatio = nonBlackPixels / totalPixels;

        return { dataUrl, reason: null, tainted, nonBlackRatio, totalPixels };
      });

      console.log(`  Frame capture attempt ${attempt + 1}:`, {
        hasData: !!frameResult?.dataUrl,
        reason: frameResult?.reason,
        nonBlackRatio: frameResult?.nonBlackRatio?.toFixed(3),
      });

      if (frameResult?.reason) {
        console.warn(`  Frame blank reason: ${frameResult.reason}`);
      }

      if (frameResult?.nonBlackRatio !== undefined && frameResult.nonBlackRatio < 0.01) {
        console.warn(`  WARNING: Frame appears blank — only ${(frameResult.nonBlackRatio * 100).toFixed(1)}% non-black pixels. Video may not have buffered.`);
      }

      if (frameResult?.dataUrl) {
        const base64Data = frameResult.dataUrl.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length > 1024) {
          screenshot = buffer;
          break;
        }
        console.warn(`  Buffer too small (${buffer.length} bytes), retrying...`);
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (!screenshot) {
      console.log('  Falling back to element screenshot...');
      const videoElement = await page.$('video');
      if (videoElement) {
        screenshot = await videoElement.screenshot({ type: 'png' });
        console.log(`  Element screenshot size: ${screenshot.length} bytes`);
      } else {
        throw new Error('Could not extract video frame after multiple attempts');
      }
    }

    console.log('  Frame extracted successfully');
    return screenshot;
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
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    const firstTimestamp = this.config.slides[0].topTimestamp;
    const url = `https://www.youtube.com/watch?v=${this.config.videoId}&t=${firstTimestamp}s&vq=hd1080`;
    console.log(`Opening video: ${url}\n`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    await page.waitForSelector('video', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 8000));

    try {
      const playButton = await page.$('.ytp-large-play-button');
      if (playButton) {
        await playButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (e) {
      console.log('Play button not found, video may be auto-playing');
    }

    try {
      await page.click('.ytp-settings-button');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const qualityMenuItems = await page.$$('.ytp-menuitem');
      for (const item of qualityMenuItems) {
        const text = await page.evaluate(el => el.textContent, item);
        if (text && text.includes('Quality')) {
          await item.click();
          await new Promise(resolve => setTimeout(resolve, 500));
          break;
        }
      }
      
      const qualityOptions = await page.$$('.ytp-quality-menu .ytp-menuitem');
      if (qualityOptions.length > 0) {
        await qualityOptions[0].click();
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('Set to highest quality\n');
      }
    } catch (e) {
      console.log('Could not manually set quality via menu\n');
    }

    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) {
        const player = document.querySelector('.html5-video-player');
        if (player && player.getOption) {
          try {
            player.setOption('captions', 'track', {});
          } catch (e) {}
        }
        const tracks = video.textTracks;
        for (let i = 0; i < tracks.length; i++) {
          tracks[i].mode = 'hidden';
        }
      }
    });

    await page.evaluate(() => {
      const elementsToHide = [
        '.ytp-chrome-top',
        '.ytp-chrome-bottom',
        '.ytp-gradient-top',
        '.ytp-gradient-bottom',
        '.ytp-title',
        '.ytp-watermark',
        '.ytp-pause-overlay'
      ];
      
      elementsToHide.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (el) el.style.display = 'none';
        });
      });
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    for (let i = 0; i < this.config.slides.length; i++) {
      const slide = this.config.slides[i];
      const result = await this.generateSlide(slide, i + 1, page);
      outputPaths.push(result);
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await page.close();

    console.log(`\n✅ Carousel complete! Generated ${outputPaths.length} slides`);
    if (this.outputDir) {
      console.log(`Output directory: ${this.outputDir}\n`);
    }

    return outputPaths;
  }
}

export default CarouselGenerator;
