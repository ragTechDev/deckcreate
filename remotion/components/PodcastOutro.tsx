import React, { useState, useEffect } from 'react';
import {
  AbsoluteFill, Audio, Img, interpolate, interpolateColors, spring,
  staticFile, useCurrentFrame, useVideoConfig,
  delayRender, continueRender,
} from 'remotion';
import {
  IconBrandSpotify, IconBrandYoutube, IconBrandApple,
  IconBrandInstagram, IconBrandTiktok, IconBrandLinkedin,
  IconThumbUp, IconBell, IconHeart,
} from '@tabler/icons-react';
import type { Brand } from '../types/brand';
import { loadNunito } from '../loadFonts';

export const OUTRO_DURATION_FRAMES = 420; // 7 s @ 60 fps

// ── Timeline ──────────────────────────────────────────────────────────────────
const THANK_START   = 0;
const CTA_START     = 60;
const SOCIAL_START  = 120;
const HOSTS_START   = 200;
const LOGO_START    = 300;
const FADE_START    = 380;
const FADE_END      = 420;

// ── Layout constants ──────────────────────────────────────────────────────────
const VW = 1920;
const VH = 1080;

// Techybara
const TB_SIZE    = 280;
const TB_HALF_W  = 140;

// Logo
const LOGO_H     = 500;
const LOGO_CX    = VW / 2;
const LOGO_CY    = 450;

// Episode frames — 4 × 3 grid background
const EPISODES = [
  'assets/episodes/ep_10x.webp',
  'assets/episodes/ep_ai.jpg',
  'assets/episodes/ep_career.jpg',
  'assets/episodes/ep_career1.webp',
  'assets/episodes/ep_imposter.jpg',
  'assets/episodes/ep_introvert.webp',
  'assets/episodes/ep_joy.jpg',
  'assets/episodes/ep_leadership.webp',
  'assets/episodes/ep_martin.jpg',
  'assets/episodes/ep_martin1.webp',
  'assets/episodes/ep_promotion.jpg',
  'assets/episodes/ep_saloni.webp',
];

// ── Static data ───────────────────────────────────────────────────────────────
const COHOSTS = [
  {
    name: 'Natasha',  role: 'Software Engineer',  img: 'assets/team/natasha.PNG',
    cardLeft: 295, cardTop: 600, cardW: 320, photoH: 380,
    rotate: -3,  nameBg: '#eebf89',
  },
  {
    name: 'Saloni',   role: 'Software Developer',  img: 'assets/team/saloni.PNG',
    cardLeft: 800, cardTop: 580, cardW: 320, photoH: 400,
    rotate: 2,   nameBg: '#9cd2d0',
  },
  {
    name: 'Victoria', role: 'Solutions Engineer',  img: 'assets/team/victoria.PNG',
    cardLeft: 1305, cardTop: 600, cardW: 320, photoH: 380,
    rotate: -1.5, nameBg: '#ffa3a6',
  },
];

const SOCIAL = [
  { Icon: IconBrandYoutube,   label: 'Subscribe', color: '#FF0000', action: 'Subscribe' },
  { Icon: IconBrandSpotify,   label: 'Follow',    color: '#1DB954', action: 'Follow' },
  { Icon: IconBrandInstagram,  label: 'Follow',    color: '#E4405F', action: 'Follow' },
  { Icon: IconBrandTiktok,     label: 'Follow',    color: '#000000', action: 'Follow' },
  { Icon: IconBrandLinkedin,   label: 'Connect',   color: '#0A66C2', action: 'Connect' },
  { Icon: IconBrandApple,      label: 'Listen',    color: '#A3AAAE', action: 'Listen' },
];

const CTAS = [
  { icon: IconHeart, text: 'Like this video', color: '#eebf89' },
  { icon: IconBell, text: 'Turn on notifications', color: '#9cd2d0' },
  { icon: IconThumbUp, text: 'Share with friends', color: '#ffa3a6' },
];

// Floating background decorations
const FLOATS = [
  { kind: 'blob', x: 150,  y: 180, sz: 280, c: '#eebf89', op: 0.12, sp: 0.35, ph: 0    },
  { kind: 'blob', x: 1770, y: 780, sz: 320, c: '#9cd2d0', op: 0.11, sp: 0.30, ph: 1.2  },
  { kind: 'blob', x: 960,  y: 950, sz: 250, c: '#ffa3a6', op: 0.09, sp: 0.40, ph: 2.4  },
  { kind: 'dot',  x: 280,  y: 520, sz: 18,  c: '#eebf89', op: 0.50, sp: 0.55, ph: 0.5  },
  { kind: 'dot',  x: 1680, y: 195, sz: 14,  c: '#9cd2d0', op: 0.45, sp: 0.50, ph: 1.0  },
  { kind: 'dot',  x: 750,  y: 125, sz: 16,  c: '#ffa3a6', op: 0.42, sp: 0.45, ph: 1.8  },
  { kind: 'dot',  x: 1460, y: 485, sz: 12,  c: '#eebf89', op: 0.40, sp: 0.60, ph: 0.3  },
  { kind: 'star', x: 420,  y: 215, sz: 30,  c: '#eebf89', op: 0.60, sp: 0.28, ph: 0.7  },
  { kind: 'star', x: 1535, y: 655, sz: 26,  c: '#ffa3a6', op: 0.55, sp: 0.38, ph: 1.5  },
  { kind: 'star', x: 1160, y: 148, sz: 22,  c: '#9cd2d0', op: 0.50, sp: 0.32, ph: 2.0  },
  { kind: 'star', x: 185,  y: 745, sz: 24,  c: '#ffa3a6', op: 0.50, sp: 0.40, ph: 0.9  },
];

// ── Component ─────────────────────────────────────────────────────────────────
type Props = { brand: Brand };

export const PodcastOutro: React.FC<Props> = ({ brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors, typography, logo, shape } = brand;
  const tw = typography.weights;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function clamp(v0: number, v1: number, f0: number, f1: number) {
    return interpolate(frame, [f0, f1], [v0, v1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
  }
  function sp(delay: number, damping = 14, stiffness = 140) {
    return spring({ frame: Math.max(0, frame - delay), fps, config: { damping, stiffness } });
  }

  // ── Global fade-in ────────────────────────────────────────────────────────────
  const globalOp = clamp(0, 1, 0, 20);

  // ── Animated background colour ────────────────────────────────────────────────
  const bgColor = interpolateColors(
    frame,
    [0, 105, 210, 315, 420],
    [colors.background, colors.primary, colors.accent, colors.secondary, colors.background],
  );

  // ── Thank you message ─────────────────────────────────────────────────────────
  const thankProg = sp(THANK_START, 14, 100);
  const thankY    = interpolate(thankProg, [0, 1], [-60, 0]);
  const thankOp   = Math.min(1, thankProg * 2);

  // ── CTA cards ─────────────────────────────────────────────────────────────────
  const ctaProgs = CTAS.map((_, i) => sp(CTA_START + i * 15, 13, 120));

  // ── Social icons ─────────────────────────────────────────────────────────────
  const socialProg = sp(SOCIAL_START, 14, 110);
  const socialOp   = Math.min(1, socialProg * 2.5);

  // ── Host cards ─────────────────────────────────────────────────────────────────
  const hostProgs = COHOSTS.map((_, i) => sp(HOSTS_START + i * 20, 13, 120));

  // ── Logo ──────────────────────────────────────────────────────────────────────
  const logoProg  = sp(LOGO_START, 14, 100);
  const logoOp    = Math.min(1, logoProg * 2.5);
  const logoScale = interpolate(logoProg, [0, 1], [0.65, 1]);
  const logoY     = interpolate(logoProg, [0, 1], [80, 0]);

  // ── Techybara ─────────────────────────────────────────────────────────────────
  const techY = Math.sin((frame / fps) * Math.PI * 0.65) * 8;
  const techX = Math.cos((frame / fps) * Math.PI * 0.50) * 4;
  const techOp = clamp(1, 0, FADE_START - 30, FADE_START);

  return (
    <AbsoluteFill style={{
      background: '#000',
      fontFamily: typography.fontFamily,
      overflow: 'hidden',
    }}>

      {/* ── Episode grid background ──────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
      }}>
        {EPISODES.map((src, i) => (
          <Img
            key={i}
            src={staticFile(src)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'brightness(0.4) saturate(0.7)' }}
          />
        ))}
      </div>

      {/* Animated brand-colour overlay */}
      <div style={{ position: 'absolute', inset: 0, background: bgColor, opacity: 0.55 }} />

      {/* Audio */}
      <Audio
        src={staticFile('sounds/intro-outro-music.mp3')}
        volume={(f) => interpolate(f, [FADE_START, FADE_END], [0.85, 0], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        })}
      />

      {/* ── Floating background shapes ───────────────────────────────────────── */}
      {FLOATS.map((s, i) => {
        const fy = Math.sin((frame / fps) * Math.PI * s.sp + s.ph) * 12;
        const fx = Math.cos((frame / fps) * Math.PI * s.sp * 0.7 + s.ph) * 6;
        const base: React.CSSProperties = {
          position: 'absolute', left: s.x + fx, top: s.y + fy,
          opacity: s.op * globalOp, pointerEvents: 'none',
          transform: 'translate(-50%, -50%)',
        };
        if (s.kind === 'blob') return <div key={i} style={{ ...base, width: s.sz, height: s.sz, borderRadius: '50%', background: s.c, filter: 'blur(80px)' }} />;
        if (s.kind === 'dot')  return <div key={i} style={{ ...base, width: s.sz, height: s.sz, borderRadius: '50%', background: s.c }} />;
        return <span key={i} style={{ ...base, fontSize: s.sz, color: s.c, lineHeight: 1 }}>✦</span>;
      })}

      {/* ── Thank You Header ──────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        top: 80,
        left: 0, right: 0,
        textAlign: 'center',
        transform: `translateY(${thankY}px)`,
        opacity: thankOp,
        zIndex: 20,
      }}>
        <div style={{
          fontSize: 72,
          fontWeight: tw.bold,
          color: colors.text.onPrimary,
          textShadow: `0 4px 20px ${colors.primary}40`,
        }}>
          Thanks for listening!
        </div>
        <div style={{
          fontSize: 32,
          fontWeight: tw.regular,
          color: `${colors.text.onPrimary}CC`,
          marginTop: 16,
        }}>
          Don't miss our next episode
        </div>
      </div>

      {/* ── CTA Cards (Like, Notify, Share) ───────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        top: 240,
        left: 0, right: 0,
        display: 'flex',
        justifyContent: 'center',
        gap: 40,
        zIndex: 20,
      }}>
        {CTAS.map(({ icon: Icon, text, color }, i) => {
          const prog = ctaProgs[i];
          const y = interpolate(prog, [0, 1], [40, 0]);
          const scl = interpolate(prog, [0, 1], [0.85, 1]);
          const op = Math.min(1, prog * 2);
          return (
            <div key={text} style={{
              transform: `translateY(${y}px) scale(${scl})`,
              opacity: op,
            }}>
              <div style={{
                width: 220,
                padding: '24px 28px',
                background: 'rgba(255,255,255,0.95)',
                borderRadius: shape.borderRadius,
                border: `3px solid ${color}60`,
                boxShadow: `0 8px 32px ${color}30`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
              }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Icon size={32} color='white' strokeWidth={2} />
                </div>
                <span style={{
                  fontSize: 20,
                  fontWeight: tw.semiBold,
                  color: colors.text.onPrimary,
                  textAlign: 'center',
                }}>{text}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Social Icons Ring ─────────────────────────────────────────────────── */}
      {socialOp > 0 && (
        <div style={{
          position: 'absolute',
          top: 460,
          left: 0, right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 50,
          opacity: socialOp,
          zIndex: 20,
        }}>
          {SOCIAL.map(({ Icon, label, color, action }, i) => {
            const iconProg = sp(SOCIAL_START + i * 12, 14, 130);
            const iconScl = interpolate(iconProg, [0, 1], [0.6, 1]);
            const iconOp = Math.min(1, iconProg * 2.5);
            return (
              <div key={label} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                transform: `scale(${iconScl})`,
                opacity: iconOp,
              }}>
                <div style={{
                  width: 90,
                  height: 90,
                  borderRadius: '50%',
                  background: 'white',
                  border: `3px solid ${color}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 6px 24px ${color}40`,
                }}>
                  <Icon size={44} color={color} strokeWidth={1.5} />
                </div>
                <span style={{
                  fontSize: 16,
                  fontWeight: tw.bold,
                  color: colors.text.onPrimary,
                }}>{action}</span>
                <span style={{
                  fontSize: 14,
                  color: `${colors.text.onPrimary}88`,
                }}>{label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Host Cards (lower, smaller) ───────────────────────────────────────── */}
      {hostProgs.map((prog, i) => {
        const host = COHOSTS[i];
        const y = interpolate(prog, [0, 1], [50, 0]);
        const scl = interpolate(prog, [0, 1], [0.8, 1]);
        const op = Math.min(1, prog * 2.5);
        return (
          <div key={host.name} style={{
            position: 'absolute',
            left: host.cardLeft,
            top: host.cardTop,
            width: host.cardW,
            transform: `rotate(${host.rotate}deg) translateY(${y}px) scale(${scl})`,
            transformOrigin: 'center bottom',
            opacity: op,
            zIndex: 10,
          }}>
            <div style={{ position: 'relative', width: host.cardW, height: host.photoH }}>
              {/* Name pill */}
              <div style={{
                position: 'absolute', top: -22, left: '50%',
                transform: `translateX(-50%) rotate(${host.rotate * 0.5}deg)`,
                background: host.nameBg, borderRadius: 999,
                padding: '8px 22px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                zIndex: 10, whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: 22, fontWeight: tw.bold, color: colors.text.onPrimary }}>{host.name}</span>
              </div>

              {/* Photo */}
              <Img
                src={staticFile(host.img)}
                style={{
                  position: 'absolute', bottom: 0, left: '50%',
                  transform: 'translateX(-50%)',
                  height: host.photoH, width: '100%',
                  objectFit: 'contain', objectPosition: 'bottom',
                  filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.22))',
                }}
              />
            </div>
          </div>
        );
      })}

      {/* ── Techybara (bottom center) ────────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        left: VW / 2 - TB_HALF_W,
        bottom: 40,
        zIndex: 5,
        opacity: techOp,
        transform: `translate(${techX}px, ${techY}px)`,
      }}>
        <Img
          src={staticFile('assets/techybara/techybara-holding-laptop.png')}
          style={{
            height: TB_SIZE, objectFit: 'contain',
            filter: 'drop-shadow(0 12px 30px rgba(0,0,0,0.25))',
          }}
        />
      </div>

      {/* ── Logo Overlay (final moments) ─────────────────────────────────────── */}
      {logoOp > 0 && (
        <div style={{
          position: 'absolute',
          top: 60,
          left: 0, right: 0,
          display: 'flex',
          justifyContent: 'center',
          opacity: logoOp,
          zIndex: 50,
          transform: `translateY(${logoY}px)`,
        }}>
          <div style={{
            padding: '40px 80px',
            background: 'rgba(255,255,255,0.96)',
            borderRadius: shape.borderRadius * 1.5,
            boxShadow: `0 12px 60px ${colors.primary}40`,
          }}>
            <Img
              src={staticFile(logo.replace(/^\/+/, ''))}
              style={{
                height: LOGO_H,
                objectFit: 'contain',
                transform: `scale(${logoScale})`,
              }}
            />
            <div style={{
              textAlign: 'center',
              marginTop: 24,
              fontSize: 28,
              fontWeight: tw.bold,
              color: colors.text.onPrimary,
            }}>
              ragTech
            </div>
            <div style={{
              textAlign: 'center',
              marginTop: 8,
              fontSize: 18,
              fontWeight: tw.regular,
              color: `${colors.text.onPrimary}99`,
            }}>
              Conversations with REAL people in tech!
            </div>
          </div>
        </div>
      )}

    </AbsoluteFill>
  );
};

// ── Standalone Remotion Composition wrapper ───────────────────────────────────

type CompositionProps = { brandSrc?: string };

export const PodcastOutroComposition: React.FC<CompositionProps> = ({
  brandSrc = 'brand.json',
}) => {
  const [brand, setBrand]   = useState<Brand | null>(null);
  const [brandHandle]       = useState(() => delayRender('Loading brand'));
  const [fontHandle]        = useState(() => delayRender('Loading Nunito font'));

  useEffect(() => {
    fetch(staticFile(brandSrc))
      .then(r => r.json())
      .then(data => { setBrand(data); continueRender(brandHandle); })
      .catch(err => { console.error('PodcastOutro: brand load failed:', err); continueRender(brandHandle); });
  }, [brandSrc, brandHandle]);

  useEffect(() => {
    loadNunito().finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  if (!brand) return null;
  return <PodcastOutro brand={brand} />;
};
