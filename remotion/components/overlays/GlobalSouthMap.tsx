import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Img,
  staticFile,
} from 'remotion';
import type { Brand } from '../../types/brand';

// ── Animation constants ───────────────────────────────────────────────────────
const OPEN_FRAMES    = 36;
const CLOSE_FRAMES   = 24;
const ZOOM_LEVEL     = 2.8;
const WORLD_INTRO_F  = 30;   // frames showing full world before first pan
const WORLD_OUTRO_F  = 60;   // frames panning back to world overview
// Per-region timing: min/max bounds; actual values scale to fit durationInFrames.
const PAN_F_MIN      = 20;
const PAN_F_MAX      = 50;
const HOLD_F_MIN     = 40;
const HOLD_F_MAX     = 90;

/** Vivid per-region accent colours (Asia, Middle East, Latin America, Africa). */
const REGION_COLORS = ['#FF6B35', '#FFD700', '#00BCD4', '#66BB6A'] as const;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface RegionConfig {
  name: string;
  /** Horizontal focus point, 0-1 (fraction of map width from left). */
  focusX: number;
  /** Vertical focus point, 0-1 (fraction of map height from top). */
  focusY: number;
}

export interface GlobalSouthMapProps {
  brand: Brand;
  durationInFrames: number;
  /**
   * World-map image path.
   * Pass an absolute URL or a path relative to /public (no leading slash).
   * The image should use a Mercator projection so the default region positions
   * match accurately. Recommended ratio: 2:1 (e.g. 2000 × 1000 px).
   */
  src: string;
  regions?: RegionConfig[];
}

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_REGIONS: RegionConfig[] = [
  { name: 'Asia',          focusX: 0.73, focusY: 0.29 },
  { name: 'Middle East',   focusX: 0.57, focusY: 0.36 },
  { name: 'Latin America', focusX: 0.27, focusY: 0.62 },
  { name: 'Africa',        focusX: 0.50, focusY: 0.56 },
];

/**
 * Returns the minimum recommended durationInFrames for this overlay
 * to show all regions comfortably at default timing.
 */
export function globalSouthMapMinDuration(regionCount = DEFAULT_REGIONS.length): number {
  return (
    OPEN_FRAMES +
    WORLD_INTRO_F +
    regionCount * (PAN_F_MAX + HOLD_F_MAX) +
    WORLD_OUTRO_F +
    CLOSE_FRAMES
  );
}

/**
 * Derive per-region pan/hold frame counts that fit within the given durationInFrames.
 * Scales the timing down proportionally rather than dropping regions, as long as
 * the minimum per-region budget (PAN_F_MIN + HOLD_F_MIN) is met.
 */
function deriveRegionTiming(
  durationInFrames: number,
  regionCount: number,
): { panF: number; holdF: number } {
  const contentFrames   = durationInFrames - OPEN_FRAMES - CLOSE_FRAMES;
  const overhead        = WORLD_INTRO_F + WORLD_OUTRO_F;
  const available       = Math.max(0, contentFrames - overhead);
  const perRegion       = regionCount > 0 ? Math.floor(available / regionCount) : 0;
  const clampedPerRegion = Math.max(PAN_F_MIN + HOLD_F_MIN, Math.min(PAN_F_MAX + HOLD_F_MAX, perRegion));
  // Split ~35% pan, ~65% hold, respecting individual min/max.
  const panF  = Math.min(PAN_F_MAX,  Math.max(PAN_F_MIN,  Math.round(clampedPerRegion * 0.35)));
  const holdF = Math.min(HOLD_F_MAX, Math.max(HOLD_F_MIN, clampedPerRegion - panF));
  return { panF, holdF };
}

// ── Camera maths ──────────────────────────────────────────────────────────────
interface Camera {
  fx: number;   // focus x (0-1)
  fy: number;   // focus y (0-1)
  zoom: number;
}

interface FrameState {
  cam: Camera;
  /** Index of the currently-held region (null = world view or mid-pan). */
  activeIdx: number | null;
  /**
   * How far into the current hold phase we are (0 = just arrived, 1 = done).
   * 0 during pans and world views.
   */
  holdProgress: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getFrameState(
  contentFrame: number,
  regions: RegionConfig[],
  panF: number,
  holdF: number,
): FrameState {
  let f = contentFrame;

  // ── World intro ────────────────────────────────────────────────────────────
  if (f < WORLD_INTRO_F) {
    return { cam: { fx: 0.5, fy: 0.5, zoom: 1 }, activeIdx: null, holdProgress: 0 };
  }
  f -= WORLD_INTRO_F;

  // ── Region sequence ───────────────────────────────────────────────────────
  for (let i = 0; i < regions.length; i++) {
    const fromFx   = i === 0 ? 0.5      : regions[i - 1].focusX;
    const fromFy   = i === 0 ? 0.5      : regions[i - 1].focusY;
    const fromZoom = i === 0 ? 1        : ZOOM_LEVEL;
    const { focusX: toFx, focusY: toFy } = regions[i];

    // Pan phase
    if (f < panF) {
      const t = easeInOutCubic(f / panF);
      return {
        cam: {
          fx:   lerp(fromFx,   toFx,      t),
          fy:   lerp(fromFy,   toFy,      t),
          zoom: lerp(fromZoom, ZOOM_LEVEL, t),
        },
        activeIdx: null,
        holdProgress: 0,
      };
    }
    f -= panF;

    // Hold phase
    if (f < holdF) {
      return {
        cam: { fx: toFx, fy: toFy, zoom: ZOOM_LEVEL },
        activeIdx: i,
        holdProgress: f / holdF,
      };
    }
    f -= holdF;
  }

  // ── Pan back to world ──────────────────────────────────────────────────────
  if (regions.length === 0) {
    return { cam: { fx: 0.5, fy: 0.5, zoom: 1 }, activeIdx: null, holdProgress: 1 };
  }
  const last = regions[regions.length - 1];
  if (f < WORLD_OUTRO_F) {
    const t = easeInOutCubic(f / WORLD_OUTRO_F);
    return {
      cam: {
        fx:   lerp(last.focusX, 0.5, t),
        fy:   lerp(last.focusY, 0.5, t),
        zoom: lerp(ZOOM_LEVEL,  1,   t),
      },
      activeIdx: null,
      holdProgress: 0,
    };
  }

  return { cam: { fx: 0.5, fy: 0.5, zoom: 1 }, activeIdx: null, holdProgress: 1 };
}

// ── Component ─────────────────────────────────────────────────────────────────
export const GlobalSouthMap: React.FC<GlobalSouthMapProps> = ({
  brand,
  durationInFrames,
  src,
  regions = DEFAULT_REGIONS,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: videoWidth, height: videoHeight } = useVideoConfig();
  const { colors: _c, typography } = brand;

  // ── Slide in / out (whole panel slides up from below) ──────────────────────
  const openP = spring({ frame, fps, config: { damping: 18, stiffness: 80, mass: 0.8 } });
  const closeP = spring({
    frame: Math.max(0, frame - (durationInFrames - CLOSE_FRAMES)),
    fps,
    config: { damping: 20, stiffness: 100 },
  });
  const isClosing  = frame >= durationInFrames - CLOSE_FRAMES;
  const slideY     = interpolate(
    isClosing ? 1 - closeP : openP,
    [0, 1],
    [videoHeight, 0],
  );

  // ── Adaptive per-region timing ────────────────────────────────────────────
  const { panF, holdF } = deriveRegionTiming(durationInFrames, regions.length);

  // ── Camera state ──────────────────────────────────────────────────────────
  const contentFrame              = Math.max(0, frame - OPEN_FRAMES);
  const { cam, activeIdx, holdProgress } = getFrameState(contentFrame, regions, panF, holdF);

  // scale(z) translate(tx, ty) with transform-origin:center keeps the focus
  // point visually centred: tx = (0.5 - fx)*100%, ty = (0.5 - fy)*100%.
  const mapTransform = `scale(${cam.zoom}) translate(${(0.5 - cam.fx) * 100}%, ${(0.5 - cam.fy) * 100}%)`;

  // ── Pulse on active dot ───────────────────────────────────────────────────
  const pulse = 1 + Math.sin((frame / 20) * Math.PI) * 0.07;

  // ── Derived UI state ──────────────────────────────────────────────────────
  const isWorldView = activeIdx === null && cam.zoom < 1.2;

  // Region label: fades in over the first 22% of each hold phase
  const zoomedLabelOpacity = interpolate(holdProgress, [0, 0.22], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const zoomedLabelScale = interpolate(holdProgress, [0, 0.22], [0.88, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // World-view labels: fade in as zoom returns to 1 (range must be increasing)
  const worldLabelOpacity = interpolate(cam.zoom, [1.0, 1.35], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Pass the raw path to staticFile — it handles its own URL encoding internally.
  // Pre-encoding (e.g. encodeURI) causes double-encoding (%20 → %2520).
  const resolvedSrc = src.startsWith('http') ? src : staticFile(src);

  return (
    // Fullscreen panel: starts below the viewport, slides up on open
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: videoWidth,
        height: videoHeight,
        transform: `translateY(${slideY}px)`,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {/* ── Map layer — fills 100% × 100% ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: '#0d1f3c',
          overflow: 'hidden',
        }}
      >
        {/* Pan/zoom layer */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: mapTransform,
            transformOrigin: 'center center',
          }}
        >
          {/* Map image — explicit pixel dimensions so objectFit has a reference */}
          <Img
            src={resolvedSrc}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: videoWidth,
              height: videoHeight,
              objectFit: 'cover',
            }}
          />

          {/* Region dot markers (live in map space so they zoom with the camera) */}
          {regions.map((region, i) => {
            const isActive = activeIdx === i;
            return (
              <div
                key={region.name}
                style={{
                  position: 'absolute',
                  left: `${region.focusX * 100}%`,
                  top:  `${region.focusY * 100}%`,
                  width: 16,
                  height: 16,
                  transform: `translate(-50%, -50%) scale(${isActive ? pulse : 1})`,
                  borderRadius: '50%',
                  backgroundColor: REGION_COLORS[i],
                  border: '3px solid #ffffff',
                  boxShadow: `0 0 ${isActive ? 20 : 8}px ${REGION_COLORS[i]}`,
                }}
              />
            );
          })}
        </div>

        {/* ── Thin bottom gradient for legibility ── */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 320,
            background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 100%)',
          }}
        />
      </div>

      {/* ── Zoomed-in region label (fixed to screen, appears during hold) ── */}
      {activeIdx !== null && (
        <div
          style={{
            position: 'absolute',
            bottom: 160,
            left: '50%',
            transform: `translateX(-50%) scale(${zoomedLabelScale})`,
            opacity: zoomedLabelOpacity,
          }}
        >
          <div
            style={{
              backgroundColor: REGION_COLORS[activeIdx],
              color: '#ffffff',
              fontFamily: typography.fontFamily,
              fontSize: 72,
              fontWeight: 800,
              padding: '24px 72px',
              borderRadius: 56,
              whiteSpace: 'nowrap',
              letterSpacing: '0.02em',
              boxShadow: `0 8px 48px ${REGION_COLORS[activeIdx]}88`,
            }}
          >
            {regions[activeIdx].name}
          </div>
        </div>
      )}

      {/* ── World-view floating labels (near each pin) ── */}
      {isWorldView && regions.map((region, i) => (
        <div
          key={region.name}
          style={{
            position: 'absolute',
            left: `${region.focusX * 100}%`,
            top:  `${region.focusY * 100}%`,
            transform: 'translate(-50%, -52px)',
            opacity: worldLabelOpacity,
          }}
        >
          <div
            style={{
              backgroundColor: REGION_COLORS[i] + 'dd',
              color: '#ffffff',
              fontFamily: typography.fontFamily,
              fontSize: 26,
              fontWeight: 700,
              padding: '8px 20px',
              borderRadius: 24,
              whiteSpace: 'nowrap',
              boxShadow: `0 2px 12px rgba(0,0,0,0.4)`,
            }}
          >
            {region.name}
          </div>
        </div>
      ))}

      {/* ── Bottom bar: progress pills + caption ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 48,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        {/* Progress pills */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {regions.map((region, i) => {
            const isActive     = activeIdx === i;
            const pastThreshF  = WORLD_INTRO_F + (i + 1) * (panF + holdF);
            const isPast       = !isActive && contentFrame > pastThreshF;
            const arriveStartF = WORLD_INTRO_F + i * (panF + holdF);
            const fadeFrames   = Math.max(1, Math.min(20, Math.floor(panF * 0.4)));
            const pillOpacity  = interpolate(
              contentFrame,
              [arriveStartF, arriveStartF + fadeFrames],
              [0, 1],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            );

            return (
              <div
                key={region.name}
                style={{
                  padding: '10px 28px',
                  borderRadius: 28,
                  backgroundColor: isActive
                    ? REGION_COLORS[i]
                    : isPast
                    ? REGION_COLORS[i] + '44'
                    : 'rgba(255,255,255,0.12)',
                  border: `2px solid ${REGION_COLORS[i]}`,
                  color: isActive ? '#ffffff' : REGION_COLORS[i],
                  fontFamily: typography.fontFamily,
                  fontSize: 28,
                  fontWeight: isActive ? 700 : 500,
                  whiteSpace: 'nowrap',
                  opacity: pillOpacity,
                }}
              >
                {region.name}
              </div>
            );
          })}
        </div>

        {/* Caption */}
        <div
          style={{
            fontFamily: typography.fontFamily,
            fontSize: 28,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          Global South ·{' '}
          <span style={{ color: _c.primary, fontWeight: 700 }}>
            75% of world population
          </span>
        </div>
      </div>
    </div>
  );
};
