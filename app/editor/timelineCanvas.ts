import type { Segment, TimeCut } from '../../remotion/types/transcript';

// ─── Layout constants ────────────────────────────────────────────────────────
export const RULER_H = 24;
export const TRACK_H = 54;
export const TRACK_GAP = 2;
export const N_TRACKS = 2;
export const CANVAS_H = RULER_H + N_TRACKS * (TRACK_H + TRACK_GAP);
export const CLIP_PAD = 7;          // vertical padding inside track row for clip rect
export const CLIP_H = TRACK_H - CLIP_PAD * 2;
export const TRIM_W = 11;           // px width of trim handle zone

// ─── Draw state ──────────────────────────────────────────────────────────────
export interface TimelineDrawState {
  width: number;
  visStart: number;
  visDur: number;
  total: number;
  fps: number;
  videoStart: number;
  videoEnd: number;
  segments: Segment[];
  speakerColors: Record<string, string>;
  visualCuts: Map<number, TimeCut[]>;
  currentTime: number;
  markIn: number | null;
  snapGuideTime: number | null;
  trimPreview: { segId: number; side: 'left' | 'right'; time: number } | null;
  hoverSegId: number | null;
  selectedSegId: number | null;
  activeDrag: 'playhead' | 'pan' | 'trim' | null;
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────
export function timeToX(t: number, s: TimelineDrawState): number {
  return ((t - s.visStart) / s.visDur) * s.width;
}
export function trackClipTop(trackIdx: number): number {
  return RULER_H + trackIdx * (TRACK_H + TRACK_GAP) + CLIP_PAD;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function fmtTC(s: number, fps: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s % 1) * fps);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

function getTickInterval(visDur: number, w: number): number {
  if (w <= 0) return 10;
  const t = (visDur / w) * 80;
  return [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find(i => i >= t) ?? 300;
}

function getMajorInterval(tick: number): number {
  if (tick <= 0.1) return 0.5;
  if (tick <= 0.5) return 1;
  if (tick <= 2) return 10;
  if (tick <= 10) return 60;
  return 300;
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = -(h + w); i < w + h; i += 9) {
    ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + h, y + h); ctx.stroke();
  }
  ctx.restore();
}

// ─── Main draw function ───────────────────────────────────────────────────────
export function drawTimeline(canvas: HTMLCanvasElement, s: TimelineDrawState) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const { width } = s;
  const height = CANVAS_H;

  // Resize backing buffer if needed
  const wPx = Math.round(width * dpr);
  const hPx = Math.round(height * dpr);
  if (canvas.width !== wPx || canvas.height !== hPx) {
    canvas.width = wPx;
    canvas.height = hPx;
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const visEnd = s.visStart + s.visDur;

  // ── Track backgrounds ──────────────────────────────────────────────────────
  for (let ti = 0; ti < N_TRACKS; ti++) {
    const ty = RULER_H + ti * (TRACK_H + TRACK_GAP);
    ctx.fillStyle = ti === 0 ? '#1e2024' : '#191c1f';
    ctx.fillRect(0, ty, width, TRACK_H);
    // Track label
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.font = '700 9px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(ti === 0 ? 'VID' : 'AUD', 5, ty + TRACK_H / 2);
  }
  for (let ti = 1; ti < N_TRACKS; ti++) {
    ctx.fillStyle = '#2c2e33';
    ctx.fillRect(0, RULER_H + ti * (TRACK_H + TRACK_GAP) - TRACK_GAP, width, TRACK_GAP);
  }

  // ── Exclusion zones ────────────────────────────────────────────────────────
  if (s.videoStart > s.visStart) {
    const ex = timeToX(Math.min(s.videoStart, visEnd), s);
    hatch(ctx, 0, RULER_H, Math.max(0, ex), height - RULER_H);
    if (s.videoStart < visEnd) {
      ctx.save(); ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ex, RULER_H); ctx.lineTo(ex, height); ctx.stroke();
      ctx.restore();
    }
  }
  if (s.videoEnd < visEnd) {
    const ex = timeToX(Math.max(s.videoEnd, s.visStart), s);
    hatch(ctx, ex, RULER_H, Math.max(0, width - ex), height - RULER_H);
    if (s.videoEnd > s.visStart) {
      ctx.save(); ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ex, RULER_H); ctx.lineTo(ex, height); ctx.stroke();
      ctx.restore();
    }
  }

  // ── Audio track: segment dims + token cuts ─────────────────────────────────
  const ct1 = trackClipTop(1);
  for (const seg of s.segments) {
    if (seg.cut || seg.end < s.visStart || seg.start > visEnd) continue;
    const x = timeToX(seg.start, s); const w = Math.max(timeToX(seg.end, s) - x, 1);
    ctx.globalAlpha = 0.18;
    rrect(ctx, x, ct1, w, CLIP_H, 3);
    ctx.fillStyle = s.speakerColors[seg.speaker] ?? '#888'; ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const seg of s.segments) {
    for (const c of (seg.cuts ?? [])) {
      if (c.to < s.visStart || c.from > visEnd) continue;
      const x = timeToX(c.from, s); const w = Math.max(timeToX(c.to, s) - x, 1);
      ctx.globalAlpha = 0.55;
      rrect(ctx, x, ct1, w, CLIP_H, 2); ctx.fillStyle = '#dc3545'; ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ── Video track: segments ─────────────────────────────────────────────────
  const ct0 = trackClipTop(0);
  for (const seg of s.segments) {
    if (seg.end < s.visStart || seg.start > visEnd) continue;
    const x = timeToX(seg.start, s); const w = Math.max(timeToX(seg.end, s) - x, 1);
    const color = seg.cut ? '#2a2a2a' : (s.speakerColors[seg.speaker] ?? '#888');
    const isHov = s.hoverSegId === seg.id;
    const isSel = s.selectedSegId === seg.id;

    ctx.globalAlpha = seg.cut ? 0.14 : (isHov || isSel ? 0.9 : 0.65);
    rrect(ctx, x, ct0, w, CLIP_H, 3); ctx.fillStyle = color; ctx.fill();

    if (isSel) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      rrect(ctx, x, ct0, w, CLIP_H, 3); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Trim handle highlights
    if ((isHov || isSel) && !seg.cut) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(x, ct0, TRIM_W, CLIP_H);
      ctx.fillRect(x + w - TRIM_W, ct0, TRIM_W, CLIP_H);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      const bh = CLIP_H * 0.42;
      const by = ct0 + (CLIP_H - bh) / 2;
      ctx.fillRect(x + TRIM_W / 2 - 1, by, 2, bh);
      ctx.fillRect(x + w - TRIM_W / 2 - 1, by, 2, bh);
    }

    // Speaker label
    if (!seg.cut && w > 40) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + TRIM_W + 2, ct0, Math.max(0, w - TRIM_W * 2 - 4), CLIP_H);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '600 10px -apple-system,system-ui,sans-serif';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 3;
      ctx.fillText(seg.speaker, x + TRIM_W + 4, ct0 + CLIP_H / 2);
      ctx.restore();
    }
  }

  // ── Visual cuts (video track) ──────────────────────────────────────────────
  for (const [, cuts] of s.visualCuts) {
    for (const c of cuts) {
      if (c.to < s.visStart || c.from > visEnd) continue;
      const x = timeToX(c.from, s); const w = Math.max(timeToX(c.to, s) - x, 1);
      ctx.globalAlpha = 0.82;
      rrect(ctx, x, ct0, w, CLIP_H, 2); ctx.fillStyle = '#dc3545'; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, ct0); ctx.lineTo(x, ct0 + CLIP_H);
      ctx.moveTo(x + w, ct0); ctx.lineTo(x + w, ct0 + CLIP_H);
      ctx.stroke();
    }
  }

  // ── Trim drag preview ──────────────────────────────────────────────────────
  if (s.trimPreview) {
    const seg = s.segments.find(sg => sg.id === s.trimPreview!.segId);
    if (seg) {
      const p = s.trimPreview;
      const from = p.side === 'left' ? seg.start : p.time;
      const to = p.side === 'left' ? p.time : seg.end;
      if (to > from + 0.01) {
        const x = timeToX(from, s); const w = Math.max(timeToX(to, s) - x, 1);
        ctx.globalAlpha = 0.5;
        rrect(ctx, x, ct0, w, CLIP_H, 2); ctx.fillStyle = '#ff9800'; ctx.fill();
        ctx.globalAlpha = 1;
        ctx.save(); ctx.strokeStyle = '#ff9800'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        rrect(ctx, x, ct0, w, CLIP_H, 2); ctx.stroke(); ctx.restore();
      }
    }
  }

  // ── Mark In ────────────────────────────────────────────────────────────────
  if (s.markIn !== null) {
    const x = timeToX(s.markIn, s);
    if (x >= 0 && x <= width) {
      ctx.save();
      const g = ctx.createLinearGradient(0, RULER_H, 0, height);
      g.addColorStop(0, '#ff9800'); g.addColorStop(1, 'rgba(255,152,0,0.12)');
      ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, height); ctx.stroke();
      ctx.fillStyle = '#ff9800';
      rrect(ctx, x + 1, RULER_H + 1, 17, 11, 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = '700 8px monospace';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText('IN', x + 3, RULER_H + 7);
      ctx.restore();
    }
  }

  // ── Playhead line ──────────────────────────────────────────────────────────
  const phX = timeToX(s.currentTime, s);
  if (phX >= -2 && phX <= width + 2) {
    ctx.save();
    if (s.activeDrag === 'playhead') {
      ctx.shadowColor = 'rgba(255,255,255,0.4)'; ctx.shadowBlur = 5;
    }
    ctx.strokeStyle = 'white';
    ctx.lineWidth = s.activeDrag === 'playhead' ? 2.5 : 2;
    ctx.beginPath(); ctx.moveTo(phX, RULER_H); ctx.lineTo(phX, height); ctx.stroke();
    ctx.restore();
  }

  // ── Snap guide ─────────────────────────────────────────────────────────────
  if (s.snapGuideTime !== null) {
    const x = timeToX(s.snapGuideTime, s);
    if (x >= 0 && x <= width) {
      ctx.save(); ctx.setLineDash([3, 2]);
      ctx.strokeStyle = 'rgba(255,230,0,0.85)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, height); ctx.stroke();
      ctx.restore();
    }
  }

  // ── Ruler (drawn last — sits on top) ───────────────────────────────────────
  ctx.fillStyle = '#0d0e10';
  ctx.fillRect(0, 0, width, RULER_H);
  ctx.fillStyle = '#2c2e33';
  ctx.fillRect(0, RULER_H - 1, width, 1);

  const tick = getTickInterval(s.visDur, width);
  const major = getMajorInterval(tick);
  const first = Math.ceil(s.visStart / tick) * tick;
  for (let t = first; t <= visEnd + tick; t += tick) {
    const x = timeToX(t, s);
    if (x < -1 || x > width + 1) continue;
    const isMaj = Math.abs(t % major) < tick * 0.5;
    ctx.strokeStyle = isMaj ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, RULER_H - (isMaj ? 11 : 5)); ctx.stroke();
    if (isMaj) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(fmtTC(t, s.fps), x, 2);
    }
  }

  // Timecode pill + downward handle triangle at playhead in ruler
  if (phX >= -2 && phX <= width + 2) {
    const tc = fmtTC(s.currentTime, s.fps);
    ctx.font = '700 9px monospace';
    const tcW = ctx.measureText(tc).width + 10;
    const tcX = Math.max(2, Math.min(phX - tcW / 2, width - tcW - 2));
    const tcY = 3;
    rrect(ctx, tcX, tcY, tcW, 15, 3);
    ctx.fillStyle = 'white'; ctx.fill();
    ctx.fillStyle = '#111';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(tc, tcX + 5, tcY + 8);
    // ▼ triangle at ruler bottom, centered on playhead
    ctx.beginPath();
    ctx.moveTo(phX - 6, RULER_H - 1);
    ctx.lineTo(phX + 6, RULER_H - 1);
    ctx.lineTo(phX, RULER_H + 5);
    ctx.closePath();
    ctx.fillStyle = 'white'; ctx.fill();
  }

  ctx.restore();
}
