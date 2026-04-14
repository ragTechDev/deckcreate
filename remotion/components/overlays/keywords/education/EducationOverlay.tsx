import React from 'react';
import { TextOverlay, type TextOverlayProps } from '../../core';
import type { Brand } from '../../../../types/brand';

export type EducationOverlayProps = Omit<TextOverlayProps, 'brand' | 'text' | 'subtext' | 'keyword' | 'accentColor'> & {
  brand: Brand;
  concept:
    | 'learning' | 'fundamentals' | 'curriculum' | 'workshop' | 'hackathon'
    | 'mentor' | 'training' | 'teaching' | 'education' | 'skill' | 'mindset' | 'discipline';
};

const conceptMap: Record<string, { text: string; subtext: string }> = {
  learning:     { text: 'Learning',     subtext: 'Never stop growing' },
  fundamentals: { text: 'Fundamentals', subtext: 'Build strong foundations' },
  curriculum:   { text: 'Curriculum',   subtext: 'Structured learning' },
  workshop:     { text: 'Workshop',     subtext: 'Hands-on training' },
  hackathon:    { text: 'Hackathon',    subtext: 'Code & compete' },
  mentor:       { text: 'Mentor',       subtext: 'Guidance from experts' },
  training:     { text: 'Training',     subtext: 'Skill development' },
  teaching:     { text: 'Teaching',     subtext: 'Passing knowledge' },
  education:    { text: 'Education',    subtext: 'Formal learning' },
  skill:        { text: 'Skill',        subtext: 'Developed ability' },
  mindset:      { text: 'Mindset',      subtext: 'Way of thinking' },
  discipline:   { text: 'Discipline',   subtext: 'Consistent practice' },
};

export const EducationOverlay: React.FC<EducationOverlayProps> = ({ brand, concept, ...props }) => {
  const { text, subtext } = conceptMap[concept];
  return (
    <TextOverlay
      brand={brand}
      text={text}
      subtext={subtext}
      keyword="@guide"
      accentColor={brand.colors.secondary}
      {...props}
    />
  );
};
