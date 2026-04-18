'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { Box, Text } from '@mantine/core';
import type { Transcript, TimeCut } from '../../remotion/types/transcript';
import {
  CANVAS_H, RULER_H, TRACK_H, TRACK_GAP, TRIM_W, N_TRACKS, CLIP_PAD,
  TimelineDrawState, drawTimeline, timeToX, trackClipTop,
} from './timelineCanvas';

// ─── Constants ────────────────────────────────────────────────────────────────
const SNAP_PX = 8;
const TRIM_SNAP_S = 0.1;
const MIN_ZOOM = 1;
const MAX_ZOOM = 80;
const EDGE_ZONE = 55;          // px from canvas edge that triggers auto-scroll
const EDGE_MAX_SPD = 14;       // max seconds/second auto-scroll speed
const MINIMAP_H = 10;

export function fmtTimecode(s: number, fps: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s % 1) * fps);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ─── Types ────────────────────────────────────────────────────────────────────
export type TimelineProps = {
  transcript: Transcript;
  speakerColors: Record<string, string>;
  visualCuts: Map<number, TimeCut[]>;
  currentTime: number;
  totalDuration: number;
  zoom: number;
  panOffset: number;
  markIn: number | null;
  onSeek: (t: number) => void;
  onZoomChange: (newZoom: number, newPan: number) => void;
  onPanChange: (newPan: number) => void;
  onAddVisualCut: (segId: number, cut: TimeCut) => void;
};

type TrimDrag = { segId: number; side: 'left' | 'right'; segStart: number; segEnd: number };
type TrimPreview = { segId: number; side: 'left' | 'right'; time: number };
type AutoScroll = { dir: -1 | 1; speed: number };

// ─── Component ────────────────────────────────────────────────────────────────
export const Timeline: React.FC<TimelineProps> = ({
  transcript, speakerColors, visualCuts, currentTime, totalDuration: total,
  zoom, panOffset, markIn, onSeek, onZoomChange, onPanChange, onAddVisualCut,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Stable value refs (updated every render, read from effects/handlers) ──
  const onSeekRef = useRef(onSeek); onSeekRef.current = onSeek;
  const onPanChangeRef = useRef(onPanChange); onPanChangeRef.current = onPanChange;
  const onAddVisualCutRef = useRef(onAddVisualCut); onAddVisualCutRef.current = onAddVisualCut;
  const onZoomChangeRef = useRef(onZoomChange); onZoomChangeRef.current = onZoomChange;
  const panOffsetRef = useRef(panOffset); panOffsetRef.current = panOffset;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const totalRef = useRef(total); totalRef.current = total;
  const transcriptRef = useRef(transcript); transcriptRef.current = transcript;
  const speakerColorsRef = useRef(speakerColors); speakerColorsRef.current = speakerColors;
  const visualCutsRef = useRef(visualCuts); visualCutsRef.current = visualCuts;
  const markInRef = useRef(markIn); markInRef.current = markIn;

  // ── Drag / interaction refs ───────────────────────────────────────────────
  const playheadDragRef = useRef(false);
  const panDragRef = useRef<{ startX: number; startPan: number } | null>(null);
  const trimDragRef = useRef<TrimDrag | null>(null);
  const trimPreviewRef = useRef<TrimPreview | null>(null);
  const autoScrollRef = useRef<AutoScroll | null>(null);
  const snapGuideRef = useRef<number | null>(null);
  const hoverSegIdRef = useRef<number | null>(null);
  const selectedSegIdRef = useRef<number | null>(null);

  // ── Draw state (mutated in-place, never replaced) ─────────────────────────
  const drawStateRef = useRef<TimelineDrawState>({
    width: 800, visStart: 0, visDur: total / zoom, total,
    fps: transcript.meta.fps ?? 60,
    videoStart: transcript.meta.videoStart ?? 0, videoEnd: transcript.meta.videoEnd ?? total,
    segments: transcript.segments, speakerColors, visualCuts,
    currentTime, markIn: null, snapGuideTime: null, trimPreview: null,
    hoverSegId: null, selectedSegId: null, activeDrag: null,
  });

  // Sync draw state with latest React props (runs before RAF fires)
  const ds = drawStateRef.current;
  ds.visStart = panOffset;
  ds.visDur = total / zoom;
  ds.total = total;
  ds.fps = transcript.meta.fps ?? 60;
  ds.videoStart = transcript.meta.videoStart ?? 0;
  ds.videoEnd = transcript.meta.videoEnd ?? total;
  ds.segments = transcript.segments;
  ds.speakerColors = speakerColors;
  ds.visualCuts = visualCuts;
  ds.currentTime = currentTime;
  ds.markIn = markIn;

  // ── RAF render loop ───────────────────────────────────────────────────────
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const loop = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        // Auto-scroll: advance panOffset in the loop itself for butter-smooth feel
        if (autoScrollRef.current) {
          const { dir, speed } = autoScrollRef.current;
          const visDur = totalRef.current / zoomRef.current;
          const newPan = clamp(
            panOffsetRef.current + dir * speed / 60,
            0,
            Math.max(0, totalRef.current - visDur),
          );
          if (newPan !== panOffsetRef.current) {
            panOffsetRef.current = newPan;
            drawStateRef.current.visStart = newPan;
            onPanChangeRef.current(newPan);
          }
        }
        drawStateRef.current.width = container.offsetWidth;
        drawTimeline(canvas, drawStateRef.current);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // stable: all state read from refs

  // ── Non-passive wheel on canvas (prevents browser page zoom) ─────────────
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const t = totalRef.current;
      if (!t) return;
      const rect = el.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const newZoom = clamp(zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_ZOOM, MAX_ZOOM);
      const cursorTime = panOffsetRef.current + ratio * (t / zoomRef.current);
      const newPan = clamp(cursorTime - ratio * (t / newZoom), 0, Math.max(0, t - t / newZoom));
      onZoomChangeRef.current(newZoom, newPan);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // stable

  // ── Coordinate helpers ────────────────────────────────────────────────────
  const clientXToTime = useCallback((clientX: number): number => {
    const el = canvasRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return clamp(panOffsetRef.current + ratio * (totalRef.current / zoomRef.current), 0, totalRef.current);
  }, []);

  const snapToGrid = useCallback((t: number): { time: number; snapped: number | null } => {
    const el = canvasRef.current;
    if (!el) return { time: t, snapped: null };
    const visDur = totalRef.current / zoomRef.current;
    const pxPerSec = el.offsetWidth / visDur;
    const threshSec = SNAP_PX / pxPerSec;
    let nearest = t;
    let nearestDist = threshSec;
    let snapTarget: number | null = null;
    const meta = transcriptRef.current.meta;
    for (const b of [meta.videoStart ?? 0, meta.videoEnd ?? totalRef.current]) {
      const d = Math.abs(b - t);
      if (d < nearestDist) { nearest = b; nearestDist = d; snapTarget = b; }
    }
    for (const seg of transcriptRef.current.segments) {
      for (const b of [seg.start, seg.end]) {
        const d = Math.abs(b - t);
        if (d < nearestDist) { nearest = b; nearestDist = d; snapTarget = b; }
      }
    }
    return { time: nearest, snapped: snapTarget };
  }, []);

  // ── Hit-test helpers ──────────────────────────────────────────────────────
  const hitTestCanvas = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const visDur = totalRef.current / zoomRef.current;

    // Ruler zone → playhead handle
    if (cy <= RULER_H + 8) {
      const phX = timeToX(drawStateRef.current.currentTime, drawStateRef.current);
      if (Math.abs(cx - phX) <= 9) return { type: 'playhead' as const };
      return { type: 'ruler' as const };
    }

    // Check each video track segment for trim handles
    const trackIdx = Math.floor((cy - RULER_H) / (TRACK_H + TRACK_GAP));
    if (trackIdx !== 0) return null; // trim only on video track
    const clipTop = trackClipTop(0);
    const clipBot = clipTop + (TRACK_H - CLIP_PAD * 2);
    if (cy < clipTop || cy > clipBot) return null;

    for (const seg of transcriptRef.current.segments) {
      if (seg.cut) continue;
      const sx = ((seg.start - panOffsetRef.current) / visDur) * el.offsetWidth;
      const ex = ((seg.end - panOffsetRef.current) / visDur) * el.offsetWidth;
      if (cx < sx - TRIM_W || cx > ex + TRIM_W) continue;
      if (cx <= sx + TRIM_W) return { type: 'trimLeft' as const, seg };
      if (cx >= ex - TRIM_W) return { type: 'trimRight' as const, seg };
      if (cx >= sx && cx <= ex) return { type: 'segment' as const, seg };
    }
    return null;
  }, []);

  // Update cursor style based on hover
  const updateCursor = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return;
    if (playheadDragRef.current || trimDragRef.current) return; // keep drag cursor
    const hit = hitTestCanvas(clientX, clientY);
    if (!hit) { el.style.cursor = 'crosshair'; return; }
    if (hit.type === 'playhead' || hit.type === 'ruler') { el.style.cursor = 'ew-resize'; return; }
    if (hit.type === 'trimLeft' || hit.type === 'trimRight') { el.style.cursor = 'ew-resize'; return; }
    if (hit.type === 'segment') { el.style.cursor = 'pointer'; return; }
    el.style.cursor = panDragRef.current ? 'grabbing' : (zoomRef.current > 1 ? 'grab' : 'crosshair');
  }, [hitTestCanvas]);

  // Update auto-scroll based on cursor position during active drag
  const updateAutoScroll = useCallback((clientX: number) => {
    const el = canvasRef.current;
    if (!el) return;
    if (!playheadDragRef.current && !trimDragRef.current) {
      autoScrollRef.current = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    const fromLeft = clientX - rect.left;
    const fromRight = rect.right - clientX;
    if (fromLeft < EDGE_ZONE) {
      autoScrollRef.current = { dir: -1, speed: ((EDGE_ZONE - fromLeft) / EDGE_ZONE) * EDGE_MAX_SPD };
    } else if (fromRight < EDGE_ZONE) {
      autoScrollRef.current = { dir: 1, speed: ((EDGE_ZONE - fromRight) / EDGE_ZONE) * EDGE_MAX_SPD };
    } else {
      autoScrollRef.current = null;
    }
  }, []);

  // ── Global mouse handlers (registered once) ───────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      updateAutoScroll(e.clientX);

      if (playheadDragRef.current) {
        const { time, snapped } = snapToGrid(clientXToTime(e.clientX));
        drawStateRef.current.currentTime = time;
        drawStateRef.current.snapGuideTime = snapped;
        snapGuideRef.current = snapped;
        onSeekRef.current(time);
        return;
      }

      if (trimDragRef.current) {
        const raw = clientXToTime(e.clientX);
        const snapped = Math.round(raw / TRIM_SNAP_S) * TRIM_SNAP_S;
        const p: TrimPreview = { segId: trimDragRef.current.segId, side: trimDragRef.current.side, time: snapped };
        trimPreviewRef.current = p;
        drawStateRef.current.trimPreview = p;
        return;
      }

      if (panDragRef.current) {
        const visDur = totalRef.current / zoomRef.current;
        const el = canvasRef.current;
        const pxPerSec = (el?.offsetWidth ?? 1) / visDur;
        const newPan = clamp(
          panDragRef.current.startPan - (e.clientX - panDragRef.current.startX) / pxPerSec,
          0,
          Math.max(0, totalRef.current - visDur),
        );
        panOffsetRef.current = newPan;
        drawStateRef.current.visStart = newPan;
        onPanChangeRef.current(newPan);
      }
    };

    const onUp = (e: MouseEvent) => {
      autoScrollRef.current = null;

      if (playheadDragRef.current) {
        playheadDragRef.current = false;
        drawStateRef.current.activeDrag = null;
        drawStateRef.current.snapGuideTime = null;
        snapGuideRef.current = null;
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
        return;
      }

      if (trimDragRef.current) {
        const p = trimPreviewRef.current;
        if (p) {
          const { segId, side, segStart, segEnd } = trimDragRef.current;
          const t = clamp(p.time, segStart, segEnd);
          if (side === 'left' && t > segStart + 0.05) {
            onAddVisualCutRef.current(segId, { from: segStart, to: t });
          } else if (side === 'right' && t < segEnd - 0.05) {
            onAddVisualCutRef.current(segId, { from: t, to: segEnd });
          }
        }
        trimDragRef.current = null;
        trimPreviewRef.current = null;
        drawStateRef.current.trimPreview = null;
        drawStateRef.current.activeDrag = null;
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
        return;
      }

      if (panDragRef.current) {
        if (Math.abs(e.clientX - panDragRef.current.startX) < 4) {
          // Click = seek + snap
          const { time, snapped } = snapToGrid(clientXToTime(e.clientX));
          drawStateRef.current.currentTime = time;
          onSeekRef.current(time);
          // Brief snap guide flash
          if (snapped !== null) {
            drawStateRef.current.snapGuideTime = snapped;
            setTimeout(() => { drawStateRef.current.snapGuideTime = null; }, 400);
          }
        }
        panDragRef.current = null;
        drawStateRef.current.activeDrag = null;
        if (canvasRef.current) canvasRef.current.style.cursor = zoomRef.current > 1 ? 'grab' : 'crosshair';
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clientXToTime, snapToGrid, updateAutoScroll]); // stable callbacks

  // ── Canvas mousedown (hit-test entry point) ───────────────────────────────
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const hit = hitTestCanvas(e.clientX, e.clientY);

    if (hit?.type === 'playhead' || hit?.type === 'ruler') {
      playheadDragRef.current = true;
      drawStateRef.current.activeDrag = 'playhead';
      if (canvasRef.current) canvasRef.current.style.cursor = 'ew-resize';
      return;
    }

    if (hit?.type === 'trimLeft' && hit.seg) {
      trimDragRef.current = { segId: hit.seg.id, side: 'left', segStart: hit.seg.start, segEnd: hit.seg.end };
      drawStateRef.current.activeDrag = 'trim';
      if (canvasRef.current) canvasRef.current.style.cursor = 'ew-resize';
      return;
    }

    if (hit?.type === 'trimRight' && hit.seg) {
      trimDragRef.current = { segId: hit.seg.id, side: 'right', segStart: hit.seg.start, segEnd: hit.seg.end };
      drawStateRef.current.activeDrag = 'trim';
      if (canvasRef.current) canvasRef.current.style.cursor = 'ew-resize';
      return;
    }

    if (hit?.type === 'segment' && hit.seg) {
      const wasSelected = selectedSegIdRef.current === hit.seg.id;
      selectedSegIdRef.current = wasSelected ? null : hit.seg.id;
      drawStateRef.current.selectedSegId = selectedSegIdRef.current;
    }

    panDragRef.current = { startX: e.clientX, startPan: panOffsetRef.current };
    drawStateRef.current.activeDrag = 'pan';
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
  }, [hitTestCanvas]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    updateCursor(e.clientX, e.clientY);
    // Update hover
    const hit = hitTestCanvas(e.clientX, e.clientY);
    const hovId = hit?.type === 'segment' || hit?.type === 'trimLeft' || hit?.type === 'trimRight'
      ? hit.seg?.id ?? null : null;
    if (hovId !== hoverSegIdRef.current) {
      hoverSegIdRef.current = hovId;
      drawStateRef.current.hoverSegId = hovId;
    }
  }, [updateCursor, hitTestCanvas]);

  const handleCanvasMouseLeave = useCallback(() => {
    hoverSegIdRef.current = null;
    drawStateRef.current.hoverSegId = null;
  }, []);

  // ── Minimap click ─────────────────────────────────────────────────────────
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const ratio = (e.clientX - el.getBoundingClientRect().left) / el.offsetWidth;
    const visDur = total / zoom;
    const newPan = clamp(ratio * total - visDur / 2, 0, Math.max(0, total - visDur));
    onPanChange(newPan);
  }, [total, zoom, onPanChange]);

  // ── Derived render values ─────────────────────────────────────────────────
  const visibleDuration = total / zoom;

  return (
    <Box ref={containerRef} style={{ userSelect: 'none' }}>

      {/* ── Canvas ── */}
      <Box style={{ position: 'relative', height: CANVAS_H, borderRadius: 6, overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: CANVAS_H, cursor: 'crosshair' }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
        />
      </Box>

      {/* ── Minimap ── */}
      {zoom > 1 && (
        <Box
          onClick={handleMinimapClick}
          style={{
            position: 'relative', height: MINIMAP_H, marginTop: 2,
            background: '#0d0e10', borderRadius: 3, overflow: 'hidden', cursor: 'pointer',
          }}
        >
          {transcript.segments.map(seg => (
            <Box key={seg.id} style={{
              position: 'absolute',
              left: `${(seg.start / total) * 100}%`,
              width: `${Math.max((seg.end - seg.start) / total * 100, 0.05)}%`,
              top: 1, height: MINIMAP_H - 2,
              background: seg.cut ? '#333' : (speakerColors[seg.speaker] ?? '#888'),
              opacity: seg.cut ? 0.15 : 0.45, borderRadius: 1,
            }} />
          ))}
          {/* Viewport window */}
          <Box style={{
            position: 'absolute',
            left: `${(panOffset / total) * 100}%`,
            width: `${(visibleDuration / total) * 100}%`,
            top: 0, height: '100%',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.28)',
            borderRadius: 2, pointerEvents: 'none',
          }} />
          {/* Playhead */}
          <Box style={{
            position: 'absolute',
            left: `${(currentTime / total) * 100}%`,
            top: 0, width: 1, height: '100%',
            background: 'rgba(255,255,255,0.7)', pointerEvents: 'none',
          }} />
        </Box>
      )}

      {/* ── Track labels legend ── */}
      <Box style={{ display: 'flex', gap: 8, marginTop: 6, paddingLeft: 2 }}>
        {[...Array(N_TRACKS)].map((_, ti) => (
          <Text key={ti} size="xs" style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, fontFamily: 'monospace' }}>
            {ti === 0 ? 'VID — speaker segments + visual cuts' : 'AUD — token-derived cuts from doc'}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
