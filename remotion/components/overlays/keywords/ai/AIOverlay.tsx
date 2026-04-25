import React from 'react';
import { TextOverlay, type TextOverlayProps } from '../../core';
import type { Brand } from '../../../../types/brand';

export type AIOverlayProps = Omit<TextOverlayProps, 'brand' | 'text' | 'subtext' | 'keyword' | 'accentColor'> & {
  brand: Brand;
  concept:
    | 'ai' | 'artificial-intelligence' | 'ai-assistant' | 'ai-agent'
    | 'prompt-engineering' | 'vibe-coding' | 'model' | 'llm' | 'agents'
    | 'api-call' | 'training' | 'automation' | 'machine-learning' | 'neural-network';
};

const conceptMap: Record<string, { text: string; subtext: string }> = {
  ai:                     { text: 'AI',                     subtext: 'Artificial Intelligence' },
  'artificial-intelligence':{ text: 'Artificial Intelligence', subtext: 'Smart machines' },
  'ai-assistant':         { text: 'AI Assistant',           subtext: 'Your coding partner' },
  'ai-agent':             { text: 'AI Agent',               subtext: 'Autonomous task solver' },
  'prompt-engineering':   { text: 'Prompt Engineering',     subtext: 'Talk to AI effectively' },
  'vibe-coding':          { text: 'Vibe Coding',            subtext: 'Code with AI flow' },
  model:                  { text: 'Model',                  subtext: 'The AI brain' },
  llm:                    { text: 'LLM',                    subtext: 'Large Language Model' },
  agents:                 { text: 'Agents',                 subtext: 'AI that acts' },
  'api-call':             { text: 'API Call',               subtext: 'Connect to AI' },
  training:               { text: 'Training',               subtext: 'Teaching the model' },
  automation:             { text: 'Automation',             subtext: 'Let AI handle it' },
  'machine-learning':     { text: 'Machine Learning',       subtext: 'Learning from data' },
  'neural-network':       { text: 'Neural Network',         subtext: 'Brain-inspired computing' },
};

export const AIOverlay: React.FC<AIOverlayProps> = ({ brand, concept, ...props }) => {
  const { text, subtext } = conceptMap[concept];
  return (
    <TextOverlay
      brand={brand}
      text={text}
      subtext={subtext}
      keyword="async"
      accentColor={brand.colors.accent}
      {...props}
    />
  );
};
