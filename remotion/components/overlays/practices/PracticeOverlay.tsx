import React from 'react';
import { TextOverlay, type TextOverlayProps } from '../core';
import type { Brand } from '../../../types/brand';

export type PracticeOverlayProps = Omit<TextOverlayProps, 'brand' | 'text' | 'subtext' | 'keyword' | 'accentColor'> & {
  brand: Brand;
  practice:
    | 'best-practices' | 'standards' | 'fallback-strategy' | 'retry-logic'
    | 'lazy-loading' | 'caching' | 'api-keys' | 'security' | 'cybersecurity'
    | 'guardrails' | 'evaluation' | 'explicit-instructions' | 'business-acumen';
};

const practiceMap: Record<string, { text: string; subtext: string }> = {
  'best-practices':       { text: 'Best Practices',       subtext: 'Industry standards' },
  standards:              { text: 'Standards',            subtext: 'Quality guidelines' },
  'fallback-strategy':    { text: 'Fallback Strategy',    subtext: 'Plan B ready' },
  'retry-logic':          { text: 'Retry Logic',          subtext: 'Resilient systems' },
  'lazy-loading':         { text: 'Lazy Loading',         subtext: 'Load on demand' },
  caching:                { text: 'Caching',              subtext: 'Speed through storage' },
  'api-keys':             { text: 'API Keys',             subtext: 'Authentication credentials' },
  security:               { text: 'Security',             subtext: 'Protect your systems' },
  cybersecurity:          { text: 'Cybersecurity',        subtext: 'Defend against threats' },
  guardrails:             { text: 'Guardrails',           subtext: 'Safe boundaries' },
  evaluation:             { text: 'Evaluation',           subtext: 'Measure & improve' },
  'explicit-instructions':{ text: 'Explicit Instructions', subtext: 'Clear & precise' },
  'business-acumen':      { text: 'Business Acumen',      subtext: 'Tech + business sense' },
};

export const PracticeOverlay: React.FC<PracticeOverlayProps> = ({ brand, practice, ...props }) => {
  const { text, subtext } = practiceMap[practice];
  return (
    <TextOverlay
      brand={brand}
      text={text}
      subtext={subtext}
      keyword="// tip"
      accentColor={brand.colors.primary}
      {...props}
    />
  );
};
