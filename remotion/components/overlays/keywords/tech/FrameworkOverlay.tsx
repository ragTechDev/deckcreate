import React from 'react';
import { TextOverlay, type TextOverlayProps } from '../../core';
import type { Brand } from '../../../../types/brand';

export type FrameworkOverlayProps = Omit<TextOverlayProps, 'brand' | 'text' | 'subtext' | 'keyword' | 'accentColor'> & {
  brand: Brand;
  framework: 'kubernetes' | 'docker' | 'langchain' | 'tensorflow' | 'pytorch' | 'react' | 'nextjs';
};

const frameworkMap: Record<string, { text: string; subtext: string; accent: string }> = {
  kubernetes: { text: 'Kubernetes', subtext: 'Container orchestration', accent: '#326CE5' },
  docker:     { text: 'Docker',     subtext: 'Containerize everything',  accent: '#2496ED' },
  langchain:  { text: 'LangChain',  subtext: 'LLM application framework', accent: '#1a7a5e' },
  tensorflow: { text: 'TensorFlow', subtext: 'ML at scale',              accent: '#c45200' },
  pytorch:    { text: 'PyTorch',    subtext: 'Deep learning framework',  accent: '#c0392b' },
  react:      { text: 'React',      subtext: 'UI components',            accent: '#0ea5c9' },
  nextjs:     { text: 'Next.js',    subtext: 'Full-stack React',         accent: '#374151' },
};

export const FrameworkOverlay: React.FC<FrameworkOverlayProps> = ({ brand, framework, ...props }) => {
  const { text, subtext, accent } = frameworkMap[framework];
  return (
    <TextOverlay
      brand={brand}
      text={text}
      subtext={subtext}
      keyword="import"
      accentColor={accent}
      {...props}
    />
  );
};
