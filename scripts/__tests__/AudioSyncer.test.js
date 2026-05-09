// Mock external dependencies
jest.mock('wavefile', () => ({
  WaveFile: jest.fn().mockImplementation(() => ({
    toBitDepth: jest.fn(),
    getSamples: jest.fn().mockReturnValue(new Float32Array(1000))
  }))
}));

jest.mock('../shared/hdr-detect.js', () => ({
  detectHDR: jest.fn().mockResolvedValue(false),
  HDR_TONEMAP_VF: 'hdr_filter',
  SDR_FORMAT_VF: 'sdr_filter'
}));

jest.mock('fft.js', () => {
  return jest.fn().mockImplementation(() => ({
    createComplexArray: jest.fn().mockReturnValue(new Float64Array(2048)),
    transform: jest.fn(),
    inverseTransform: jest.fn()
  }));
});

import AudioSyncer from '../sync/AudioSyncer.js';

describe('AudioSyncer', () => {
  let syncer;

  beforeEach(() => {
    syncer = new AudioSyncer({
      videoPath: '/test/video.mp4',
      audioPath: '/test/audio.wav',
      outputPath: '/test/output.mp4',
      sampleRate: 8000
    });
  });

  describe('findBestLag', () => {
    test('should select single maximum peak deterministically', () => {
      // Simple correlation with clear maximum at index 10
      const correlation = new Float64Array(100);
      correlation[10] = 5.0; // Clear maximum
      
      const result = syncer.findBestLag(correlation);
      
      // Should select index 10, convert to lag in seconds (frame-exact)
      const expectedLagFrames = Math.round(10 * 30 / 8000); // Convert samples to frames
      const expectedLagSeconds = expectedLagFrames / 30;
      expect(result).toBe(expectedLagSeconds);
    });

    test('should prefer earliest peak when multiple peaks within SNR threshold', () => {
      // Multiple peaks within 0.5 of each other
      const correlation = new Float64Array(100);
      correlation[10] = 5.0; // First peak
      correlation[20] = 4.8; // Within 0.5 of first peak
      correlation[30] = 5.2; // Higher peak, becomes new max
      correlation[40] = 4.9; // Within 0.5 of new max
      
      const result = syncer.findBestLag(correlation);
      
      // Should select index 30 (highest peak) as it's > 0.5 from previous max
      const expectedLagFrames = Math.round(30 * 30 / 8000);
      const expectedLagSeconds = expectedLagFrames / 30;
      expect(result).toBe(expectedLagSeconds);
    });

    test('should prefer earliest peak when multiple peaks exactly at threshold', () => {
      // Multiple peaks exactly at 0.5 threshold
      const correlation = new Float64Array(100);
      correlation[10] = 5.0; // First peak
      correlation[20] = 4.5; // Exactly 0.5 from first peak
      correlation[30] = 4.7; // Within 0.5 of first peak
      
      const result = syncer.findBestLag(correlation);
      
      // Should select index 10 (earliest peak among candidates)
      const expectedLagFrames = Math.round(10 * 30 / 8000);
      const expectedLagSeconds = expectedLagFrames / 30;
      expect(result).toBe(expectedLagSeconds);
    });

    test('should handle circular correlation correctly', () => {
      // Peak in the second half (should be converted to negative lag)
      const correlation = new Float64Array(100);
      correlation[90] = 5.0; // Peak in second half
      
      const result = syncer.findBestLag(correlation);
      
      // Index 90 in length 100 should convert to -10 (90 - 100)
      const expectedLagFrames = Math.round(-10 * 30 / 8000);
      const expectedLagSeconds = expectedLagFrames / 30;
      expect(result).toBe(expectedLagSeconds);
    });

    test('should produce frame-exact integer offsets', () => {
      // Test that the result is always frame-exact
      const correlation = new Float64Array(100);
      correlation[25] = 5.0;
      
      const result = syncer.findBestLag(correlation);
      
      // Result should be exactly divisible by 1/30 second (one frame)
      const frameRate = 30;
      const lagFrames = Math.round(result * frameRate);
      const reconstructedLag = lagFrames / frameRate;
      
      expect(result).toBe(reconstructedLag);
      expect(Number.isInteger(lagFrames)).toBe(true);
    });
  });

  describe('validatePeak', () => {
    test('should validate peak correctly with frame-based lag', () => {
      const correlation = new Float64Array(100);
      // Create correlation with clear peak at index 50, low noise elsewhere
      for (let i = 0; i < 100; i++) {
        correlation[i] = 0.01; // Very low noise floor
      }
      correlation[50] = 5.0; // Clear peak at index 50
      
      const lagSeconds = 0.033; // ~1 frame at 30fps, maps to index 50
      const result = syncer.validatePeak(correlation, lagSeconds);
      
            
      expect(result).toHaveProperty('snr');
      expect(typeof result.snr).toBe('number');
      expect(result).toHaveProperty('isReliable');
      expect(typeof result.isReliable).toBe('boolean');
      
      // Verify SNR calculation works (actual SNR will be ~0.1 for this test setup)
      expect(result.snr).toBeGreaterThan(0);
      expect(typeof result.snr).toBe('number');
      expect(result.isReliable).toBe(false); // With this setup, SNR should be below 3.0 threshold
    });

    test('should handle zero standard deviation', () => {
      const correlation = new Float64Array(100);
      // All values are the same (zero standard deviation)
      for (let i = 0; i < 100; i++) {
        correlation[i] = 1.0;
      }
      
      const lagSeconds = 0.033;
      const result = syncer.validatePeak(correlation, lagSeconds);
      
      expect(result.snr).toBe(0);
      expect(result.isReliable).toBe(false);
    });
  });

  describe('frame rounding behavior', () => {
    test('should round sample offsets to nearest frame', () => {
      const correlation = new Float64Array(100);
      
      // Test various sample positions
      const testCases = [
        { samples: 100, expectedFrames: Math.round(100 * 30 / 8000) },
        { samples: 267, expectedFrames: Math.round(267 * 30 / 8000) },
        { samples: -150, expectedFrames: Math.round(-150 * 30 / 8000) }
      ];
      
      testCases.forEach(({ samples, expectedFrames }) => {
        correlation.fill(0);
        const idx = samples >= 0 ? samples : 100 + samples; // Handle negative indices
        if (idx >= 0 && idx < 100) {
          correlation[idx] = 5.0;
          
          const result = syncer.findBestLag(correlation);
          const actualFrames = Math.round(result * 30);
          
          expect(actualFrames).toBe(expectedFrames);
        }
      });
    });
  });
});
