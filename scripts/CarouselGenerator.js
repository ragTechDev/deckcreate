const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');

let puppeteer;
let isStealthPluginLoaded = false;

function loadPuppeteer() {
  if (!puppeteer) {
    puppeteer = require('puppeteer-extra');
    if (!isStealthPluginLoaded) {
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
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
    const pptr = loadPuppeteer();
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
    
    await page.evaluate((ts) => {
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = ts;
        video.pause();
      }
    }, timestamp);

    await new Promise(resolve => setTimeout(resolve, 3000));

    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) {
        video.pause();
        video.removeAttribute('autoplay');
        video.playbackRate = 0;
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    const isPaused = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video) {
        video.pause();
        return video.paused;
      }
      return false;
    });

    console.log(`  Video paused: ${isPaused}`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('  Extracting video frame...');
    const frameDataUrl = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) {
        throw new Error('Video element not found');
      }

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      return canvas.toDataURL('image/png');
    });

    const base64Data = frameDataUrl.replace(/^data:image\/png;base64,/, '');
    const screenshot = Buffer.from(base64Data, 'base64');

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

    const topScreenshot = await this.seekAndExtractFrame(page, slideConfig.topTimestamp);
    const bottomScreenshot = await this.seekAndExtractFrame(page, slideConfig.bottomTimestamp);

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
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

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

module.exports = CarouselGenerator;
