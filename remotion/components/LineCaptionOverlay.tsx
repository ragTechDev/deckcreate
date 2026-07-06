import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionLine } from '../types/lineCaptions';
import type { Brand } from '../types/brand';

// ── Layout constants for 1080 × 1920 (matches CaptionOverlay.tsx) ─────────────

const CAPTION_TOP       = 1300;
const CAPTION_FONT_SIZE = 60;

type Props = {
  lines: CaptionLine[];
  brand: Brand;
};

function colorForSpeaker(speaker: string, speakers: string[], brand: Brand): string {
  if (speakers.length <= 1) return brand.colors.text.primary;
  const palette = brand.colors.palette;
  if (!palette || palette.length === 0) return brand.colors.text.primary;
  const idx = speakers.indexOf(speaker);
  return palette[idx % palette.length];
}

export const LineCaptionOverlay: React.FC<Props> = ({ lines, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const speakers = useMemo(() => Array.from(new Set(lines.map(l => l.speaker))), [lines]);
  const active = useMemo(() => lines.find(l => ms >= l.startMs && ms < l.endMs) ?? null, [lines, ms]);

  if (!active) return null;

  const { typography } = brand;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 101 }}>
      <div style={{
        position:   'absolute',
        top:        CAPTION_TOP,
        left:       0,
        width:      '100%',
        textAlign:  'center',
        padding:    '0 60px',
        boxSizing:  'border-box',
        fontFamily: typography.fontFamily,
        fontWeight: typography.weights.black,
        fontSize:   CAPTION_FONT_SIZE,
        lineHeight: 1.2,
        color:      colorForSpeaker(active.speaker, speakers, brand),
        textShadow: '0 2px 10px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.8)',
        whiteSpace: 'nowrap',
      }}>
        {active.text}
      </div>
    </AbsoluteFill>
  );
};
