import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate, staticFile } from 'remotion';
import type { Brand } from '../../types/brand';

const LOGO = staticFile('assets/logo/transparent-bg-logo.png');

const ApplePodcastsIcon = () => (
  <svg viewBox="0 0 24 24" width="38" height="38">
    <rect x="9" y="2" width="6" height="11" rx="3" fill="white" />
    <path d="M5 10a7 7 0 0 0 14 0" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
    <line x1="12" y1="17" x2="12" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round" />
    <line x1="8" y1="20" x2="16" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" width="38" height="38">
    <polygon points="9,7 20,12 9,17" fill="white" />
  </svg>
);

const SpotifyIcon = () => (
  <svg viewBox="0 0 24 24" width="38" height="38">
    <path d="M4 7.5c5.5-3.5 12.5-3.5 16 0" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    <path d="M5 12c4.5-2.5 11-2.5 14 0" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    <path d="M6.5 16.5c3.5-2 9-2 11 0" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
  </svg>
);

interface PlatformProps {
  color: string;
  icon: React.ReactNode;
  label: string;
  fontFamily: string;
}

const Platform: React.FC<PlatformProps> = ({ color, icon, label, fontFamily }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: 120 }}>
    <div style={{
      width: 72,
      height: 72,
      borderRadius: '50%',
      background: color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      {icon}
    </div>
    <span style={{
      fontFamily,
      fontSize: 22,
      fontWeight: 700,
      color: '#ffffff',
      textAlign: 'center',
      lineHeight: 1.2,
      textShadow: '0 2px 8px rgba(0,0,0,0.8)',
    }}>
      {label}
    </span>
  </div>
);

interface Props {
  brand: Brand;
}

export const ShortFormOutro: React.FC<Props> = ({ brand }) => {
  const frame = useCurrentFrame();
  const { colors, typography } = brand;

  const opacity = interpolate(frame, [0, 20], [0, 0.8], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const translateY = interpolate(frame, [0, 20], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute',
        bottom: 630,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
        opacity,
        transform: `translateY(${translateY}px)`,
      }}>
        <span style={{
          fontFamily: typography.fontFamily,
          fontSize: 90,
          fontWeight: typography.weights.black,
          color: '#ffffff',
          letterSpacing: 6,
          textShadow: '0 4px 16px rgba(0,0,0,0.5)',
          lineHeight: 1,
          marginBottom: 2,
        }}>
          OUT NOW
        </span>

        <img src={LOGO} style={{ height: 480, objectFit: 'contain', marginBottom: 12 }} />

        <div style={{ display: 'flex', flexDirection: 'row', gap: 40, alignItems: 'flex-start' }}>
          <Platform
            color="#B347D9"
            icon={<ApplePodcastsIcon />}
            label="Apple Podcasts"
            fontFamily={typography.fontFamily}
          />
          <Platform
            color="#FF0000"
            icon={<YouTubeIcon />}
            label="YouTube"
            fontFamily={typography.fontFamily}
          />
          <Platform
            color="#1DB954"
            icon={<SpotifyIcon />}
            label="Spotify"
            fontFamily={typography.fontFamily}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
