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
  frameSrc?: string;
};

export type ThumbnailCompositionProps = {
  manifestSrc?: string;      // default: 'transcribe/output/thumbnail/manifest.json'
  transcriptSrc?: string;    // default: 'transcribe/output/edit/transcript.json'
  brandSrc?: string;         // default: 'brand.json'
  hookText?: string;         // override: skips transcript fetch
  speakerNames?: string[];   // subset to show (default: all in manifest)
  layoutVariant?: 'left' | 'right' | 'center';
  frameSrc?: string;         // optional blurred video frame bg (relative to /public)
};

// ── Constants ─────────────────────────────────────────────────────────────────

const NAME_BG: Record<string, string> = {
  Natasha:  '#eebf89',
  Saloni:   '#9cd2d0',
  Victoria: '#ffa3a6',
};

// Scaled-down version of PodcastIntro FLOATS for 1280×720 canvas (ratio ~0.667)
const FLOATS = [
  { kind: 'blob', x: 67,   y: 107, sz: 207, c: '#eebf89', op: 0.13 },
  { kind: 'blob', x: 1155, y: 493, sz: 234, c: '#9cd2d0', op: 0.12 },
  { kind: 'blob', x: 607,  y: 600, sz: 180, c: '#ffa3a6', op: 0.10 },
  { kind: 'dot',  x: 210,  y: 380, sz: 13,  c: '#eebf89', op: 0.55 },
  { kind: 'dot',  x: 1094, y: 137, sz: 11,  c: '#9cd2d0', op: 0.50 },
  { kind: 'dot',  x: 527,  y: 72,  sz: 12,  c: '#ffa3a6', op: 0.48 },
  { kind: 'star', x: 303,  y: 150, sz: 21,  c: '#eebf89', op: 0.65 },
  { kind: 'star', x: 1044, y: 427, sz: 19,  c: '#ffa3a6', op: 0.60 },
  { kind: 'star', x: 794,  y: 92,  sz: 16,  c: '#9cd2d0', op: 0.55 },
  { kind: 'star', x: 105,  y: 503, sz: 17,  c: '#ffa3a6', op: 0.55 },
];

const TERMINAL_W = 560;
const CANVAS_W   = 1280;
const CANVAS_H   = 720;

// ── Hook text resolution (also used in generate-thumbnail.js) ─────────────────

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

  return truncate4(transcript.meta?.title ?? 'RAG Tech Podcast');
}

function resolveSpeakers(
  manifest: Record<string, { cutout: string }>,
  speakerNames?: string[],
): SpeakerSlot[] {
  const names = speakerNames?.length ? speakerNames : Object.keys(manifest);
  return names
    .filter(n => manifest[n])
    .map(n => ({
      name: n,
      cutoutSrc: manifest[n].cutout,
      nameBg: NAME_BG[n] ?? '#eebf89',
    }));
}

// ── Hook text font size ───────────────────────────────────────────────────────

function hookFontSize(text: string): number {
  const words = text.trim().split(/\s+/).length;
  if (words <= 1) return 80;
  if (words === 2) return 68;
  if (words === 3) return 58;
  return 48;
}

// ── Terminal panel ────────────────────────────────────────────────────────────

function TerminalPanel({
  brand, hookText, speakers, panelLeft,
}: {
  brand: Brand;
  hookText: string;
  speakers: SpeakerSlot[];
  panelLeft: number;
}) {
  const { colors, typography } = brand;
  const tw = typography.weights;

  return (
    <div style={{
      position: 'absolute',
      left: panelLeft,
      top: 0,
      width: TERMINAL_W,
      height: CANVAS_H,
      zIndex: 20,
    }}>
      <div style={{
        background: '#1e1e1e',
        borderRight: panelLeft === 0 ? `1.5px solid ${colors.secondary}40` : undefined,
        borderLeft:  panelLeft !== 0 ? `1.5px solid ${colors.secondary}40` : undefined,
        boxShadow: '4px 0 32px rgba(0,0,0,0.30)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Title bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 24px',
          height: 44,
          background: '#252526',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57', display: 'inline-block' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E', display: 'inline-block' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840', display: 'inline-block' }} />
          <span style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 16,
            fontWeight: tw.semiBold,
            color: '#44444488',
            letterSpacing: '0.04em',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}>
            bash — rag tech podcast
          </span>
        </div>

        {/* Terminal body */}
        <div style={{
          flex: 1,
          padding: '28px 28px 80px',
          position: 'relative',
          overflow: 'hidden',
        }}>

          {/* Prompt line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{
              fontSize: 26,
              fontWeight: tw.bold,
              color: colors.secondary,
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            }}>
              ~ ❯
            </span>
            <span style={{
              fontSize: 26,
              fontWeight: tw.semiBold,
              color: '#e0e0e0',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            }}>
              npm run podcast
            </span>
          </div>

          {/* Output prefix */}
          <div style={{
            fontSize: 20,
            color: '#555',
            fontFamily: 'monospace',
            marginBottom: 8,
          }}>
            &gt;&#47;&#47;
          </div>

          {/* Hook text */}
          <div style={{
            fontSize: hookFontSize(hookText),
            fontWeight: tw.black ?? 900,
            color: colors.primary,
            lineHeight: 1.15,
            maxWidth: TERMINAL_W - 56,
            wordBreak: 'break-word',
            fontFamily: typography.fontFamily,
          }}>
            {hookText}
          </div>

          {/* Blinking cursor (static-on for thumbnail) */}
          <span style={{
            display: 'inline-block',
            width: 10,
            height: Math.max(36, hookFontSize(hookText) * 0.6),
            background: colors.accent,
            borderRadius: 2,
            opacity: 0.9,
            marginTop: 8,
            verticalAlign: 'middle',
          }} />

          {/* Speaker name badges — bottom of terminal */}
          <div style={{
            position: 'absolute',
            bottom: 28,
            left: 28,
            right: 28,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}>
            {speakers.map(s => (
              <div key={s.name} style={{
                background: s.nameBg,
                borderRadius: 999,
                padding: '5px 14px',
                whiteSpace: 'nowrap',
              }}>
                <span style={{
                  fontSize: 17,
                  fontWeight: tw.bold,
                  color: colors.background,
                  fontFamily: typography.fontFamily,
                }}>
                  {s.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Speaker cutout positions ──────────────────────────────────────────────────

function getSpeakerPositions(
  count: number,
  zoneLeft: number,
  zoneWidth: number,
): Array<{ left: number; height: number }> {
  if (count === 1) {
    return [{ left: zoneLeft + zoneWidth / 2 - 160, height: 660 }];
  }
  if (count === 2) {
    const gap = zoneWidth / 3;
    return [
      { left: zoneLeft + gap * 0.3,       height: 620 },
      { left: zoneLeft + gap * 0.3 + 240, height: 620 },
    ];
  }
  // 3 speakers
  const step = zoneWidth / 3.2;
  return [
    { left: zoneLeft + step * 0,  height: 580 },
    { left: zoneLeft + step * 1,  height: 620 },
    { left: zoneLeft + step * 2,  height: 580 },
  ];
}

// ── Main presentational component ─────────────────────────────────────────────

export const PodcastThumbnail: React.FC<ThumbnailInnerProps> = ({
  brand, hookText, speakers, layoutVariant, frameSrc,
}) => {
  const { colors } = brand;

  const panelLeft = layoutVariant === 'right' ? CANVAS_W - TERMINAL_W : 0;
  const speakerZoneLeft  = layoutVariant === 'right' ? 0         : TERMINAL_W - 60;
  const speakerZoneWidth = layoutVariant === 'right' ? CANVAS_W - TERMINAL_W + 60 : CANVAS_W - TERMINAL_W + 60;

  // For 'center' variant with 2 speakers: terminal centered, speakers flank
  const isCenterVariant = layoutVariant === 'center';
  const centerPanelLeft = Math.round((CANVAS_W - TERMINAL_W) / 2);

  const positions = isCenterVariant && speakers.length === 2
    ? [{ left: 20, height: 620 }, { left: CANVAS_W - 320, height: 620 }]
    : getSpeakerPositions(
        speakers.length,
        isCenterVariant ? 0 : speakerZoneLeft,
        isCenterVariant ? CANVAS_W : speakerZoneWidth,
      );

  return (
    <AbsoluteFill style={{
      background: colors.background,
      fontFamily: brand.typography.fontFamily,
      overflow: 'hidden',
    }}>

      {/* ── Background layer ──────────────────────────────────────────────────── */}
      {frameSrc ? (
        <Img
          src={staticFile(frameSrc)}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            filter: 'blur(18px) brightness(0.6)',
            transform: 'scale(1.05)',
            opacity: 0.22,
          }}
        />
      ) : (
        FLOATS.map((s, i) => {
          const base: React.CSSProperties = {
            position: 'absolute', left: s.x, top: s.y,
            opacity: s.op, pointerEvents: 'none',
            transform: 'translate(-50%, -50%)',
          };
          if (s.kind === 'blob') return (
            <div key={i} style={{ ...base, width: s.sz, height: s.sz, borderRadius: '50%', background: s.c, filter: 'blur(60px)' }} />
          );
          if (s.kind === 'dot') return (
            <div key={i} style={{ ...base, width: s.sz, height: s.sz, borderRadius: '50%', background: s.c }} />
          );
          return <span key={i} style={{ ...base, fontSize: s.sz, color: s.c, lineHeight: 1 }}>✦</span>;
        })
      )}

      {/* ── Terminal panel ────────────────────────────────────────────────────── */}
      <TerminalPanel
        brand={brand}
        hookText={hookText}
        speakers={speakers}
        panelLeft={isCenterVariant ? centerPanelLeft : panelLeft}
      />

      {/* ── Speaker cutouts ───────────────────────────────────────────────────── */}
      {speakers.map((speaker, i) => {
        const pos = positions[i];
        if (!pos) return null;
        return (
          <div key={speaker.name} style={{
            position: 'absolute',
            left: pos.left,
            bottom: 0,
            height: pos.height,
            zIndex: i === 1 ? 12 : 10,  // center speaker on top
          }}>
            <Img
              src={staticFile(speaker.cutoutSrc)}
              style={{
                height: pos.height,
                objectFit: 'contain',
                objectPosition: 'bottom center',
                filter: 'drop-shadow(0 20px 48px rgba(0,0,0,0.50))',
              }}
            />
          </div>
        );
      })}

    </AbsoluteFill>
  );
};

// ── Standalone composition wrapper ────────────────────────────────────────────

export const PodcastThumbnailComposition: React.FC<ThumbnailCompositionProps> = ({
  manifestSrc  = 'transcribe/output/thumbnail/manifest.json',
  transcriptSrc = 'transcribe/output/edit/transcript.json',
  brandSrc     = 'brand.json',
  hookText: hookTextProp,
  speakerNames,
  layoutVariant = 'left',
  frameSrc,
}) => {
  const [brand, setBrand]         = useState<Brand | null>(null);
  const [hookText, setHookText]   = useState<string | null>(hookTextProp ?? null);
  const [speakers, setSpeakers]   = useState<SpeakerSlot[] | null>(null);
  const [brandHandle]             = useState(() => delayRender('Loading brand'));
  const [fontHandle]              = useState(() => delayRender('Loading Nunito font'));
  const [assetsHandle]            = useState(() => delayRender('Loading thumbnail assets'));

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
      if (manifestData) {
        setSpeakers(resolveSpeakers(manifestData, speakerNames));
      } else {
        // Fallback: show static team images if manifest not yet generated
        const fallback: SpeakerSlot[] = (speakerNames ?? ['Natasha', 'Saloni', 'Victoria']).map(n => ({
          name: n,
          cutoutSrc: `assets/team/${n.toLowerCase()}.PNG`,
          nameBg: NAME_BG[n] ?? '#eebf89',
        }));
        setSpeakers(fallback);
      }
      continueRender(assetsHandle);
    });
  }, [manifestSrc, transcriptSrc, hookTextProp, assetsHandle]);

  if (!brand || !hookText || !speakers) return null;

  return (
    <PodcastThumbnail
      brand={brand}
      hookText={hookText}
      speakers={speakers}
      layoutVariant={layoutVariant}
      frameSrc={frameSrc}
    />
  );
};
