import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from 'remotion';

export type OverlayProps = {
  startFrame?: number;
  durationInFrames: number;
  text?: string;
  position?: 'center' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  enterAnimation?: 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'scale' | 'fade';
  exitAnimation?: 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'scale' | 'fade';
};

const getPositionStyles = (position: string) => {
  const positions: Record<string, React.CSSProperties> = {
    center: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
    top: { top: '10%', left: '50%', transform: 'translateX(-50%)' },
    bottom: { bottom: '15%', left: '50%', transform: 'translateX(-50%)' },
    'top-left': { top: '10%', left: '10%' },
    'top-right': { top: '10%', right: '10%' },
    'bottom-left': { bottom: '15%', left: '10%' },
    'bottom-right': { bottom: '15%', right: '10%' },
  };
  return positions[position] || positions.center;
};

export const BaseOverlay: React.FC<React.PropsWithChildren<OverlayProps>> = ({
  children,
  startFrame = 0,
  durationInFrames,
  position = 'center',
  enterAnimation = 'slideUp',
  exitAnimation = 'slideDown',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const safeDuration = Number.isFinite(durationInFrames)
    ? Math.max(16, Math.floor(durationInFrames))
    : 16;
  const localFrame = frame - startFrame;
  const isActive = localFrame >= 0 && localFrame < safeDuration;
  const isEntering = localFrame >= 0 && localFrame < Math.min(15, safeDuration * 0.2);
  const isExiting = localFrame >= safeDuration - Math.min(15, safeDuration * 0.2);

  const enterProgress = isEntering
    ? spring({ frame: localFrame, fps, config: { damping: 12, stiffness: 200 } })
    : 1;

  const exitProgress = isExiting
    ? spring({
        frame: localFrame - (safeDuration - Math.min(15, safeDuration * 0.2)),
        fps,
        config: { damping: 12, stiffness: 200 },
      })
    : 0;

  const getEnterTransform = () => {
    const progress = interpolate(enterProgress, [0, 1], enterAnimation === 'scale' ? [0.8, 1] : [50, 0]);
    switch (enterAnimation) {
      case 'slideUp': return `translateY(${progress}px)`;
      case 'slideDown': return `translateY(-${progress}px)`;
      case 'slideLeft': return `translateX(${progress}px)`;
      case 'slideRight': return `translateX(-${progress}px)`;
      case 'scale': return `scale(${progress})`;
      case 'fade': return 'none';
      default: return `translateY(${progress}px)`;
    }
  };

  const getExitTransform = () => {
    const progress = interpolate(exitProgress, [0, 1], exitAnimation === 'scale' ? [1, 0.8] : [0, 30]);
    switch (exitAnimation) {
      case 'slideUp': return `translateY(-${progress}px)`;
      case 'slideDown': return `translateY(${progress}px)`;
      case 'slideLeft': return `translateX(-${progress}px)`;
      case 'slideRight': return `translateX(${progress}px)`;
      case 'scale': return `scale(${progress})`;
      case 'fade': return 'none';
      default: return `translateY(${progress}px)`;
    }
  };

  const opacity = interpolate(
    localFrame,
    [0, 8, safeDuration - 8, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const positionStyles = getPositionStyles(position);

  if (!isActive) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          ...positionStyles,
          opacity,
          transform: `${getEnterTransform()} ${getExitTransform()}`,
          transition: 'none',
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
