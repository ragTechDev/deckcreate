import { useState, useCallback, useEffect } from 'react';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 80;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

interface NavState { zoom: number; pan: number; }

export interface UseTimelineNavOptions {
  totalDuration: number;
  currentTime: number;
  isPlaying: boolean;
  videoStart?: number;
  videoEnd?: number;
}

export function useTimelineNav({
  totalDuration: total,
  currentTime,
  isPlaying,
  videoStart,
  videoEnd,
}: UseTimelineNavOptions) {
  const [nav, setNav] = useState<NavState>({ zoom: 1, pan: 0 });

  /** Zoom anchored to cursor. ratio = cursorX / canvasWidth (0-1). */
  const zoomAt = useCallback((ratio: number, newZoom: number) => {
    setNav(prev => {
      const clamped = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
      const cursorTime = prev.pan + ratio * (total / prev.zoom);
      const newVisDur = total / clamped;
      return {
        zoom: clamped,
        pan: clamp(cursorTime - ratio * newVisDur, 0, Math.max(0, total - newVisDur)),
      };
    });
  }, [total]);

  /** Apply a multiplicative zoom factor around the cursor. */
  const zoomBy = useCallback((ratio: number, factor: number) => {
    setNav(prev => {
      const newZoom = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const cursorTime = prev.pan + ratio * (total / prev.zoom);
      const newVisDur = total / newZoom;
      return {
        zoom: newZoom,
        pan: clamp(cursorTime - ratio * newVisDur, 0, Math.max(0, total - newVisDur)),
      };
    });
  }, [total]);

  /** Pan by a delta in seconds. */
  const panBy = useCallback((deltaSec: number) => {
    setNav(prev => {
      const visDur = total / prev.zoom;
      return { ...prev, pan: clamp(prev.pan + deltaSec, 0, Math.max(0, total - visDur)) };
    });
  }, [total]);

  /** Pan to an absolute position in seconds. */
  const panTo = useCallback((targetPan: number) => {
    setNav(prev => {
      const visDur = total / prev.zoom;
      return { ...prev, pan: clamp(targetPan, 0, Math.max(0, total - visDur)) };
    });
  }, [total]);

  /** Set both zoom and pan atomically (used by Timeline's onZoomChange). */
  const setZoomAndPan = useCallback((zoom: number, pan: number) => {
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    setNav({ zoom: z, pan: clamp(pan, 0, Math.max(0, total - total / z)) });
  }, [total]);

  /** Show entire video. */
  const fitAll = useCallback(() => setNav({ zoom: 1, pan: 0 }), []);

  /** Fit videoStart–videoEnd with 5% padding on each side. */
  const fitContent = useCallback(() => {
    const start = videoStart ?? 0;
    const end = videoEnd ?? total;
    const dur = end - start;
    if (dur <= 0) { fitAll(); return; }
    const pad = dur * 0.05;
    const z = clamp(total / (dur + pad * 2), MIN_ZOOM, MAX_ZOOM);
    setNav({ zoom: z, pan: clamp(start - pad, 0, Math.max(0, total - total / z)) });
  }, [total, videoStart, videoEnd, fitAll]);

  /** Jump to a named zoom preset. */
  const zoomToPreset = useCallback((preset: 'full' | 'clips' | 'frames') => {
    if (preset === 'full') { fitAll(); return; }
    if (preset === 'clips') { fitContent(); return; }
    // 'frames': maximum zoom centred on current time
    setNav(prev => {
      const z = MAX_ZOOM;
      const visDur = total / z;
      return { zoom: z, pan: clamp(currentTime - visDur * 0.35, 0, Math.max(0, total - visDur)) };
    });
  }, [fitAll, fitContent, currentTime, total]);

  // ── Auto-follow: keep playhead at 35% during playback ─────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    setNav(prev => {
      const visDur = total / prev.zoom;
      const ratio = (currentTime - prev.pan) / visDur;
      // Only reposition when playhead drifts outside 8–72% window
      if (ratio >= 0.08 && ratio <= 0.72) return prev;
      return { ...prev, pan: clamp(currentTime - 0.35 * visDur, 0, Math.max(0, total - visDur)) };
    });
  }, [currentTime, isPlaying, total]);

  return {
    zoom: nav.zoom,
    pan: nav.pan,
    zoomAt,
    zoomBy,
    panBy,
    panTo,
    setZoomAndPan,
    fitAll,
    fitContent,
    zoomToPreset,
  };
}
