import CarouselGenerator from '../carousel/CarouselGenerator.js';
import fs from 'fs-extra';

// Mock sharp and puppeteer
jest.mock('sharp', () => {
  const mockSharp = jest.fn().mockImplementation(() => {
    const mockChain = {
      resize: jest.fn().mockReturnThis(),
      raw: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      composite: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue({
        data: Buffer.from(Array(100 * 100 * 3).fill(128)), // Non-blank gray pixels
        info: { width: 100, height: 100, channels: 3 }
      })
    };
    return mockChain;
  });
  return mockSharp;
});

jest.mock('puppeteer', () => ({
  launch: jest.fn()
}));
jest.mock('puppeteer-extra');
jest.mock('puppeteer-extra-plugin-stealth');
jest.mock('fs-extra');

describe('CarouselGenerator', () => {
  let generator;
  let mockBrowser;
  let mockPage;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock browser and page
    mockBrowser = {
      newPage: jest.fn(),
      close: jest.fn()
    };

    mockPage = {
      setUserAgent: jest.fn(),
      setViewport: jest.fn(),
      setExtraHTTPHeaders: jest.fn(),
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      waitForFunction: jest.fn().mockResolvedValue(true),
      click: jest.fn(),
      evaluate: jest.fn(),
      close: jest.fn(),
      $: jest.fn(),
      $$: jest.fn(),
      setRequestInterception: jest.fn(),
      on: jest.fn(),
      url: jest.fn().mockReturnValue('https://youtube.com/watch?v=test'),
      reload: jest.fn().mockResolvedValue(),
      addStyleTag: jest.fn().mockResolvedValue(),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('screenshot-data'))
    };

    // Setup puppeteer mock (source uses `import('puppeteer')`)
    const puppeteer = jest.requireMock('puppeteer');
    puppeteer.launch.mockResolvedValue(mockBrowser);

    mockBrowser.newPage.mockResolvedValue(mockPage);

    // Setup fs-extra mocks
    fs.ensureDir.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    fs.readFile.mockResolvedValue(Buffer.from('mock-font-data'));

    // Create generator instance
    generator = new CarouselGenerator({
      name: 'test-carousel',
      videoId: 'test-video-id',
      slides: [
        {
          topTimestamp: 10,
          bottomTimestamp: 15,
          topText: 'Top text',
          bottomText: 'Bottom text'
        }
      ]
    });
  });

  afterEach(() => {
    // Clear all mocks and timers
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Constructor', () => {
    test('should initialize with config', () => {
      expect(generator.config.name).toBe('test-carousel');
      expect(generator.config.videoId).toBe('test-video-id');
      expect(generator.config.slides).toHaveLength(1);
    });

    test('should set output directory when not returning base64', () => {
      expect(generator.outputDir).toContain('test-carousel');
      expect(generator.returnBase64).toBe(false);
    });

    test('should set output directory to null when returning base64', () => {
      const base64Generator = new CarouselGenerator({
        name: 'test-carousel',
        returnBase64: true
      });
      expect(base64Generator.outputDir).toBeNull();
      expect(base64Generator.returnBase64).toBe(true);
    });
  });

  describe('init', () => {
    test('should initialize browser and output directory', async () => {
      await generator.init();

      expect(fs.ensureDir).toHaveBeenCalled();
      expect(jest.requireMock('puppeteer').launch).toHaveBeenCalled();
      expect(generator.browser).toBe(mockBrowser);
    });

    test('should not create output directory when returning base64', async () => {
      const base64Generator = new CarouselGenerator({
        name: 'test-carousel',
        returnBase64: true
      });
      await base64Generator.init();

      expect(fs.ensureDir).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    test('should close browser', async () => {
      generator.browser = mockBrowser;
      await generator.close();

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    test('should handle null browser', async () => {
      generator.browser = null;
      await expect(generator.close()).resolves.toBeUndefined();
    });
  });

  describe('wordWrapText', () => {
    test('should wrap text to fit maxWidth', () => {
      const result = generator.wordWrapText('This is a long text that should be wrapped', 100, 12);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every(line => line.length <= 20)).toBe(true); // Approximate check
    });

    test('should handle short text', () => {
      const result = generator.wordWrapText('Short text', 200, 12);
      
      expect(result).toEqual(['Short text']);
    });

    test('should handle empty text', () => {
      const result = generator.wordWrapText('', 100, 12);
      
      expect(result).toEqual([]);
    });

    test('should handle single long word', () => {
      const result = generator.wordWrapText('Supercalifragilisticexpialidocious', 50, 12);
      
      expect(result).toEqual(['Supercalifragilisticexpialidocious']);
    });
  });

  describe('loadNunitoFont', () => {
    test('should load font file', async () => {
      const result = await generator.loadNunitoFont();

      expect(fs.readFile).toHaveBeenCalledWith(
        expect.stringContaining('Nunito-Bold.ttf')
      );
      expect(result).toBe('bW9jay1mb250LWRhdGE=');
    });
  });

  describe('generateTextOverlaySVG', () => {
    test('should generate SVG with text overlay', () => {
      const fontData = 'base64-font-data';
      const svg = generator.generateTextOverlaySVG(
        1080, 1080, 
        'Top text', 'Bottom text', 
        fontData
      );

      expect(svg).toContain('<svg');
      expect(svg).toContain('Top text');
      expect(svg).toContain('Bottom text');
      expect(svg).toContain(fontData);
      expect(svg).toContain('Nunito');
    });

    test('should escape XML in text', () => {
      const fontData = 'base64-font-data';
      const svg = generator.generateTextOverlaySVG(
        1080, 1080,
        'Text with <script> & "quotes"', 'Bottom text',
        fontData
      );

      expect(svg).toContain('Text with &lt;script&gt; &amp; &quot;quotes&quot;');
    });
  });

  describe('escapeXml', () => {
    test('should escape XML entities', () => {
      const result = generator.escapeXml('Text with <tag> & "quotes" and \'apostrophes\'');
      
      expect(result).toBe('Text with &lt;tag&gt; &amp; &quot;quotes&quot; and &apos;apostrophes&apos;');
    });

    test('should handle empty string', () => {
      expect(generator.escapeXml('')).toBe('');
    });

    test('should handle string without special characters', () => {
      expect(generator.escapeXml('Normal text')).toBe('Normal text');
    });
  });

  describe('generateSlide', () => {
    test('should generate slide successfully', async () => {
      // Mock seekAndExtractFrame
      jest.spyOn(generator, 'seekAndExtractFrame')
        .mockResolvedValueOnce(Buffer.from('top-frame'))
        .mockResolvedValueOnce(Buffer.from('bottom-frame'));

      // Mock font loading
      jest.spyOn(generator, 'loadNunitoFont').mockResolvedValue('font-data');

      const slideConfig = {
        topTimestamp: 10,
        bottomTimestamp: 15,
        topText: 'Top text',
        bottomText: 'Bottom text'
      };

      const result = await generator.generateSlide(slideConfig, 1, mockPage);

      expect(generator.seekAndExtractFrame).toHaveBeenCalledTimes(2);
      expect(generator.seekAndExtractFrame).toHaveBeenCalledWith(mockPage, 10);
      expect(generator.seekAndExtractFrame).toHaveBeenCalledWith(mockPage, 15);
      expect(fs.writeFile).toHaveBeenCalled();
      expect(result).toContain('slide-1.png');
    });

    test('should return base64 when configured', async () => {
      const base64Generator = new CarouselGenerator({
        name: 'test-carousel',
        returnBase64: true
      });
      base64Generator.browser = mockBrowser;

      jest.spyOn(base64Generator, 'seekAndExtractFrame')
        .mockResolvedValueOnce(Buffer.from('top-frame'))
        .mockResolvedValueOnce(Buffer.from('bottom-frame'));

      jest.spyOn(base64Generator, 'loadNunitoFont').mockResolvedValue('font-data');

      const slideConfig = {
        topTimestamp: 10,
        bottomTimestamp: 15,
        topText: 'Top text',
        bottomText: 'Bottom text'
      };

      const result = await base64Generator.generateSlide(slideConfig, 1, mockPage);

      expect(result).toHaveProperty('base64');
      expect(result).toHaveProperty('filename');
      expect(result.base64).toContain('data:image/png;base64,');
    });

    test('should handle frame extraction errors', async () => {
      jest.spyOn(generator, 'seekAndExtractFrame')
        .mockRejectedValueOnce(new Error('Frame extraction failed'));

      const slideConfig = {
        topTimestamp: 10,
        bottomTimestamp: 15,
        topText: 'Top text',
        bottomText: 'Bottom text'
      };

      await expect(generator.generateSlide(slideConfig, 1, mockPage))
        .rejects.toThrow('Invalid timestamp 10s - Frame extraction failed');
    });
  });

  describe('generateCtaSlide', () => {
    test('should generate CTA slide', async () => {
      jest.spyOn(generator, 'loadNunitoFont').mockResolvedValue('font-data');

      const ctaConfig = {
        bgColor: '#1a1a2e',
        text: 'Follow us for more content!',
        thumbnailPath: '/path/to/thumb.png',
        platforms: ['instagram', 'youtube']
      };

      await generator.generateCtaSlide(ctaConfig, 1);

      expect(generator.loadNunitoFont).toHaveBeenCalled();
      expect(fs.readFile).toHaveBeenCalledWith('/path/to/thumb.png');
      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('slide-cta.png'), expect.anything());
    });

    test('should handle missing thumbnail', async () => {
      jest.spyOn(generator, 'loadNunitoFont').mockResolvedValue('font-data');

      const ctaConfig = {
        text: 'Follow us!',
        platforms: ['instagram']
      };

      await generator.generateCtaSlide(ctaConfig, 1);

      expect(fetch).not.toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
    });

    test('should return base64 when configured', async () => {
      const base64Generator = new CarouselGenerator({
        name: 'test-carousel',
        returnBase64: true
      });

      jest.spyOn(base64Generator, 'loadNunitoFont').mockResolvedValue('font-data');

      const ctaConfig = {
        text: 'Follow us!',
        platforms: []
      };

      const result = await base64Generator.generateCtaSlide(ctaConfig, 1);

      expect(result).toHaveProperty('base64');
      expect(result).toHaveProperty('filename');
    });
  });

  describe('seekAndExtractFrame', () => {
    test('should extract frame successfully', async () => {
      // Mock page evaluations
      mockPage.evaluate
        .mockResolvedValueOnce({ isAd: false, hasSkip: false, hasOverlay: false }) // skipAds
        .mockResolvedValueOnce(undefined) // Clear error elements
        .mockResolvedValueOnce(undefined) // Set video time
        .mockResolvedValueOnce(true)      // Video paused
        .mockResolvedValueOnce({          // Error check
          hasErrorElements: false,
          hasVideoError: false,
          videoReadyState: 4,
          videoCurrentTime: 10,
          videoNetworkState: 1
        })
        .mockResolvedValueOnce('data:image/png;base64,mock-frame-data'); // Frame extraction

      // Mock video element
      const mockVideoElement = {
        screenshot: jest.fn().mockResolvedValue(Buffer.from('mock-screenshot'))
      };
      mockPage.$.mockResolvedValue(mockVideoElement);

      const result = await generator.seekAndExtractFrame(mockPage, 10);

      expect(mockPage.evaluate).toHaveBeenCalledTimes(4);
      expect(result).toBeInstanceOf(Buffer);
    });

    test('should retry when screenshot returns null then succeed', async () => {
      // skipAds needs a valid ad state; all other evaluates are no-ops
      mockPage.evaluate
        .mockResolvedValue({ isAd: false, hasSkip: false, hasOverlay: false });

      // First attempt returns null, second returns a real buffer
      const mockVideoElement = {
        screenshot: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(Buffer.from('mock-screenshot'))
      };
      mockPage.$.mockResolvedValue(mockVideoElement);

      const result = await generator.seekAndExtractFrame(mockPage, 10);

      expect(mockVideoElement.screenshot).toHaveBeenCalledTimes(2);
      expect(result).toBeInstanceOf(Buffer);
    });

    test('should throw error when video element not found', async () => {
      mockPage.evaluate
        .mockResolvedValue({ isAd: false, hasSkip: false, hasOverlay: false });
      mockPage.$.mockResolvedValue(null); // no video element on page

      await expect(generator.seekAndExtractFrame(mockPage, 10))
        .rejects.toThrow('Video element not found');
    });

    test('should fallback to element screenshot', async () => {
      mockPage.evaluate
        .mockResolvedValueOnce({ isAd: false, hasSkip: false, hasOverlay: false }) // skipAds
        .mockResolvedValueOnce(undefined) // Clear error elements
        .mockResolvedValueOnce(undefined) // Set video time
        .mockResolvedValueOnce(true)      // Video paused
        .mockResolvedValueOnce({          // Error check
          hasErrorElements: false,
          hasVideoError: false,
          videoReadyState: 4,
          videoCurrentTime: 10,
          videoNetworkState: 1
        })
        .mockResolvedValueOnce(null)      // Frame extraction fails
        .mockResolvedValueOnce(null);     // Retry fails

      const mockVideoElement = {
        screenshot: jest.fn().mockResolvedValue(Buffer.from('element-screenshot'))
      };
      mockPage.$.mockResolvedValue(mockVideoElement);

      const result = await generator.seekAndExtractFrame(mockPage, 10);

      expect(mockPage.$).toHaveBeenCalledWith('video');
      expect(result).toBeInstanceOf(Buffer);
    });

    test('should throw error when all extraction attempts fail', async () => {
      mockPage.evaluate
        .mockResolvedValueOnce({ isAd: false, hasSkip: false, hasOverlay: false }) // skipAds
        .mockResolvedValueOnce(undefined) // Clear error elements
        .mockResolvedValueOnce(undefined) // Set video time
        .mockResolvedValueOnce(true)      // Video paused
        .mockResolvedValueOnce({          // Error check
          hasErrorElements: false,
          hasVideoError: false,
          videoReadyState: 4,
          videoCurrentTime: 10,
          videoNetworkState: 1
        })
        .mockResolvedValueOnce(null)      // Frame extraction fails
        .mockResolvedValueOnce(null)      // Retry fails
        .mockResolvedValueOnce(null);     // Third retry fails

      // Mock video element that fails screenshot
      const mockVideoElement = {
        screenshot: jest.fn().mockResolvedValue(null)
      };
      mockPage.$.mockResolvedValue(mockVideoElement);

      await expect(generator.seekAndExtractFrame(mockPage, 10))
        .rejects.toThrow('Could not extract a non-blank video frame after multiple attempts');
    });
  });

  describe('generateCarousel', () => {
    test('should generate complete carousel', async () => {
      jest.spyOn(generator, 'generateSlide').mockResolvedValue('slide-1.png');
      generator.browser = mockBrowser;

      const result = await generator.generateCarousel();

      expect(mockBrowser.newPage).toHaveBeenCalled();
      expect(mockPage.setUserAgent).toHaveBeenCalled();
      expect(mockPage.setViewport).toHaveBeenCalled();
      expect(mockPage.goto).toHaveBeenCalled();
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('video', { timeout: 15000 });
      expect(generator.generateSlide).toHaveBeenCalledWith(
        generator.config.slides[0],
        1,
        mockPage
      );
      expect(mockPage.close).toHaveBeenCalled();
      expect(result).toEqual(['slide-1.png']);
    });

    test('should handle multiple slides', async () => {
      generator.config.slides = [
        { topTimestamp: 10, bottomTimestamp: 15, topText: 'Top 1', bottomText: 'Bottom 1' },
        { topTimestamp: 20, bottomTimestamp: 25, topText: 'Top 2', bottomText: 'Bottom 2' }
      ];

      jest.spyOn(generator, 'generateSlide')
        .mockResolvedValueOnce('slide-1.png')
        .mockResolvedValueOnce('slide-2.png');

      generator.browser = mockBrowser;

      await generator.generateCarousel();

      expect(generator.generateSlide).toHaveBeenCalledTimes(2);
    });

    test('should handle YouTube page setup', async () => {
      jest.spyOn(generator, 'generateSlide').mockResolvedValue('slide-1.png');
      generator.browser = mockBrowser;

      await generator.generateCarousel();

      // Check YouTube URL construction (goto is called with url + options)
      expect(mockPage.goto).toHaveBeenCalledWith(
        expect.stringContaining('youtube.com/watch?v=test-video-id'),
        expect.any(Object)
      );
      expect(mockPage.goto).toHaveBeenCalledWith(
        expect.stringContaining('t=10s'),
        expect.any(Object)
      );
    });
  });
});
