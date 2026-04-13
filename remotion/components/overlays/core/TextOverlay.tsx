import React from 'react';
import { BaseOverlay, type OverlayProps } from './BaseOverlay';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";

export type TextOverlayProps = OverlayProps & {
  brand: Brand;
  /** Concept label — rendered in bold uppercase */
  text: string;
  /** Description — rendered as a code comment: // subtext */
  subtext?: string;
  /**
   * Monospace keyword badge above the main text.
   * Gives a coding flavour, e.g. "const", "type", "async", "import".
   */
  keyword?: string;
  /** Left accent bar and keyword colour. Defaults to brand.colors.primary. */
  accentColor?: string;
  fontSize?: number;
  subtextSize?: number;
  maxWidth?: number;
};

export const TextOverlay: React.FC<TextOverlayProps> = ({
  brand,
  text,
  subtext,
  keyword,
  accentColor,
  fontSize = 52,
  subtextSize = 22,
  maxWidth = 560,
  ...baseProps
}) => {
  const { colors, typography, shape } = brand;
  const accent = accentColor ?? colors.primary;

  return (
    <BaseOverlay
      {...baseProps}
      position={baseProps.position ?? 'bottom-left'}
      enterAnimation={baseProps.enterAnimation ?? 'slideUp'}
      exitAnimation={baseProps.exitAnimation ?? 'slideDown'}
    >
      <div
        style={{
          background: '#FFFFFF',
          borderLeft: `5px solid ${accent}`,
          borderRadius: `0 ${shape.borderRadius}px ${shape.borderRadius}px 0`,
          padding: '28px 48px 32px 36px',
          maxWidth,
          boxShadow: '0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
        }}
      >
        {keyword && (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 600,
              color: accent,
              letterSpacing: '0.07em',
              marginBottom: 10,
              opacity: 0.85,
            }}
          >
            {keyword}
          </div>
        )}

        <div
          style={{
            fontFamily: typography.fontFamily,
            fontSize,
            fontWeight: typography.weights.black,
            color: '#0F0F1A',
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            textTransform: 'uppercase',
          }}
        >
          {text}
        </div>

        {subtext && (
          <div
            style={{
              fontFamily: MONO,
              fontSize: subtextSize,
              color: '#71717a',
              marginTop: 8,
              letterSpacing: '0.01em',
              lineHeight: 1.4,
            }}
          >
            {'// '}
            {subtext}
          </div>
        )}
      </div>
    </BaseOverlay>
  );
};
