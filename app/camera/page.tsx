'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ActionIcon, Alert, Box, Button, Container, Group,
  Loader, Paper, Select, Stack, Text, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';

// ── Types ────────────────────────────────────────────────────────────────────

type Detection  = { x: number; y: number; w: number; h: number; score: number };
type FaceBox    = { id: number; x: number; y: number; w: number; h: number; speaker: string };
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type Drag =
  | { mode: 'idle' }
  | { mode: 'move';   id: number; ox: number; oy: number; mx0: number; my0: number }
  | { mode: 'resize'; id: number; handle: ResizeHandle; orig: FaceBox; mx0: number; my0: number }
  | { mode: 'draw';   sx: number; sy: number; cx: number; cy: number };

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#e67700', '#862e9c', '#0c8599'];
const col = (i: number) => COLORS[i % COLORS.length];

const MIN_BOX = 0.025;   // minimum box dimension in normalised coords
const HR = 0.013;        // handle radius

const HANDLES: [ResizeHandle, number, number][] = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['e', 1, 0.5],
  ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1],
  ['w', 0, 0.5],
];

const CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize', n: 'ns-resize',  ne: 'nesw-resize',
  e:  'ew-resize',
  se: 'nwse-resize', s: 'ns-resize',  sw: 'nesw-resize',
  w:  'ew-resize',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resize a box while locking to a given aspect ratio.
 *
 * `ratio` is the desired w/h in *normalised* coords.
 * For same-aspect source/output (e.g. 1920×1080 → 1920×1080) ratio = 1,
 * because (w × srcW) / (h × srcH) = videoAspect  →  w/h = videoAspect/videoAspect = 1.
 * For portrait output on landscape source: ratio = (9/16) / (16/9) ≈ 0.316.
 *
 * Anchor strategy:
 *  - Corner handles: opposite corner is fixed; use the larger scale as driver.
 *  - Edge handles:   opposite edge is fixed; dragged dim drives, other follows.
 */
function applyResize(orig: FaceBox, handle: ResizeHandle, dx: number, dy: number, ratio = 1): Partial<FaceBox> {
  // Anchor corners of the original box
  const r = orig.x + orig.w;   // right
  const b = orig.y + orig.h;   // bottom
  const cx = orig.x + orig.w / 2;
  const cy = orig.y + orig.h / 2;

  // Raw unconstrained sizes from drag delta
  const rawW = handle.includes('e') ? Math.max(MIN_BOX, orig.w + dx)
             : handle.includes('w') ? Math.max(MIN_BOX, orig.w - dx)
             : orig.w;
  const rawH = handle.includes('s') ? Math.max(MIN_BOX, orig.h + dy)
             : handle.includes('n') ? Math.max(MIN_BOX, orig.h - dy)
             : orig.h;

  // Resolve locked size: corners use the larger scale; edges use the dragged axis
  const isCorner = (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw');
  let newW: number, newH: number;
  if (isCorner) {
    const scaleW = rawW / orig.w;
    const scaleH = rawH / orig.h;
    if (scaleW >= scaleH) { newW = rawW; newH = rawW / ratio; }
    else                  { newH = rawH; newW = rawH * ratio; }
  } else if (handle === 'e' || handle === 'w') {
    newW = rawW; newH = newW / ratio;
  } else {
    newH = rawH; newW = newH * ratio;
  }

  newW = Math.max(MIN_BOX, Math.min(1, newW));
  newH = Math.max(MIN_BOX, Math.min(1, newH));

  // Compute new position from anchor
  let x: number, y: number;
  if (handle.includes('w')) x = r - newW; else x = orig.x;
  if (handle.includes('n')) y = b - newH; else y = orig.y;
  // Edge-only handles: centre on the perpendicular axis
  if (handle === 'n' || handle === 's') x = cx - newW / 2;
  if (handle === 'e' || handle === 'w') y = cy - newH / 2;

  x = Math.max(0, Math.min(1 - newW, x));
  y = Math.max(0, Math.min(1 - newH, y));

  return { x, y, w: newW, h: newH };
}

/**
 * Compute a closeup viewport where the face occupies ~1/9 of the output frame.
 *
 * The SVG overlay uses normalised coords where x spans image width and y spans
 * image height, so the source aspect ratio is already baked in. For output that
 * matches the source aspect ratio the box must be square in normalised coords:
 *
 *   Fill without black bars:  cropW / cropH = outputAspect / sourceAspect = 1
 *   Face at 1/9 of output:    face.w × face.h / (cropW × cropH) = 1/9
 *     → cropW = cropH = 3 × sqrt(face.w × face.h)
 *
 * For a portrait output (different outputAspect), pass outputAspect explicitly.
 * R = outputAspect / sourceAspect gives cropH = 3√(face.w×face.h/R), cropW = R×cropH.
 */
function computeCloseup(
  face: { x: number; y: number; w: number; h: number },
  sourceAspect: number,
  outputAspect: number = sourceAspect,
) {
  const R = outputAspect / sourceAspect;   // 1 when source and output match
  const cropH = Math.min(1, 4 * Math.sqrt((face.w * face.h) / R));
  const cropW = Math.min(1, R * cropH);

  // Centre on the face, shifting up slightly so the top of the head isn't cropped
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2 - face.h * 0.05;

  // Clamp so the crop doesn't extend outside the source frame
  const clampedCx = Math.max(cropW / 2, Math.min(1 - cropW / 2, cx));
  const clampedCy = Math.max(cropH / 2, Math.min(1 - cropH / 2, cy));

  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return { cx: r4(clampedCx), cy: r4(clampedCy), w: r4(cropW), h: r4(cropH) };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CameraPage() {
  const [boxes, setBoxes]                 = useState<FaceBox[]>([]);
  const [rawDetections, setRawDetections] = useState<Detection[] | null>(null);
  const [speakers, setSpeakers]           = useState<string[]>([]);
  const [drag, setDrag]                   = useState<Drag>({ mode: 'idle' });
  const [selectedId, setSelectedId]       = useState<number | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [saving, setSaving]               = useState(false);
  const [imgSize, setImgSize]             = useState<{ w: number; h: number } | null>(null);
  const boxesInitialized                  = useRef(false);

  const svgRef     = useRef<SVGSVGElement>(null);
  const nextId     = useRef(1);
  const dragRef    = useRef(drag);
  const imgSizeRef = useRef(imgSize);
  dragRef.current    = drag;
  imgSizeRef.current = imgSize;

  // ── Load data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const detectionsRes = await fetch('/transcribe/output/camera/detections.json');
        const transcriptRes = await fetch('/transcribe/output/edit/transcript.json');

        const dets: Detection[] = detectionsRes.ok ? await detectionsRes.json() : [];
        setRawDetections(dets);

        if (transcriptRes.ok) {
          const transcript = await transcriptRes.json();
          const names = [
            ...new Set<string>(
              (transcript.segments as { speaker: string }[])
                .map(s => s.speaker).filter(Boolean),
            ),
          ].sort();
          setSpeakers(names);
        } else {
          setSpeakers([]);
        }

        if (!detectionsRes.ok) {
          setError('Detections file not found. Run camera setup first, or draw boxes manually.');
        } else if (!transcriptRes.ok) {
          setError('Transcript not found. You can still position boxes, but speaker list will be empty until transcript is generated.');
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Initialise boxes once the real image size is known ───────────────────────

  useEffect(() => {
    if (!imgSize || !rawDetections || boxesInitialized.current) return;
    boxesInitialized.current = true;
    const aspectRatio = imgSize.w / imgSize.h;
    // Expand detected face bboxes to the actual closeup viewport size so
    // what you see in the GUI is exactly what will appear in the cut.
    setBoxes(rawDetections.map(d => {
      const vp = computeCloseup(d, aspectRatio);
      return {
        id: nextId.current++,
        x: vp.cx - vp.w / 2,
        y: vp.cy - vp.h / 2,
        w: vp.w,
        h: vp.h,
        speaker: '',
      };
    }));
  }, [imgSize, rawDetections]);

  // ── Coordinate helpers ───────────────────────────────────────────────────────

  const getNorm = useCallback((e: MouseEvent | React.MouseEvent): { x: number; y: number } => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height)),
    };
  }, []);

  // ── Global mouse handlers (keep drag going outside SVG) ──────────────────────

  useEffect(() => {
    if (drag.mode === 'idle') return;

    const onMove = (e: MouseEvent) => {
      const { x, y } = getNorm(e);
      const d = dragRef.current;

      if (d.mode === 'move') {
        const dx = x - d.mx0, dy = y - d.my0;
        setBoxes(prev => prev.map(b => b.id !== d.id ? b : {
          ...b,
          x: Math.max(0, Math.min(1 - b.w, d.ox + dx)),
          y: Math.max(0, Math.min(1 - b.h, d.oy + dy)),
        }));
      } else if (d.mode === 'resize') {
        const dx = x - d.mx0, dy = y - d.my0;
        // ratio = 1 for same-aspect output; portrait would use (9/16)/(16/9)
        const patch = applyResize(d.orig, d.handle, dx, dy, 1);
        setBoxes(prev => prev.map(b => b.id !== d.id ? b : { ...b, ...patch }));
      } else if (d.mode === 'draw') {
        setDrag(prev => prev.mode === 'draw' ? { ...prev, cx: x, cy: y } : prev);
      }
    };

    const onUp = (e: MouseEvent) => {
      const d = dragRef.current;
      if (d.mode === 'draw') {
        const { x, y } = getNorm(e);
        const bx = Math.min(d.sx, x), by = Math.min(d.sy, y);
        const bw = Math.abs(x - d.sx), bh = Math.abs(y - d.sy);
        if (bw > MIN_BOX && bh > MIN_BOX) {
          setBoxes(prev => [...prev, { id: nextId.current++, x: bx, y: by, w: bw, h: bh, speaker: '' }]);
        }
      }
      setDrag({ mode: 'idle' });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag.mode, getNorm]);

  // ── SVG interaction ──────────────────────────────────────────────────────────

  const onSvgDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const target = e.target as Element;
    const norm   = getNorm(e);

    const handleAttr = target.getAttribute('data-handle');
    const boxIdAttr  = target.getAttribute('data-box-id');

    if (handleAttr && boxIdAttr) {
      // Resize handle
      const id   = Number(boxIdAttr);
      const orig = boxes.find(b => b.id === id);
      if (orig) {
        setSelectedId(id);
        setDrag({ mode: 'resize', id, handle: handleAttr as ResizeHandle, orig: { ...orig }, mx0: norm.x, my0: norm.y });
      }

    } else if (boxIdAttr) {
      // Box body — select + move
      const id  = Number(boxIdAttr);
      const box = boxes.find(b => b.id === id);
      if (box) {
        setSelectedId(id);
        setDrag({ mode: 'move', id, ox: box.x, oy: box.y, mx0: norm.x, my0: norm.y });
      }

    } else {
      // Background — deselect + draw new box
      setSelectedId(null);
      setDrag({ mode: 'draw', sx: norm.x, sy: norm.y, cx: norm.x, cy: norm.y });
    }
  }, [boxes, getNorm]);

  // ── Box management ───────────────────────────────────────────────────────────

  const deleteBox = (id: number) =>
    setBoxes(prev => prev.filter(b => b.id !== id));

  const addBox = () =>
    setBoxes(prev => [...prev, { id: nextId.current++, x: 0.1, y: 0.1, w: 0.2, h: 0.35, speaker: '' }]);

  const clearBoxes = () => setBoxes([]);

  const setSpeaker = (id: number, speaker: string) =>
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, speaker } : b));

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const speakerMap: Record<string, object> = {};
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    for (const box of boxes) {
      if (!box.speaker) continue;
      const cx = r4(box.x + box.w / 2);
      const cy = r4(box.y + box.h / 2);
      speakerMap[box.speaker] = {
        label: box.speaker,
        closeupViewport: { cx, cy, w: r4(box.w), h: r4(box.h) },
        portraitCx: cx,
      };
    }

    const sw = imgSize?.w ?? 1920;
    const sh = imgSize?.h ?? 1080;
    const profiles = {
      sourceWidth:  sw,
      sourceHeight: sh,
      outputWidth:  sw,
      outputHeight: sh,
      wideViewport: { cx: 0.5, cy: 0.5, w: 1.0, h: 1.0 },
      speakers: speakerMap,
    };

    setSaving(true);
    try {
      const res = await fetch('/api/camera/save-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profiles),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      notifications.show({ color: 'green', message: 'camera-profiles.json saved.' });
    } catch (err) {
      notifications.show({ color: 'red', message: String(err) });
    } finally {
      setSaving(false);
    }
  };

  // ── Render: SVG drawing preview ──────────────────────────────────────────────

  const drawPreview = drag.mode === 'draw' && Math.abs(drag.cx - drag.sx) > MIN_BOX && Math.abs(drag.cy - drag.sy) > MIN_BOX
    ? { x: Math.min(drag.sx, drag.cx), y: Math.min(drag.sy, drag.cy), w: Math.abs(drag.cx - drag.sx), h: Math.abs(drag.cy - drag.sy) }
    : null;

  const assignedCount = boxes.filter(b => b.speaker).length;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Container size="xl" py="xl">
      <Title order={2} mb={4}>Camera Setup</Title>
      <Text c="dimmed" size="sm" mb="lg">
        Drag boxes to move · Drag handles to resize · Click &amp; drag on empty area to draw a new box
      </Text>

      {error && (
        <Alert color="red" mb="md" title="Load error">
          {error}
          <br />
          <Text size="xs" mt={4}>Run <code>npm run setup-camera</code> first to extract the frame.</Text>
        </Alert>
      )}

      {loading && <Group justify="center" py="xl"><Loader /></Group>}

      {!loading && (
        <Group align="flex-start" gap="xl" wrap="nowrap">

          {/* ── Image + SVG overlay ── */}
          <Box style={{ flex: '1 1 auto', position: 'relative', lineHeight: 0 }}>
            <img
              src="/transcribe/output/camera/frame.jpg"
              alt="Video frame"
              onLoad={e => {
                const img = e.currentTarget;
                setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              draggable={false}
              style={{ display: 'block', width: '100%', borderRadius: 8, userSelect: 'none' }}
            />

            <svg
              ref={svgRef}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              onMouseDown={onSvgDown}
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                cursor: drag.mode === 'idle' ? 'crosshair' : 'default',
                userSelect: 'none',
                overflow: 'hidden',
              }}
            >
              {/* Transparent background to capture draw events */}
              <rect x={0} y={0} width={1} height={1} fill="transparent" />

              {/* Render non-selected boxes first (behind), selected box last (on top) */}
              {[...boxes]
                .sort((a, b) => (a.id === selectedId ? 1 : 0) - (b.id === selectedId ? 1 : 0))
                .map((box) => {
                  const i = boxes.indexOf(box);
                  const isSelected = box.id === selectedId;
                  const hasSelection = selectedId !== null;
                  const opacity = hasSelection && !isSelected ? 0.35 : 1;
                  return (
                    <g key={box.id} opacity={opacity}>
                      {/* Box body */}
                      <rect
                        x={box.x} y={box.y} width={box.w} height={box.h}
                        fill={isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
                        stroke={col(i)}
                        strokeWidth={isSelected ? 0.004 : 0.002}
                        strokeDasharray={isSelected ? undefined : '0.012 0.006'}
                        style={{ cursor: 'move' }}
                        data-box-id={box.id}
                      />

                      {/* Face number badge */}
                      <rect
                        x={box.x} y={Math.max(0, box.y - 0.045)} width={0.042} height={0.04}
                        fill={col(i)} rx={0.005}
                        style={{ pointerEvents: 'none' }}
                      />
                      <text
                        x={box.x + 0.021} y={Math.max(0, box.y - 0.013)}
                        textAnchor="middle" fontSize={0.032} fill="white"
                        fontWeight="bold" fontFamily="sans-serif"
                        style={{ pointerEvents: 'none' }}
                      >
                        {i + 1}
                      </text>

                      {/* Resize handles — only show on selected box */}
                      {isSelected && HANDLES.map(([handle, fx, fy]) => (
                        <circle
                          key={handle}
                          cx={box.x + fx * box.w}
                          cy={box.y + fy * box.h}
                          r={HR}
                          fill={col(i)}
                          stroke="white"
                          strokeWidth={0.002}
                          style={{ cursor: CURSORS[handle] }}
                          data-box-id={box.id}
                          data-handle={handle}
                        />
                      ))}
                    </g>
                  );
                })
              }

              {/* In-progress draw preview */}
              {drawPreview && (
                <rect
                  x={drawPreview.x} y={drawPreview.y}
                  width={drawPreview.w} height={drawPreview.h}
                  fill="rgba(255,255,255,0.1)"
                  stroke="white"
                  strokeWidth={0.003}
                  strokeDasharray="0.015 0.008"
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </svg>

            {/* Image controls below */}
            <Group mt="xs" gap="xs">
              <Button size="xs" variant="light" onClick={addBox}>
                + Add box
              </Button>
              <Button size="xs" variant="subtle" color="red" onClick={clearBoxes} disabled={boxes.length === 0}>
                Clear all
              </Button>
              {boxes.length === 0 && (
                <Text size="xs" c="dimmed">
                  Click &amp; drag on the image to draw a face box.
                </Text>
              )}
            </Group>
          </Box>

          {/* ── Assignment panel ── */}
          <Paper withBorder p="md" style={{ flex: '0 0 270px' }}>
            <Stack>
              <Text fw={600} size="sm">
                {boxes.length} box{boxes.length !== 1 ? 'es' : ''}
              </Text>

              {boxes.length === 0 && (
                <Text c="dimmed" size="sm">
                  No boxes yet. Draw them on the image, or re-run{' '}
                  <code>npm run setup-camera</code> for auto-detection.
                </Text>
              )}

              {boxes.map((box, i) => (
                <Group
                  key={box.id} gap="xs" wrap="nowrap" align="center"
                  onClick={() => setSelectedId(id => id === box.id ? null : box.id)}
                  style={{
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: 6,
                    background: selectedId === box.id ? 'var(--mantine-color-default-hover)' : 'transparent',
                  }}
                >
                  <Box
                    style={{
                      width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                      background: col(i),
                    }}
                  />
                  <Text size="sm" fw={500} style={{ flexShrink: 0, minWidth: 44 }}>
                    Face {i + 1}
                  </Text>
                  <Select
                    size="xs"
                    placeholder="Speaker…"
                    clearable
                    data={speakers}
                    value={box.speaker || null}
                    onChange={v => setSpeaker(box.id, v ?? '')}
                    style={{ flex: 1 }}
                  />
                  <Tooltip label="Delete box" position="left">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="red"
                      onClick={() => deleteBox(box.id)}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ))}

              {boxes.length > 0 && speakers.length === 0 && (
                <Alert color="yellow">
                  No speakers in transcript yet. Run <code>npm run assign-speakers</code> first.
                </Alert>
              )}

              {boxes.length > 0 && (
                <>
                  <Text size="xs" c="dimmed">
                    {assignedCount} / {boxes.length} assigned
                  </Text>
                  <Button
                    onClick={handleSave}
                    loading={saving}
                    disabled={assignedCount === 0}
                    fullWidth
                  >
                    Save profiles
                  </Button>
                  {assignedCount > 0 && (
                    <Text size="xs" c="dimmed">
                      Saves to public/transcribe/output/camera/camera-profiles.json
                    </Text>
                  )}
                </>
              )}
            </Stack>
          </Paper>
        </Group>
      )}
    </Container>
  );
}
