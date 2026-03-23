import main from '../carousel/generate-carousel.js';
import fs from 'fs-extra';
import path from 'path';
import CarouselGenerator from '../carousel/CarouselGenerator.js';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('../carousel/CarouselGenerator.js', () => {
  return jest.fn().mockImplementation((config) => ({
    config,
    outputDir: null,
    init: jest.fn().mockResolvedValue(),
    generateCarousel: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue()
  }));
});

describe('generate-carousel.js', () => {
  let mockProcessArgv;
  let mockProcessExit;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock process.argv
    mockProcessArgv = ['node', 'generate-carousel.js'];
    process.argv = mockProcessArgv;

    // Mock process.exit
    mockProcessExit = jest.fn();
    process.exit = mockProcessExit;

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    // Restore console methods
    console.log.mockRestore();
    console.error.mockRestore();
  });

  describe('main function', () => {
    describe('single carousel mode', () => {
      test('should generate single carousel successfully', async () => {
        // Mock config file exists
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          name: 'test-carousel',
          videoId: 'test-video-id',
          showLogo: true,
          slides: [
            {
              topTimestamp: 10,
              bottomTimestamp: 15,
              topText: 'Top text',
              bottomText: 'Bottom text'
            }
          ]
        });

        // Mock CarouselGenerator to return specific values for this test
        CarouselGenerator.mockImplementation((config) => ({
          config,
          outputDir: null,
          init: jest.fn().mockResolvedValue(),
          generateCarousel: jest.fn().mockResolvedValue(['slide-1.png']),
          close: jest.fn().mockResolvedValue()
        }));

        await main();

        expect(fs.existsSync).toHaveBeenCalledWith(
          path.join(process.cwd(), 'carousel-config.json')
        );
        expect(fs.readJson).toHaveBeenCalled();
        expect(CarouselGenerator).toHaveBeenCalledWith({
          name: 'test-carousel',
          videoId: 'test-video-id',
          showLogo: true,
          slides: [
            {
              topTimestamp: 10,
              bottomTimestamp: 15,
              topText: 'Top text',
              bottomText: 'Bottom text'
            }
          ]
        });
        
        // Get the mocked instance
        const mockInstance = CarouselGenerator.mock.results[0].value;
        expect(mockInstance.init).toHaveBeenCalled();
        expect(mockInstance.generateCarousel).toHaveBeenCalled();
        expect(mockInstance.close).toHaveBeenCalled();
        expect(mockProcessExit).not.toHaveBeenCalled();
      });

      test('should handle missing config file', async () => {
        fs.existsSync.mockReturnValue(false);

        await main();

        expect(console.error).toHaveBeenCalledWith('❌ Error: carousel-config.json not found');
        expect(console.log).toHaveBeenCalledWith('Please create a carousel-config.json file in the project root.');
        expect(console.log).toHaveBeenCalledWith('\nExample format:');
        expect(mockProcessExit).toHaveBeenCalledWith(1);
      });

      test('should handle carousel generation error', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          name: 'test-carousel',
          videoId: 'test-video-id',
          slides: []
        });

        CarouselGenerator.mockImplementation((config) => ({
          config,
          outputDir: null,
          init: jest.fn().mockResolvedValue(),
          generateCarousel: jest.fn().mockRejectedValue(new Error('Generation failed')),
          close: jest.fn().mockResolvedValue()
        }));

        await main();

        expect(console.error).toHaveBeenCalledWith('❌ Error generating carousel:', expect.any(Error));
        
        // Get the mocked instance
        const mockInstance = CarouselGenerator.mock.results[0].value;
        expect(mockInstance.close).toHaveBeenCalled();
        expect(mockProcessExit).toHaveBeenCalledWith(1);
      });

      test('should ensure generator close is called even if init fails', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          name: 'test-carousel',
          videoId: 'test-video-id',
          slides: []
        });

        CarouselGenerator.mockImplementation((config) => ({
          config,
          outputDir: null,
          init: jest.fn().mockRejectedValue(new Error('Init failed')),
          generateCarousel: jest.fn(),
          close: jest.fn().mockResolvedValue()
        }));

        await main();

        // Get the mocked instance
        const mockInstance = CarouselGenerator.mock.results[0].value;
        expect(mockInstance.close).toHaveBeenCalled();
        expect(mockProcessExit).toHaveBeenCalledWith(1);
      });
    });

    describe('bulk mode', () => {
      beforeEach(() => {
        // Set process.argv for bulk mode
        process.argv = ['node', 'generate-carousel.js', '--bulk'];
      });

      test('should generate multiple carousels in bulk mode', async () => {
        // Mock bulk config file exists
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          transcriptName: 'test-transcript',
          videoId: 'test-video-id',
          showLogo: true,
          carousels: [
            {
              name: 'Carousel 1',
              description: 'First carousel',
              slides: [
                {
                  topTimestamp: 10,
                  bottomTimestamp: 15,
                  topText: 'Top 1',
                  bottomText: 'Bottom 1'
                }
              ]
            },
            {
              name: 'Carousel 2',
              description: 'Second carousel',
              slides: [
                {
                  topTimestamp: 20,
                  bottomTimestamp: 25,
                  topText: 'Top 2',
                  bottomText: 'Bottom 2'
                }
              ]
            }
          ]
        });

        // Mock CarouselGenerator instances
        CarouselGenerator
          .mockImplementationOnce((config) => ({
            config,
            outputDir: null,
            init: jest.fn().mockResolvedValue(),
            generateCarousel: jest.fn().mockResolvedValue(['slide-1.png']),
            close: jest.fn().mockResolvedValue()
          }))
          .mockImplementationOnce((config) => ({
            config,
            outputDir: null,
            init: jest.fn().mockResolvedValue(),
            generateCarousel: jest.fn().mockResolvedValue(['slide-2.png']),
            close: jest.fn().mockResolvedValue()
          }));

        await main();

        expect(fs.existsSync).toHaveBeenCalledWith(
          path.join(process.cwd(), 'carousel-bulk-config.json')
        );
        expect(fs.readJson).toHaveBeenCalled();
        expect(CarouselGenerator).toHaveBeenCalledTimes(2);

        // Check first carousel
        expect(CarouselGenerator).toHaveBeenNthCalledWith(1, {
          name: 'test-transcript-carousel-1',
          videoId: 'test-video-id',
          slides: [
            {
              topTimestamp: 10,
              bottomTimestamp: 15,
              topText: 'Top 1',
              bottomText: 'Bottom 1'
            }
          ],
          showLogo: true
        });

        // Check second carousel
        expect(CarouselGenerator).toHaveBeenNthCalledWith(2, {
          name: 'test-transcript-carousel-2',
          videoId: 'test-video-id',
          slides: [
            {
              topTimestamp: 20,
              bottomTimestamp: 25,
              topText: 'Top 2',
              bottomText: 'Bottom 2'
            }
          ],
          showLogo: true
        });

        // Check all generators were properly initialized and closed
        const mockInstances = CarouselGenerator.mock.results.map(result => result.value);
        mockInstances.forEach((instance) => {
          expect(instance.init).toHaveBeenCalled();
          expect(instance.generateCarousel).toHaveBeenCalled();
          expect(instance.close).toHaveBeenCalled();
        });

        expect(console.log).toHaveBeenCalledWith('\n✅ Bulk generation complete! Check public/output/ for 2 carousel folders.\n');
      });

      test('should handle missing bulk config file', async () => {
        fs.existsSync.mockReturnValue(false);

        await main();

        expect(console.error).toHaveBeenCalledWith('❌ Error: carousel-bulk-config.json not found');
        expect(console.log).toHaveBeenCalledWith('Please create a carousel-bulk-config.json file in the project root.');
        expect(mockProcessExit).toHaveBeenCalledWith(1);
      });

      test('should handle individual carousel errors in bulk mode', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          transcriptName: 'test-transcript',
          videoId: 'test-video-id',
          carousels: [
            {
              name: 'Carousel 1',
              slides: []
            },
            {
              name: 'Carousel 2',
              slides: []
            }
          ]
        });

        CarouselGenerator
          .mockImplementationOnce((config) => ({
            config,
            outputDir: null,
            init: jest.fn().mockResolvedValue(),
            generateCarousel: jest.fn().mockResolvedValue(['slide-1.png']),
            close: jest.fn().mockResolvedValue()
          }))
          .mockImplementationOnce((config) => ({
            config,
            outputDir: null,
            init: jest.fn().mockResolvedValue(),
            generateCarousel: jest.fn().mockRejectedValue(new Error('Generation failed')),
            close: jest.fn().mockResolvedValue()
          }));

        await main();

        expect(console.error).toHaveBeenCalledWith('❌ Error generating carousel 2:', expect.any(Error));
        
        const mockInstances = CarouselGenerator.mock.results.map(result => result.value);
        expect(mockInstances[0].close).toHaveBeenCalled();
        expect(mockInstances[1].close).toHaveBeenCalled();
        expect(mockProcessExit).not.toHaveBeenCalled(); // Should not exit on individual errors
      });

      test('should handle empty carousels array', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          transcriptName: 'test-transcript',
          videoId: 'test-video-id',
          carousels: []
        });

        await main();

        expect(CarouselGenerator).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith('\n✅ Bulk generation complete! Check public/output/ for 0 carousel folders.\n');
      });

      test('should handle showLogo default in bulk mode', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          transcriptName: 'test-transcript',
          videoId: 'test-video-id',
          // showLogo not specified, should default to true
          carousels: [
            {
              name: 'Carousel 1',
              slides: []
            }
          ]
        });

        CarouselGenerator.mockImplementation((config) => ({
          config,
          outputDir: null,
          init: jest.fn().mockResolvedValue(),
          generateCarousel: jest.fn().mockResolvedValue([]),
          close: jest.fn().mockResolvedValue()
        }));

        await main();

        expect(CarouselGenerator).toHaveBeenCalledWith(
          expect.objectContaining({
            showLogo: true
          })
        );
      });

      test('should handle showLogo false in bulk mode', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          transcriptName: 'test-transcript',
          videoId: 'test-video-id',
          showLogo: false,
          carousels: [
            {
              name: 'Carousel 1',
              slides: []
            }
          ]
        });

        CarouselGenerator.mockImplementation((config) => ({
          config,
          outputDir: null,
          init: jest.fn().mockResolvedValue(),
          generateCarousel: jest.fn().mockResolvedValue([]),
          close: jest.fn().mockResolvedValue()
        }));

        await main();

        expect(CarouselGenerator).toHaveBeenCalledWith(
          expect.objectContaining({
            showLogo: false
          })
        );
      });
    });

    describe('argument parsing', () => {
      test('should detect bulk mode with --bulk flag', async () => {
        process.argv = ['node', 'generate-carousel.js', '--bulk'];
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          transcriptName: 'test-transcript',
          videoId: 'test-video-id',
          carousels: []
        });

        await main();

        expect(fs.existsSync).toHaveBeenCalledWith(
          path.join(process.cwd(), 'carousel-bulk-config.json')
        );
      });

      test('should detect bulk mode with --bulk flag among other args', async () => {
        process.argv = ['node', 'generate-carousel.js', 'other-arg', '--bulk', 'another-arg'];
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          transcriptName: 'test-transcript',
          videoId: 'test-video-id',
          carousels: []
        });

        await main();

        expect(fs.existsSync).toHaveBeenCalledWith(
          path.join(process.cwd(), 'carousel-bulk-config.json')
        );
      });

      test('should use single mode without --bulk flag', async () => {
        process.argv = ['node', 'generate-carousel.js', 'other-arg'];
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockResolvedValue({
          name: 'test-carousel',
          videoId: 'test-video-id',
          slides: []
        });

        const mockGenerator = {
          init: jest.fn().mockResolvedValue(),
          generateCarousel: jest.fn().mockResolvedValue([]),
          close: jest.fn().mockResolvedValue()
        };
        CarouselGenerator.mockImplementation(() => mockGenerator);

        await main();

        expect(fs.existsSync).toHaveBeenCalledWith(
          path.join(process.cwd(), 'carousel-config.json')
        );
      });
    });

    describe('error handling', () => {
      test('should handle JSON parsing errors', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readJson.mockRejectedValue(new Error('Invalid JSON'));

        await main();

        expect(mockProcessExit).toHaveBeenCalledWith(1);
      });

      test('should handle unexpected errors gracefully', async () => {
        fs.existsSync.mockImplementation(() => {
          throw new Error('File system error');
        });

        await main();

        expect(mockProcessExit).toHaveBeenCalledWith(1);
      });
    });
  });

  describe('module exports', () => {
    test('should export main function', () => {
      expect(typeof main).toBe('function');
    });

    test('should be callable as module', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readJson.mockResolvedValue({
        name: 'test-carousel',
        videoId: 'test-video-id',
        slides: []
      });

      CarouselGenerator.mockImplementation((config) => ({
        config,
        outputDir: null,
        init: jest.fn().mockResolvedValue(),
        generateCarousel: jest.fn().mockResolvedValue([]),
        close: jest.fn().mockResolvedValue()
      }));

      await main();

      const mockInstance = CarouselGenerator.mock.results[0].value;
      expect(mockInstance.init).toHaveBeenCalled();
    });
  });
});
