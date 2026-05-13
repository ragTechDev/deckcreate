import React from 'react';

jest.mock('remotion', () => ({
  useCurrentFrame: jest.fn(() => 0),
  useVideoConfig: jest.fn(() => ({ fps: 60, durationInFrames: 1800, width: 1080, height: 1920 })),
  staticFile: (path: string) => `/static/${path}`,
  delayRender: jest.fn(() => 'handle'),
  continueRender: jest.fn(),
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
jest.mock('./components/CaptionOverlay', () => ({ CaptionOverlay: () => null }));
jest.mock('./components/OverlayRenderer', () => ({ OverlayRenderer: () => null }));
jest.mock('./components/overlays/EpisodePill', () => ({ EpisodePill: () => null }));
jest.mock('./components/overlays/HookTitle', () => ({ HookTitle: () => null }));
jest.mock('./components/overlays/ShortFormOutro', () => ({ ShortFormOutro: () => null }));
jest.mock('./components/Transition', () => ({ Transition: () => null }));
jest.mock('./loadFonts', () => ({ loadNunito: jest.fn().mockResolvedValue(undefined) }));

import { calculateShortMetadata } from './ShortFormClip';
import { getAudioDurationInSeconds } from '@remotion/media-utils';

const minimalTranscript = { meta: { fps: 60 }, segments: [] };

describe('calculateShortMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('returns fallback when transcriptSrc is not provided', async () => {
    const result = await calculateShortMetadata({ props: { src: 'video.mp4' } } as never);
    expect(result.durationInFrames).toBe(300);
    expect(result.fps).toBe(60);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
  });

  it('resolves hookMusicSrc from brand.audio.hookMusic when brandId is set', async () => {
    const mockBrand = { audio: { hookMusic: 'sounds/jazz-cafe-music.mp3' } };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(minimalTranscript) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockBrand) });
    (getAudioDurationInSeconds as jest.Mock).mockResolvedValue(30);

    const result = await calculateShortMetadata({
      props: { src: 'v.mp4', transcriptSrc: 'shorts/s1/transcript.json', brandId: 'ragtech' },
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

    await calculateShortMetadata({
      props: {
        src: 'v.mp4',
        transcriptSrc: 'shorts/s1/transcript.json',
        hookMusicSrc: 'sounds/custom.mp3',
        brandId: 'ragtech',
      },
    } as never);

    // Only one fetch: transcript. Brand fetch is skipped because hookMusicSrc was explicit.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('skips hook music when brand has no hookMusic field', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(minimalTranscript) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ audio: {} }) });

    const result = await calculateShortMetadata({
      props: { src: 'v.mp4', transcriptSrc: 'shorts/s1/transcript.json', brandId: 'ragtech' },
    } as never);

    expect(getAudioDurationInSeconds).not.toHaveBeenCalled();
    expect(result.props?.hookMusicSrc).toBeUndefined();
  });
});
