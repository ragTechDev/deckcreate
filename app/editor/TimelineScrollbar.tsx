'use client';

import React, { useRef, useCallback } from 'react';
import { Box } from '@mantine/core';

interface Props {
  total: number;
  zoom: number;
  panOffset: number;
  onPanChange: (pan: number) => void;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Thin scrollbar that mirrors the timeline viewport.
 * - Drag thumb to pan.
 * - Click the track (outside thumb) to jump by one visible duration.
 * Returns null when fully zoomed out (no scroll needed).
 */
export const TimelineScrollbar: React.FC<Props> = ({ total, zoom, panOffset, onPanChange }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startPan: number } | null>(null);

  const visDur = total / zoom;
  const thumbW = Math.min((visDur / total) * 100, 100); // %
  const thumbL = total > 0 ? (panOffset / total) * 100 : 0; // %

  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el) return;
    const ratio = (e.clientX - el.getBoundingClientRect().left) / el.offsetWidth;
    const clickedTime = ratio * total;
    const thumbMid = panOffset + visDur / 2;
    // If click lands inside the thumb, start a drag; otherwise page-jump
    const thumbLPx = (panOffset / total) * el.offsetWidth;
    const thumbRPx = ((panOffset + visDur) / total) * el.offsetWidth;
    const cx = e.clientX - el.getBoundingClientRect().left;

    if (cx >= thumbLPx && cx <= thumbRPx) {
      // Drag the thumb
      dragRef.current = { startX: e.clientX, startPan: panOffset };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      // Jump: centre viewport on click position
      const newPan = clamp(clickedTime - visDur / 2, 0, Math.max(0, total - visDur));
      onPanChange(newPan);
    }
  }, [total, visDur, panOffset, onPanChange]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const el = trackRef.current;
    if (!el) return;
    const dx = e.clientX - dragRef.current.startX;
    const newPan = clamp(
      dragRef.current.startPan + (dx / el.offsetWidth) * total,
      0,
      Math.max(0, total - visDur),
    );
    onPanChange(newPan);
  }, [total, visDur, onPanChange]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // No scrollbar when everything fits (saves space)
  if (thumbW >= 99.5) return null;

  return (
    <Box
      ref={trackRef}
      onPointerDown={handleTrackPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'relative',
        height: 8,
        background: '#0a0b0c',
        borderRadius: 4,
        cursor: 'pointer',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* Thumb */}
      <Box
        style={{
          position: 'absolute',
          top: 1,
          left: `${thumbL}%`,
          width: `${thumbW}%`,
          height: 6,
          background: dragRef.current ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)',
          borderRadius: 3,
          cursor: 'grab',
          pointerEvents: 'none', // track handles all events
          transition: 'background 0.12s',
        }}
      />
    </Box>
  );
};
