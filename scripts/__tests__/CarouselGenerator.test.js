import CarouselGenerator from '../carousel/CarouselGenerator.js';
import fs from 'fs-extra';

// Mock sharp and puppeteer
jest.mock('sharp');
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
      click: jest.fn(),
      evaluate: jest.fn(),
      close: jest.fn(),
      $: jest.fn(),
      $$: jest.fn()
    };

    // Setup puppeteer mock
    const puppeteer = await import('puppeteer-extra');
    puppeteer.default.launch = jest.fn().mockResolvedValue(mockBrowser);
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
      expect((await import('puppeteer-extra')).default.launch).toHaveBeenCalledWith({
        headless: true,
        args: expect.any(Array),
        protocolTimeout: 60000,
        defaultViewport: null
      });
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
        thumbnailUrl: 'https://example.com/thumb.jpg',
        platforms: ['instagram', 'youtube']
      };

      // Mock fetch for thumbnail
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('thumbnail-data'))
      });

      const result = await generator.generateCtaSlide(ctaConfig, 1);

      expect(generator.loadNunitoFont).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith('https://example.com/thumb.jpg');
      expect(fs.writeFile).toHaveBeenCalled();
      expect(result).toContain('cta-slide-1.png');
    });

    test('should handle missing thumbnail', async () => {
      jest.spyOn(generator, 'loadNunitoFont').mockResolvedValue('font-data');

      const ctaConfig = {
        text: 'Follow us!',
        platforms: ['instagram']
      };

      const result = await generator.generateCtaSlide(ctaConfig, 1);

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

      const result = await generator.seekAndExtractFrame(mockPage, 10);

      expect(mockPage.evaluate).toHaveBeenCalledTimes(5);
      expect(result).toBeInstanceOf(Buffer);
    });

    test('should handle video reset and reload', async () => {
      mockPage.evaluate
        .mockResolvedValueOnce(undefined) // Clear error elements
        .mockResolvedValueOnce(undefined) // Set video time
        .mockResolvedValueOnce(true)      // Video paused
        .mockResolvedValueOnce({          // Error check - video reset
          hasErrorElements: false,
          hasVideoError: false,
          videoReadyState: 4,
          videoCurrentTime: 0, // Reset to 0
          videoNetworkState: 1
        });

      mockPage.reload = jest.fn().mockResolvedValue();
      mockPage.url = jest.fn().mockReturnValue('https://youtube.com/watch?v=test');

      // Mock second evaluation after reload
      mockPage.evaluate
        .mockResolvedValueOnce({          // Error check after reload
          hasErrorElements: false,
          hasVideoError: false,
          videoCurrentTime: 10
        })
        .mockResolvedValueOnce('data:image/png;base64,mock-frame-data');

      const result = await generator.seekAndExtractFrame(mockPage, 10);

      expect(mockPage.reload).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Buffer);
    });

    test('should throw error on YouTube error', async () => {
      mockPage.evaluate
        .mockResolvedValueOnce(undefined) // Clear error elements
        .mockResolvedValueOnce(undefined) // Set video time
        .mockResolvedValueOnce(true)      // Video paused
        .mockResolvedValueOnce({          // Error check - has error
          hasErrorElements: true,
          hasVideoError: false,
          videoReadyState: 4,
          videoCurrentTime: 10,
          videoNetworkState: 1
        });

      await expect(generator.seekAndExtractFrame(mockPage, 10))
        .rejects.toThrow('YouTube error detected after seeking to 10s - timestamp may be beyond video duration');
    });

    test('should fallback to element screenshot', async () => {
      mockPage.evaluate
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

      mockPage.$ = jest.fn().mockResolvedValue({
        screenshot: jest.fn().mockResolvedValue(Buffer.from('element-screenshot'))
      });

      const result = await generator.seekAndExtractFrame(mockPage, 10);

      expect(mockPage.$).toHaveBeenCalledWith('video');
      expect(result).toBeInstanceOf(Buffer);
    });

    test('should throw error when all extraction attempts fail', async () => {
      mockPage.evaluate
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

      mockPage.$ = jest.fn().mockResolvedValue(null); // No video element

      await expect(generator.seekAndExtractFrame(mockPage, 10))
        .rejects.toThrow('Could not extract video frame after multiple attempts');
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

      const result = await generator.generateCarousel();

      expect(generator.generateSlide).toHaveBeenCalledTimes(2);
      expect(result).toEqual(['slide-1.png', 'slide-2.png']);
    });

    test('should handle YouTube page setup', async () => {
      jest.spyOn(generator, 'generateSlide').mockResolvedValue('slide-1.png');
      generator.browser = mockBrowser;

      await generator.generateCarousel();

      // Check YouTube URL construction
      expect(mockPage.goto).toHaveBeenCalledWith(
        expect.stringContaining('youtube.com/watch?v=test-video-id')
      );
      expect(mockPage.goto).toHaveBeenCalledWith(
        expect.stringContaining('t=10s')
      );
    });
  });
});
