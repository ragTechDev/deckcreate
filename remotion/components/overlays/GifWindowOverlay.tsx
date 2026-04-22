import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { Gif } from '@remotion/gif';
import type { Brand } from '../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";

const OPEN_FRAMES = 24;
const CLOSE_FRAMES = 20;

export interface GifWindowOverlayProps {
  brand: Brand;
  durationInFrames: number;
  /** GIF URL — must allow CORS for remote sources */
  src: string;
  /** Title bar text (defaults to the URL if omitted) */
  title?: string;
  /** Optional caption shown below the GIF */
  caption?: string;
  /** Window / GIF width in pixels — defaults to 720 */
  width?: number;
  /** GIF display height in pixels — defaults to 405 (16:9 at width=720) */
  gifHeight?: number;
  /** Playback speed multiplier — defaults to 1 */
  playbackRate?: number;
  /** Loop strategy — defaults to 'loop' */
  loopBehavior?: 'loop' | 'pause-after-finish' | 'unmount-after-finish';
}

export const GifWindowOverlay: React.FC<GifWindowOverlayProps> = ({
  brand,
  durationInFrames,
  src,
  title,
  caption,
  width = 720,
  gifHeight = 405,
  playbackRate = 1,
  loopBehavior = 'loop',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors, shape, typography } = brand;

  // Open: spring scale 0→1 from bottom-center
  const openSpring = spring({
    frame: Math.min(frame, OPEN_FRAMES),
    fps,
    config: { damping: 18, stiffness: 150 },
  });
  const openScale = openSpring;
  const openTranslateY = interpolate(openSpring, [0, 1], [220, 0]);

  // Close: ease-in shrink to bottom over last CLOSE_FRAMES
  const closeStart = Math.max(0, durationInFrames - CLOSE_FRAMES);
  const closeFrame = Math.max(0, frame - closeStart);
  const closeProgress = interpolate(closeFrame, [0, CLOSE_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
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
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', flexShrink: 0 }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', flexShrink: 0 }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', flexShrink: 0 }} />

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

        {/* GIF area */}
        <div
          style={{
            background: '#0d1117',
            height: gifHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            lineHeight: 0,
          }}
        >
          <Gif
            src={src}
            width={width}
            height={gifHeight}
            fit="contain"
            playbackRate={playbackRate}
            loopBehavior={loopBehavior}
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
