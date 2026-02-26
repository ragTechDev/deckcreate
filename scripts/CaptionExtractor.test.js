import CaptionExtractor from './CaptionExtractor.js';

describe('CaptionExtractor', () => {
  let extractor;

  beforeEach(() => {
    extractor = new CaptionExtractor();
    fetch.mockClear();
  });

  describe('Constructor and initialization', () => {
    test('should create instance without errors', () => {
      expect(extractor).toBeInstanceOf(CaptionExtractor);
    });

    test('init and close methods should resolve', async () => {
      await expect(extractor.init()).resolves.toBeUndefined();
      await expect(extractor.close()).resolves.toBeUndefined();
    });
  });

  describe('fetchAllCaptions', () => {
    test('should fetch captions successfully', async () => {
      const mockHtml = `
        <html>
          <body>
            <script>
              var ytInitialPlayerResponse = {
                "captions": {
                  "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                      {
                        "baseUrl": "http://example.com/captions",
                        "languageCode": "en"
                      }
                    ]
                  }
                }
              };
              var somethingElse = true;
            </script>
          </body>
        </html>
      `;

      const mockCaptionData = JSON.stringify({
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 3000,
            segs: [{ utf8: "Hello world" }]
          }
        ]
      });

      fetch
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            getSetCookie: () => ['test=value'],
            get: jest.fn().mockReturnValue('')
          },
          text: jest.fn().mockResolvedValue(mockHtml)
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(mockCaptionData)
        });

      const result = await extractor.fetchAllCaptions('testVideoId');

      expect(result).toEqual([
        {
          startSec: 1,
          endSec: 4,
          text: 'Hello world'
        }
      ]);
    });

    test('should handle missing player response', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          getSetCookie: () => [],
          get: jest.fn().mockReturnValue('')
        },
        text: jest.fn().mockResolvedValue('<html>No player response</html>')
      });

      await expect(extractor.fetchAllCaptions('testVideoId'))
        .rejects.toThrow('Could not find ytInitialPlayerResponse');
    });

    test('should handle no caption tracks', async () => {
      const mockHtml = `
        <script>
          var ytInitialPlayerResponse = {
            "captions": {
              "playerCaptionsTracklistRenderer": {
                "captionTracks": []
              }
            }
          };
        </script>
      `;

      fetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          getSetCookie: () => [],
          get: jest.fn().mockReturnValue('')
        },
        text: jest.fn().mockResolvedValue(mockHtml)
      });

      await expect(extractor.fetchAllCaptions('testVideoId'))
        .rejects.toThrow('No caption tracks found for this video');
    });

    test('should handle fetch errors', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: {
          getSetCookie: () => [],
          get: jest.fn().mockReturnValue('')
        }
      });

      await expect(extractor.fetchAllCaptions('testVideoId'))
        .rejects.toThrow('Failed to fetch video page: 404');
    });
  });

  describe('parseJsonSegments', () => {
    test('should parse JSON caption segments correctly', () => {
      const jsonData = {
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 2000,
            segs: [
              { utf8: "Hello" },
              { utf8: " " },
              { utf8: "world" }
            ]
          },
          {
            tStartMs: 3000,
            dDurationMs: 1000,
            segs: [{ utf8: "Test" }]
          }
        ]
      };

      const result = extractor.parseJsonSegments(JSON.stringify(jsonData));

      expect(result).toEqual([
        {
          startSec: 1,
          endSec: 3,
          text: 'Hello world'
        },
        {
          startSec: 3,
          endSec: 4,
          text: 'Test'
        }
      ]);
    });

    test('should handle empty segments array', () => {
      const jsonData = { events: [] };
      const result = extractor.parseJsonSegments(JSON.stringify(jsonData));
      expect(result).toEqual([]);
    });

    test('should handle segments without segs', () => {
      const jsonData = {
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 2000
          }
        ]
      };

      const result = extractor.parseJsonSegments(JSON.stringify(jsonData));
      expect(result).toEqual([]);
    });

    test('should handle empty text segments', () => {
      const jsonData = {
        events: [
          {
            tStartMs: 1000,
            dDurationMs: 2000,
            segs: [{ utf8: "" }]
          }
        ]
      };

      const result = extractor.parseJsonSegments(JSON.stringify(jsonData));
      expect(result).toEqual([]);
    });
  });

  describe('parseXmlSegments', () => {
    test('should parse XML caption segments with <p> elements', () => {
      const xmlData = `
        <transcript>
          <p t="1000" d="2000">
            <s>Hello</s> <s>world</s>
          </p>
          <p t="3000" d="1000">
            <s>Test</s>
          </p>
        </transcript>
      `;

      const result = extractor.parseXmlSegments(xmlData);

      expect(result).toEqual([
        {
          startSec: 1,
          endSec: 3,
          text: 'Hello world'
        },
        {
          startSec: 3,
          endSec: 4,
          text: 'Test'
        }
      ]);
    });

    test('should parse XML caption segments with <text> elements as fallback', () => {
      const xmlData = `
        <transcript>
          <text start="1.0" dur="2.0">Hello world</text>
          <text start="3.0" dur="1.0">Test</text>
        </transcript>
      `;

      const result = extractor.parseXmlSegments(xmlData);

      expect(result).toEqual([
        {
          startSec: 1.0,
          endSec: 3.0,
          text: 'Hello world'
        },
        {
          startSec: 3.0,
          endSec: 4.0,
          text: 'Test'
        }
      ]);
    });

    test('should handle empty XML', () => {
      const result = extractor.parseXmlSegments('');
      expect(result).toEqual([]);
    });
  });

  describe('extractSlideCaptions', () => {
    test('should extract captions for slide timestamps', async () => {
      const mockSegments = [
        { startSec: 0, endSec: 2, text: 'First sentence' },
        { startSec: 2, endSec: 4, text: 'Second sentence' },
        { startSec: 4, endSec: 6, text: 'Third sentence' },
        { startSec: 6, endSec: 8, text: 'Fourth sentence' }
      ];

      jest.spyOn(extractor, 'fetchAllCaptions').mockResolvedValue(mockSegments);

      const result = await extractor.extractSlideCaptions('testVideoId', 2, 6);

      expect(result).toHaveProperty('topCaption');
      expect(result).toHaveProperty('bottomCaption');
      expect(typeof result.topCaption).toBe('string');
      expect(typeof result.bottomCaption).toBe('string');
    });

    test('should handle empty segments', async () => {
      jest.spyOn(extractor, 'fetchAllCaptions').mockResolvedValue([]);

      const result = await extractor.extractSlideCaptions('testVideoId', 2, 6);

      expect(result).toEqual({
        topCaption: '',
        bottomCaption: ''
      });
    });

    test('should handle no segments in time range', async () => {
      const mockSegments = [
        { startSec: 0, endSec: 1, text: 'Early' },
        { startSec: 10, endSec: 11, text: 'Late' }
      ];

      jest.spyOn(extractor, 'fetchAllCaptions').mockResolvedValue(mockSegments);

      const result = await extractor.extractSlideCaptions('testVideoId', 2, 6);

      // With context padding (5s), the range becomes -3 to 11s, so both segments should be included
      expect(result).toEqual({
        topCaption: 'Early',
        bottomCaption: 'Late'
      });
    });
  });

  describe('transcribeVideo', () => {
    test('should transcribe video with time range', async () => {
      const mockSegments = [
        { startSec: 0, endSec: 2, text: 'First sentence.' },
        { startSec: 2, endSec: 4, text: 'Second sentence.' },
        { startSec: 4, endSec: 6, text: 'Third sentence.' }
      ];

      jest.spyOn(extractor, 'fetchAllCaptions').mockResolvedValue(mockSegments);

      const result = await extractor.transcribeVideo('testVideoId', {
        startTime: 1,
        endTime: 5
      });

      expect(result).toHaveProperty('sentences');
      expect(result).toHaveProperty('fullText');
      expect(Array.isArray(result.sentences)).toBe(true);
      expect(typeof result.fullText).toBe('string');
    });

    test('should transcribe entire video without time range', async () => {
      const mockSegments = [
        { startSec: 0, endSec: 2, text: 'First sentence.' },
        { startSec: 2, endSec: 4, text: 'Second sentence.' }
      ];

      jest.spyOn(extractor, 'fetchAllCaptions').mockResolvedValue(mockSegments);

      const result = await extractor.transcribeVideo('testVideoId');

      expect(result.sentences.length).toBeGreaterThan(0);
      expect(result.fullText).toBe(result.sentences.map(s => s.text).join(' '));
    });

    test('should handle empty segments', async () => {
      jest.spyOn(extractor, 'fetchAllCaptions').mockResolvedValue([]);

      const result = await extractor.transcribeVideo('testVideoId');

      expect(result).toEqual({
        sentences: [],
        fullText: ''
      });
    });
  });

  describe('splitIntoSentences', () => {
    test('should split text into sentences correctly', () => {
      const text = 'First sentence. Second sentence! Third sentence? Fourth sentence.';
      const result = extractor.splitIntoSentences(text);

      expect(result).toEqual([
        'First sentence.',
        'Second sentence!',
        'Third sentence?',
        'Fourth sentence.'
      ]);
    });

    test('should handle single sentence', () => {
      const text = 'Single sentence.';
      const result = extractor.splitIntoSentences(text);

      expect(result).toEqual(['Single sentence.']);
    });

    test('should handle text without punctuation', () => {
      const text = 'Text without punctuation';
      const result = extractor.splitIntoSentences(text);

      expect(result).toEqual(['Text without punctuation']);
    });

    test('should handle empty text', () => {
      const result = extractor.splitIntoSentences('');
      expect(result).toEqual([]);
    });
  });

  describe('removeFillerWords', () => {
    test('should remove filler words from text', () => {
      const text = 'uh this is like, you know, a test';
      const result = extractor.removeFillerWords(text);

      expect(result).toBe('this is a test');
    });

    test('should handle text without filler words', () => {
      const text = 'This is a clean sentence';
      const result = extractor.removeFillerWords(text);

      expect(result).toBe('This is a clean sentence');
    });

    test('should handle empty text', () => {
      const result = extractor.removeFillerWords('');
      expect(result).toBe('');
    });

    test('should normalize whitespace', () => {
      const text = 'Word  word   word';
      const result = extractor.removeFillerWords(text);

      expect(result).toBe('Word word word');
    });
  });

  describe('trimToSentences', () => {
    test('should trim to complete sentences keeping end', () => {
      const text = 'Incomplete sentence. Complete sentence.';
      const result = extractor.trimToSentences(text, 'end');

      expect(result).toBe('Complete sentence.');
    });

    test('should trim to complete sentences keeping start', () => {
      const text = 'Complete sentence. Incomplete sentence';
      const result = extractor.trimToSentences(text, 'start');

      expect(result).toBe('Complete sentence.');
    });

    test('should handle empty text', () => {
      const result = extractor.trimToSentences('', 'end');
      expect(result).toBe('');
    });

    test('should capitalize first letter', () => {
      const text = 'lowercase sentence.';
      const result = extractor.trimToSentences(text, 'end');

      expect(result).toBe('Lowercase sentence.');
    });
  });

  describe('decodeHtml', () => {
    test('should decode HTML entities', () => {
      const text = '&amp; &lt; &gt; &quot; &#39;';
      const result = extractor.decodeHtml(text);

      expect(result).toBe('& < > " \'');
    });

    test('should handle numeric entities', () => {
      const text = '&#65;&#66;&#67;';
      const result = extractor.decodeHtml(text);

      expect(result).toBe('ABC');
    });

    test('should handle newlines', () => {
      const text = 'Line\nbreak';
      const result = extractor.decodeHtml(text);

      expect(result).toBe('Line break');
    });

    test('should handle empty text', () => {
      const result = extractor.decodeHtml('');
      expect(result).toBe('');
    });
  });

  describe('extractCaptions (legacy method)', () => {
    test('should extract captions for single timestamp', async () => {
      const mockSegments = [
        { startSec: 0, endSec: 2, text: 'Before' },
        { startSec: 1.5, endSec: 2.5, text: 'During' },
        { startSec: 3, endSec: 4, text: 'After' }
      ];

      jest.spyOn(extractor, 'fetchAllCaptions').mockResolvedValue(mockSegments);

      const result = await extractor.extractCaptions('testVideoId', 2);

      expect(result).toContain('During');
      expect(typeof result).toBe('string');
    });

    test('should handle empty segments', async () => {
      jest.spyOn(extractor, 'fetchAllCaptions').mockResolvedValue([]);

      const result = await extractor.extractCaptions('testVideoId', 2);

      expect(result).toBe('');
    });
  });

  describe('fetchCaptionData', () => {
    beforeEach(() => {
      fetch.mockClear();
    });
    
    test('should fetch caption data with different formats', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('test-data')
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('test-data-json3')
        });

      const result1 = await extractor.fetchCaptionData('http://example.com', 'cookie=test');
      const result2 = await extractor.fetchCaptionData('http://example.com', 'cookie=test');

      expect(result1).toBe('test-data');
      expect(result2).toBe('test-data-json3');
    });

    test('should return null on failed fetch', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('')  // First call with fmt=json3
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('')  // Second call with fmt=''
        });

      const result = await extractor.fetchCaptionData('http://example.com', 'cookie=test');

      expect(result).toBeNull();
    });
  });

  describe('fetchViaInnertube', () => {
    test('should try multiple clients and return caption data', async () => {
      const mockInnertubeResponse = {
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                languageCode: 'en',
                kind: 'asr',
                baseUrl: 'https://example.com/captions'
              }
            ]
          }
        }
      };

      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockInnertubeResponse)
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('caption-data')
        });

      const result = await extractor.fetchViaInnertube('testVideoId');

      expect(result).toBe('caption-data');
    });

    test('should return null if all clients fail', async () => {
      fetch.mockResolvedValue({
        ok: false
      });

      const result = await extractor.fetchViaInnertube('testVideoId');

      expect(result).toBeNull();
    });
  });
});
