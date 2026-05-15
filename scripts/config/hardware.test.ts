import { detectHardware, HardwareProfile } from './hardware';

/**
 * Unit tests for detectHardware().
 *
 * We mock `process.platform` and `process.arch` via Object.defineProperty so
 * each test case exercises a specific hardware environment without spawning any
 * processes or touching the filesystem.
 */

/** Helper: temporarily override process.platform and process.arch. */
function withPlatformArch(
  platform: string,
  arch: string,
  fn: () => Promise<void>,
): Promise<void> {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });

  return fn().finally(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  });
}

describe('detectHardware()', () => {
  describe('Apple Silicon (darwin / arm64)', () => {
    let profile: HardwareProfile;

    beforeAll(async () => {
      await withPlatformArch('darwin', 'arm64', async () => {
        profile = await detectHardware();
      });
    });

    it('reports platform as darwin', () => {
      expect(profile.platform).toBe('darwin');
    });

    it('reports arch as arm64', () => {
      expect(profile.arch).toBe('arm64');
    });

    it('sets supportsVideoToolbox to true', () => {
      expect(profile.supportsVideoToolbox).toBe(true);
    });

    it('sets supportsCuda to false', () => {
      expect(profile.supportsCuda).toBe(false);
    });

    it('selects videotoolbox encoder profile', () => {
      expect(profile.encoderProfile).toBe('videotoolbox');
    });
  });

  describe('Apple Intel Mac (darwin / x64)', () => {
    let profile: HardwareProfile;

    beforeAll(async () => {
      await withPlatformArch('darwin', 'x64', async () => {
        profile = await detectHardware();
      });
    });

    it('sets supportsVideoToolbox to true', () => {
      expect(profile.supportsVideoToolbox).toBe(true);
    });

    it('sets supportsCuda to false', () => {
      expect(profile.supportsCuda).toBe(false);
    });

    it('selects videotoolbox encoder profile', () => {
      expect(profile.encoderProfile).toBe('videotoolbox');
    });
  });

  describe('Linux x64 (NVIDIA CUDA heuristic)', () => {
    let profile: HardwareProfile;

    beforeAll(async () => {
      await withPlatformArch('linux', 'x64', async () => {
        profile = await detectHardware();
      });
    });

    it('reports platform as linux', () => {
      expect(profile.platform).toBe('linux');
    });

    it('reports arch as x64', () => {
      expect(profile.arch).toBe('x64');
    });

    it('sets supportsVideoToolbox to false', () => {
      expect(profile.supportsVideoToolbox).toBe(false);
    });

    it('sets supportsCuda to true', () => {
      expect(profile.supportsCuda).toBe(true);
    });

    it('selects nvenc encoder profile', () => {
      expect(profile.encoderProfile).toBe('nvenc');
    });
  });

  describe('Linux arm64 (CPU fallback — no VideoToolbox, no CUDA heuristic)', () => {
    let profile: HardwareProfile;

    beforeAll(async () => {
      await withPlatformArch('linux', 'arm64', async () => {
        profile = await detectHardware();
      });
    });

    it('sets supportsVideoToolbox to false', () => {
      expect(profile.supportsVideoToolbox).toBe(false);
    });

    it('sets supportsCuda to false', () => {
      expect(profile.supportsCuda).toBe(false);
    });

    it('selects libx264 encoder profile', () => {
      expect(profile.encoderProfile).toBe('libx264');
    });
  });

  describe('Windows x64 (CPU fallback)', () => {
    let profile: HardwareProfile;

    beforeAll(async () => {
      await withPlatformArch('win32', 'x64', async () => {
        profile = await detectHardware();
      });
    });

    it('sets supportsVideoToolbox to false', () => {
      expect(profile.supportsVideoToolbox).toBe(false);
    });

    it('sets supportsCuda to false', () => {
      expect(profile.supportsCuda).toBe(false);
    });

    it('selects libx264 encoder profile', () => {
      expect(profile.encoderProfile).toBe('libx264');
    });
  });

  describe('shape contract', () => {
    it('returns an object with all required HardwareProfile fields', async () => {
      const profile = await detectHardware();
      expect(profile).toMatchObject({
        platform: expect.any(String),
        arch: expect.any(String),
        supportsVideoToolbox: expect.any(Boolean),
        supportsCuda: expect.any(Boolean),
        encoderProfile: expect.stringMatching(/^(videotoolbox|nvenc|libx264)$/),
      });
    });

    it('resolves (does not reject) on the current machine', async () => {
      await expect(detectHardware()).resolves.toBeDefined();
    });
  });
});
