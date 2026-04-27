'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ActionIcon, Alert, Box, Button, Container, Group,
  Loader, Paper, Select, Stack, Text, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';

// ── Types ────────────────────────────────────────────────────────────────────

type Detection  = { x: number; y: number; w: number; h: number; score: number };
/** `angleName` is set for multi-angle shoots; undefined for single-angle (legacy). */
type FaceBox    = { id: number; x: number; y: number; w: number; h: number; speaker: string; angleName?: string; timeframeIdx?: number };

/** One timeframe entry for dynamic angles (camera angle changes over time). */
type TimeframeInfo = {
  timestamp: number;
  fromTime: number;
  toTime: number;
  frameFile: string;
  detectFile: string;
  timeLabel: string;
};

/** One entry per camera angle from angles.json (written by setup-camera.js). */
type AngleInfo  = {
  angleName: string;
  videoSrc: string;
  frameFile: string;
  detectFile: string;
  /** Multiple timeframes when camera angle changes during filming (dynamic angles). */
  timeframes?: TimeframeInfo[];
};

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

function CameraPageContent() {
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

  // Multi-angle state — null when angles.json is absent (single-angle mode)
  const [angles, setAngles]               = useState<AngleInfo[] | null>(null);
  const [currentAngleIdx, setCurrentAngleIdx] = useState(0);
  const [currentTimeframeIdx, setCurrentTimeframeIdx] = useState(0); // For dynamic angles
  const [angleRawDetections, setAngleRawDetections] = useState<Record<string, Detection[]>>({});
  const [angleImgSizes, setAngleImgSizes] = useState<Record<string, { w: number; h: number }>>({});
  const angleBoxesInitialized             = useRef<Set<string>>(new Set());

  const svgRef     = useRef<SVGSVGElement>(null);
  const nextId     = useRef(1);
  const dragRef    = useRef(drag);
  const imgSizeRef = useRef(imgSize);
  // Refs so async closures (drag events) can read current angle without stale captures
  const anglesRef        = useRef(angles);
  const currentAngleIdxRef = useRef(currentAngleIdx);
  const currentTimeframeIdxRef = useRef(currentTimeframeIdx);
  dragRef.current          = drag;
  imgSizeRef.current       = imgSize;
  anglesRef.current        = angles;
  currentAngleIdxRef.current = currentAngleIdx;
  currentTimeframeIdxRef.current = currentTimeframeIdx;

  // ── Mode: 'shorts' = portrait 9:16 output; default = landscape longform ──────
  const searchParams = useSearchParams();
  const isShorts = searchParams.get('mode') === 'shorts';
  const isPortraitMode = isShorts;
  const outputDims = isShorts ? { w: 1080, h: 1920 } : null;

  // ── Load data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        // ── Transcript (speakers) — same for both single and multi-angle ──────
        const transcriptRes = await fetch('/edit/transcript.json');
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
          setError('Transcript not found. You can still position boxes, but speaker list will be empty until transcript is generated.');
        }

        // ── Try multi-angle (angles.json) first ───────────────────────────────
        const anglesRes = await fetch('/camera/angles.json');
        if (anglesRes.ok) {
          const anglesData: AngleInfo[] = await anglesRes.json();
          if (anglesData.length >= 1) {
            setAngles(anglesData);
            const detMap: Record<string, Detection[]> = {};
            for (const angle of anglesData) {
              // Load detections for primary frame or all timeframes
              const r = await fetch(`/camera/${angle.detectFile}`);
              detMap[angle.angleName] = r.ok ? await r.json() : [];

              // Also load detections for each timeframe if dynamic angles
              if (angle.timeframes) {
                for (const tf of angle.timeframes) {
                  const tfRes = await fetch(`/camera/${tf.detectFile}`);
                  if (tfRes.ok) {
                    detMap[`${angle.angleName}-${tf.timeLabel}`] = await tfRes.json();
                  }
                }
              }
            }
            setAngleRawDetections(detMap);
            if (anglesData.length > 1) return; // multi-angle loaded; skip single-angle path
          }
        }

        // ── Single-angle fallback ─────────────────────────────────────────────
        const detectionsRes = await fetch('/camera/detections.json');
        const dets: Detection[] = detectionsRes.ok ? await detectionsRes.json() : [];
        setRawDetections(dets);
        if (!detectionsRes.ok) {
          setError('Detections file not found. Run camera setup first, or draw boxes manually.');
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Initialise boxes once the real image size is known ───────────────────────

  // Single-angle: initialise from rawDetections + imgSize (unchanged legacy path)
  useEffect(() => {
    if (angles) return; // multi-angle handled below
    if (!imgSize || !rawDetections || boxesInitialized.current) return;
    boxesInitialized.current = true;
    const sourceAspect = imgSize.w / imgSize.h;
    // For portrait shorts, compute viewports targeting 9:16 output
    const outputAspect = isPortraitMode && outputDims ? (outputDims.w / outputDims.h) : sourceAspect;
    // Expand detected face bboxes to the actual closeup viewport size so
    // what you see in the GUI is exactly what will appear in the cut.
    setBoxes(rawDetections.map(d => {
      const vp = computeCloseup(d, sourceAspect, outputAspect);
      return {
        id: nextId.current++,
        x: vp.cx - vp.w / 2,
        y: vp.cy - vp.h / 2,
        w: vp.w,
        h: vp.h,
        speaker: '',
      };
    }));
  }, [angles, imgSize, rawDetections, isPortraitMode, outputDims]);

  // Multi-angle: initialise boxes for the current angle/timeframe once its image has loaded
  useEffect(() => {
    if (!angles) return;
    const currentAngle = angles[currentAngleIdx];
    if (!currentAngle) return;
    const { angleName, timeframes } = currentAngle;

    // Check if we're in dynamic angle mode (multiple timeframes)
    const hasTimeframes = timeframes && timeframes.length > 0;
    const timeframeIdx = hasTimeframes ? currentTimeframeIdx : undefined;
    const timeframe = hasTimeframes ? timeframes[timeframeIdx!] : undefined;

    // Use timeframe-specific key for tracking initialization
    const initKey = hasTimeframes
      ? `${angleName}-${timeframe?.timeLabel}`
      : angleName;

    const aImgSize = angleImgSizes[initKey] || angleImgSizes[angleName];
    const rawDets = hasTimeframes
      ? angleRawDetections[`${angleName}-${timeframe?.timeLabel}`]
      : angleRawDetections[angleName];

    if (!aImgSize || !rawDets || angleBoxesInitialized.current.has(initKey)) return;
    angleBoxesInitialized.current.add(initKey);

    const sourceAspect = aImgSize.w / aImgSize.h;
    // For portrait shorts, compute viewports targeting 9:16 output
    const outputAspect = isPortraitMode && outputDims ? (outputDims.w / outputDims.h) : sourceAspect;
    const newBoxes: FaceBox[] = rawDets.map(d => {
      const vp = computeCloseup(d, sourceAspect, outputAspect);
      return {
        id: nextId.current++,
        x: vp.cx - vp.w / 2,
        y: vp.cy - vp.h / 2,
        w: vp.w,
        h: vp.h,
        speaker: '',
        angleName,
        timeframeIdx: hasTimeframes ? timeframeIdx : undefined,
      };
    });
    if (newBoxes.length > 0) setBoxes(prev => [...prev, ...newBoxes]);
  }, [angles, currentAngleIdx, currentTimeframeIdx, angleImgSizes, angleRawDetections, isPortraitMode, outputDims]);

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
        // ratio = 1 for same-aspect output; portrait uses (outputAspect / sourceAspect)
        // For 9:16 output on 16:9 source: (9/16) / (16/9) ≈ 0.316
        const imgSizeRef = angles ? angleImgSizes[angles[currentAngleIdx]?.angleName] : imgSize;
        const sourceAspect = imgSizeRef ? (imgSizeRef.w / imgSizeRef.h) : (16 / 9);
        const outputAspect = isPortraitMode && outputDims ? (outputDims.w / outputDims.h) : sourceAspect;
        const ratio = outputAspect / sourceAspect;
        const patch = applyResize(d.orig, d.handle, dx, dy, ratio);
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
          const currentAngles = anglesRef.current;
          const currentAngle = currentAngles ? currentAngles[currentAngleIdxRef.current] : undefined;
          const angleName = currentAngle?.angleName;
          const hasTimeframes = currentAngle?.timeframes && currentAngle.timeframes.length > 0;
          const timeframeIdx = hasTimeframes ? currentTimeframeIdxRef.current : undefined;
          setBoxes(prev => [...prev, { id: nextId.current++, x: bx, y: by, w: bw, h: bh, speaker: '', angleName, timeframeIdx }]);
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

  const addBox = () => {
    const currentAngle = angles?.[currentAngleIdx];
    const angleName = currentAngle?.angleName;
    const hasTimeframes = currentAngle?.timeframes && currentAngle.timeframes.length > 0;
    const timeframeIdx = hasTimeframes ? currentTimeframeIdx : undefined;
    setBoxes(prev => [...prev, { id: nextId.current++, x: 0.1, y: 0.1, w: 0.2, h: 0.35, speaker: '', angleName, timeframeIdx }]);
  };

  const clearBoxes = () => {
    if (currentAngleName) {
      // Multi-angle with timeframes: only clear boxes for the currently visible timeframe
      const currentAngle = angles?.[currentAngleIdx];
      const hasTimeframes = currentAngle?.timeframes && currentAngle.timeframes.length > 0;
      if (hasTimeframes) {
        setBoxes(prev => prev.filter(b => !(b.angleName === currentAngleName && b.timeframeIdx === currentTimeframeIdx)));
      } else {
        // Multi-angle without timeframes: clear all boxes for this angle
        setBoxes(prev => prev.filter(b => b.angleName !== currentAngleName));
      }
    } else {
      setBoxes([]);
    }
  };

  const setSpeaker = (id: number, speaker: string) =>
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, speaker } : b));

  // ── Timeframe switching with speaker label carryover ─────────────────────────

  const switchToTimeframe = (newTimeframeIdx: number) => {
    const currentAngle = angles?.[currentAngleIdx];
    if (!currentAngle?.timeframes) {
      setCurrentTimeframeIdx(newTimeframeIdx);
      return;
    }

    const angleName = currentAngle.angleName;
    const prevTimeframeIdx = currentTimeframeIdx;

    // Get speaker assignments from current timeframe boxes
    const prevBoxes = boxes.filter(b => b.angleName === angleName && b.timeframeIdx === prevTimeframeIdx);
    const speakerAssignments = new Map<number, string>(); // box id -> speaker
    prevBoxes.forEach((box, idx) => {
      if (box.speaker) {
        speakerAssignments.set(idx, box.speaker); // Use index as key for matching
      }
    });

    setCurrentTimeframeIdx(newTimeframeIdx);

    // Apply speaker labels to new timeframe boxes if they exist
    if (speakerAssignments.size > 0) {
      setTimeout(() => {
        setBoxes(prev => {
          const newBoxes = [...prev];
          const targetBoxes = newBoxes.filter(b => b.angleName === angleName && b.timeframeIdx === newTimeframeIdx);

          // Match by spatial proximity or index
          targetBoxes.forEach((box, idx) => {
            const speaker = speakerAssignments.get(idx);
            if (speaker && !box.speaker) {
              box.speaker = speaker;
            }
          });

          return newBoxes;
        });
      }, 0);
    }
  };

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const speakerMap: Record<string, object> = {};
    const r4 = (n: number) => Math.round(n * 10000) / 10000;

    // Group boxes by speaker and angle (critical for multi-angle with timeframes)
    const boxesBySpeakerAngle = new Map<string, FaceBox[]>();
    for (const box of boxes) {
      if (!box.speaker) continue;
      const key = `${box.speaker}:${box.angleName || 'default'}`;
      if (!boxesBySpeakerAngle.has(key)) {
        boxesBySpeakerAngle.set(key, []);
      }
      boxesBySpeakerAngle.get(key)!.push(box);
    }

    // Build speaker profiles with time-keyed viewports when applicable
    for (const [key, speakerBoxes] of boxesBySpeakerAngle) {
      const speaker = key.split(':')[0];
      // Check if this speaker has time-keyed viewports (different boxes at different times)
      const hasTimeframes = speakerBoxes.some(b => b.timeframeIdx !== undefined);

      if (hasTimeframes) {
        // Sort by timeframe index
        const sortedBoxes = [...speakerBoxes].sort((a, b) =>
          (a.timeframeIdx ?? 0) - (b.timeframeIdx ?? 0)
        );

        // Get the angle info to determine time ranges
        const angleName = sortedBoxes[0].angleName;
        const angle = angles?.find(a => a.angleName === angleName);
        const timeframes = angle?.timeframes;

        // Build closeupViewportsByTime
        const closeupViewportsByTime = sortedBoxes.map(box => {
          const tfIdx = box.timeframeIdx ?? 0;
          const timeframe = timeframes?.[tfIdx];
          return {
            from: timeframe?.fromTime ?? 0,
            to: timeframe?.toTime ?? 0,
            viewport: {
              cx: r4(box.x + box.w / 2),
              cy: r4(box.y + box.h / 2),
              w: r4(box.w),
              h: r4(box.h),
            },
          };
        });

        // Use first viewport as default closeupViewport
        const firstBox = sortedBoxes[0];
        const cx = r4(firstBox.x + firstBox.w / 2);
        const cy = r4(firstBox.y + firstBox.h / 2);

        // Use speaker+angle as key to prevent overwriting when speaker appears on multiple angles
        const mapKey = angleName ? `${speaker}:${angleName}` : speaker;
        speakerMap[mapKey] = {
          label: speaker,
          closeupViewport: { cx, cy, w: r4(firstBox.w), h: r4(firstBox.h) },
          closeupViewportsByTime,
          portraitCx: cx,
          ...(angleName ? { angleName } : {}),
        };
      } else {
        // Single viewport (no timeframes)
        const box = speakerBoxes[0];
        const cx = r4(box.x + box.w / 2);
        const cy = r4(box.y + box.h / 2);
        const boxAngleName = box.angleName;
        const mapKey = boxAngleName ? `${speaker}:${boxAngleName}` : speaker;
        speakerMap[mapKey] = {
          label: speaker,
          closeupViewport: { cx, cy, w: r4(box.w), h: r4(box.h) },
          portraitCx: cx,
          ...(boxAngleName ? { angleName: boxAngleName } : {}),
        };
      }
    }

    // Primary source dimensions: angle1 for multi-angle, or the single frame
    const primaryAngleName = angles?.[0]?.angleName;
    const primarySize = primaryAngleName ? angleImgSizes[primaryAngleName] : null;
    const sw = primarySize?.w ?? imgSize?.w ?? 1920;
    const sh = primarySize?.h ?? imgSize?.h ?? 1080;

    // Build angles config for multi-angle shoots (include time-keyed wide viewports per angle if needed)
    const anglesConfig = angles
      ? Object.fromEntries(
          angles.map(a => {
            const aSize = angleImgSizes[a.angleName];
            const result: Record<string, unknown> = {
              videoSrc:     a.videoSrc,
              sourceWidth:  aSize?.w ?? sw,
              sourceHeight: aSize?.h ?? sh,
            };

            // If angle has timeframes, include wideViewportsByTime
            if (a.timeframes && a.timeframes.length > 0) {
              // For now, wide viewports are constant per angle
              // In future, could support time-keyed wide viewports too
              result.wideViewport = { cx: 0.5, cy: 0.5, w: 1.0, h: 1.0 };
            }

            return [a.angleName, result];
          })
        )
      : undefined;

    // Use portrait dimensions when in portrait mode (9:16 shorts), otherwise match source
    const outW = isPortraitMode && outputDims ? outputDims.w : sw;
    const outH = isPortraitMode && outputDims ? outputDims.h : sh;

    const profiles = {
      sourceWidth:  sw,
      sourceHeight: sh,
      outputWidth:  outW,
      outputHeight: outH,
      wideViewport: { cx: 0.5, cy: 0.5, w: 1.0, h: 1.0 },
      speakers: speakerMap,
      ...(anglesConfig ? { angles: anglesConfig } : {}),
    };

    setSaving(true);
    try {
      const saveUrl = isShorts
        ? '/api/camera/save-profiles?dest=shorts'
        : '/api/camera/save-profiles';
      const res = await fetch(saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profiles),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const dest = isShorts ? 'public/shorts/camera-profiles.json' : 'public/camera/camera-profiles.json';
      notifications.show({ color: 'green', message: `Saved to ${dest}` });
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

  // In multi-angle mode, only show the current angle/timeframe's boxes on the canvas
  const currentAngle = angles?.[currentAngleIdx];
  const currentAngleName = currentAngle?.angleName;
  const currentTimeframes = currentAngle?.timeframes;
  const hasTimeframes = currentTimeframes && currentTimeframes.length > 0;

  const visibleBoxes = currentAngleName
    ? hasTimeframes
      ? boxes.filter(b => b.angleName === currentAngleName && b.timeframeIdx === currentTimeframeIdx)
      : boxes.filter(b => b.angleName === currentAngleName)
    : boxes;

  // Frame image path: per-angle/timeframe in multi-angle mode, legacy path otherwise
  const frameSrc = angles
    ? hasTimeframes
      ? `/camera/${currentTimeframes[currentTimeframeIdx]?.frameFile}`
      : `/camera/${angles[currentAngleIdx]?.frameFile}`
    : '/camera/frame.jpg';

  const assignedCount = boxes.filter(b => b.speaker).length;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Container size="xl" py="xl">
      <Group mb={4}>
        <Title order={2}>Camera Setup</Title>
        {isPortraitMode && (
          <Text size="xs" c="teal" bg="teal.0" px={8} py={2} style={{ borderRadius: 4 }}>
            9:16 Portrait Mode
          </Text>
        )}
      </Group>
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
          <Box style={{ flex: '1 1 auto', lineHeight: 0 }}>

            {/* Angle tabs — shown in multi-angle mode or when timeframes exist */}
            {angles && angles.length > 1 && (
              <Group mb="xs" gap="xs">
                {angles.map((angle, i) => (
                  <Button
                    key={angle.angleName}
                    size="xs"
                    variant={i === currentAngleIdx ? 'filled' : 'light'}
                    onClick={() => {
                      setCurrentAngleIdx(i);
                      setCurrentTimeframeIdx(0); // Reset timeframe when switching angles
                    }}
                  >
                    {angle.angleName}
                  </Button>
                ))}
              </Group>
            )}

            {/* Timeframe tabs — shown when current angle has multiple timeframes (dynamic angles) */}
            {hasTimeframes && currentTimeframes && (
              <Group mb="xs" gap="xs">
                <Text size="xs" c="dimmed" mr="xs">Timeframe:</Text>
                {currentTimeframes.map((tf, i) => (
                  <Button
                    key={tf.timeLabel}
                    size="xs"
                    variant={i === currentTimeframeIdx ? 'filled' : 'light'}
                    color={i === currentTimeframeIdx ? 'teal' : 'gray'}
                    onClick={() => switchToTimeframe(i)}
                  >
                    {tf.timeLabel}
                  </Button>
                ))}
              </Group>
            )}

            <Box style={{ position: 'relative' }}>
              <img
              src={frameSrc}
              alt="Video frame"
              onLoad={e => {
                const img = e.currentTarget;
                const newSize = { w: img.naturalWidth, h: img.naturalHeight };
                if (angles && currentAngleName) {
                  setAngleImgSizes(prev => ({ ...prev, [currentAngleName]: newSize }));
                } else {
                  setImgSize(newSize);
                }
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
              <rect x={0} y={0} width={1} height={1} fill="transparent" style={{ pointerEvents: 'none' }} />

              {/* Render non-selected boxes first (behind), selected box last (on top) */}
              {[...visibleBoxes]
                .sort((a, b) => (a.id === selectedId ? 1 : 0) - (b.id === selectedId ? 1 : 0))
                .map((box) => {
                  const i = visibleBoxes.indexOf(box);
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
              <Button size="xs" variant="subtle" color="red" onClick={clearBoxes} disabled={visibleBoxes.length === 0}>
                Clear all
              </Button>
              {visibleBoxes.length === 0 && (
                <Text size="xs" c="dimmed">
                  Click &amp; drag on the image to draw a face box.
                </Text>
              )}
            </Group>
          </Box>
          </Box>

          {/* ── Assignment panel ── */}
          <Paper withBorder p="md" style={{ flex: '0 0 270px' }}>
            <Stack>
              <Text fw={600} size="sm">
                {boxes.length} box{boxes.length !== 1 ? 'es' : ''}
                {angles && angles.length > 1 && ` across ${angles.length} angles`}
              </Text>

              {boxes.length === 0 && (
                <Text c="dimmed" size="sm">
                  No boxes yet. Draw them on the image, or re-run{' '}
                  <code>npm run setup-camera</code> for auto-detection.
                </Text>
              )}

              {visibleBoxes.map((box, i) => (
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

              {visibleBoxes.length > 0 && (
                <>
                  <Text size="xs" c="dimmed">
                    {visibleBoxes.filter(b => b.speaker).length} / {visibleBoxes.length} assigned (this angle)
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
                      Saves to public/camera/camera-profiles.json
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

export default function CameraPage() {
  return (
    <Suspense>
      <CameraPageContent />
    </Suspense>
  );
}
