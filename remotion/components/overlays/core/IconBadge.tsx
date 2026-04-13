import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from 'remotion';
import type { Brand } from '../../../types/brand';

export type IconBadgeProps = {
  brand: Brand;
  startFrame: number;
  durationInFrames: number;
  icon: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
  backgroundColor?: string;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  offset?: { x: number; y: number };
  pulse?: boolean;
  bounce?: boolean;
};

const sizeMap = {
  sm: { container: 60, icon: 32, font: 14 },
  md: { container: 80, icon: 44, font: 18 },
  lg: { container: 100, icon: 56, font: 22 },
  xl: { container: 140, icon: 80, font: 28 },
};

const positionMap: Record<string, { top?: number; bottom?: number; left?: number; right?: number }> = {
  'top-left': { top: 60, left: 60 },
  'top-right': { top: 60, right: 60 },
  'bottom-left': { bottom: 120, left: 60 },
  'bottom-right': { bottom: 120, right: 60 },
  'center': {},
};

export const IconBadge: React.FC<IconBadgeProps> = ({
  brand,
  startFrame,
  durationInFrames,
  icon,
  label,
  size = 'md',
  color,
  backgroundColor,
  position = 'top-right',
  offset = { x: 0, y: 0 },
  pulse = false,
  bounce = true,
}) => {
  const { colors, typography } = brand;
  const finalColor = color ?? colors.text.onPrimary;
  const finalBackgroundColor = backgroundColor ?? colors.primary + 'E6';
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const localFrame = frame - startFrame;
  const isActive = localFrame >= 0 && localFrame < durationInFrames;

  const sizes = sizeMap[size];

  const scale = bounce
    ? spring({
        frame: localFrame,
        fps,
        config: { damping: 10, stiffness: 150, mass: 0.8 },
        durationInFrames: 20,
      })
    : 1;

  const pulseScale = pulse
    ? 1 + Math.sin((localFrame / fps) * Math.PI * 2) * 0.05
    : 1;

  const opacity = interpolate(
    localFrame,
    [0, 8, durationInFrames - 8, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const pos = positionMap[position];

  if (!isActive) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: pos.top !== undefined ? pos.top + offset.y : undefined,
        bottom: pos.bottom !== undefined ? pos.bottom + offset.y : undefined,
        left: pos.left !== undefined ? pos.left + offset.x : undefined,
        right: pos.right !== undefined ? pos.right - offset.x : undefined,
        opacity,
        transform: `scale(${scale * pulseScale})`,
        transformOrigin: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <div
        style={{
          width: sizes.container,
          height: sizes.container,
          borderRadius: '50%',
          background: finalBackgroundColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: sizes.icon,
          boxShadow: `0 4px 20px ${colors.primary}66, 0 2px 8px rgba(0,0,0,0.3)`,
          backdropFilter: 'blur(8px)',
        }}
      >
        {icon}
      </div>
      {label && (
        <div
          style={{
            fontFamily: typography.fontFamily,
            fontSize: sizes.font,
            fontWeight: typography.weights.bold,
            color: finalColor,
            textShadow: '0 2px 10px rgba(0,0,0,0.5)',
            background: colors.background + 'CC',
            padding: '4px 12px',
            borderRadius: brand.shape.borderRadiusSmall,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
};
