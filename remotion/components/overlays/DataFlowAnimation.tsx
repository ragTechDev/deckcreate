import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';
import type { Brand } from '../../types/brand';

const OPEN_FRAMES = 30;
const CLOSE_FRAMES = 24;

export interface DataFlowAnimationProps {
  brand: Brand;
  durationInFrames: number;
}

interface DataParticle {
  id: number;
  startFrame: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  delay: number;
}

export const DataFlowAnimation: React.FC<DataFlowAnimationProps> = ({
  brand,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: videoWidth, height: videoHeight } = useVideoConfig();
  const { colors: _colors, typography } = brand;
  const colors = {
    ..._colors,
    shadow: _colors.background + '80',
    border: _colors.accent,
    textMuted: _colors.text.secondary,
    text: _colors.text.primary,
  };

  // Container dimensions
  const CHAPTER_MARKER_PADDING = 120;
  const WINDOW_MARGIN = 60;
  const containerWidth = Math.min(700, videoWidth - WINDOW_MARGIN * 2);
  const containerHeight = 380;
  const titleBarH = 48;
  const totalHeight = containerHeight + titleBarH;

  // Window animation
  const openProgress = spring({
    frame,
    fps,
    config: {
      damping: 18,
      stiffness: 80,
      mass: 0.8,
    },
  });

  const closeProgress = spring({
    frame: Math.max(0, frame - (durationInFrames - CLOSE_FRAMES)),
    fps,
    config: {
      damping: 20,
      stiffness: 100,
    },
  });

  const windowY = interpolate(
    frame < durationInFrames - CLOSE_FRAMES ? openProgress : 1 - closeProgress,
    [0, 1],
    [videoHeight, 0]
  );

  const opacity = interpolate(
    frame < durationInFrames - CLOSE_FRAMES ? openProgress : 1 - closeProgress,
    [0, 1],
    [0, 1]
  );

  // Layout: Global South on left, Global North on right
  const leftX = 150;
  const rightX = containerWidth - 150;
  const centerY = containerHeight / 2;

  // Generate data particles flowing from left to right
  const particles: DataParticle[] = [];
  const particleCount = 30;
  const flowDuration = 90; // frames for particle to travel

  for (let i = 0; i < particleCount; i++) {
    const startFrame = OPEN_FRAMES + (i * 3); // Stagger particles
    const yOffset = (Math.sin(i * 0.5) * 80) + (Math.sin(i * 1.7 + 0.3) * 20);
    
    particles.push({
      id: i,
      startFrame,
      fromX: leftX,
      fromY: centerY + yOffset,
      toX: rightX,
      toY: centerY + yOffset * 0.3, // Converge slightly toward center
      delay: i * 2,
    });
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: (videoWidth - containerWidth) / 2,
        top: windowY + CHAPTER_MARKER_PADDING,
        width: containerWidth,
        opacity,
        filter: `drop-shadow(0 8px 32px ${colors.shadow})`,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {/* Window chrome */}
      <div
        style={{
          width: '100%',
          height: totalHeight,
          backgroundColor: colors.background,
          borderRadius: 12,
          overflow: 'hidden',
          border: `1px solid ${colors.border}`,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            height: titleBarH,
            backgroundColor: colors.surface,
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 16,
            paddingRight: 16,
            gap: 8,
          }}
        >
          {/* Traffic lights */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F56' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FFBD2E' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#27C93F' }} />
          </div>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              fontFamily: typography.fontFamily,
              fontSize: 15,
              fontWeight: 600,
              color: colors.text,
            }}
          >
            AI Data Flow
          </div>
        </div>

        {/* Content area */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: containerHeight,
            backgroundColor: colors.surface,
            overflow: 'hidden',
          }}
        >
          {/* Background gradient */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(circle at 50% 50%, ${colors.primary}15, transparent 70%)`,
            }}
          />

          {/* Connecting lines (subtle) */}
          <svg
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
            }}
          >
            {[0, 1, 2].map((i) => {
              const y = centerY + (i - 1) * 60;
              const pathOpacity = interpolate(
                frame,
                [OPEN_FRAMES, OPEN_FRAMES + 20],
                [0, 0.2]
              );
              
              return (
                <path
                  key={i}
                  d={`M ${leftX + 60} ${y} Q ${containerWidth / 2} ${y + (i - 1) * 20}, ${rightX - 60} ${centerY}`}
                  stroke={colors.border}
                  strokeWidth="2"
                  fill="none"
                  opacity={pathOpacity}
                  strokeDasharray="5,5"
                />
              );
            })}
          </svg>

          {/* Data particles */}
          {particles.map((particle) => {
            const particleFrame = Math.max(0, frame - particle.startFrame);
            const progress = Math.min(1, particleFrame / flowDuration);
            
            if (particleFrame < 0 || progress >= 1) return null;

            const x = interpolate(progress, [0, 1], [particle.fromX, particle.toX], {
              easing: Easing.inOut(Easing.ease),
            });
            
            const y = interpolate(progress, [0, 1], [particle.fromY, particle.toY], {
              easing: Easing.inOut(Easing.ease),
            });

            const scale = interpolate(progress, [0, 0.1, 0.9, 1], [0, 1, 1, 0]);
            const particleOpacity = interpolate(progress, [0, 0.1, 0.9, 1], [0, 1, 1, 0]);

            return (
              <div
                key={particle.id}
                style={{
                  position: 'absolute',
                  left: x,
                  top: y,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: colors.primary,
                  transform: `translate(-50%, -50%) scale(${scale})`,
                  opacity: particleOpacity,
                  boxShadow: `0 0 8px ${colors.primary}`,
                }}
              />
            );
          })}

          {/* Global South box (left) */}
          <div
            style={{
              position: 'absolute',
              left: leftX - 80,
              top: centerY - 100,
              width: 160,
              transform: `scale(${interpolate(frame, [OPEN_FRAMES, OPEN_FRAMES + 15], [0, 1])})`,
            }}
          >
            <div
              style={{
                padding: '20px',
                backgroundColor: colors.background,
                borderRadius: 12,
                border: `2px solid ${colors.primary}`,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontFamily: typography.fontFamily,
                  fontSize: 18,
                  fontWeight: 700,
                  color: colors.primary,
                  marginBottom: 12,
                }}
              >
                Global South
              </div>
              <div
                style={{
                  fontFamily: typography.fontFamily,
                  fontSize: 13,
                  color: colors.textMuted,
                  lineHeight: 1.5,
                }}
              >
                📱 Mobile data<br />
                💳 Transactions<br />
                🗣️ Languages<br />
                🏥 Health records<br />
                🌾 Agriculture
              </div>
            </div>
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                backgroundColor: colors.primary + '20',
                borderRadius: 8,
                fontFamily: typography.fontFamily,
                fontSize: 12,
                fontWeight: 600,
                color: colors.primary,
                textAlign: 'center',
              }}
            >
              Data Generation
            </div>
          </div>

          {/* Global North box (right) */}
          <div
            style={{
              position: 'absolute',
              left: rightX - 80,
              top: centerY - 100,
              width: 160,
              transform: `scale(${interpolate(frame, [OPEN_FRAMES + 10, OPEN_FRAMES + 25], [0, 1])})`,
            }}
          >
            <div
              style={{
                padding: '20px',
                backgroundColor: colors.background,
                borderRadius: 12,
                border: `2px solid ${colors.accent}`,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontFamily: typography.fontFamily,
                  fontSize: 18,
                  fontWeight: 700,
                  color: colors.accent,
                  marginBottom: 12,
                }}
              >
                Global North
              </div>
              <div
                style={{
                  fontFamily: typography.fontFamily,
                  fontSize: 13,
                  color: colors.textMuted,
                  lineHeight: 1.5,
                }}
              >
                🤖 Model training<br />
                🏗️ Infrastructure<br />
                📊 Platforms<br />
                🚀 Distribution<br />
                💰 Control
              </div>
            </div>
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                backgroundColor: colors.accent + '20',
                borderRadius: 8,
                fontFamily: typography.fontFamily,
                fontSize: 12,
                fontWeight: 600,
                color: colors.accent,
                textAlign: 'center',
              }}
            >
              Value Capture
            </div>
          </div>

          {/* Bottom label */}
          <div
            style={{
              position: 'absolute',
              bottom: 30,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontFamily: typography.fontFamily,
              fontSize: 14,
              color: colors.textMuted,
              opacity: interpolate(frame, [OPEN_FRAMES + 20, OPEN_FRAMES + 35], [0, 1]),
            }}
          >
            Data flows from Global South → Global North controls the value chain
          </div>
        </div>
      </div>
    </div>
  );
};
