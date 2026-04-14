import React from 'react';
import { staticFile } from 'remotion';
import { BaseOverlay, type OverlayProps } from './BaseOverlay';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";
const TECHYBARA = staticFile('assets/techybara/techybara-raising-hand.png');

export type TextOverlayProps = OverlayProps & {
  brand: Brand;
  /** Concept label — rendered in bold uppercase */
  text: string;
  /** Description — rendered as a code comment: // subtext */
  subtext?: string;
  /**
   * Monospace keyword badge above the main text.
   * Also used as the terminal filename prompt (e.g. "const" → "const.ts").
   */
  keyword?: string;
  /** Accent colour for prompt, keyword badge, and cursor. Defaults to brand.colors.primary. */
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
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>

        {/* Techybara — overlaps the terminal's left edge */}
        <img
          src={TECHYBARA}
          style={{
            height: 164,
            objectFit: 'contain',
            position: 'relative',
            zIndex: 2,
            marginRight: -28,
            flexShrink: 0,
          }}
        />

        {/* Terminal window */}
        <div style={{ position: 'relative', zIndex: 1 }}>

          {/* Chrome */}
          <div
            style={{
              background: '#21262d',
              borderRadius: `${shape.borderRadius}px ${shape.borderRadius}px 0 0`,
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }} />
            <span style={{ fontFamily: MONO, fontSize: 13, color: '#8b949e', marginLeft: 10 }}>
              ~/ragtech — zsh
            </span>
          </div>

          {/* Body */}
          <div
            style={{
              background: '#0d1117',
              borderRadius: `0 0 ${shape.borderRadius}px ${shape.borderRadius}px`,
              padding: '16px 28px 20px',
              color: '#e6edf3',
              maxWidth,
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* Dim prompt header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, opacity: 0.45 }}>
              <span style={{ color: accent, fontFamily: MONO, marginRight: 8 }}>❯</span>
              <span style={{ color: '#8b949e', fontFamily: MONO, fontSize: 13 }}>
                {keyword ? `${keyword}.ts` : '~/ragtech — zsh'}
              </span>
            </div>

            {/* Keyword badge */}
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

            {/* Main text */}
            <div
              style={{
                fontFamily: typography.fontFamily,
                fontSize,
                fontWeight: typography.weights.black,
                color: '#e6edf3',
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
                textTransform: 'uppercase',
              }}
            >
              {text}
            </div>

            {/* Subtext — rendered as a code comment */}
            {subtext && (
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: subtextSize,
                  color: '#484f58',
                  marginTop: 8,
                  letterSpacing: '0.01em',
                  lineHeight: 1.4,
                }}
              >
                {'// '}{subtext}
              </div>
            )}
          </div>
        </div>
      </div>
    </BaseOverlay>
  );
};
