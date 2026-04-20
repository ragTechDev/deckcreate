import React from 'react';
import { TextOverlay, type TextOverlayProps } from '../../core';
import type { Brand } from '../../../../types/brand';

export type RoleOverlayProps = Omit<TextOverlayProps, 'brand' | 'text' | 'subtext' | 'keyword' | 'accentColor'> & {
  brand: Brand;
  role:
    | 'software-engineer' | 'developer' | 'coder' | 'programmer'
    | 'junior-developer' | 'senior-developer' | 'devops-engineer'
    | 'data-center-engineer' | 'ml-engineer' | 'ai-app-developer'
    | 'product-engineer' | 'data-engineer' | 'prompt-engineer';
};

const roleMap: Record<string, { text: string; subtext: string }> = {
  'software-engineer':    { text: 'Software Engineer',    subtext: 'Builder of systems' },
  developer:              { text: 'Developer',            subtext: 'Creator of applications' },
  coder:                  { text: 'Coder',                subtext: 'Writer of code' },
  programmer:             { text: 'Programmer',           subtext: 'Logic architect' },
  'junior-developer':     { text: 'Junior Dev',           subtext: 'Growing and learning' },
  'senior-developer':     { text: 'Senior Dev',           subtext: 'Experienced leader' },
  'devops-engineer':      { text: 'DevOps Engineer',      subtext: 'Deployment & operations' },
  'data-center-engineer': { text: 'Data Center Engineer', subtext: 'Infrastructure expert' },
  'ml-engineer':          { text: 'ML Engineer',          subtext: 'Machine learning specialist' },
  'ai-app-developer':     { text: 'AI App Developer',     subtext: 'Building with AI' },
  'product-engineer':     { text: 'Product Engineer',     subtext: 'Tech + business mindset' },
  'data-engineer':        { text: 'Data Engineer',        subtext: 'Data pipelines' },
  'prompt-engineer':      { text: 'Prompt Engineer',      subtext: 'AI whisperer' },
};

export const RoleOverlay: React.FC<RoleOverlayProps> = ({ brand, role, ...props }) => {
  const { text, subtext } = roleMap[role];
  return (
    <TextOverlay
      brand={brand}
      text={text}
      subtext={subtext}
      keyword="type"
      accentColor={brand.colors.accent}
      {...props}
    />
  );
};
