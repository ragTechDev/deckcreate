import React, { useState, useEffect } from 'react';
import {
  AbsoluteFill, Img, staticFile,
  delayRender, continueRender,
} from 'remotion';
import type { Brand } from '../types/brand';
import { loadNunito } from '../loadFonts';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SpeakerSlot = {
  name: string;
  cutoutSrc: string;   // path relative to /public
  nameBg: string;
};

type ThumbnailInnerProps = {
  brand: Brand;
  hookText: string;
  speakers: SpeakerSlot[];
  layoutVariant: 'left' | 'right' | 'center';
  backgroundSrcs?: string[];   // external image(s) for bg; multiple = horizontal stack w/ blur
  title?: string;
  middleSpeakers?: string[];   // speaker name(s) to place in center positions
};

export type ThumbnailCompositionProps = {
  manifestSrc?: string;        // default: 'thumbnail/cutouts/manifest.json'
  transcriptSrc?: string;      // default: 'edit/transcript.json'
  brandSrc?: string;           // default: 'brand.json'
  hookText?: string;           // override: skips transcript fetch
  speakerNames?: string[];     // subset to show (default: all in manifest)
  layoutVariant?: 'left' | 'right' | 'center';
  backgroundSrcs?: string[];   // blurred bg image(s) relative to /public
  title?: string;              // supports **highlighted** syntax
  middleSpeakers?: string[];   // speaker name(s) to place in center positions
};

// ── Constants ─────────────────────────────────────────────────────────────────

const NAME_BG: Record<string, string> = {
  Natasha:  '#eebf89',
  Saloni:   '#9cd2d0',
  Victoria: '#ffa3a6',
};

const CANVAS_W        = 1280;
const CANVAS_H        = 720;
const TERMINAL_BAR_H  = 44;
const CONTENT_H       = CANVAS_H - TERMINAL_BAR_H;
const LOGO_W          = Math.round(CANVAS_W * 0.10);  // ~128px

const FLOATS = [
  { kind: 'blob', x: 67,   y: 107, sz: 207, c: '#eebf89', op: 0.10 },
  { kind: 'blob', x: 1155, y: 493, sz: 234, c: '#9cd2d0', op: 0.09 },
  { kind: 'blob', x: 607,  y: 600, sz: 180, c: '#ffa3a6', op: 0.08 },
  { kind: 'dot',  x: 210,  y: 380, sz: 13,  c: '#eebf89', op: 0.45 },
  { kind: 'dot',  x: 1094, y: 137, sz: 11,  c: '#9cd2d0', op: 0.40 },
  { kind: 'dot',  x: 527,  y: 72,  sz: 12,  c: '#ffa3a6', op: 0.38 },
  { kind: 'star', x: 303,  y: 150, sz: 21,  c: '#eebf89', op: 0.55 },
  { kind: 'star', x: 1044, y: 427, sz: 19,  c: '#ffa3a6', op: 0.50 },
  { kind: 'star', x: 794,  y: 92,  sz: 16,  c: '#9cd2d0', op: 0.45 },
  { kind: 'star', x: 105,  y: 503, sz: 17,  c: '#ffa3a6', op: 0.45 },
];

// ── Text utilities ────────────────────────────────────────────────────────────

function truncate4(phrase: string): string {
  const words = phrase.trim().split(/\s+/).slice(0, 4);
  if (words.length === 4) words[3] = words[3].replace(/[,;]$/, '');
  return words.join(' ');
}

function resolveHookText(transcript: { segments?: any[]; meta?: { title?: string } }): string {
  const segments = transcript.segments ?? [];
  const t1 = segments
    .filter((s: any) => s.hook && s.hookPhrase && s.hookFrom != null)
    .sort((a: any, b: any) => b.hookPhrase.split(/\s+/).length - a.hookPhrase.split(/\s+/).length)[0];
  if (t1) return truncate4(t1.hookPhrase);
  const t2 = segments.find((s: any) => s.hook && s.text?.trim());
  if (t2) return truncate4(t2.text.trim());
  return truncate4(transcript.meta?.title ?? 'ragTech Podcast');
}

// ── Title highlight parser ────────────────────────────────────────────────────
// Supports **highlighted text** syntax from transcript.doc.txt

type TitlePart = { text: string; highlighted: boolean };

function parseTitleHighlights(text: string): TitlePart[] {
  const parts: TitlePart[] = [];
  const regex = /\*\*(.*?)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push({ text: text.slice(lastIdx, match.index), highlighted: false });
    parts.push({ text: match[1], highlighted: true });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx), highlighted: false });
  return parts;
}

// ── Speaker resolution ────────────────────────────────────────────────────────

function resolveSpeakers(
  manifest: Record<string, { cutout: string }>,
  speakerNames?: string[],
  middleSpeakers?: string[],
): SpeakerSlot[] {
  const rawNames = speakerNames?.length ? speakerNames : Object.keys(manifest);
  const seen = new Set<string>();
  const uniqueNames = rawNames.filter(n => {
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });

  const slots = uniqueNames
    .filter(n => manifest[n]?.cutout)
    .map(n => ({
      name: n,
      cutoutSrc: manifest[n].cutout,
      nameBg: NAME_BG[n] ?? '#eebf89',
    }));

  const seenSrcs = new Set<string>();
  const deduped = slots.filter(s => {
    if (seenSrcs.has(s.cutoutSrc)) return false;
    seenSrcs.add(s.cutoutSrc);
    return true;
  });

  // Reorder: put middleSpeakers into center index positions
  if (middleSpeakers?.length && deduped.length >= 3) {
    const count = Math.min(deduped.length, 4);
    const midPositions = count === 3 ? [1] : [1, 2];
    const result = [...deduped];
    middleSpeakers.forEach((name, mi) => {
      if (mi >= midPositions.length) return;
      const fromIdx = result.findIndex(s => s.name === name);
      const toIdx = midPositions[mi];
      if (fromIdx !== -1 && fromIdx !== toIdx) {
        const [sp] = result.splice(fromIdx, 1);
        result.splice(toIdx, 0, sp);
      }
    });
    return result;
  }

  return deduped;
}

// ── Speaker layout ────────────────────────────────────────────────────────────
// Speakers span the full content height. Heads are evenly spaced horizontally.
// For 2 speakers: left image left-edge at canvas left, right image right-edge at canvas right.
// For 3/4 speakers: head centers at even intervals; middle speaker(s) have higher z-index.

type SpeakerLayoutItem = {
  left?: number;
  right?: number;
  containerW: number;
  zIndex: number;
  objPos: string;
  scale?: number;
};

function getSpeakerLayout(count: number): SpeakerLayoutItem[] {
  if (count === 1) {
    return [{
      left: Math.round((CANVAS_W - 500) / 2),
      containerW: 500,
      zIndex: 10,
      objPos: 'top center',
    }];
  }

  if (count === 2) {
    // Left edge aligned to canvas left; right edge aligned to canvas right.
    // objectPosition ensures the image hugs the correct edge within its container.
    return [
      { left: 0,  containerW: 500, zIndex: 10, objPos: 'top left'  },
      { right: 0, containerW: 500, zIndex: 10, objPos: 'top right' },
    ];
  }

  if (count === 3) {
    // Head centers at 15%, 50%, 85% of canvas width.
    // Wider spread prevents face overlap while allowing body overlap.
    const cw = 700;
    const centers = [
      Math.round(CANVAS_W * 0.2),  // left speaker
      Math.round(CANVAS_W * 0.50),  // center speaker
      Math.round(CANVAS_W * 0.8),  // right speaker
    ];
    const scales = [0.92, 1.05, 0.92]; // middle speaker bigger
    return centers.map((cx, i) => ({
      left: cx,
      containerW: 0, // no longer used
      zIndex: i === 1 ? 15 : 10,
      objPos: 'top center',
      scale: scales[i],
    }));
  }

  // 4 speakers — head centers at 12%, 37%, 63%, 88%.
  const cw = 400;
  const centers = [
    Math.round(CANVAS_W * 0.12),
    Math.round(CANVAS_W * 0.37),
    Math.round(CANVAS_W * 0.63),
    Math.round(CANVAS_W * 0.88),
  ];
  return centers.map((cx, i) => ({
    left: Math.max(0, cx - Math.round(cw / 2)),
    containerW: cw,
    zIndex: i === 1 || i === 2 ? 15 : 10,
    objPos: 'top center',
  }));
}

// ── Terminal title bar (frames the whole thumbnail) ───────────────────────────

function TerminalTitleBar({ brand }: { brand: Brand }) {
  const { typography } = brand;
  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0,
      width: CANVAS_W,
      height: TERMINAL_BAR_H,
      background: '#252526',
      borderBottom: '1px solid #333',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 20px',
      zIndex: 50,
      boxSizing: 'border-box',
    }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57', display: 'inline-block', flexShrink: 0 }} />
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E', display: 'inline-block', flexShrink: 0 }} />
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840', display: 'inline-block', flexShrink: 0 }} />
      <span style={{
        flex: 1,
        textAlign: 'center',
        fontSize: 15,
        fontWeight: typography.weights.semiBold,
        color: '#666',
        letterSpacing: '0.04em',
        fontFamily: 'monospace',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}>
        bash — @ragtechdev
      </span>
    </div>
  );
}

// ── Background layer ──────────────────────────────────────────────────────────
// No srcs → dark terminal with decorative floats.
// One src → full-bleed blurred image.
// Multiple srcs → equal-width horizontal stack, each blurred.
// Supports both internal paths (relative to /public) and external URLs.

function isExternalUrl(src: string): boolean {
  return /^https?:\/\//.test(src);
}

function resolveSrc(src: string): string {
  if (isExternalUrl(src)) return src;
  // Strip public/ prefix if present - staticFile expects paths relative to /public
  const cleanSrc = src.replace(/^public\//, '').replace(/^\//, '');
  return staticFile(cleanSrc);
}

function BackgroundLayer({ srcs }: { srcs?: string[] }) {
  if (!srcs?.length) {
    return (
      <>
        {FLOATS.map((s, i) => {
          const base: React.CSSProperties = {
            position: 'absolute',
            left: s.x,
            top: s.y + TERMINAL_BAR_H,
            opacity: s.op,
            pointerEvents: 'none',
            transform: 'translate(-50%, -50%)',
          };
          if (s.kind === 'blob') return (
            <div key={i} style={{ ...base, width: s.sz, height: s.sz, borderRadius: '50%', background: s.c, filter: 'blur(60px)' }} />
          );
          if (s.kind === 'dot') return (
            <div key={i} style={{ ...base, width: s.sz, height: s.sz, borderRadius: '50%', background: s.c }} />
          );
          return <span key={i} style={{ ...base, fontSize: s.sz, color: s.c, lineHeight: 1 }}>✦</span>;
        })}
      </>
    );
  }

  if (srcs.length === 1) {
    return (
      <Img
        src={resolveSrc(srcs[0])}
        style={{
          position: 'absolute',
          top: TERMINAL_BAR_H,
          left: 0,
          width: CANVAS_W, height: CONTENT_H,
          objectFit: 'cover',
          filter: 'blur(12px) brightness(0.5) contrast(1.05)',
          transform: 'scale(1.06)',
          transformOrigin: 'center center',
          opacity: 0.9
        }}
      />
    );
  }

  const segW = Math.round(CANVAS_W / srcs.length);
  return (
    <>
      {srcs.map((src, i) => (
        <Img
          key={i}
          src={resolveSrc(src)}
          style={{
            position: 'absolute',
            top: TERMINAL_BAR_H,
            left: i * segW,
            width: i === srcs.length - 1 ? CANVAS_W - i * segW : segW,
            height: CONTENT_H,
            objectFit: 'cover',
            filter: 'blur(2px) brightness(0.9) contrast(1.05)',
            transform: 'scale(1.06)',
            transformOrigin: 'center center',
            opacity: 0.9
          }}
        />
      ))}
    </>
  );
}

// ── Title overlay ─────────────────────────────────────────────────────────────
// Centered at the visual midpoint of the content area.
// Bash-style `~ >` prefix above the title text.
// **text** in the title prop is rendered with accent color highlight.

function TitleOverlay({ text, brand }: { text: string; brand: Brand }) {
  const { colors, typography } = brand;
  // Strip surrounding quotes and parse highlights
  const cleanText = text.replace(/^["']|["']$/g, '');
  const parts = parseTitleHighlights(cleanText);

  return (
  <div style={{
    position: 'absolute',
    top: TERMINAL_BAR_H + Math.round(CONTENT_H * 0.7),
    left: '50%',
    transform: 'translate(-50%, 0)',
    width: Math.round(CANVAS_W * 0.70),
    zIndex: 20,
    pointerEvents: 'none',
  }}>
    
    {/* 🔳 Blurred dark backing */}
    <div
      style={{
        position: 'absolute',
        inset: '-5px -5px', // extend beyond text for soft edges
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        
        // feathered edges
        maskImage:
          'radial-gradient(ellipse at center, rgba(0,0,0,1) 60%, rgba(0,0,0,0) 100%)',
        WebkitMaskImage:
          'radial-gradient(ellipse at center, rgba(0,0,0,1) 60%, rgba(0,0,0,0) 100%)',

        borderRadius: 24,
      }}
    />

    {/* 📝 Title text */}
    <div style={{
      position: 'relative',
      textAlign: 'center',
      fontSize: 60,
      fontWeight: brand.typography.weights.black,
      color: '#fff',
      lineHeight: 1.15,
      fontFamily: brand.typography.fontFamily,
      textShadow:
        '0 4px 32px rgba(0,0,0,0.85), 0 2px 12px rgba(0,0,0,0.65)',
    }}>
      <span style={{ color: brand.colors.secondary, marginRight: '0.3em' }}>~&gt;</span>
      {parts.map((part, i) =>
        part.highlighted ? (
          <span key={i} style={{
            color: brand.colors.accent,
            background: `${brand.colors.accent}33`,
            borderRadius: 6,
            padding: '0 6px',
          }}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </div>
  </div>
  );
}

// ── Logo mark ─────────────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <div style={{
      position: 'absolute',
      bottom: 18,
      left: 18,
      zIndex: 30,
    }}>
      <Img
        src={staticFile('assets/logo/transparent-bg-logo.png')}
        style={{
          width: LOGO_W,
          height: LOGO_W,
          objectFit: 'contain',
          objectPosition: 'bottom left',
        }}
      />
    </div>
  );
}

// ── Main presentational component ─────────────────────────────────────────────

export const PodcastThumbnail: React.FC<ThumbnailInnerProps> = ({
  brand, hookText, speakers, backgroundSrcs, title,
}) => {
  const speakerCount = Math.min(speakers.length, 4);
  const layout = getSpeakerLayout(speakerCount);
  const displayText = title ?? hookText;

  return (
    <AbsoluteFill style={{
      background: '#1e1e1e',
      fontFamily: brand.typography.fontFamily,
      overflow: 'hidden',
    }}>

      {/* ── Terminal title bar (frames entire thumbnail) ─────────────── */}
      <TerminalTitleBar brand={brand} />

      {/* ── Background: blurred image(s) or decorative dark floats ─── */}
      <BackgroundLayer srcs={backgroundSrcs} />

      {/* ── Speaker cutouts spanning full content height ─────────────── */}
      {/* Images use objectFit: contain + objectPosition: top so they    */}
      {/* scale proportionally from the topmost pixel (top of head).     */}
      {speakers.slice(0, 4).map((speaker, i) => {
        const pos = layout[i];
        if (!pos) return null;
        return (
            <div
              key={`${speaker.name}-${i}`}
              style={{
                position: 'absolute',
                top: TERMINAL_BAR_H+35,
                left: pos.left,
                height: CONTENT_H,
                transform: `translate(-50%, ${i === 1 ? '0px' : '20px'}) scale(${pos.scale ?? 1})`,
                transformOrigin: 'top center',
                zIndex: pos.zIndex,
              }}
            >
            <Img
              src={staticFile(speaker.cutoutSrc)}
              style={{
                height: '100%',
                width: 'auto',
                objectFit: 'contain',
                objectPosition: pos.objPos,
                filter: 'drop-shadow(0 16px 40px rgba(0,0,0,0.65))',
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            />
          </div>
        );
      })}

      {/* ── Centered title overlay ────────────────────────────────────── */}
      <TitleOverlay text={displayText} brand={brand} />

      {/* ── Logo bottom-left, ~10% canvas width ──────────────────────── */}
      <LogoMark />

    </AbsoluteFill>
  );
};

// ── Standalone composition wrapper ────────────────────────────────────────────

export const PodcastThumbnailComposition: React.FC<ThumbnailCompositionProps> = ({
  manifestSrc   = 'thumbnail/cutouts/manifest.json',
  transcriptSrc = 'edit/transcript.json',
  brandSrc      = 'brand.json',
  hookText: hookTextProp,
  speakerNames,
  layoutVariant: layoutVariantProp = 'left',
  backgroundSrcs: backgroundSrcsProp,
  title: titleProp,
  middleSpeakers: middleSpeakersProp,
}) => {
  const [brand, setBrand]       = useState<Brand | null>(null);
  const [hookText, setHookText] = useState<string | null>(hookTextProp ?? null);
  const [speakers, setSpeakers] = useState<SpeakerSlot[] | null>(null);
  const [layoutVariant, setLayoutVariant] = useState<'left' | 'right' | 'center'>(layoutVariantProp);
  const [backgroundSrcs, setBackgroundSrcs] = useState<string[] | undefined>(backgroundSrcsProp);
  const [title, setTitle] = useState<string | undefined>(titleProp);
  const [middleSpeakers, setMiddleSpeakers] = useState<string[] | undefined>(middleSpeakersProp);
  const [brandHandle]           = useState(() => delayRender('Loading brand'));
  const [fontHandle]            = useState(() => delayRender('Loading Nunito font'));
  const [assetsHandle]          = useState(() => delayRender('Loading thumbnail assets'));

  useEffect(() => {
    loadNunito().finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  useEffect(() => {
    fetch(staticFile(brandSrc))
      .then(r => r.json())
      .then(data => { setBrand(data); continueRender(brandHandle); })
      .catch(err => { console.error('PodcastThumbnail: brand load failed:', err); continueRender(brandHandle); });
  }, [brandSrc, brandHandle]);

  useEffect(() => {
    const transcriptFetch = hookTextProp
      ? Promise.resolve(null)
      : fetch(staticFile(transcriptSrc)).then(r => r.json()).catch(() => null);

    const manifestFetch = fetch(staticFile(manifestSrc))
      .then(r => r.json())
      .catch(() => null);

    Promise.all([transcriptFetch, manifestFetch]).then(([transcriptData, manifestData]) => {
      if (!hookTextProp && transcriptData) {
        setHookText(resolveHookText(transcriptData));
      }

      // Read thumbnail overrides from transcript.meta.thumbnail if not provided as props
      const thumb = transcriptData?.meta?.thumbnail;
      if (thumb) {
        if (!layoutVariantProp && thumb.layoutVariant) {
          setLayoutVariant(thumb.layoutVariant);
        }
        if (!backgroundSrcsProp && thumb.bg?.length) {
          setBackgroundSrcs(thumb.bg);
        }
        if (!titleProp && thumb.title) {
          setTitle(thumb.title);
        }
        if (!middleSpeakersProp && thumb.middleSpeakers?.length) {
          setMiddleSpeakers(thumb.middleSpeakers);
        }
      }

      if (manifestData) {
        setSpeakers(resolveSpeakers(manifestData, speakerNames, middleSpeakers ?? thumb?.middleSpeakers));
      } else {
        const fallback: SpeakerSlot[] = (speakerNames ?? ['Natasha', 'Saloni', 'Victoria']).map(n => ({
          name: n,
          cutoutSrc: `assets/team/${n.toLowerCase()}.PNG`,
          nameBg: NAME_BG[n] ?? '#eebf89',
        }));
        setSpeakers(fallback);
      }
      continueRender(assetsHandle);
    });
  }, [manifestSrc, transcriptSrc, hookTextProp, assetsHandle, middleSpeakers, layoutVariantProp, backgroundSrcsProp, titleProp, middleSpeakersProp]);

  if (!brand || !hookText || !speakers) return null;

  return (
    <PodcastThumbnail
      brand={brand}
      hookText={hookText}
      speakers={speakers}
      layoutVariant={layoutVariant}
      backgroundSrcs={backgroundSrcs}
      title={title}
      middleSpeakers={middleSpeakers}
    />
  );
};
