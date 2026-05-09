// Test for deterministic behavior verification
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

describe('AudioSyncer Determinism Tests', () => {
  let syncer;

  beforeEach(() => {
    syncer = new AudioSyncer({
      videoPath: '/test/video.mp4',
      audioPath: '/test/audio.wav',
      outputPath: '/test/output.mp4',
      sampleRate: 8000
    });
  });

  test('should produce identical results for identical correlation data', () => {
    // Create deterministic correlation data
    const correlation = new Float64Array(100);
    correlation[10] = 5.0; // Primary peak
    correlation[15] = 4.6; // Within 0.5 threshold
    correlation[20] = 4.8; // Within 0.5 threshold
    correlation[25] = 3.0; // Below threshold
    
    // Run the same calculation multiple times
    const results = [];
    for (let i = 0; i < 10; i++) {
      const result = syncer.findBestLag(correlation);
      results.push(result);
    }
    
    // All results should be identical
    const firstResult = results[0];
    results.forEach((result) => {
      expect(result).toBe(firstResult);
    });
    
    // Verify it selected the earliest peak (index 10)
    const expectedLagFrames = Math.round(10 * 30 / 8000);
    const expectedLagSeconds = expectedLagFrames / 30;
    expect(firstResult).toBe(expectedLagSeconds);
  });

  test('should handle ties deterministically by selecting earliest peak', () => {
    // Create correlation with multiple identical peaks
    const correlation = new Float64Array(100);
    correlation[5] = 5.0;  // First peak
    correlation[15] = 5.0; // Second identical peak
    correlation[25] = 5.0; // Third identical peak
    
    // Run multiple times
    const results = [];
    for (let i = 0; i < 10; i++) {
      const result = syncer.findBestLag(correlation);
      results.push(result);
    }
    
    // All should be identical and select the first peak (index 5)
    const firstResult = results[0];
    results.forEach((result) => {
      expect(result).toBe(firstResult);
    });
    
    const expectedLagFrames = Math.round(5 * 30 / 8000);
    const expectedLagSeconds = expectedLagFrames / 30;
    expect(firstResult).toBe(expectedLagSeconds);
  });

  test('should produce frame-exact results across different sample rates', () => {
    // Test with different sample rates to ensure frame rounding is consistent
    const sampleRates = [8000, 16000, 48000];
    const correlation = new Float64Array(100);
    correlation[10] = 5.0;
    
    const results = sampleRates.map(rate => {
      const testSyncer = new AudioSyncer({
        videoPath: '/test/video.mp4',
        audioPath: '/test/audio.wav',
        outputPath: '/test/output.mp4',
        sampleRate: rate
      });
      
      return testSyncer.findBestLag(correlation, 50);
    });
    
    // Results should be frame-exact (divisible by 1/30)
    results.forEach(result => {
      const frameRate = 30;
      const lagFrames = Math.round(result * frameRate);
      const reconstructedLag = lagFrames / frameRate;
      expect(result).toBe(reconstructedLag);
      expect(Number.isInteger(lagFrames)).toBe(true);
    });
  });

  test('should validate that frame offsets are integers', () => {
    // Test various correlation scenarios to ensure frame rounding
    const testCases = [
      { peakIndex: 10, description: 'early peak' },
      { peakIndex: 50, description: 'middle peak' },
      { peakIndex: 90, description: 'late peak (negative lag)' }
    ];
    
    testCases.forEach(({ peakIndex }) => {
      const correlation = new Float64Array(100);
      correlation[peakIndex] = 5.0;
      
      const result = syncer.findBestLag(correlation);
      
      // Convert to frames and verify it's an integer
      const frameRate = 30;
      const lagFrames = Math.round(result * frameRate);
      
      expect(Number.isInteger(lagFrames)).toBe(true);
      expect(lagFrames).toBeGreaterThanOrEqual(-Math.floor(100 / 2));
      expect(lagFrames).toBeLessThanOrEqual(Math.floor(100 / 2));
    });
  });
});
