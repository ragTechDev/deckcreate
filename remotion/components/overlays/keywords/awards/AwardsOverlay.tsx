import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill } from 'remotion';
import type { Brand } from '../../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";
const GOLD = '#F59E0B';

export type AwardsOverlayProps = {
  brand: Brand;
  durationInFrames: number;
  award: 'best-podcast' | 'award-winner' | 'recognition' | 'achievement' | 'milestone' | 'celebration';
  recipient?: string;
};

const awardMap: Record<string, { text: string; subtext: string; keyword: string }> = {
  'best-podcast':  { text: 'Best Podcast',        subtext: 'Award Winner',           keyword: '#award' },
  'award-winner':  { text: 'Award Winner',         subtext: 'Excellence recognised',  keyword: '#award' },
  recognition:     { text: 'Recognition',          subtext: 'For outstanding work',   keyword: '#recognition' },
  achievement:     { text: 'Achievement Unlocked', subtext: 'Goal accomplished',      keyword: '#milestone' },
  milestone:       { text: 'Milestone',            subtext: 'Progress marker',        keyword: '#milestone' },
  celebration:     { text: 'Celebration',          subtext: 'Time to celebrate',      keyword: '#celebrate' },
};

export const AwardsOverlay: React.FC<AwardsOverlayProps> = ({
  brand,
  durationInFrames,
  award,
  recipient,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const safeDuration = Math.max(30, durationInFrames);
  const exitStart = safeDuration - 15;

  const scaleIn = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.8 },
  });

  const slideOut = frame > exitStart
    ? spring({ frame: frame - exitStart, fps, config: { damping: 20, stiffness: 120 } })
    : 0;

  const scale = interpolate(scaleIn, [0, 1], [0.88, 1]);
  const translateY = interpolate(slideOut, [0, 1], [0, 40]);
  const opacity = interpolate(
    frame,
    [0, 8, exitStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const config = awardMap[award];
  const { typography, shape } = brand;
  const subtextFull = recipient ? `${config.subtext} · ${recipient}` : config.subtext;

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-start',
        padding: '60px 80px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          transform: `scale(${scale}) translateY(${translateY}px)`,
          opacity,
          background: '#FFFFFF',
          borderLeft: `5px solid ${GOLD}`,
          borderRadius: `0 ${shape.borderRadius}px ${shape.borderRadius}px 0`,
          padding: '20px 40px 22px 28px',
          maxWidth: 580,
          boxShadow: `0 8px 40px rgba(245,158,11,0.18), 0 2px 8px rgba(0,0,0,0.10)`,
        }}
      >
        {/* keyword badge */}
        <div
          style={{
            fontFamily: MONO,
            fontSize: 13,
            fontWeight: 600,
            color: GOLD,
            letterSpacing: '0.07em',
            marginBottom: 10,
            opacity: 0.9,
          }}
        >
          {config.keyword}
        </div>

        {/* trophy + award name row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <span style={{ fontSize: 44, lineHeight: 1 }}>🏆</span>
          <div
            style={{
              fontFamily: typography.fontFamily,
              fontSize: 52,
              fontWeight: typography.weights.black,
              color: '#0F0F1A',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              textTransform: 'uppercase',
            }}
          >
            {config.text}
          </div>
        </div>

        {/* subtext as code comment */}
        <div
          style={{
            fontFamily: MONO,
            fontSize: 20,
            color: '#71717a',
            marginTop: 8,
            letterSpacing: '0.01em',
          }}
        >
          {'// '}
          {subtextFull}
        </div>
      </div>
    </AbsoluteFill>
  );
};
