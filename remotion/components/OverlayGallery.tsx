import React, { useState, useEffect } from 'react';
import { AbsoluteFill, Sequence, staticFile, delayRender, continueRender } from 'remotion';
import type { Brand } from '../types/brand';
import { loadNunito } from '../loadFonts';

import { TextOverlay, IconBadge, CodeBlock } from './overlays/core';
import { ConceptExplainer, SpeakerIntro } from './overlays/lower-thirds';

const FRAMES_PER_SLIDE = 300; // 5 seconds at 60 fps

type GalleryEntry = {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: React.FC<any>;
  props: Record<string, unknown>;
};

const GALLERY_ENTRIES: GalleryEntry[] = [
  // ──── TextOverlay ────
  {
    label: 'TextOverlay — with icon + subtext',
    Component: TextOverlay,
    props: { text: 'Hello World', subtext: 'Your message here', icon: '💡' },
  },
  {
    label: 'TextOverlay — bottom position',
    Component: TextOverlay,
    props: { text: 'Key Takeaway', subtext: 'Subtitle text', position: 'bottom' },
  },
  {
    label: 'TextOverlay — glow',
    Component: TextOverlay,
    props: { text: 'Highlight', subtext: 'With glow effect', glow: true },
  },

  // ──── IconBadge ────
  {
    label: 'IconBadge — top-right with label',
    Component: IconBadge,
    props: { icon: '🎙️', label: 'Live', size: 'lg', position: 'top-right', startFrame: 0 },
  },
  {
    label: 'IconBadge — bottom-left pulse',
    Component: IconBadge,
    props: { icon: '🔥', label: 'Hot Take', size: 'xl', position: 'bottom-left', pulse: true, startFrame: 0 },
  },

  // ──── CodeBlock ────
  {
    label: 'CodeBlock',
    Component: CodeBlock,
    props: {
      language: 'python',
      highlightLines: [3],
      code: 'def ask_llm(prompt: str) -> str:\n    response = client.chat(\n        model="claude-opus-4-6",\n        messages=[{"role": "user", "content": prompt}],\n    )\n    return response.content',
    },
  },

  // ──── ConceptExplainer ────
  {
    label: 'ConceptExplainer',
    Component: ConceptExplainer,
    props: { keyPhrase: 'RAG', description: 'Retrieval Augmented Generation — grounding LLMs with real data' },
  },

  // ──── SpeakerIntro ────
  { label: 'SpeakerIntro', Component: SpeakerIntro, props: { name: 'Natasha', title: 'Software Engineer' } },
];

export const GALLERY_TOTAL_FRAMES = GALLERY_ENTRIES.length * FRAMES_PER_SLIDE;

const SlideLabel: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      position: 'absolute',
      top: 32,
      left: 48,
      zIndex: 200,
      background: 'rgba(255, 255, 255, 0.88)',
      color: '#1a1a2e',
      fontFamily: 'monospace',
      fontSize: 26,
      fontWeight: 600,
      padding: '10px 22px',
      borderRadius: 8,
      letterSpacing: '0.02em',
      pointerEvents: 'none',
      backdropFilter: 'blur(4px)',
      border: '1px solid rgba(255,255,255,0.12)',
    }}
  >
    {text}
  </div>
);

const SlideCounter: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <div
    style={{
      position: 'absolute',
      top: 32,
      right: 48,
      zIndex: 200,
      background: 'rgba(255, 255, 255, 0.70)',
      color: 'rgba(26,26,46,0.55)',
      fontFamily: 'monospace',
      fontSize: 24,
      padding: '10px 22px',
      borderRadius: 8,
      pointerEvents: 'none',
    }}
  >
    {current} / {total}
  </div>
);

const OverlayGallery: React.FC<{ brand: Brand }> = ({ brand }) => {
  const total = GALLERY_ENTRIES.length;

  return (
    <AbsoluteFill style={{ background: '#f8fafc' }}>
      {GALLERY_ENTRIES.map((entry, i) => (
        <Sequence key={i} from={i * FRAMES_PER_SLIDE} durationInFrames={FRAMES_PER_SLIDE} layout="none">
          <AbsoluteFill>
            <entry.Component {...entry.props} brand={brand} durationInFrames={FRAMES_PER_SLIDE} />
            <SlideLabel text={entry.label} />
            <SlideCounter current={i + 1} total={total} />
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

type CompositionProps = { brandSrc?: string };

export const OverlayGalleryComposition: React.FC<CompositionProps> = ({
  brandSrc = 'brand.json',
}) => {
  const [brand, setBrand]   = useState<Brand | null>(null);
  const [brandHandle]       = useState(() => delayRender('Loading brand'));
  const [fontHandle]        = useState(() => delayRender('Loading Nunito font'));

  useEffect(() => {
    fetch(staticFile(brandSrc))
      .then(r => r.json())
      .then(data => { setBrand(data); continueRender(brandHandle); })
      .catch(err => { console.error('OverlayGallery: brand load failed:', err); continueRender(brandHandle); });
  }, [brandSrc, brandHandle]);

  useEffect(() => {
    loadNunito().finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  if (!brand) return null;
  return <OverlayGallery brand={brand} />;
};
