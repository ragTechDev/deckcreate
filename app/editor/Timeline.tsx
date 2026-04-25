'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { Box, Text } from '@mantine/core';
import type { Transcript, TimeCut, CameraCue } from '../../remotion/types/transcript';
import type { CameraProfiles } from '../../remotion/types/camera';
import {
  CANVAS_H, RULER_H, TRACK_H, TRACK_GAP, TRIM_W, N_TRACKS, CLIP_PAD,
  CAM_TRACK_Y, CAM_TRACK_H, CAM_HANDLE_HIT,
  TimelineDrawState, drawTimeline, timeToX, trackClipTop, buildCamRegions,
} from './timelineCanvas';
import { TimelineScrollbar } from './TimelineScrollbar';
import { MIN_ZOOM, MAX_ZOOM } from './useTimelineNav';

// ─── Constants ────────────────────────────────────────────────────────────────
const SNAP_PX = 8;
const TRIM_SNAP_S = 0.1;
const EDGE_ZONE = 55;          // px from edge that triggers auto-scroll
const EDGE_MAX_SPD = 14;       // max seconds/second
const MINIMAP_H = 10;
const EASE_TAU = 38;           // ms — animation time constant (~120ms settle)

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
  // Camera
  cameraProfiles?: CameraProfiles | null;
  cameraCues?: Map<number, CameraCue[]>;
  onCueMoved?: (segId: number, cueIdx: number, newAt: number) => void;
  onCueAdded?: (segId: number, at: number, shot: 'closeup' | 'wide', speaker?: string) => void;
  onCueDeleted?: (segId: number, cueIdx: number) => void;
};

type TrimDrag = { segId: number; side: 'left' | 'right'; segStart: number; segEnd: number };
type TrimPreview = { segId: number; side: 'left' | 'right'; time: number };
type AutoScroll = { dir: -1 | 1; speed: number };
type CueDrag = { segId: number; cueIdx: number; segStart: number; segEnd: number; prevBound: number; nextBound: number };

// ─── Component ────────────────────────────────────────────────────────────────
export const Timeline: React.FC<TimelineProps> = ({
  transcript, speakerColors, visualCuts, currentTime, totalDuration: total,
  zoom, panOffset, markIn, onSeek, onZoomChange, onPanChange, onAddVisualCut,
  cameraProfiles, cameraCues: cameraCuesProp, onCueMoved, onCueAdded, onCueDeleted,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Target value refs (reflect latest props; animation chases these) ──────
  const onSeekRef = useRef(onSeek); onSeekRef.current = onSeek;
  const onPanChangeRef = useRef(onPanChange); onPanChangeRef.current = onPanChange;
  const onAddVisualCutRef = useRef(onAddVisualCut); onAddVisualCutRef.current = onAddVisualCut;
  const onZoomChangeRef = useRef(onZoomChange); onZoomChangeRef.current = onZoomChange;
  const onCueMovedRef = useRef(onCueMoved); onCueMovedRef.current = onCueMoved;
  const onCueAddedRef = useRef(onCueAdded); onCueAddedRef.current = onCueAdded;
  const onCueDeletedRef = useRef(onCueDeleted); onCueDeletedRef.current = onCueDeleted;
  const panOffsetRef = useRef(panOffset); panOffsetRef.current = panOffset;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const totalRef = useRef(total); totalRef.current = total;
  const transcriptRef = useRef(transcript); transcriptRef.current = transcript;
  const speakerColorsRef = useRef(speakerColors); speakerColorsRef.current = speakerColors;
  const visualCutsRef = useRef(visualCuts); visualCutsRef.current = visualCuts;
  const cameraCuesRef = useRef<Map<number, CameraCue[]>>(cameraCuesProp ?? new Map());
  cameraCuesRef.current = cameraCuesProp ?? new Map();
  const cameraProfilesRef = useRef<CameraProfiles | null>(cameraProfiles ?? null);
  cameraProfilesRef.current = cameraProfiles ?? null;

  // ── Animated (current) values — the RAF loop advances these ──────────────
  const animZoomRef = useRef(zoom);
  const animPanRef = useRef(panOffset);
  const animVisDurRef = useRef(total / zoom); // derived: kept in sync in RAF
  const lastFrameTimeRef = useRef(0);

  // ── Drag / interaction refs ───────────────────────────────────────────────
  const playheadDragRef = useRef(false);
  const panDragRef = useRef<{ startX: number; startPan: number } | null>(null);
  const trimDragRef = useRef<TrimDrag | null>(null);
  const trimPreviewRef = useRef<TrimPreview | null>(null);
  const cueDragRef = useRef<CueDrag | null>(null);
  const autoScrollRef = useRef<AutoScroll | null>(null);
  const hoverSegIdRef = useRef<number | null>(null);
  const selectedSegIdRef = useRef<number | null>(null);

  // ── Draw state (mutated in-place each frame by the RAF loop) ─────────────
  const drawStateRef = useRef<TimelineDrawState>({
    width: 800, visStart: animPanRef.current, visDur: animVisDurRef.current, total,
    fps: transcript.meta.fps ?? 60,
    videoStart: transcript.meta.videoStart ?? 0, videoEnd: transcript.meta.videoEnd ?? total,
    segments: transcript.segments, speakerColors, visualCuts,
    currentTime, markIn: null, snapGuideTime: null, trimPreview: null,
    hoverSegId: null, selectedSegId: null, activeDrag: null,
    cameraCues: cameraCuesProp ?? new Map(),
    cameraProfiles: cameraProfiles ?? null,
    hoveredCueHandle: null,
    cueDragOverlay: null,
  });

  // Keep non-animated fields fresh every render so the RAF loop picks them up
  const ds = drawStateRef.current;
  ds.total = total;
  ds.fps = transcript.meta.fps ?? 60;
  ds.videoStart = transcript.meta.videoStart ?? 0;
  ds.videoEnd = transcript.meta.videoEnd ?? total;
  ds.segments = transcript.segments;
  ds.speakerColors = speakerColors;
  ds.visualCuts = visualCuts;
  ds.currentTime = currentTime;
  ds.markIn = markIn;
  ds.cameraCues = cameraCuesProp ?? new Map();
  ds.cameraProfiles = cameraProfiles ?? null;

  // ── RAF loop ──────────────────────────────────────────────────────────────
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const loop = (ts: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        // Delta time, capped at 50ms to avoid huge jumps after tab backgrounding
        const dt = lastFrameTimeRef.current ? Math.min(ts - lastFrameTimeRef.current, 50) : 16;
        lastFrameTimeRef.current = ts;
        const k = 1 - Math.exp(-dt / EASE_TAU); // easing coefficient

        // ── Auto-scroll (instant — direct mutation for crisp response) ──
        if (autoScrollRef.current) {
          const { dir, speed } = autoScrollRef.current;
          const visDur = totalRef.current / animZoomRef.current;
          const newPan = clamp(
            animPanRef.current + dir * speed / 60,
            0,
            Math.max(0, totalRef.current - visDur),
          );
          animPanRef.current = newPan;
          panOffsetRef.current = newPan;
          onPanChangeRef.current(newPan);
        }

        // ── Smooth zoom + pan animation (only when not actively dragging) ──
        if (!panDragRef.current) {
          animZoomRef.current += (zoomRef.current - animZoomRef.current) * k;
          if (Math.abs(animZoomRef.current - zoomRef.current) < 0.0002) {
            animZoomRef.current = zoomRef.current;
          }
          animPanRef.current += (panOffsetRef.current - animPanRef.current) * k;
          if (Math.abs(animPanRef.current - panOffsetRef.current) < 0.0002) {
            animPanRef.current = panOffsetRef.current;
          }
        }

        // Update derived animated visDur for hit-testing
        animVisDurRef.current = totalRef.current / animZoomRef.current;

        // Write animated values into draw state
        drawStateRef.current.visStart = animPanRef.current;
        drawStateRef.current.visDur = animVisDurRef.current;
        drawStateRef.current.width = container.offsetWidth;

        drawTimeline(canvas, drawStateRef.current);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // stable: all mutable state read from refs

  // ── Non-passive wheel — isolated to canvas, never reaches page zoom ───────
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

      // ── Ctrl / Meta → zoom (also handles Mac pinch gesture) ──
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06; // gentle for pinch
        const newZoom = clamp(animZoomRef.current * factor, MIN_ZOOM, MAX_ZOOM);
        const cursorTime = animPanRef.current + ratio * animVisDurRef.current;
        const newVisDur = t / newZoom;
        const newPan = clamp(cursorTime - ratio * newVisDur, 0, Math.max(0, t - newVisDur));
        onZoomChangeRef.current(newZoom, newPan);
        return;
      }

      // ── Shift → horizontal pan from vertical wheel delta ──
      if (e.shiftKey) {
        const deltaSec = (e.deltaY / el.offsetWidth) * animVisDurRef.current * 2.5;
        const newPan = clamp(animPanRef.current + deltaSec, 0, Math.max(0, t - animVisDurRef.current));
        onPanChangeRef.current(newPan);
        return;
      }

      // ── Horizontal trackpad swipe → pan ──
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.6) {
        const deltaSec = (e.deltaX / el.offsetWidth) * animVisDurRef.current;
        const newPan = clamp(animPanRef.current + deltaSec, 0, Math.max(0, t - animVisDurRef.current));
        onPanChangeRef.current(newPan);
        return;
      }

      // ── Default → zoom (mouse wheel, vertical trackpad scroll) ──
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZoom = clamp(animZoomRef.current * factor, MIN_ZOOM, MAX_ZOOM);
      const cursorTime = animPanRef.current + ratio * animVisDurRef.current;
      const newVisDur = t / newZoom;
      const newPan = clamp(cursorTime - ratio * newVisDur, 0, Math.max(0, t - newVisDur));
      onZoomChangeRef.current(newZoom, newPan);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // stable

  // ── Coordinate helpers ────────────────────────────────────────────────────
  // Uses *animated* zoom/pan so hit-testing matches what's visually on screen
  const clientXToTime = useCallback((clientX: number): number => {
    const el = canvasRef.current;
    if (!el) return 0;
    const ratio = clamp((clientX - el.getBoundingClientRect().left) / el.offsetWidth, 0, 1);
    return clamp(animPanRef.current + ratio * animVisDurRef.current, 0, totalRef.current);
  }, []);

  const snapToGrid = useCallback((t: number): { time: number; snapped: number | null } => {
    const el = canvasRef.current;
    if (!el) return { time: t, snapped: null };
    const threshSec = SNAP_PX / (el.offsetWidth / animVisDurRef.current);
    let nearest = t, nearestDist = threshSec, snapTarget: number | null = null;
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

    // Ruler → playhead handle or ruler-seek
    if (cy <= RULER_H + 8) {
      const phX = timeToX(drawStateRef.current.currentTime, drawStateRef.current);
      if (Math.abs(cx - phX) <= 9) return { type: 'playhead' as const };
      return { type: 'ruler' as const };
    }

    // Camera track — cue handles
    if (cy >= CAM_TRACK_Y && cy <= CAM_TRACK_Y + CAM_TRACK_H) {
      for (const seg of transcriptRef.current.segments) {
        if (seg.cut) continue;
        const cues = cameraCuesRef.current.get(seg.id) ?? [];
        for (let i = 0; i < cues.length; i++) {
          let at = cues[i].at;
          const ov = drawStateRef.current.cueDragOverlay;
          if (ov?.segId === seg.id && ov?.cueIdx === i) at = ov.at;
          const hx = ((at - animPanRef.current) / animVisDurRef.current) * el.offsetWidth;
          if (Math.abs(cx - hx) <= CAM_HANDLE_HIT) {
            return { type: 'cueHandle' as const, seg, cueIdx: i };
          }
        }
      }
      return { type: 'camTrack' as const };
    }

    // Video track segments and trim handles
    const trackIdx = Math.floor((cy - RULER_H) / (TRACK_H + TRACK_GAP));
    if (trackIdx !== 0) return null;
    const clipTop = trackClipTop(0);
    const clipBot = clipTop + (TRACK_H - CLIP_PAD * 2);
    if (cy < clipTop || cy > clipBot) return null;

    for (const seg of transcriptRef.current.segments) {
      if (seg.cut) continue;
      const sx = ((seg.start - animPanRef.current) / animVisDurRef.current) * el.offsetWidth;
      const ex = ((seg.end - animPanRef.current) / animVisDurRef.current) * el.offsetWidth;
      if (cx < sx - TRIM_W || cx > ex + TRIM_W) continue;
      if (cx <= sx + TRIM_W) return { type: 'trimLeft' as const, seg };
      if (cx >= ex - TRIM_W) return { type: 'trimRight' as const, seg };
      if (cx >= sx && cx <= ex) return { type: 'segment' as const, seg };
    }
    return null;
  }, []);

  const updateCursor = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return;
    if (playheadDragRef.current || trimDragRef.current || cueDragRef.current) return;
    const hit = hitTestCanvas(clientX, clientY);
    if (!hit) { el.style.cursor = panDragRef.current ? 'grabbing' : 'crosshair'; return; }
    if (hit.type === 'playhead' || hit.type === 'ruler' || hit.type === 'trimLeft' || hit.type === 'trimRight' || hit.type === 'cueHandle') {
      el.style.cursor = 'ew-resize'; return;
    }
    if (hit.type === 'camTrack') { el.style.cursor = 'crosshair'; return; }
    el.style.cursor = 'pointer';
  }, [hitTestCanvas]);

  const updateAutoScroll = useCallback((clientX: number) => {
    if (!playheadDragRef.current && !trimDragRef.current && !cueDragRef.current) { autoScrollRef.current = null; return; }
    const el = canvasRef.current;
    if (!el) return;
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

  // ── Global mouse handlers (stable, registered once) ───────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      updateAutoScroll(e.clientX);

      if (playheadDragRef.current) {
        const { time, snapped } = snapToGrid(clientXToTime(e.clientX));
        drawStateRef.current.currentTime = time;
        drawStateRef.current.snapGuideTime = snapped;
        onSeekRef.current(time);
        return;
      }
      if (trimDragRef.current) {
        const snapped = Math.round(clientXToTime(e.clientX) / TRIM_SNAP_S) * TRIM_SNAP_S;
        const p: TrimPreview = { segId: trimDragRef.current.segId, side: trimDragRef.current.side, time: snapped };
        trimPreviewRef.current = p;
        drawStateRef.current.trimPreview = p;
        return;
      }
      if (cueDragRef.current) {
        const { segId, cueIdx, segStart, segEnd, prevBound, nextBound } = cueDragRef.current;
        const rawAt = clientXToTime(e.clientX);
        const newAt = clamp(rawAt, Math.max(segStart + 0.05, prevBound + 0.05), Math.min(segEnd - 0.05, nextBound - 0.05));
        drawStateRef.current.cueDragOverlay = { segId, cueIdx, at: newAt };
        return;
      }
      if (panDragRef.current) {
        const el = canvasRef.current;
        const pxPerSec = (el?.offsetWidth ?? 1) / animVisDurRef.current;
        const newPan = clamp(
          panDragRef.current.startPan - (e.clientX - panDragRef.current.startX) / pxPerSec,
          0, Math.max(0, totalRef.current - animVisDurRef.current),
        );
        // Instant (no animation) during drag — write to both anim and target
        animPanRef.current = newPan;
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
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
        return;
      }
      if (trimDragRef.current) {
        const p = trimPreviewRef.current;
        if (p) {
          const { segId, side, segStart, segEnd } = trimDragRef.current;
          const t = clamp(p.time, segStart, segEnd);
          if (side === 'left' && t > segStart + 0.05) onAddVisualCutRef.current(segId, { from: segStart, to: t });
          else if (side === 'right' && t < segEnd - 0.05) onAddVisualCutRef.current(segId, { from: t, to: segEnd });
        }
        trimDragRef.current = null; trimPreviewRef.current = null;
        drawStateRef.current.trimPreview = null;
        drawStateRef.current.activeDrag = null;
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
        return;
      }
      if (cueDragRef.current) {
        const ov = drawStateRef.current.cueDragOverlay;
        if (ov) onCueMovedRef.current?.(ov.segId, ov.cueIdx, ov.at);
        cueDragRef.current = null;
        drawStateRef.current.cueDragOverlay = null;
        drawStateRef.current.activeDrag = null;
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
        return;
      }
      if (panDragRef.current) {
        if (Math.abs(e.clientX - panDragRef.current.startX) < 4) {
          // Tiny movement = click-to-seek
          const { time, snapped } = snapToGrid(clientXToTime(e.clientX));
          drawStateRef.current.currentTime = time;
          onSeekRef.current(time);
          if (snapped !== null) {
            drawStateRef.current.snapGuideTime = snapped;
            setTimeout(() => { drawStateRef.current.snapGuideTime = null; }, 450);
          }
        }
        panDragRef.current = null;
        drawStateRef.current.activeDrag = null;
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [clientXToTime, snapToGrid, updateAutoScroll]); // stable callbacks

  // ── Canvas event handlers ─────────────────────────────────────────────────
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
    if (hit?.type === 'cueHandle' && hit.seg) {
      const { seg, cueIdx } = hit;
      const cues = cameraCuesRef.current.get(seg.id) ?? [];
      const prevBound = cueIdx > 0 ? cues[cueIdx - 1].at : seg.start;
      const nextBound = cueIdx < cues.length - 1 ? cues[cueIdx + 1].at : seg.end;
      cueDragRef.current = { segId: seg.id, cueIdx, segStart: seg.start, segEnd: seg.end, prevBound, nextBound };
      drawStateRef.current.activeDrag = 'cue';
      drawStateRef.current.cueDragOverlay = { segId: seg.id, cueIdx, at: cues[cueIdx].at };
      if (canvasRef.current) canvasRef.current.style.cursor = 'ew-resize';
      return;
    }
    if (hit?.type === 'segment' && hit.seg) {
      selectedSegIdRef.current = selectedSegIdRef.current === hit.seg.id ? null : hit.seg.id;
      drawStateRef.current.selectedSegId = selectedSegIdRef.current;
    }
    // Start pan drag — use animated pan as the baseline for instant-feeling drag
    panDragRef.current = { startX: e.clientX, startPan: animPanRef.current };
    drawStateRef.current.activeDrag = 'pan';
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
  }, [hitTestCanvas]);

  /** Double-click ruler → seek; double-click CAM track → add cue. */
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cy = e.clientY - rect.top;

    // Ruler seek
    if (cy <= RULER_H + 4) {
      const { time } = snapToGrid(clientXToTime(e.clientX));
      drawStateRef.current.currentTime = time;
      onSeekRef.current(time);
      return;
    }

    // CAM track — add a cue at click position
    if (cy >= CAM_TRACK_Y && cy <= CAM_TRACK_Y + CAM_TRACK_H) {
      const at = clientXToTime(e.clientX);
      const seg = transcriptRef.current.segments.find(s => !s.cut && at >= s.start && at < s.end);
      if (!seg) return;
      // Determine what's currently playing at `at` and toggle
      const regions = buildCamRegions(transcriptRef.current.segments, cameraCuesRef.current);
      const region = regions.find(r => r.segId === seg.id && at >= r.from && at < r.to);
      const newShot = region?.shot === 'closeup' ? 'wide' : 'closeup';
      const newSpeaker = newShot === 'closeup' ? seg.speaker : undefined;
      onCueAddedRef.current?.(seg.id, at, newShot, newSpeaker);
    }
  }, [clientXToTime, snapToGrid]);

  /** Right-click on cue handle → delete that cue. */
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTestCanvas(e.clientX, e.clientY);
    if (hit?.type === 'cueHandle' && hit.seg) {
      e.preventDefault();
      onCueDeletedRef.current?.(hit.seg.id, hit.cueIdx!);
    }
  }, [hitTestCanvas]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    updateCursor(e.clientX, e.clientY);
    const hit = hitTestCanvas(e.clientX, e.clientY);
    const hovId = (hit?.type === 'segment' || hit?.type === 'trimLeft' || hit?.type === 'trimRight')
      ? hit.seg?.id ?? null : null;
    if (hovId !== hoverSegIdRef.current) {
      hoverSegIdRef.current = hovId;
      drawStateRef.current.hoverSegId = hovId;
    }
    // Update hovered cue handle
    const hovCue = hit?.type === 'cueHandle' ? { segId: hit.seg!.id, cueIdx: hit.cueIdx! } : null;
    const prev = drawStateRef.current.hoveredCueHandle;
    if (hovCue?.segId !== prev?.segId || hovCue?.cueIdx !== prev?.cueIdx) {
      drawStateRef.current.hoveredCueHandle = hovCue;
    }
  }, [updateCursor, hitTestCanvas]);

  const handleCanvasMouseLeave = useCallback(() => {
    hoverSegIdRef.current = null;
    drawStateRef.current.hoverSegId = null;
    drawStateRef.current.hoveredCueHandle = null;
  }, []);

  // ── Minimap click ─────────────────────────────────────────────────────────
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const ratio = (e.clientX - el.getBoundingClientRect().left) / el.offsetWidth;
    const visDur = total / zoom;
    onPanChange(clamp(ratio * total - visDur / 2, 0, Math.max(0, total - visDur)));
  }, [total, zoom, onPanChange]);

  // ── Render ────────────────────────────────────────────────────────────────
  const visDur = total / zoom;

  return (
    <Box ref={containerRef} style={{ userSelect: 'none' }}>

      {/* Canvas */}
      <Box style={{ position: 'relative', height: CANVAS_H, borderRadius: 6, overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: CANVAS_H, cursor: 'crosshair' }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
          onDoubleClick={handleCanvasDoubleClick}
          onContextMenu={handleCanvasContextMenu}
        />
      </Box>

      {/* Scrollbar — visible whenever zoomed in */}
      <TimelineScrollbar
        total={total}
        zoom={zoom}
        panOffset={panOffset}
        onPanChange={onPanChange}
      />

      {/* Minimap — always visible */}
      <Box
        onClick={handleMinimapClick}
        style={{
          position: 'relative', height: MINIMAP_H, marginTop: 3,
          background: '#0a0b0c', borderRadius: 3, overflow: 'hidden',
          cursor: 'pointer',
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
          width: `${Math.min((visDur / total) * 100, 100)}%`,
          top: 0, height: '100%',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: 2, pointerEvents: 'none',
        }} />
        {/* Playhead */}
        <Box style={{
          position: 'absolute',
          left: `${(currentTime / total) * 100}%`,
          top: 0, width: 1, height: '100%',
          background: 'rgba(255,255,255,0.65)', pointerEvents: 'none',
        }} />
      </Box>

      {/* Track legend */}
      <Box style={{ display: 'flex', gap: 12, marginTop: 5, paddingLeft: 2 }}>
        {[...Array(N_TRACKS)].map((_, ti) => (
          <Text key={ti} style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, fontFamily: 'monospace' }}>
            {ti === 0 ? 'VID — segments + visual cuts' : 'AUD — doc cuts'}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
