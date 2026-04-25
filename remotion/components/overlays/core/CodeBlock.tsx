import React from 'react';
import { staticFile } from 'remotion';
import { BaseOverlay, type OverlayProps } from './BaseOverlay';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";
const TECHYBARA = staticFile('assets/techybara/techybara-holding-laptop.png');

export type CodeBlockProps = OverlayProps & {
  brand: Brand;
  code: string;
  language?: string;
  fontSize?: number;
  highlightLines?: number[];
};

export const CodeBlock: React.FC<CodeBlockProps> = ({
  brand,
  code,
  language,
  fontSize = 22,
  highlightLines = [],
  ...baseProps
}) => {
  const { colors, shape } = brand;
  const lines = code.split('\n');

  return (
    <BaseOverlay {...baseProps} position={baseProps.position ?? 'bottom-left'}>
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
              {language ? `${language} — zsh` : '~/ragtech — zsh'}
            </span>
          </div>

          {/* Body */}
          <div
            style={{
              background: '#0d1117',
              borderRadius: `0 0 ${shape.borderRadius}px ${shape.borderRadius}px`,
              padding: '16px 0 20px',
              fontFamily: MONO,
              fontSize,
              lineHeight: 1.7,
              color: '#e6edf3',
              minWidth: 520,
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* Dim prompt header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, opacity: 0.45, padding: '0 28px' }}>
              <span style={{ color: colors.secondary, marginRight: 8 }}>❯</span>
              <span style={{ color: '#8b949e' }}>~/ragtech — zsh</span>
            </div>

            {/* Code lines with line numbers */}
            {lines.map((line, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  background: highlightLines.includes(i + 1) ? 'rgba(255,255,255,0.05)' : 'transparent',
                  padding: '1px 28px',
                  borderLeft: highlightLines.includes(i + 1)
                    ? `3px solid ${colors.primary}`
                    : '3px solid transparent',
                }}
              >
                <span
                  style={{
                    color: '#484f58',
                    minWidth: 28,
                    textAlign: 'right',
                    marginRight: 20,
                    userSelect: 'none',
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ color: '#e6edf3', whiteSpace: 'pre' }}>{line || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BaseOverlay>
  );
};
