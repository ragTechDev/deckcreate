import React, { useState, useEffect, useMemo } from 'react';
import {
  Img,
  OffthreadVideo,
  useVideoConfig,
  getRemotionEnvironment,
  delayRender,
  continueRender,
  staticFile,
} from 'remotion';
import { Gif } from '@remotion/gif';
import type { Brand } from '../../types/brand';

/**
 * Resolve a src string to a URL usable by Remotion elements.
 *   - Remote URLs (http/https/protocol-relative) → passed through unchanged
 *   - Local paths relative to /public (e.g. "assets/clip.mp4") → staticFile()
 *
 * Mirrors the normalizeStaticPath + staticFile pattern used in Composition.tsx.
 */
function resolveSrc(src: string): string {
  if (/^https?:\/\/|^\/\//.test(src)) return src;
  return staticFile(src.replace(/^\/+/, ''));
}

export interface FullscreenMediaOverlayProps {
  /**
   * Path to the media file, relative to /public (e.g. 'assets/overlay.png').
   * The same path format used in transcript.json videoSrc / hookGraphic.
   */
  src: string;
  /**
   * Which Remotion element to use.
   *   'image' → <Img>
   *   'video' → <OffthreadVideo>
   *   'gif'   → <Img> in Studio (smooth preview) / <Gif> on render (frame-accurate animation)
   */
  mediaType: 'image' | 'video' | 'gif';
  /**
   * Injected by OverlayRenderer. Not used by this component — the Sequence
   * wrapper in OverlayRenderer already controls visibility.
   */
  durationInFrames: number;
  /** Injected by OverlayRenderer — unused but required by the overlay interface. */
  brand: Brand;
  /**
   * Whether the overlay video track should be audible.
   * Defaults to false — overlays are usually silent B-roll.
   */
  muted?: boolean;
}

/**
 * FullscreenMediaOverlay
 *
 * Scales media to fill the frame using aspect-ratio-aware logic (centred, no
 * cropping). The axis used to fit depends on the media's intrinsic shape:
 *
 *   Landscape (w > h) → fits to frame HEIGHT in longform (16:9)
 *                       fits to frame WIDTH  in shortform (9:16)
 *   Portrait  (h > w) → fits to frame HEIGHT in both longform and shortform
 *   Square    (w = h) → fits to frame HEIGHT in longform (16:9)
 *                       fits to frame WIDTH  in shortform (9:16)
 *
 * Intrinsic dimensions are loaded once via delayRender/continueRender so both
 * Studio preview and final renders use the correct sizing from frame 0.
 */
export const FullscreenMediaOverlay: React.FC<FullscreenMediaOverlayProps> = ({
  src,
  mediaType,
  muted = false,
}) => {
  const { width: frameWidth, height: frameHeight } = useVideoConfig();
  const { isRendering } = getRemotionEnvironment();
  const isPortraitFrame = frameHeight > frameWidth; // shortform composition

  // ── Load intrinsic media dimensions ──────────────────────────────────────
  // delayRender pauses frame capture until we know the media's w/h.
  // This runs in both Remotion Studio and headless render (Puppeteer).
  const resolvedSrc = useMemo(() => resolveSrc(src), [src]);

  const delayHandle = useMemo(
    () => delayRender(`FullscreenMediaOverlay: measuring ${src}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const done = (w: number, h: number) => {
      setMediaSize({ w, h });
      continueRender(delayHandle);
    };
    const fail = () => {
      // Fall back to frame dimensions so the overlay still renders even if the
      // media element can't report its intrinsic size (e.g. unsupported container).
      // object-fit / width+height logic will still apply using the frame ratio.
      console.warn(`[FullscreenMediaOverlay] Could not load dimensions for "${src}" — falling back to frame size`);
      setMediaSize({ w: frameWidth, h: frameHeight });
      continueRender(delayHandle);
    };

    if (mediaType === 'video') {
      const vid = document.createElement('video');
      vid.onloadedmetadata = () => done(vid.videoWidth, vid.videoHeight);
      vid.onerror = fail;
      vid.src = resolvedSrc;
      vid.load();
    } else {
      // image or gif — use resolvedSrc so local paths work via staticFile()
      const img = new window.Image();
      img.onload = () => done(img.naturalWidth, img.naturalHeight);
      img.onerror = fail;
      img.src = resolvedSrc;
    }
  // delayHandle is stable (created once); src/mediaType don't change mid-session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While dimensions are loading, render nothing — delayRender holds the frame.
  if (!mediaSize) return null;

  // ── Determine fit axis ────────────────────────────────────────────────────
  //   Landscape (w > h) → height-fit in longform, width-fit in shortform
  //   Portrait  (h > w) → height-fit (both longform & shortform)
  //   Square    (w = h) → height-fit in longform, width-fit in shortform
  //
  // Simplified: fit width only when shortform (portrait frame) AND media is not portrait
  const isPortraitMedia = mediaSize.h > mediaSize.w;
  const fitWidth = isPortraitFrame && !isPortraitMedia;

  // ── Shared container ──────────────────────────────────────────────────────
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
  };

  // ── Media styles (absolute-positioned, centred on the relevant axis) ──────
  //
  // fit-width:  fill 100% of composition width, height scales proportionally,
  //             centred vertically (translateY -50%).
  // fit-height: fill 100% of composition height, width scales proportionally,
  //             centred horizontally (translateX -50%).
  const mediaStyle: React.CSSProperties = fitWidth
    ? {
        position: 'absolute',
        width: '100%',
        height: 'auto',
        top: '50%',
        left: 0,
        transform: 'translateY(-50%)',
        display: 'block',
      }
    : {
        position: 'absolute',
        width: 'auto',
        height: '100%',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'block',
      };

  // ── Gif branch (Studio: <Img> for performance, render: <Gif> for animation)
  if (mediaType === 'gif') {
    if (isRendering) {
      // Compute exact pixel dimensions so <Gif fit="fill"> renders at the
      // right size without any internal scaling artifacts.
      const gifWidth  = fitWidth
        ? frameWidth
        : Math.round(frameHeight * (mediaSize.w / mediaSize.h));
      const gifHeight = fitWidth
        ? Math.round(frameWidth * (mediaSize.h / mediaSize.w))
        : frameHeight;

      const gifWrapStyle: React.CSSProperties = fitWidth
        ? { position: 'absolute', width: gifWidth, top: '50%', left: 0,   transform: 'translateY(-50%)' }
        : { position: 'absolute', height: gifHeight, top: 0, left: '50%', transform: 'translateX(-50%)' };

      return (
        <div style={containerStyle}>
          <div style={gifWrapStyle}>
            <Gif src={resolvedSrc} width={gifWidth} height={gifHeight} fit="fill" loopBehavior="loop" />
          </div>
        </div>
      );
    }

    // Studio: native browser GIF — smooth, zero JS decode overhead.
    return (
      <div style={containerStyle}>
        <Img src={resolvedSrc} style={mediaStyle} />
      </div>
    );
  }

  // ── Image branch ──────────────────────────────────────────────────────────
  if (mediaType === 'image') {
    return (
      <div style={containerStyle}>
        <Img src={resolvedSrc} style={mediaStyle} />
      </div>
    );
  }

  // ── Video branch ──────────────────────────────────────────────────────────
  if (mediaType === 'video') {
    return (
      <div style={containerStyle}>
        {/*
          trimBefore=0 → play from the first frame of the clip.
          OffthreadVideo renders each frame as an <img> so width/auto / auto/height
          scales it the same way as a regular image element.
        */}
        <OffthreadVideo
          src={resolvedSrc}
          style={mediaStyle}
          trimBefore={0}
          muted={muted}
        />
      </div>
    );
  }

  return null;
};
