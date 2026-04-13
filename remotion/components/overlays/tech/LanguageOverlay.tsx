import React from 'react';
import { TextOverlay, type TextOverlayProps } from '../core';
import type { Brand } from '../../../types/brand';

export type LanguageOverlayProps = Omit<TextOverlayProps, 'brand' | 'text' | 'subtext' | 'keyword' | 'accentColor'> & {
  brand: Brand;
  language: 'python' | 'javascript' | 'java' | 'php' | 'go' | 'typescript' | 'rust' | 'cpp' | 'binary';
};

// accent colors are the language's own brand color, clipped to readable values
const languageMap: Record<string, { text: string; subtext: string; accent: string }> = {
  python:     { text: 'Python',     subtext: 'Code that reads like English', accent: '#3776AB' },
  javascript: { text: 'JavaScript', subtext: 'The language of the web',      accent: '#c4940a' },
  java:       { text: 'Java',       subtext: 'Enterprise standard',           accent: '#007396' },
  php:        { text: 'PHP',        subtext: 'Web server power',              accent: '#6144a0' },
  go:         { text: 'Go',         subtext: "Google's efficient language",   accent: '#00ADD8' },
  typescript: { text: 'TypeScript', subtext: 'Typed JavaScript',              accent: '#3178C6' },
  rust:       { text: 'Rust',       subtext: 'Safe systems programming',      accent: '#b05a2b' },
  cpp:        { text: 'C++',        subtext: 'Performance critical',          accent: '#00599C' },
  binary:     { text: 'Binary',     subtext: 'Zeros and ones',                accent: '#52525b' },
};

export const LanguageOverlay: React.FC<LanguageOverlayProps> = ({ brand, language, ...props }) => {
  const { text, subtext, accent } = languageMap[language];
  return (
    <TextOverlay
      brand={brand}
      text={text}
      subtext={subtext}
      keyword="lang"
      accentColor={accent}
      {...props}
    />
  );
};
