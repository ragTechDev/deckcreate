import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Img } from 'remotion';
import type { Brand } from '../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";

const OPEN_FRAMES = 24;
const CLOSE_FRAMES = 20;

export interface ImageWindowOverlayProps {
  brand: Brand;
  durationInFrames: number;
  /** Direct image URL or public-relative path */
  src: string;
  /** Title bar text (defaults to the URL) */
  title?: string;
  /** Optional caption shown below the image */
  caption?: string;
  /** Window width in pixels — defaults to 720 */
  width?: number;
}

const CHAPTER_MARKER_PADDING = 120; // Space reserved for chapter marker at top
const WINDOW_MARGIN = 24; // Small margin for shorts - fills width with tiny gap

export const ImageWindowOverlay: React.FC<ImageWindowOverlayProps> = ({
  brand,
  durationInFrames,
  src,
  title,
  caption,
  width: propWidth,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: videoWidth, height: videoHeight } = useVideoConfig();
  const { colors, shape, typography } = brand;

  // Calculate window size to fit viewport with padding for chapter marker
  const availableHeight = videoHeight - CHAPTER_MARKER_PADDING - WINDOW_MARGIN;
  const availableWidth = videoWidth - WINDOW_MARGIN * 2;

  // For shorts: fill width with small gap (use all available width)
  const width = propWidth ?? availableWidth;
  const maxImageHeight = availableHeight - 42 - (caption ? 44 : 0); // Subtract title bar and optional caption

  // Open: spring from bottom, scale 0→1 + translateY 200→0
  const openSpring = spring({
    frame: Math.min(frame, OPEN_FRAMES),
    fps,
    config: { damping: 18, stiffness: 150 },
  });
  const openScale = openSpring;
  const openTranslateY = interpolate(openSpring, [0, 1], [220, 0]);

  // Close: last CLOSE_FRAMES — ease-in scale to tiny, slide down
  const closeStart = Math.max(0, durationInFrames - CLOSE_FRAMES);
  const closeFrame = Math.max(0, frame - closeStart);
  const closeProgress = interpolate(closeFrame, [0, CLOSE_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Ease-in: accelerate into minimize
  const closeEased = closeProgress * closeProgress;
  const closeScale = interpolate(closeEased, [0, 1], [1, 0.06]);
  const closeTranslateY = interpolate(closeEased, [0, 1], [0, 380]);

  const isClosing = frame >= closeStart;
  const scale = isClosing ? closeScale : openScale;
  const translateY = isClosing ? closeTranslateY : openTranslateY;

  const opacity = interpolate(
    frame,
    [0, 3, durationInFrames - 3, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const displayTitle = title ?? src;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width,
          opacity,
          transform: `translateY(${translateY}px) scale(${scale})`,
          transformOrigin: '50% 100%',
          borderRadius: shape.borderRadius,
          overflow: 'hidden',
          boxShadow: '0 28px 90px rgba(0,0,0,0.80), 0 0 0 1px rgba(255,255,255,0.08)',
        }}
      >
        {/* Title bar */}
        <div
          style={{
            background: '#21262d',
            height: 42,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            gap: 7,
            position: 'relative',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          {/* Traffic lights */}
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', flexShrink: 0 }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', flexShrink: 0 }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', flexShrink: 0 }} />

          {/* Centered title */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              fontFamily: MONO,
              fontSize: 12,
              color: '#8b949e',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: width - 120,
              pointerEvents: 'none',
            }}
          >
            {displayTitle}
          </div>
        </div>

        {/* Image area */}
        <div
          style={{
            background: '#0d1117',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            maxHeight: maxImageHeight,
          }}
        >
          <Img
            src={src}
            style={{
              width: '100%',
              maxHeight: maxImageHeight,
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </div>

        {/* Caption bar */}
        {caption && (
          <div
            style={{
              background: '#21262d',
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 24px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <span
              style={{
                fontFamily: typography.fontFamily,
                fontSize: 15,
                fontWeight: typography.weights.semiBold ?? 600,
                color: colors.text?.secondary ?? colors.secondary,
                letterSpacing: '0.02em',
                textAlign: 'center',
                lineHeight: 1.4,
              }}
            >
              {caption}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
