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
 * Scales media to fill the entire frame using **cover** semantics:
 *   - Both axes are filled to 100 % of the composition dimensions
 *   - Aspect ratio is preserved
 *   - Any overflow is cropped symmetrically (centred on the media)
 *
 * This works correctly for every combination of media shape × frame aspect ratio:
 *
 *   Landscape media  + longform  frame (16:9) → minimal/no cropping
 *   Portrait  media  + shortform frame (9:16) → minimal/no cropping
 *   Landscape media  + shortform frame (9:16) → sides cropped  (fine for B-roll)
 *   Portrait  media  + longform  frame (16:9) → top/bottom cropped (fine for B-roll)
 *   Square    media  + either    frame         → one axis cropped symmetrically
 *
 * Implementation strategy by type:
 *   image / video     → CSS `object-fit: cover` with width/height 100 % — no
 *                        dimension-loading required; the browser / Remotion renderer
 *                        handles scaling natively.
 *   gif (Studio)      → <Img> with the same CSS cover style.
 *   gif (headless)    → intrinsic dimensions are loaded via delayRender, then an
 *                        explicit cover scale is computed and the <Gif> element is
 *                        pixel-positioned to fill the frame.
 */
export const FullscreenMediaOverlay: React.FC<FullscreenMediaOverlayProps> = ({
  src,
  mediaType,
  muted = false,
}) => {
  const { width: frameWidth, height: frameHeight } = useVideoConfig();
  const { isRendering } = getRemotionEnvironment();

  const resolvedSrc = useMemo(() => resolveSrc(src), [src]);

  // ── Dimension loading (gif render mode only) ──────────────────────────────
  // object-fit:cover handles sizing for image/video and gif-in-Studio without
  // any JS measurement.  The <Gif> component used during headless rendering needs
  // explicit pixel width/height, so we measure intrinsic size only in that case.
  const needsDimensions = mediaType === 'gif' && isRendering;

  const delayHandle = useMemo(
    () =>
      needsDimensions
        ? delayRender(`FullscreenMediaOverlay: measuring ${src}`)
        : null,
    // stable for the component lifetime — src and mediaType don't change mid-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!needsDimensions) return;

    const done = (w: number, h: number) => {
      setMediaSize({ w, h });
      continueRender(delayHandle!);
    };
    const fail = () => {
      // Fall back to frame dimensions so the overlay still renders even if
      // the GIF can't report its intrinsic size.  The cover calculation will
      // produce no-op scaling (1:1) and fill the frame.
      console.warn(
        `[FullscreenMediaOverlay] Could not load dimensions for "${src}" — falling back to frame size`,
      );
      setMediaSize({ w: frameWidth, h: frameHeight });
      continueRender(delayHandle!);
    };

    const img = new window.Image();
    img.onload = () => done(img.naturalWidth, img.naturalHeight);
    img.onerror = fail;
    img.src = resolvedSrc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shared container ──────────────────────────────────────────────────────
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
  };

  // ── Cover style (image / video / gif-Studio) ──────────────────────────────
  // object-fit:cover fills 100 % of both axes, preserves aspect ratio, and
  // crops any overflow symmetrically — a true full-bleed overlay regardless of
  // how the media aspect ratio relates to the composition aspect ratio.
  const coverStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center',
    display: 'block',
  };

  // ── Gif branch ────────────────────────────────────────────────────────────
  if (mediaType === 'gif') {
    if (isRendering) {
      // Wait for intrinsic dimensions — delayRender holds the frame.
      if (!mediaSize) return null;

      // Cover scale: the larger of the two scale factors ensures both axes
      // are >= the corresponding frame dimension.
      const scale = Math.max(frameWidth / mediaSize.w, frameHeight / mediaSize.h);
      const gifW = Math.round(mediaSize.w * scale);
      const gifH = Math.round(mediaSize.h * scale);

      // Centre the (potentially larger) scaled GIF over the frame.
      // Negative offsets push the overflow equally off both edges.
      const gifWrapStyle: React.CSSProperties = {
        position: 'absolute',
        top: Math.round((frameHeight - gifH) / 2),
        left: Math.round((frameWidth - gifW) / 2),
      };

      return (
        <div style={containerStyle}>
          <div style={gifWrapStyle}>
            <Gif src={resolvedSrc} width={gifW} height={gifH} fit="fill" loopBehavior="loop" />
          </div>
        </div>
      );
    }

    // Studio: native browser GIF — smooth preview, CSS handles the cover sizing.
    return (
      <div style={containerStyle}>
        <Img src={resolvedSrc} style={coverStyle} />
      </div>
    );
  }

  // ── Image branch ──────────────────────────────────────────────────────────
  if (mediaType === 'image') {
    return (
      <div style={containerStyle}>
        <Img src={resolvedSrc} style={coverStyle} />
      </div>
    );
  }

  // ── Video branch ──────────────────────────────────────────────────────────
  if (mediaType === 'video') {
    return (
      <div style={containerStyle}>
        {/*
          OffthreadVideo renders each frame as an <img>, so object-fit:cover
          scales it identically to a regular <img> element.
          trimBefore=0 → play from the first frame of the clip.
        */}
        <OffthreadVideo
          src={resolvedSrc}
          style={coverStyle}
          trimBefore={0}
          muted={muted}
        />
      </div>
    );
  }

  return null;
};
