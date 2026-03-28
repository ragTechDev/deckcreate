import React, { useState, useEffect } from 'react';
import {
  AbsoluteFill, Audio, Img, interpolate, interpolateColors, spring,
  staticFile, useCurrentFrame, useVideoConfig,
  delayRender, continueRender,
} from 'remotion';
import {
  IconBrandSpotify, IconBrandYoutube, IconBrandApple,
  IconBrandInstagram, IconBrandTiktok, IconBrandLinkedin,
} from '@tabler/icons-react';
import type { Brand } from '../types/brand';
import { loadNunito } from '../loadFonts';

export const INTRO_DURATION_FRAMES = 420; // 7 s @ 60 fps

// ── Timeline ──────────────────────────────────────────────────────────────────
const CMD             = 'npm run podcast'; // 15 chars
const FRAMES_PER_CHAR = 2;
const TYPING_START    = 110;
const ENTER_FRAME     = TYPING_START + CMD.length * FRAMES_PER_CHAR; // 140
const COLLAPSE_START  = ENTER_FRAME + 15;  // 155
const SPARKLY_START   = COLLAPSE_START + 20; // 175

// Cohost staggered load
const C_DELAY  = [217, 250, 307];
const C_LOAD_S = [225, 258, 315];
const C_LOAD_E = [263, 296, 353];
const C_CHECK  = [271, 304, 361];

// Terminal scroll events: each fires when a new line enters the bottom-bar viewport
const SCROLL_AT = [
  ENTER_FRAME + 30, // "Loading cohosts..." → scroll
  C_CHECK[0],       // ✓ Natasha → scroll
  C_CHECK[1],       // ✓ Saloni  → scroll
  C_CHECK[2],       // ✓ Victoria → scroll
];

const LOGO_END_START = 348;
const FADE_START     = 398;
const FADE_END       = 420;

// ── Layout constants ──────────────────────────────────────────────────────────
const VW = 1920;
const VH = 1080;

// Terminal – center phase
const TF_W = 1000;
const TF_T = 100;
const TF_L = (VW - TF_W) / 2; // 460

// Terminal – bottom bar
const TB_BAR_H      = 260;
const TB_BAR_T      = VH - TB_BAR_H; // 820
const BOTTOM_LINE_H = 88; // height of each terminal line in bottom mode

// Techybara
const TB_LARGE    = 460;
const TB_LARGE_HW = 200; // approx half-width when large
const TB_SMALL    = 185;
const TB_SMALL_W  = 163; // approx width when small (185 * 0.88 aspect estimate)

// Logo overlay icon circle
const LOGO_H     = 800; // 5× the previous 160 px
const ICON_R     = 490; // radius from logo center to icon center
const LOGO_CX    = VW / 2;
const LOGO_CY    = 560;

// ── Static data ───────────────────────────────────────────────────────────────
// Horizontal row, group centered: 390+60+430+60+390 = 1330 px → left = (1920-1330)/2 = 295
const COHOSTS = [
  {
    name: 'Natasha',  role: 'Software Engineer',  img: 'assets/team/natasha.PNG',
    cardLeft: 295, cardTop: 160, cardW: 390, photoH: 490,
    rotate: -3,  nameRotate: -2, nameBg: '#eebf89',
  },
  {
    name: 'Saloni',   role: 'Software Developer',  img: 'assets/team/saloni.PNG',
    cardLeft: 745, cardTop: 140, cardW: 430, photoH: 530,
    rotate: 2,   nameRotate: 2,  nameBg: '#9cd2d0',
  },
  {
    name: 'Victoria', role: 'Solutions Engineer',  img: 'assets/team/victoria.PNG',
    cardLeft: 1235, cardTop: 160, cardW: 390, photoH: 490,
    rotate: -1.5, nameRotate: -1, nameBg: '#ffa3a6',
  },
];

const SOCIAL = [
  { Icon: IconBrandSpotify,   label: 'Spotify'        },
  { Icon: IconBrandYoutube,   label: 'YouTube'        },
  { Icon: IconBrandApple,     label: 'Apple Podcasts' },
  { Icon: IconBrandInstagram, label: 'Instagram'      },
  { Icon: IconBrandTiktok,    label: 'TikTok'         },
  { Icon: IconBrandLinkedin,  label: 'LinkedIn'       },
];

// Floating background decorations
const FLOATS = [
  { kind: 'blob', x: 100,  y: 160, sz: 310, c: '#eebf89', op: 0.13, sp: 0.38, ph: 0    },
  { kind: 'blob', x: 1730, y: 740, sz: 350, c: '#9cd2d0', op: 0.12, sp: 0.32, ph: 1.2  },
  { kind: 'blob', x: 910,  y: 900, sz: 270, c: '#ffa3a6', op: 0.10, sp: 0.42, ph: 2.4  },
  { kind: 'dot',  x: 315,  y: 570, sz: 20,  c: '#eebf89', op: 0.55, sp: 0.60, ph: 0.5  },
  { kind: 'dot',  x: 1640, y: 205, sz: 16,  c: '#9cd2d0', op: 0.50, sp: 0.52, ph: 1.0  },
  { kind: 'dot',  x: 790,  y: 108, sz: 18,  c: '#ffa3a6', op: 0.48, sp: 0.48, ph: 1.8  },
  { kind: 'dot',  x: 1420, y: 475, sz: 14,  c: '#eebf89', op: 0.45, sp: 0.65, ph: 0.3  },
  { kind: 'dot',  x: 205,  y: 385, sz: 22,  c: '#9cd2d0', op: 0.45, sp: 0.46, ph: 2.1  },
  { kind: 'dot',  x: 1810, y: 440, sz: 12,  c: '#ffa3a6', op: 0.40, sp: 0.58, ph: 0.8  },
  { kind: 'star', x: 455,  y: 225, sz: 32,  c: '#eebf89', op: 0.65, sp: 0.30, ph: 0.7  },
  { kind: 'star', x: 1565, y: 640, sz: 28,  c: '#ffa3a6', op: 0.60, sp: 0.42, ph: 1.5  },
  { kind: 'star', x: 1190, y: 138, sz: 24,  c: '#9cd2d0', op: 0.55, sp: 0.36, ph: 2.0  },
  { kind: 'star', x: 158,  y: 755, sz: 26,  c: '#ffa3a6', op: 0.55, sp: 0.44, ph: 0.9  },
  { kind: 'star', x: 690,  y: 540, sz: 20,  c: '#eebf89', op: 0.50, sp: 0.50, ph: 1.4  },
];

// ── Component ─────────────────────────────────────────────────────────────────
type Props = { brand: Brand };

export const PodcastIntro: React.FC<Props> = ({ brand }) => {
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

  // ── Animated background colour — cycles through brand palette ─────────────────
  const bgColor = interpolateColors(
    frame,
    [0, 105, 210, 315, 420],
    [colors.background, colors.secondary, colors.accent, colors.primary, colors.background],
  );

  // ── Terminal ──────────────────────────────────────────────────────────────────
  const termRevealProg = sp(50, 16, 110);
  const termRevealY    = interpolate(termRevealProg, [0, 1], [-260, 0]);

  const collapseProg = sp(COLLAPSE_START, 16, 100);
  const termLeft     = interpolate(collapseProg, [0, 1], [TF_L, 0]);
  const termTop      = interpolate(collapseProg, [0, 1], [TF_T, TB_BAR_T]);
  const termWidth    = interpolate(collapseProg, [0, 1], [TF_W, VW]);
  const termPad      = interpolate(collapseProg, [0, 1], [28, 36]);

  // Text sizes: bigger in center, smaller in bottom bar
  const cmdFontSz  = interpolate(collapseProg, [0, 1], [48, 38]);
  const outFontSz  = interpolate(collapseProg, [0, 1], [42, 34]);
  const barFontSz  = interpolate(collapseProg, [0, 1], [36, 30]);
  const titleBarSz = interpolate(collapseProg, [0, 1], [18, 24]);

  // Each line's height in the content stack
  const lineH = interpolate(collapseProg, [0, 1], [40, BOTTOM_LINE_H]);

  // Terminal scroll: 4 springs, each advancing by lineH when a new line appears
  const scrollSprings = SCROLL_AT.map(f => sp(f, 18, 120));
  const scrollAmount  = scrollSprings.reduce((a, s) => a + s, 0) * lineH;

  // Viewport clips to 2 lines once the collapse is well underway
  const isBottomClip  = collapseProg > 0.65;
  const clipH         = isBottomClip
    ? interpolate(collapseProg, [0.65, 1], [9999, BOTTOM_LINE_H * 2], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 9999;

  // Typing
  const charsVisible = Math.min(CMD.length, Math.floor(Math.max(0, frame - TYPING_START) / FRAMES_PER_CHAR));
  const cmdText    = CMD.slice(0, charsVisible);
  const typingDone = charsVisible >= CMD.length;
  const cursorOn   = frame >= TYPING_START && frame < ENTER_FRAME + 20
    && Math.floor(frame / (typingDone ? 12 : 20)) % 2 === 0;

  // Enter flash
  const enterFlash = (frame >= ENTER_FRAME && frame <= ENTER_FRAME + 25)
    ? interpolate(frame, [ENTER_FRAME, ENTER_FRAME + 12, ENTER_FRAME + 25], [0, 0.45, 0], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      })
    : 0;

  // Output line opacities
  const line1Op = clamp(0, 1, ENTER_FRAME + 18, ENTER_FRAME + 32);
  const line2Op = clamp(0, 1, ENTER_FRAME + 30, ENTER_FRAME + 44);

  // ── Techybara ─────────────────────────────────────────────────────────────────
  const techRevealProg = sp(0, 14, 100);
  const techRevealOffY = interpolate(techRevealProg, [0, 1], [300, 0]);

  // Pushed down when terminal appears above
  const techCenterY = interpolate(termRevealProg, [0, 1], [VH / 2 - TB_LARGE / 2, TF_T + 310 + 40]);

  // After collapse: bottom-right, above terminal bar
  const techLeft   = interpolate(collapseProg, [0, 1], [VW / 2 - TB_LARGE_HW, VW - TB_SMALL_W - 40]);
  const techTop    = interpolate(collapseProg, [0, 1], [techCenterY, TB_BAR_T - TB_SMALL - 20]);
  const techHeight = interpolate(collapseProg, [0, 1], [TB_LARGE, TB_SMALL]);

  // Gentle float (dampens post-collapse)
  const floatAmp = interpolate(collapseProg, [0, 1], [1, 0.3]);
  const floatY   = Math.sin((frame / fps) * Math.PI * 0.65) * 10 * floatAmp;
  const floatX   = Math.cos((frame / fps) * Math.PI * 0.50) * 5  * floatAmp;

  // Sparkly eyes crossfade
  const sparklyOp = clamp(0, 1, SPARKLY_START, SPARKLY_START + 14);

  // ── Cohost data ───────────────────────────────────────────────────────────────
  const cohostData = COHOSTS.map((c, i) => ({
    ...c,
    loadProg: clamp(0, 1, C_LOAD_S[i], C_LOAD_E[i]),
    checkOp:  clamp(0, 1, C_CHECK[i],  C_CHECK[i] + 12),
    cardProg: sp(C_DELAY[i], 13, 130),
  }));

  // ── Logo end overlay ──────────────────────────────────────────────────────────
  const logoEndProg  = sp(LOGO_END_START, 14, 110);
  const logoEndOp    = Math.min(1, logoEndProg * 2.5);
  const logoEndScale = interpolate(logoEndProg, [0, 1], [0.72, 1]);

  return (
    <AbsoluteFill style={{
      background: bgColor,
      fontFamily: typography.fontFamily,
      overflow: 'hidden',
    }}>

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

      {/* ── Techybara (large center → small bottom-right) ────────────────────── */}
      <div style={{
        position: 'absolute',
        left: techLeft,
        top: techTop + techRevealOffY + floatY,
        zIndex: 15,
      }}>
        <Img
          src={staticFile('assets/techybara/techybara-holding-laptop.png')}
          style={{
            height: techHeight, objectFit: 'contain',
            opacity: globalOp * (1 - sparklyOp),
            filter: 'drop-shadow(0 16px 36px rgba(0,0,0,0.28))',
            transform: `translateX(${floatX}px)`,
          }}
        />
        <Img
          src={staticFile('assets/techybara/techybara-sparkle-eyes.png')}
          style={{
            position: 'absolute', top: 0, left: 0,
            height: techHeight, objectFit: 'contain',
            opacity: sparklyOp,
            filter: 'drop-shadow(0 16px 36px rgba(0,0,0,0.28))',
            transform: `translateX(${floatX}px)`,
          }}
        />
      </div>

      {/* ── Terminal window (center → bottom bar) ────────────────────────────── */}
      <div style={{
        position: 'absolute',
        left: termLeft, top: termTop, width: termWidth,
        transform: `translateY(${termRevealY}px)`,
        opacity: termRevealProg,
        zIndex: 20,
      }}>
        <div style={{ position: 'relative' }}>
          <div style={{
            background: colors.surface,
            borderRadius: interpolate(collapseProg, [0, 1], [shape.borderRadius, 0]),
            border: `1.5px solid ${colors.secondary}28`,
            boxShadow: '0 -4px 40px rgba(0,0,0,0.3), 0 20px 56px rgba(0,0,0,0.45)',
            overflow: 'hidden',
          }}>
            {/* Title bar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: `10px ${termPad}px`,
              background: `${colors.surface}F0`,
              borderBottom: `1px solid ${colors.secondary}20`,
            }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#FEBC2E', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840', display: 'inline-block', flexShrink: 0 }} />
              <span style={{
                flex: 1, textAlign: 'center',
                fontSize: titleBarSz, fontWeight: tw.semiBold,
                color: `${colors.text.secondary}88`, letterSpacing: '0.04em',
                overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                bash — podcast studio
              </span>
            </div>

            {/* Terminal body with 2-line viewport in bottom mode */}
            <div style={{ padding: `14px ${termPad}px` }}>
              {/* Clip container — limits to 2 lines once collapsed */}
              <div style={{
                overflow: isBottomClip ? 'hidden' : 'visible',
                height: isBottomClip ? clipH : 'auto',
              }}>
                {/* Scrollable line stack */}
                <div style={{ transform: `translateY(-${scrollAmount}px)` }}>

                  {/* Line 0: prompt + command */}
                  <div style={{ height: lineH, display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                    <span style={{ fontSize: cmdFontSz, fontWeight: tw.bold, color: colors.secondary, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      ~ ❯
                    </span>
                    <span style={{ fontSize: cmdFontSz, fontWeight: tw.semiBold, color: colors.primary, whiteSpace: 'nowrap' }}>
                      {cmdText}
                    </span>
                    {cursorOn && (
                      <span style={{
                        display: 'inline-block',
                        width: interpolate(collapseProg, [0, 1], [14, 10]),
                        height: interpolate(collapseProg, [0, 1], [32, 72]),
                        background: colors.primary, borderRadius: 2, flexShrink: 0,
                      }} />
                    )}
                  </div>

                  {/* Line 1: Starting... */}
                  <div style={{ height: lineH, display: 'flex', alignItems: 'center', gap: 10, opacity: line1Op }}>
                    <span style={{ fontSize: outFontSz, color: colors.secondary, flexShrink: 0 }}>❯</span>
                    <span style={{ fontSize: outFontSz, color: colors.text.primary, whiteSpace: 'nowrap' }}>
                      Starting ragTech podcast...
                    </span>
                  </div>

                  {/* Line 2: Loading cohosts... */}
                  <div style={{ height: lineH, display: 'flex', alignItems: 'center', gap: 10, opacity: line2Op }}>
                    <span style={{ fontSize: outFontSz, color: colors.secondary, flexShrink: 0 }}>❯</span>
                    <span style={{ fontSize: outFontSz, color: colors.text.primary, whiteSpace: 'nowrap' }}>
                      Loading cohosts...
                    </span>
                  </div>

                  {/* Lines 3–5: ✓ per cohost */}
                  {cohostData.map(({ name, checkOp }) => (
                    <div key={name} style={{ height: lineH, display: 'flex', alignItems: 'center', gap: 12, opacity: checkOp }}>
                      <span style={{ fontSize: outFontSz, color: colors.accent, fontWeight: tw.bold, flexShrink: 0 }}>✓</span>
                      <span style={{ fontSize: outFontSz, color: colors.text.primary, fontWeight: tw.semiBold, whiteSpace: 'nowrap' }}>
                        {name}
                      </span>
                      <span style={{ fontSize: barFontSz, color: `${colors.text.primary}44`, whiteSpace: 'nowrap' }}>
                        loaded
                      </span>
                    </div>
                  ))}

                </div>
              </div>
            </div>
          </div>

          {/* Enter flash */}
          {enterFlash > 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              borderRadius: interpolate(collapseProg, [0, 1], [shape.borderRadius, 0]),
              background: 'white', opacity: enterFlash, pointerEvents: 'none',
            }} />
          )}
        </div>
      </div>

      {/* ── Cohost cards — large horizontal row ──────────────────────────────── */}
      {cohostData.map(({ name, role, img, cardLeft, cardTop, cardW, photoH, rotate, nameRotate, nameBg, loadProg, cardProg }, i) => {
        const cardY   = interpolate(cardProg, [0, 1], [55, 0]);
        const cardScl = interpolate(cardProg, [0, 1], [0.78, 1]);
        const cardOp  = Math.min(1, cardProg * 2.5);
        return (
          <div key={name} style={{
            position: 'absolute',
            left: cardLeft, top: cardTop, width: cardW,
            zIndex: 10,
            transform: `rotate(${rotate}deg) translateY(${cardY}px) scale(${cardScl})`,
            transformOrigin: 'center bottom',
            opacity: cardOp,
          }}>
            <div style={{ position: 'relative', width: cardW, height: photoH }}>
              {/* Name pill */}
              <div style={{
                position: 'absolute', top: -26, left: '50%',
                transform: `translateX(-50%) rotate(${nameRotate}deg)`,
                background: nameBg, borderRadius: 999,
                padding: '9px 26px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                zIndex: 10, whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: 26, fontWeight: tw.bold, color: colors.text.onPrimary }}>{name}</span>
              </div>

              {/* Photo */}
              <Img
                src={staticFile(img)}
                style={{
                  position: 'absolute', bottom: 0, left: '50%',
                  transform: 'translateX(-50%)',
                  height: photoH, width: '100%',
                  objectFit: 'contain', objectPosition: 'bottom',
                  filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.22))',
                }}
              />

              {/* Role label */}
              <div style={{
                position: 'absolute', bottom: -22, left: '50%',
                transform: `translateX(-50%) rotate(${-nameRotate * 0.6}deg)`,
                background: 'rgba(255,255,255,0.94)',
                borderRadius: 999,
                border: `2px solid ${nameBg}`,
                padding: '6px 18px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
                whiteSpace: 'nowrap', zIndex: 10,
              }}>
                <span style={{ fontSize: 17, fontWeight: tw.semiBold, color: '#1a1206' }}>{role}</span>
              </div>
            </div>

            {/* Loading bar */}
            <div style={{ width: '100%', height: 5, borderRadius: 999, background: `${nameBg}2A`, overflow: 'hidden', marginTop: 36 }}>
              <div style={{ height: '100%', width: `${loadProg * 100}%`, borderRadius: 999, background: `linear-gradient(90deg, ${nameBg}88, ${nameBg})` }} />
            </div>
          </div>
        );
      })}

      {/* ── Logo end overlay — logo only, icons in hexagonal ring ────────────── */}
      {logoEndOp > 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          zIndex: 100, pointerEvents: 'none',
        }}>
          {/* Soft backdrop glow centred on logo */}
          <div style={{
            position: 'absolute',
            left: LOGO_CX, top: LOGO_CY,
            transform: 'translate(-50%, -50%)',
            width: 1000, height: 1000,
            borderRadius: '50%',
            background: bgColor,
            filter: 'blur(70px)',
            opacity: logoEndOp * 0.92,
          }} />

          {/* Logo image */}
          <Img
            src={staticFile(logo.replace(/^\/+/, ''))}
            style={{
              position: 'absolute',
              left: LOGO_CX, top: LOGO_CY,
              transform: `translate(-50%, -50%) scale(${logoEndScale})`,
              height: LOGO_H,
              objectFit: 'contain',
              opacity: logoEndOp,
              filter: `drop-shadow(0 0 40px ${colors.primary}66)`,
            }}
          />

          {/* Social icons — hexagonal ring around logo */}
          {SOCIAL.map(({ Icon, label }, i) => {
            const angle    = (-90 + i * 60) * (Math.PI / 180); // start top, clockwise
            const ix       = LOGO_CX + ICON_R * Math.cos(angle);
            const iy       = LOGO_CY + ICON_R * Math.sin(angle);
            const iconProg = sp(LOGO_END_START + i * 10, 14, 130);
            const iconOp   = Math.min(1, iconProg * 2.5) * logoEndOp;
            const iconScl  = interpolate(iconProg, [0, 1], [0, 1]);
            return (
              <div key={label} style={{
                position: 'absolute',
                left: ix, top: iy,
                transform: `translate(-50%, -50%) scale(${iconScl})`,
                opacity: iconOp,
              }}>
                <div style={{
                  width: 72, height: 72,
                  borderRadius: '50%',
                  background: `${colors.surface}CC`,
                  border: `2px solid ${colors.secondary}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 4px 20px rgba(0,0,0,0.3)`,
                }}>
                  <Icon size={38} color={colors.text.secondary} strokeWidth={1.5} />
                </div>
              </div>
            );
          })}
        </div>
      )}

    </AbsoluteFill>
  );
};

// ── Standalone Remotion Composition wrapper ───────────────────────────────────

type CompositionProps = { brandSrc?: string };

export const PodcastIntroComposition: React.FC<CompositionProps> = ({
  brandSrc = 'brand.json',
}) => {
  const [brand, setBrand]   = useState<Brand | null>(null);
  const [brandHandle]       = useState(() => delayRender('Loading brand'));
  const [fontHandle]        = useState(() => delayRender('Loading Nunito font'));

  useEffect(() => {
    fetch(staticFile(brandSrc))
      .then(r => r.json())
      .then(data => { setBrand(data); continueRender(brandHandle); })
      .catch(err => { console.error('PodcastIntro: brand load failed:', err); continueRender(brandHandle); });
  }, [brandSrc, brandHandle]);

  useEffect(() => {
    loadNunito().finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  if (!brand) return null;
  return <PodcastIntro brand={brand} />;
};
