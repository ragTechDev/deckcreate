import React from 'react';

jest.mock('remotion', () => ({
  useCurrentFrame: jest.fn(() => 0),
  useVideoConfig: jest.fn(() => ({ fps: 60, durationInFrames: 3600, width: 1920, height: 1080 })),
  staticFile: (path: string) => `/static/${path}`,
  delayRender: jest.fn(() => 'handle'),
  continueRender: jest.fn(),
  OffthreadVideo: () => null,
  Audio: () => null,
  Loop: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Sequence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AbsoluteFill: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@remotion/media-utils', () => ({
  getAudioDurationInSeconds: jest.fn(),
}));

jest.mock('./components/SegmentPlayer', () => ({
  SegmentPlayer: () => null,
  buildSections: () => [],
  buildMainSubClips: () => [],
}));
jest.mock('./components/CameraPlayer', () => ({ CameraPlayer: () => null }));
jest.mock('./components/HookOverlay', () => ({ HookOverlay: () => null }));
jest.mock('./components/OverlayRenderer', () => ({ OverlayRenderer: () => null }));
jest.mock('./components/PodcastIntro', () => ({
  PodcastIntroComposition: () => null,
  INTRO_DURATION_FRAMES: 420,
}));
jest.mock('./components/PodcastOutro', () => ({
  PodcastOutroComposition: () => null,
  OUTRO_DURATION_FRAMES: 360,
}));
jest.mock('./loadFonts', () => ({ loadNunito: jest.fn().mockResolvedValue(undefined) }));

import { calculateMetadata } from './Composition';
import { getAudioDurationInSeconds } from '@remotion/media-utils';

const minimalTranscript = { meta: { fps: 60 }, segments: [] };

describe('calculateMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('returns fallback when transcriptSrc is not provided', async () => {
    const result = await calculateMetadata({ props: { src: 'video.mp4' } } as never);
    expect(result.durationInFrames).toBe(300);
    expect(result.fps).toBe(60);
  });

  it('resolves hookMusicSrc from brand.audio.hookMusic when brandId is set', async () => {
    const mockBrand = { audio: { hookMusic: 'sounds/jazz-cafe-music.mp3' } };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(minimalTranscript) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockBrand) });
    (getAudioDurationInSeconds as jest.Mock).mockResolvedValue(30);

    const result = await calculateMetadata({
      props: { src: 'v.mp4', transcriptSrc: 'edit/transcript.json', brandId: 'ragtech' },
    } as never);

    expect(result.props?.hookMusicSrc).toBe('sounds/jazz-cafe-music.mp3');
    expect(result.props?.hookMusicDurationSecs).toBe(30);
    expect(getAudioDurationInSeconds).toHaveBeenCalledWith(
      expect.stringContaining('jazz-cafe-music.mp3'),
    );
  });

  it('uses explicit hookMusicSrc without fetching brand', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve(minimalTranscript),
    });
    (getAudioDurationInSeconds as jest.Mock).mockResolvedValue(45);

    await calculateMetadata({
      props: {
        src: 'v.mp4',
        transcriptSrc: 'edit/transcript.json',
        hookMusicSrc: 'sounds/custom.mp3',
        brandId: 'ragtech',
      },
    } as never);

    // Only one fetch: transcript. Brand fetch is skipped because hookMusicSrc was explicit.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('skips hook music when neither hookMusicSrc nor brand hook music is available', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(minimalTranscript) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ audio: {} }) });

    const result = await calculateMetadata({
      props: { src: 'v.mp4', transcriptSrc: 'edit/transcript.json', brandId: 'ragtech' },
    } as never);

    expect(getAudioDurationInSeconds).not.toHaveBeenCalled();
    expect(result.props?.hookMusicSrc).toBeUndefined();
  });
});
