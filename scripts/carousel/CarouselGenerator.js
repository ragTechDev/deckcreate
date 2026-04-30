import sharp from 'sharp';
import fs from 'fs-extra';
import path from 'path';


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

    {
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
    this.allowVideoRequests = true;

    try {
      await this.skipAds(page);

      await page.evaluate((ts) => {
        const video = document.querySelector('video');
        if (video) { video.currentTime = ts; video.pause(); }
      }, timestamp);

      console.log('  Waiting for video to buffer...');
      const readyStateReached = await page.waitForFunction(
        () => { const v = document.querySelector('video'); return v && v.readyState >= 2; },
        { timeout: 20000 }
      ).then(() => true).catch(() => false);

      const videoState = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        return { readyState: v.readyState, currentTime: v.currentTime, videoWidth: v.videoWidth, videoHeight: v.videoHeight };
      });
      console.log(`  Video state: readyStateReached=${readyStateReached}`, videoState);

      if (!readyStateReached) {
        console.warn('  WARNING: readyState < 2 after 20s — frame may be blank');
      }

      // Capture the frame
      let screenshot = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        // Hide spinner on every attempt — it can reappear during buffering
        await page.evaluate(() => {
          ['.ytp-spinner', '.ytp-buffering-spinner',
           '.ytp-chrome-top', '.ytp-chrome-bottom', '.ytp-gradient-top', '.ytp-gradient-bottom',
           '.ytp-ce-element', '.ytp-ad-overlay-container', '.ytp-ad-text-overlay',
           '.ytp-suggested-action-badge', '.ytp-card-teaser', '.ytp-cards-teaser',
           '.ytp-watermark', '.ytp-pause-overlay',
          ].forEach(sel => {
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
        let nonWhite = 0;
        for (let i = 0; i < data.length; i += info.channels) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (r > 10 || g > 10 || b > 10) nonBlack++;
          if (r < 245 || g < 245 || b < 245) nonWhite++;
        }
        const total = info.width * info.height;
        const blackRatio = nonBlack / total;
        const whiteRatio = nonWhite / total;
        console.log(`  Non-black: ${blackRatio.toFixed(3)}, non-white: ${whiteRatio.toFixed(3)}`);

        if (blackRatio < 0.01 || whiteRatio < 0.01) {
          console.warn('  Blank frame (all black or all white), retrying in 3s...');
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

  // Word wrap segments while preserving segment boundaries
  wordWrapSegments(segments, maxWidth, fontSize) {
    const charWidth = fontSize * 0.6;
    const lines = [];
    let currentLineSegments = [];
    let currentLineLength = 0;
    let prevSegStyle = null;
    
    for (const seg of segments) {
      const segText = seg.text;
      const segWords = segText.split(' ').filter(w => w !== '');
      const segEndsWithSpace = segText.endsWith(' ');
      
      for (let i = 0; i < segWords.length; i++) {
        const word = segWords[i];
        const isLastWordInSeg = i === segWords.length - 1;
        const needsTrailingSpace = !isLastWordInSeg || segEndsWithSpace;
        const wordWithSpace = needsTrailingSpace ? word + ' ' : word;
        const wordLength = wordWithSpace.length * charWidth;
        
        // Check if we need a leading space (transitioning from different style segment)
        const needsLeadingSpace = currentLineSegments.length > 0 && 
                                   prevSegStyle !== null && 
                                   prevSegStyle !== seg.isBold;
        
        // Use non-breaking space for inter-segment spacing to prevent collapse
        const adjustedWord = needsLeadingSpace ? wordWithSpace + '\u00A0' : wordWithSpace;
        const adjustedLength = (wordWithSpace.length + (needsLeadingSpace ? 1 : 0)) * charWidth;
        
        if (currentLineLength + adjustedLength > maxWidth && currentLineSegments.length > 0) {
          // Start new line - trim trailing space from last segment of previous line
          const lastSeg = currentLineSegments[currentLineSegments.length - 1];
          lastSeg.text = lastSeg.text.trimEnd();
          lines.push(currentLineSegments);
          
          // New line starts with this word (no leading space needed at line start)
          currentLineSegments = [{ text: wordWithSpace, isBold: seg.isBold }];
          currentLineLength = wordLength;
          prevSegStyle = seg.isBold;
        } else {
          // Add to current line
          if (currentLineSegments.length > 0 && currentLineSegments[currentLineSegments.length - 1].isBold === seg.isBold) {
            // Merge with previous segment if same style
            currentLineSegments[currentLineSegments.length - 1].text += adjustedWord;
          } else {
            // Different style - add as new segment with adjusted word
            currentLineSegments.push({ text: adjustedWord, isBold: seg.isBold });
          }
          currentLineLength += adjustedLength;
          prevSegStyle = seg.isBold;
        }
      }
    }
    
    if (currentLineSegments.length > 0) {
      // Trim trailing space from last segment
      const lastSeg = currentLineSegments[currentLineSegments.length - 1];
      lastSeg.text = lastSeg.text.trimEnd();
      lines.push(currentLineSegments);
    }
    
    return lines;
  }

  async loadNunitoFont() {
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'Nunito', 'static', 'Nunito-Bold.ttf');
    const fontBuffer = await fs.readFile(fontPath);
    return fontBuffer.toString('base64');
  }

  async loadLogoAsBase64(logoPath) {
    if (!logoPath) return null;
    try {
      const fullPath = logoPath.startsWith('/') ? logoPath : path.join(process.cwd(), logoPath);
      const logoBuffer = await fs.readFile(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      return `data:${mimeType};base64,${logoBuffer.toString('base64')}`;
    } catch (e) {
      console.log(`  Could not load logo: ${e.message}`);
      return null;
    }
  }

  generateTextOverlaySVG(width, height, topText, bottomText, fontData, headerConfig = null) {
    const fontSize = 36;
    const padding = 30;
    const textBottomMargin = 20;
    const lineHeight = fontSize * 1.2;
    const halfHeight = height / 2;
    
    const topLines = this.wordWrapText(topText, width - (padding * 2), fontSize);
    const bottomLines = this.wordWrapText(bottomText, width - (padding * 2), fontSize);
    
    const topTextY = halfHeight - (topLines.length * lineHeight) - textBottomMargin;
    const bottomTextY = height - (bottomLines.length * lineHeight) - textBottomMargin;

    // Generate header elements if config provided
    let headerElements = '';
    if (headerConfig) {
      const { logoBase64, episodeNumber, episodeTitle, brandColor = '#3b82f6' } = headerConfig;
      
      // Logo on top-left
      if (logoBase64) {
        headerElements += `
          <image x="40" y="30" width="120" height="60" href="${logoBase64}" preserveAspectRatio="xMidYMid meet"/>
        `;
      }
      
      // Episode pill and title on top-right
      const rightMargin = 50;
      const topMargin = 15; // Pill moved up
      
      // Episode pill (EP X) - minimal padding
      if (episodeNumber) {
        const pillText = `EP ${episodeNumber}`;
        const pillWidth = pillText.length * 11 + 16;
        headerElements += `
          <g transform="translate(${width - rightMargin - pillWidth}, ${topMargin})">
            <rect x="0" y="0" width="${pillWidth}" height="28" rx="14" ry="14" fill="white"/>
            <text x="${pillWidth / 2}" y="20" font-family="Nunito, Arial, sans-serif" font-size="18" font-weight="700" fill="black" text-anchor="middle">${pillText}</text>
          </g>
        `;
      }
      
      // Episode title below the pill - wrapped, white text with bold in brand color
      if (episodeTitle) {
        const titleFontSize = 18;
        const titleLineHeight = titleFontSize * 1.4;
        const maxTitleWidth = 300;
        const titleStartY = topMargin + 44; // Gap below pill (28 + 16 = 44)
        
        // Split text into segments (regular and bold)
        const segments = [];
        const boldRegex = /\*\*(.*?)\*\*/g;
        let lastIndex = 0;
        let match;
        
        while ((match = boldRegex.exec(episodeTitle)) !== null) {
          // Add text before bold
          if (match.index > lastIndex) {
            segments.push({ text: episodeTitle.slice(lastIndex, match.index), isBold: false });
          }
          // Add bold text
          segments.push({ text: match[1], isBold: true });
          lastIndex = match.index + match[0].length;
        }
        // Add remaining text
        if (lastIndex < episodeTitle.length) {
          segments.push({ text: episodeTitle.slice(lastIndex), isBold: false });
        }
        
        // Word wrap segments together
        const titleLines = this.wordWrapSegments(segments, maxTitleWidth, titleFontSize);
        
        // Generate SVG for each line
        const titleSvgElements = titleLines.map((lineSegments, i) => {
          const y = titleStartY + (i * titleLineHeight);
          
          // Build content with proper styling per segment
          const content = lineSegments.map((seg, idx) => {
            const fill = seg.isBold ? brandColor : 'white';
            const fontWeight = seg.isBold ? '800' : '600';
            // Add explicit non-breaking space when transitioning between styles
            const trailingNbsp = (idx < lineSegments.length - 1 && 
                                  seg.isBold !== lineSegments[idx + 1].isBold &&
                                  !seg.text.endsWith(' ')) ? '\u00A0' : '';
            return `<tspan fill="${fill}" font-weight="${fontWeight}">${this.escapeXml(seg.text + trailingNbsp)}</tspan>`;
          }).join('');
          
          return `<text x="${width - rightMargin}" y="${y}" font-family="Nunito, Arial, sans-serif" font-size="${titleFontSize}" text-anchor="end" filter="url(#textShadow)">${content}</text>`;
        }).join('');
        
        headerElements += titleSvgElements;
      }
    }

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
          <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.8"/>
          </filter>
          <filter id="textShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.8"/>
          </filter>
        </defs>
        
        ${headerElements}
        
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
    const bgColor = '#9cd2d0';
    const episodeNumber = ctaConfig.episodeNumber || '';
    const episodeTitle = ctaConfig.episodeTitle || '';
    const brandColor = ctaConfig.brandColor || '#eebf89';
    const handle = ctaConfig.handle || 'ragtechdev';
    
    let imageBase64 = null;
    let useThumbnail = false;
    
    if (ctaConfig.thumbnailPath) {
      try {
        const thumbBuffer = await fs.readFile(ctaConfig.thumbnailPath);
        imageBase64 = `data:image/png;base64,${thumbBuffer.toString('base64')}`;
        useThumbnail = true;
      } catch (e) {
        console.log('  Could not load thumbnail.png, falling back to logo');
      }
    }
    
    if (!imageBase64 && ctaConfig.logoBase64) {
      imageBase64 = ctaConfig.logoBase64;
    }

    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      } : { r: 156, g: 210, b: 208 };
    };

    const rgb = hexToRgb(bgColor);
    const fontData = await this.loadNunitoFont();

    // Load Techybara image for top left corner
    let techybaraBase64 = null;
    try {
      const techybaraPath = path.join(process.cwd(), 'public', 'assets', 'techybara', 'techybara-holding-mic.png');
      const techybaraBuffer = await fs.readFile(techybaraPath);
      techybaraBase64 = `data:image/png;base64,${techybaraBuffer.toString('base64')}`;
    } catch (e) {
      console.log('  Could not load Techybara image');
    }

    const scale = 3;
    const imageWidth = useThumbnail ? 700 : 400;
    const imageHeight = useThumbnail ? 394 : 200;
    const imageX = (width - imageWidth) / 2;

    const pillText = episodeNumber ? `EP ${episodeNumber}` : '';
    const pillScale = 1.5;
    const pillFontSize = 18 * pillScale;
    const pillPaddingX = 16 * pillScale;
    const pillHeight = 28 * pillScale;
    const pillWidth = pillText.length * (pillFontSize * 0.55) + pillPaddingX * 2;
    
    const titleSegments = [];
    const boldRegex = /\*\*(.*?)\*\*/g;
    let lastIndex = 0;
    let match;
    while ((match = boldRegex.exec(episodeTitle)) !== null) {
      if (match.index > lastIndex) {
        titleSegments.push({ text: episodeTitle.slice(lastIndex, match.index), isBold: false });
      }
      titleSegments.push({ text: match[1], isBold: true });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < episodeTitle.length) {
      titleSegments.push({ text: episodeTitle.slice(lastIndex), isBold: false });
    }

    const titleFontSize = 20 * scale;
    const maxTitleWidth = width - 120;
    const charWidth = titleFontSize * 0.6;
    const titleLines = [];
    let currentLineSegments = [];
    let currentLineLength = 0;
    let prevSegStyle = null;

    for (const seg of titleSegments) {
      const segText = seg.text;
      const segWords = segText.split(' ').filter(w => w !== '');
      const segEndsWithSpace = segText.endsWith(' ');

      for (let i = 0; i < segWords.length; i++) {
        const word = segWords[i];
        const isLastWordInSeg = i === segWords.length - 1;
        const needsTrailingSpace = !isLastWordInSeg || segEndsWithSpace;
        const wordWithSpace = needsTrailingSpace ? word + ' ' : word;
        const wordLength = wordWithSpace.length * charWidth;

        const isStyleTransition = currentLineSegments.length > 0 &&
                                   prevSegStyle !== null &&
                                   prevSegStyle !== seg.isBold;
        const isFirstWordOfSegment = i === 0;
        const adjustedWord = (isStyleTransition && isFirstWordOfSegment) ? '\u00A0' + wordWithSpace : wordWithSpace;
        const adjustedLength = adjustedWord.length * charWidth;

        if (currentLineLength + adjustedLength > maxTitleWidth && currentLineSegments.length > 0) {
          const lastSeg = currentLineSegments[currentLineSegments.length - 1];
          lastSeg.text = lastSeg.text.trimEnd();
          titleLines.push(currentLineSegments);
          currentLineSegments = [{ text: wordWithSpace, isBold: seg.isBold }];
          currentLineLength = wordLength;
          prevSegStyle = seg.isBold;
        } else {
          if (currentLineSegments.length > 0 && currentLineSegments[currentLineSegments.length - 1].isBold === seg.isBold) {
            currentLineSegments[currentLineSegments.length - 1].text += adjustedWord;
          } else {
            currentLineSegments.push({ text: adjustedWord, isBold: seg.isBold });
          }
          currentLineLength += adjustedLength;
          prevSegStyle = seg.isBold;
        }
      }
    }
    if (currentLineSegments.length > 0) {
      const lastSeg = currentLineSegments[currentLineSegments.length - 1];
      lastSeg.text = lastSeg.text.trimEnd();
      titleLines.push(currentLineSegments);
    }

    const titleLineHeight = titleFontSize * 1.3;
    const pillY = 110;
    const titleStartY = pillY + pillHeight + titleLineHeight;
    const titleSvgElements = titleLines.map((lineSegments, i) => {
      const y = titleStartY + (i * titleLineHeight);
      const content = lineSegments.map((seg, idx) => {
        const fill = seg.isBold ? brandColor : 'white';
        const fontWeight = seg.isBold ? '800' : '600';
        const trailingNbsp = (idx < lineSegments.length - 1 && 
                              seg.isBold !== lineSegments[idx + 1].isBold &&
                              !seg.text.endsWith(' ')) ? '\u00A0' : '';
        return `<tspan fill="${fill}" font-weight="${fontWeight}">${this.escapeXml(seg.text + trailingNbsp)}</tspan>`;
      }).join('');
      return `<text x="${width / 2}" y="${y}" font-family="Nunito, Arial, sans-serif" font-size="${titleFontSize}" font-weight="600" text-anchor="middle" filter="url(#textShadow)">${content}</text>`;
    }).join('');

    const titleEndY = titleStartY + (titleLines.length * titleLineHeight);
    const imageY = titleEndY - 7; // Moved up 15px (was +8, now -7)

    const platforms = [
      { name: 'YouTube', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.81zM9.55 15.5V8.5l6.27 3.5-6.27 3.5z"/></svg>` },
      { name: 'Spotify', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="12" r="10" fill="none" stroke="white" stroke-width="2"/><path d="M8 15s3-1 4-1 4 1 4 1" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M7 12s3.5-1.5 5-1.5 5 1.5 5 1.5" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M6.5 9s4-2 5.5-2 5.5 2 5.5 2" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>` },
      { name: 'Apple Podcasts', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83z"/><path d="M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>` },
    ];

    const platformIconSize = 28 * scale;
    const platformGap = 100 * scale;
    const platformStartX = width / 2;
    const platformY = imageY + imageHeight + 33; // Moved up 15px (was +48, now +33)
    const platformLabelY = platformIconSize + 30; // 30px gap between icon and text

    const platformsSvg = platforms.map((p, i) => {
      const x = platformStartX + (i - 1) * platformGap;
      return `
        <g transform="translate(${x}, ${platformY})">
          <svg width="${platformIconSize}" height="${platformIconSize}" viewBox="0 0 24 24" fill="white" x="-${platformIconSize/2}" y="0">${p.icon}</svg>
          <text x="0" y="${platformLabelY}" font-family="Nunito, Arial, sans-serif" font-size="${12 * scale}" font-weight="600" fill="white" text-anchor="middle" dominant-baseline="hanging">${this.escapeXml(p.name)}</text>
        </g>
      `;
    }).join('');

    const ctaSvg = `
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
          <filter id="textShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.6"/>
          </filter>
          <filter id="streamNowLift" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="-3" stdDeviation="2" flood-color="#ffffff" flood-opacity="0.4"/>
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.5"/>
          </filter>
        </defs>
        
        ${techybaraBase64 ? `
        <image x="940" y="20" width="120" height="120" href="${techybaraBase64}" preserveAspectRatio="xMidYMid meet"/>
        ` : ''}
        
        <text x="${width / 2}" y="80" font-family="Nunito, Arial, sans-serif" font-size="${Math.round(24 * scale * 0.8)}" font-weight="600" fill="${brandColor}" text-anchor="middle" filter="url(#streamNowLift)">Stream now:</text>
        
        ${pillText ? `
        <g transform="translate(${width / 2 - pillWidth / 2}, ${pillY})">
          <rect x="0" y="0" width="${pillWidth}" height="${pillHeight}" rx="${pillHeight / 2}" ry="${pillHeight / 2}" fill="white"/>
          <text x="${pillWidth / 2}" y="${pillHeight / 2 + 6}" font-family="Nunito, Arial, sans-serif" font-size="${pillFontSize}" font-weight="700" fill="black" text-anchor="middle" dominant-baseline="middle">${pillText}</text>
        </g>
        ` : ''}
        
        ${titleSvgElements}
        
        ${imageBase64 ? `
        <image x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" href="${imageBase64}" preserveAspectRatio="xMidYMid meet"/>
        ` : ''}
        
        ${platformsSvg}
        
        <text x="${width / 2}" y="${platformY + platformLabelY + 45}" font-family="Nunito, Arial, sans-serif" font-size="${16 * scale}" font-weight="700" fill="${brandColor}" text-anchor="middle" filter="url(#streamNowLift)">@${this.escapeXml(handle)}</text>
      </svg>
    `;

    const composited = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: rgb.r, g: rgb.g, b: rgb.b, alpha: 1 },
      },
    })
      .composite([{ input: Buffer.from(ctaSvg), top: 0, left: 0 }])
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
      const outputPath = path.join(this.outputDir, `slide-cta.png`);
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

    // Block media requests during setup to prevent YouTube from streaming video
    // before we're ready. seekAndExtractFrame re-enables this per frame.
    this.allowVideoRequests = false;
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (!this.allowVideoRequests && req.resourceType() === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    const firstTimestamp = this.config.slides[0].topTimestamp;
    const url = `https://www.youtube.com/watch?v=${this.config.videoId}&t=${firstTimestamp}s`;
    console.log(`Opening video: ${url}\n`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    console.log(`Landed on: ${page.url()}`);

    // Inject persistent CSS to hide all YouTube UI chrome and ad overlays.
    // Using !important and a <style> tag so elements can't override it via inline styles.
    await page.addStyleTag({ content: `
      .ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom,
      .ytp-watermark, .ytp-pause-overlay, .ytp-settings-menu,
      .ytp-spinner, .ytp-buffering-spinner,
      .ytp-ad-module, .ytp-flyout-cta, .ytp-ad-overlay-container,
      .ytp-ad-overlay-slot, .ytp-ad-text-overlay, .ytp-ad-player-overlay,
      .ytp-ad-image-overlay, .ytp-ad-skip-button-modern, .ytp-ad-message-container,
      .ytp-ce-element, .ytp-suggested-action-badge,
      .ytp-card-teaser, .ytp-cards-teaser,
      #masthead-container, #related, #comments {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
    ` }).catch(() => {});

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
