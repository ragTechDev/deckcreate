import React from 'react';
import { TextOverlay, type TextOverlayProps } from '../core';
import type { Brand } from '../../../types/brand';

export type CodingOverlayProps = Omit<TextOverlayProps, 'brand' | 'text' | 'keyword' | 'accentColor'> & {
  brand: Brand;
  concept: 'coding' | 'programming' | 'syntax' | 'hello-world' | 'if-else' | 'loops' | 'variables';
};

const conceptMap: Record<string, { text: string; subtext: string }> = {
  coding:        { text: 'Coding',        subtext: 'The foundation of tech' },
  programming:   { text: 'Programming',   subtext: 'Building with logic' },
  syntax:        { text: 'Syntax',        subtext: 'The grammar of code' },
  'hello-world': { text: 'Hello World',   subtext: "Every coder's first step" },
  'if-else':     { text: 'If / Else',     subtext: 'Making decisions in code' },
  loops:         { text: 'Loops',         subtext: 'Repeat with purpose' },
  variables:     { text: 'Variables',     subtext: 'Storing data' },
};

export const CodingOverlay: React.FC<CodingOverlayProps> = ({ brand, concept, ...props }) => {
  const { text, subtext } = conceptMap[concept];
  return (
    <TextOverlay
      brand={brand}
      text={text}
      subtext={subtext}
      keyword="const"
      accentColor={brand.colors.secondary}
      {...props}
    />
  );
};
