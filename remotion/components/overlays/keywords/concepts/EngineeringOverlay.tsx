import React from 'react';
import { TextOverlay, type TextOverlayProps } from '../../core';
import type { Brand } from '../../../../types/brand';

export type EngineeringOverlayProps = Omit<TextOverlayProps, 'brand' | 'text' | 'keyword' | 'accentColor'> & {
  brand: Brand;
  concept: 'engineering' | 'system-design' | 'mindset' | 'vibe-engineering' | 'scalability' | 'production' | 'execution';
};

const conceptMap: Record<string, { text: string; subtext: string }> = {
  engineering:       { text: 'Engineering',        subtext: 'Beyond just coding' },
  'system-design':   { text: 'System Design',      subtext: 'Big picture thinking' },
  mindset:           { text: 'Engineering Mindset', subtext: 'Thinking in systems' },
  'vibe-engineering':{ text: 'Vibe Engineering',   subtext: 'Engineering with AI' },
  scalability:       { text: 'Scalability',         subtext: 'Built to grow' },
  production:        { text: 'Production Ready',    subtext: 'Real world deployment' },
  execution:         { text: 'Execution',           subtext: 'Making it happen' },
};

export const EngineeringOverlay: React.FC<EngineeringOverlayProps> = ({ brand, concept, ...props }) => {
  const { text, subtext } = conceptMap[concept];
  return (
    <TextOverlay
      brand={brand}
      text={text}
      subtext={subtext}
      keyword="class"
      accentColor={brand.colors.primary}
      {...props}
    />
  );
};
