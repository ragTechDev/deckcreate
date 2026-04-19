'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Container, Title, Group, Button, Text, Stack, Box,
  Paper, ActionIcon, Tooltip, Kbd, Badge,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlayerPlay, IconPlayerPause, IconScissors, IconDeviceFloppy,
  IconArrowsMaximize,
} from '@tabler/icons-react';
import type { Transcript, TimeCut, CameraCue } from '../../remotion/types/transcript';
import type { CameraProfiles } from '../../remotion/types/camera';
import { Timeline, fmtTimecode } from './Timeline';
import { useTimelineNav } from './useTimelineNav';

const PALETTE = ['#4C6EF5', '#27AE60', '#E67700', '#9B59B6', '#0C8599', '#E03131'];

function buildSpeakerColors(segments: Transcript['segments']): Record<string, string> {
  const speakers = [...new Set(segments.map(s => s.speaker))];
  return Object.fromEntries(speakers.map((name, i) => [name, PALETTE[i % PALETTE.length]]));
}

function fmt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

type VisualCutsMap = Map<number, TimeCut[]>;
type CameraCuesMap = Map<number, CameraCue[]>;

export default function EditorPage() {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [speakerColors, setSpeakerColors] = useState<Record<string, string>>({});
  const [visualCuts, setVisualCuts] = useState<VisualCutsMap>(new Map());
  const [cameraCues, setCameraCues] = useState<CameraCuesMap>(new Map());
  const [cameraProfiles, setCameraProfiles] = useState<CameraProfiles | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  const totalForNav = videoDuration || (transcript?.meta.duration ?? 0);
  const { zoom, pan: panOffset, setZoomAndPan, panTo, fitAll, zoomToPreset } = useTimelineNav({
    totalDuration: totalForNav,
    currentTime,
    isPlaying,
    videoStart: transcript?.meta.videoStart,
    videoEnd: transcript?.meta.videoEnd,
  });

  useEffect(() => {
    fetch('/transcribe/output/edit/transcript.json')
      .then(r => r.json())
      .then((data: Transcript) => {
        setTranscript(data);
        setSpeakerColors(buildSpeakerColors(data.segments));
        const vcMap: VisualCutsMap = new Map();
        const ccMap: CameraCuesMap = new Map();
        for (const seg of data.segments) {
          vcMap.set(seg.id, [...(seg.visualCuts ?? [])]);
          ccMap.set(seg.id, [...(seg.cameraCues ?? [])]);
        }
        setVisualCuts(vcMap);
        setCameraCues(ccMap);
      });
    // Load camera profiles — non-fatal if absent
    fetch('/transcribe/output/camera/camera-profiles.json')
      .then(r => r.ok ? r.json() : null)
      .then((data: CameraProfiles | null) => { if (data) setCameraProfiles(data); })
      .catch(() => {});
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  }, []);

  const seekTo = useCallback((time: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = time;
    setCurrentTime(time);
  }, []);

  const handleAddVisualCut = useCallback((segId: number, cut: TimeCut) => {
    setVisualCuts(prev => {
      const next = new Map(prev);
      next.set(segId, [...(next.get(segId) ?? []), cut]);
      return next;
    });
    setDirty(true);
  }, []);

  const handleMarkIn = useCallback(() => setMarkIn(currentTime), [currentTime]);

  const handleMarkOut = useCallback(() => {
    if (markIn === null || !transcript) return;
    const from = Math.min(markIn, currentTime);
    const to = Math.max(markIn, currentTime);
    if (to - from < 0.05) { setMarkIn(null); return; }
    const seg = transcript.segments.find(s => from >= s.start && from < s.end);
    if (!seg) { setMarkIn(null); return; }
    handleAddVisualCut(seg.id, { from, to: Math.min(to, seg.end) });
    setMarkIn(null);
  }, [markIn, currentTime, transcript, handleAddVisualCut]);

  const removeVisualCut = useCallback((segId: number, idx: number) => {
    setVisualCuts(prev => {
      const next = new Map(prev);
      const arr = [...(next.get(segId) ?? [])];
      arr.splice(idx, 1);
      next.set(segId, arr);
      return next;
    });
    setDirty(true);
  }, []);

  const handleCueMoved = useCallback((segId: number, cueIdx: number, newAt: number) => {
    setCameraCues(prev => {
      const next = new Map(prev);
      const arr = [...(next.get(segId) ?? [])];
      if (arr[cueIdx]) arr[cueIdx] = { ...arr[cueIdx], at: newAt };
      next.set(segId, arr);
      return next;
    });
    setDirty(true);
  }, []);

  const handleCueAdded = useCallback((segId: number, at: number, shot: 'closeup' | 'wide', speaker?: string) => {
    setCameraCues(prev => {
      const next = new Map(prev);
      const arr = [...(next.get(segId) ?? []), { shot, speaker, at }];
      arr.sort((a, b) => a.at - b.at);
      next.set(segId, arr);
      return next;
    });
    setDirty(true);
  }, []);

  const handleCueDeleted = useCallback((segId: number, cueIdx: number) => {
    setCameraCues(prev => {
      const next = new Map(prev);
      const arr = [...(next.get(segId) ?? [])];
      arr.splice(cueIdx, 1);
      next.set(segId, arr);
      return next;
    });
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!transcript) return;
    const updated: Transcript = {
      ...transcript,
      segments: transcript.segments.map(seg => ({
        ...seg,
        visualCuts: visualCuts.get(seg.id) ?? seg.visualCuts ?? [],
        cameraCues: cameraCues.get(seg.id) ?? seg.cameraCues ?? [],
      })),
    };
    const res = await fetch('/api/editor/save-transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (res.ok) {
      setDirty(false);
      notifications.show({ message: 'Saved to transcript.json and transcript.doc.txt', color: 'green' });
    } else {
      notifications.show({ message: 'Save failed', color: 'red' });
    }
  }, [transcript, visualCuts, cameraCues]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      if (e.key === 'i' || e.key === 'I') handleMarkIn();
      if (e.key === 'o' || e.key === 'O') handleMarkOut();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, handleMarkIn, handleMarkOut]);

  if (!transcript) return <Container py="xl"><Text>Loading…</Text></Container>;

  const videoSrc = transcript.meta.videoSrc ?? transcript.meta.videoSrcs?.[0];
  const total = videoDuration || transcript.meta.duration;
  const fps = transcript.meta.fps ?? 60;

  const tokenCutEntries = transcript.segments.flatMap(seg =>
    (seg.cuts ?? []).map((c, i) => ({ seg, cut: c, idx: i, kind: 'token' as const }))
  );
  const visualCutEntries = Array.from(visualCuts.entries())
    .flatMap(([segId, cuts]) => {
      const seg = transcript.segments.find(s => s.id === segId);
      return seg ? cuts.map((c, i) => ({ seg, cut: c, idx: i, kind: 'visual' as const })) : [];
    })
    .sort((a, b) => a.cut.from - b.cut.from);
  const allCutEntries = [...tokenCutEntries, ...visualCutEntries].sort((a, b) => a.cut.from - b.cut.from);

  return (
    <Container size="xl" py="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={2}>Video Editor</Title>
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={handleSave}
            disabled={!dirty}
            variant={dirty ? 'filled' : 'default'}
          >
            {dirty ? 'Save Changes' : 'Saved'}
          </Button>
        </Group>

        {/* Video player */}
        <Paper withBorder style={{ background: '#000', borderRadius: 8, overflow: 'hidden' }}>
          <video
            ref={videoRef}
            src={videoSrc ? `/${videoSrc}` : undefined}
            style={{ width: '100%', display: 'block', maxHeight: '56vh', objectFit: 'contain' }}
            onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
            onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        </Paper>

        {/* Transport controls */}
        <Paper withBorder p="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="xs">
              <ActionIcon onClick={togglePlay} size="lg" variant="filled" radius="xl">
                {isPlaying ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
              </ActionIcon>
              <Text ff="monospace" size="sm" style={{ minWidth: 118 }}>
                {fmtTimecode(currentTime, fps)}
              </Text>
              <Text size="xs" c="dimmed">/ {fmt(total)}</Text>
            </Group>

            <Group gap="xs">
              <Tooltip label="Mark the start of a cut range (I)">
                <Button
                  size="xs"
                  variant={markIn !== null ? 'filled' : 'default'}
                  color="orange"
                  leftSection={<IconScissors size={14} />}
                  onClick={handleMarkIn}
                >
                  {markIn !== null ? `In @ ${fmtTimecode(markIn, fps)}` : 'Mark In'}
                </Button>
              </Tooltip>
              <Tooltip label="Confirm cut to current position (O)">
                <Button
                  size="xs"
                  color="red"
                  leftSection={<IconScissors size={14} />}
                  onClick={handleMarkOut}
                  disabled={markIn === null}
                >
                  Mark Out
                </Button>
              </Tooltip>
            </Group>

            <Group gap={6}>
              <Text size="xs" c="dimmed"><Kbd size="xs">Space</Kbd> play</Text>
              <Text size="xs" c="dimmed"><Kbd size="xs">I</Kbd> in</Text>
              <Text size="xs" c="dimmed"><Kbd size="xs">O</Kbd> out</Text>
            </Group>
          </Group>
        </Paper>

        {/* Timeline */}
        <Paper withBorder p="sm" style={{ background: '#111213' }}>
          <Group justify="space-between" mb={8}>
            <Group gap="xs">
              <Text size="xs" style={{ color: 'rgba(255,255,255,0.45)' }}>scroll to zoom · drag to pan · drag clip edges to trim</Text>
            </Group>
            <Group gap="xs">
              {zoom > 1 && (
                <Text size="xs" ff="monospace" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {fmtTimecode(panOffset, fps)} – {fmtTimecode(panOffset + total / zoom, fps)}
                </Text>
              )}
              <Text
                size="xs" ff="monospace"
                style={{ cursor: zoom > 1 ? 'pointer' : 'default', color: zoom > 1 ? '#74c0fc' : 'rgba(255,255,255,0.45)' }}
                onClick={fitAll}
              >
                {zoom.toFixed(1)}×
              </Text>
              <Tooltip label="Fit entire video">
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={fitAll}>
                  <IconArrowsMaximize size={12} />
                </ActionIcon>
              </Tooltip>
              <Button.Group>
                <Tooltip label="Fit full video (zoom out)">
                  <Button size="xs" variant="subtle" color="gray" px={8} onClick={() => zoomToPreset('full')}>Full</Button>
                </Tooltip>
                <Tooltip label="Fit content window">
                  <Button size="xs" variant="subtle" color="gray" px={8} onClick={() => zoomToPreset('clips')}>Clips</Button>
                </Tooltip>
                <Tooltip label="Max zoom at playhead">
                  <Button size="xs" variant="subtle" color="gray" px={8} onClick={() => zoomToPreset('frames')}>Frames</Button>
                </Tooltip>
              </Button.Group>
            </Group>
          </Group>

          <Timeline
            transcript={transcript}
            speakerColors={speakerColors}
            visualCuts={visualCuts}
            currentTime={currentTime}
            totalDuration={total}
            zoom={zoom}
            panOffset={panOffset}
            markIn={markIn}
            onSeek={seekTo}
            onZoomChange={(z, p) => setZoomAndPan(z, p)}
            onPanChange={panTo}
            onAddVisualCut={handleAddVisualCut}
            cameraProfiles={cameraProfiles}
            cameraCues={cameraCues}
            onCueMoved={handleCueMoved}
            onCueAdded={handleCueAdded}
            onCueDeleted={handleCueDeleted}
          />

          {/* Legend */}
          <Group mt={10} gap="xs">
            {Object.entries(speakerColors).map(([name, color]) => (
              <Group key={name} gap={4}>
                <Box style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                <Text size="xs" style={{ color: 'rgba(255,255,255,0.75)' }}>{name}</Text>
              </Group>
            ))}
            <Group gap={4}>
              <Box style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(220,53,69,0.35)' }} />
              <Text size="xs" style={{ color: 'rgba(255,255,255,0.75)' }}>Cut (doc)</Text>
            </Group>
            <Group gap={4}>
              <Box style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(220,53,69,0.8)' }} />
              <Text size="xs" style={{ color: 'rgba(255,255,255,0.75)' }}>Cut (editor)</Text>
            </Group>
            <Group gap={4}>
              <Box style={{
                width: 10, height: 10, borderRadius: 2,
                background: 'repeating-linear-gradient(135deg,rgba(255,255,255,0.06) 0px,rgba(255,255,255,0.06) 3px,#1a1b1e 3px,#1a1b1e 6px)',
              }} />
              <Text size="xs" style={{ color: 'rgba(255,255,255,0.75)' }}>Excluded</Text>
            </Group>
          </Group>
        </Paper>

        {/* Cuts list */}
        {allCutEntries.length > 0 && (
          <Paper withBorder p="sm">
            <Text size="sm" fw={600} mb={8}>Cuts ({allCutEntries.length})</Text>
            <Stack gap={4}>
              {allCutEntries.map(({ seg, cut, idx, kind }) => (
                <Group key={`${kind}-${seg.id}-${idx}`} justify="space-between" py={2}
                  style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
                  <Group gap="xs">
                    <Box style={{
                      width: 8, height: 8, borderRadius: 2,
                      background: speakerColors[seg.speaker] ?? '#888', flexShrink: 0,
                    }} />
                    <Text size="xs" c="dimmed" style={{ minWidth: 60 }}>{seg.speaker}</Text>
                    <Text size="xs" ff="monospace">
                      {fmt(cut.from)} → {fmt(cut.to)}
                    </Text>
                    <Text size="xs" c="dimmed">({(cut.to - cut.from).toFixed(2)}s)</Text>
                    <Badge size="xs" variant="light" color={kind === 'visual' ? 'red' : 'gray'}>
                      {kind === 'visual' ? 'editor' : 'doc'}
                    </Badge>
                  </Group>
                  <Group gap="xs">
                    <Button size="xs" variant="subtle" color="blue" onClick={() => seekTo(cut.from)}>
                      Seek
                    </Button>
                    {kind === 'visual' && (
                      <Button size="xs" variant="subtle" color="red" onClick={() => removeVisualCut(seg.id, idx)}>
                        Remove
                      </Button>
                    )}
                  </Group>
                </Group>
              ))}
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
