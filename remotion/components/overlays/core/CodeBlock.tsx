import React from 'react';
import { BaseOverlay, type OverlayProps } from './BaseOverlay';
import type { Brand } from '../../../types/brand';

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
  fontSize = 24,
  highlightLines = [],
  ...baseProps
}) => {
  const { colors, typography, shape } = brand;
  const lines = code.split('\n');

  return (
    <BaseOverlay {...baseProps} position="center">
      <div
        style={{
          background: '#ffffff',
          borderRadius: shape.borderRadius,
          padding: '20px 24px',
          maxWidth: 900,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.07)',
          fontFamily: `${typography.fontFamily}, SF Mono, Monaco, Consolas, monospace`,
          fontSize,
          lineHeight: 1.6,
        }}
      >
        {language && (
          <div
            style={{
              fontSize: 12,
              color: '#57606a',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            {language}
          </div>
        )}
        <div>
          {lines.map((line, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                background: highlightLines.includes(i + 1) ? 'rgba(187, 128, 9, 0.15)' : 'transparent',
                margin: '0 -24px',
                padding: '2px 24px',
                borderLeft: highlightLines.includes(i + 1) ? '3px solid #d29922' : '3px solid transparent',
              }}
            >
              <span
                style={{
                  color: '#8f9196',
                  minWidth: 30,
                  textAlign: 'right',
                  marginRight: 16,
                  userSelect: 'none',
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: '#24292e', whiteSpace: 'pre' }}>{line || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    </BaseOverlay>
  );
};
