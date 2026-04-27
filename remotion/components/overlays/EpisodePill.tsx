import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { Brand } from '../../types/brand';

interface EpisodePillProps {
  brand: Brand;
  episodeNumber: string;
  title: string;
}

export const EpisodePill: React.FC<EpisodePillProps> = ({
  brand,
  episodeNumber,
  title,
}) => {
  const { typography } = brand;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: '2%',
          right: '5%',
          width: '30%',
          textAlign: 'right',
        }}
      >
      {/* Episode Pill */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          color: '#000000',
          padding: '16px 32px',
          borderRadius: '40px',
          fontFamily: typography.fontFamily,
          fontSize: 36,
          fontWeight: typography.weights.bold,
          marginBottom: '16px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
        }}
      >
        EP {episodeNumber}
      </div>

      {/* Title */}
      <div
        style={{
          fontFamily: typography.fontFamily,
          fontSize: 40,
          fontWeight: typography.weights.semiBold,
          color: '#ffffff',
          textShadow: '0 3px 12px rgba(0,0,0,0.8)',
          lineHeight: 1.3,
        }}
        dangerouslySetInnerHTML={{
          __html: title.replace(/\*\*(.*?)\*\*/g, '<strong style="color: ' + brand.colors.primary + '">$1</strong>'),
        }}
      />
      </div>
    </AbsoluteFill>
  );
};
