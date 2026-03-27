import {
  OffthreadVideo,
  Audio,
  staticFile,
  CalculateMetadataFunction,
  useVideoConfig,
  delayRender,
  continueRender,
} from 'remotion';
import React, { useState, useEffect } from 'react';
import { SegmentPlayer, buildSections, getEffectiveDuration } from './components/SegmentPlayer';
import { CameraPlayer } from './components/CameraPlayer';
import type { Transcript } from './types/transcript';
import type { CameraProfiles } from './types/camera';

type MyCompositionProps = {
  src: string;
  audioSrc?: string;
  audioStartFrom?: number;
  /** Path to transcript.json relative to /public, e.g. "output/transcript.json" */
  transcriptSrc?: string;
  /** Path to camera-profiles.json relative to /public. When set, enables punch-in/punch-out cuts. */
  cameraProfilesSrc?: string;
};

const normalizeStaticPath = (src: string) => src.replace(/^\/+/, '');

async function fetchTranscript(transcriptSrc: string): Promise<Transcript> {
  const res = await fetch(staticFile(normalizeStaticPath(transcriptSrc)));
  if (!res.ok) throw new Error(`Failed to load transcript: ${res.status}`);
  return res.json();
}

/** Returns only the segments within the video window defined by meta.videoStart/End. */
function getActiveSegments(transcript: Transcript) {
  const { videoStart, videoEnd } = transcript.meta;
  return transcript.segments.filter(s => {
    if (videoStart !== undefined && s.start < videoStart) return false;
    if (videoEnd !== undefined && s.end > videoEnd) return false;
    return true;
  });
}

function computeEffectiveDuration(transcript: Transcript): number {
  const hookDuration = transcript.segments
    .filter(s => s.hook && !s.cut)
    .reduce((sum, s) => {
      if (s.hookFrom !== undefined && s.hookTo !== undefined) return sum + (s.hookTo - s.hookFrom);
      return sum + getEffectiveDuration(s);
    }, 0);
  const mainDuration = getActiveSegments(transcript)
    .filter(s => !s.hook && !s.cut)
    .reduce((sum, s) => sum + getEffectiveDuration(s), 0);
  return hookDuration + mainDuration;
}

export const calculateMetadata: CalculateMetadataFunction<MyCompositionProps> = async ({ props }) => {
  const fps = 60;
  const fallback = { durationInFrames: 300, fps, width: 1920, height: 1080 };

  if (!props.transcriptSrc) return fallback;

  try {
    const transcript = await fetchTranscript(props.transcriptSrc);
    const durationInFrames = Math.max(1, Math.floor(computeEffectiveDuration(transcript) * fps));
    return { durationInFrames, fps, width: 1920, height: 1080 };
  } catch {
    return fallback;
  }
};

async function fetchCameraProfiles(src: string): Promise<CameraProfiles> {
  const res = await fetch(staticFile(normalizeStaticPath(src)));
  if (!res.ok) throw new Error(`Failed to load camera profiles: ${res.status}`);
  return res.json();
}

export const MyComposition = ({
  src,
  audioSrc,
  audioStartFrom = 0,
  transcriptSrc,
  cameraProfilesSrc,
}: MyCompositionProps) => {
  const { fps } = useVideoConfig();
  const audioStartFromFrames = Math.max(0, Math.round(audioStartFrom * fps));
  const resolvedSrc = staticFile(normalizeStaticPath(src));

  const [transcript, setTranscript]             = useState<Transcript | null>(null);
  const [cameraProfiles, setCameraProfiles]     = useState<CameraProfiles | null>(null);
  const [cameraReady, setCameraReady]           = useState(!cameraProfilesSrc);

  const [transcriptHandle] = useState(() => transcriptSrc    ? delayRender('Loading transcript')       : null);
  const [cameraHandle]     = useState(() => cameraProfilesSrc ? delayRender('Loading camera profiles') : null);

  useEffect(() => {
    if (!transcriptSrc || !transcriptHandle) return;
    fetchTranscript(transcriptSrc)
      .then(data => { setTranscript(data); continueRender(transcriptHandle); })
      .catch(err => { console.error(err); continueRender(transcriptHandle); });
  }, [transcriptSrc, transcriptHandle]);

  useEffect(() => {
    if (!cameraProfilesSrc || !cameraHandle) return;
    fetchCameraProfiles(cameraProfilesSrc)
      .then(data => { setCameraProfiles(data); })
      .catch(err => { console.warn('Camera profiles not loaded (will render without):', err.message); })
      .finally(() => { setCameraReady(true); continueRender(cameraHandle); });
  }, [cameraProfilesSrc, cameraHandle]);

  // ── Transcript-driven rendering ─────────────────────────────────────────────
  if (transcriptSrc) {
    if (!transcript) return null;
    if (!cameraReady) return null;

    // Hook segments come first (order matches buildSections and the SRT output),
    // then main segments within the videoStart/videoEnd window.
    const hookSegments = transcript.segments.filter(s => s.hook && !s.cut);
    const mainSegments = getActiveSegments(transcript).filter(s => !s.hook);
    const orderedSegments = [...hookSegments, ...mainSegments];
    const sections = buildSections(orderedSegments, fps);

    const videoEl = cameraProfiles
      ? (
        <CameraPlayer
          src={resolvedSrc}
          sections={sections}
          segments={orderedSegments}
          profiles={cameraProfiles}
        />
      )
      : <SegmentPlayer src={resolvedSrc} sections={sections} />;

    return (
      <>
        {videoEl}
        {audioSrc && (
          <Audio
            src={staticFile(normalizeStaticPath(audioSrc))}
            startFrom={audioStartFromFrames}
          />
        )}
      </>
    );
  }

  // ── Plain video rendering (no transcript) ───────────────────────────────────
  return (
    <>
      <OffthreadVideo src={resolvedSrc} muted={!!audioSrc} />
      {audioSrc && (
        <Audio
          src={staticFile(normalizeStaticPath(audioSrc))}
          startFrom={audioStartFromFrames}
        />
      )}
    </>
  );
};
