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
import type { Transcript } from './types/transcript';

type MyCompositionProps = {
  src: string;
  audioSrc?: string;
  audioStartFrom?: number;
  /** Path to transcript.json relative to /public, e.g. "output/transcript.json" */
  transcriptSrc?: string;
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
  return getActiveSegments(transcript)
    .filter(s => !s.cut)
    .reduce((sum, s) => sum + getEffectiveDuration(s), 0);
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

export const MyComposition = ({
  src,
  audioSrc,
  audioStartFrom = 0,
  transcriptSrc,
}: MyCompositionProps) => {
  const { fps } = useVideoConfig();
  const audioStartFromFrames = Math.max(0, Math.round(audioStartFrom * fps));
  const resolvedSrc = staticFile(normalizeStaticPath(src));

  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [handle] = useState(() => transcriptSrc ? delayRender('Loading transcript') : null);

  useEffect(() => {
    if (!transcriptSrc || !handle) return;
    fetchTranscript(transcriptSrc)
      .then(data => { setTranscript(data); continueRender(handle); })
      .catch(err => { console.error(err); continueRender(handle); });
  }, [transcriptSrc, handle]);

  // ── Transcript-driven rendering ─────────────────────────────────────────────
  if (transcriptSrc) {
    if (!transcript) return null;

    const sections = buildSections(getActiveSegments(transcript), fps);

    return (
      <>
        <SegmentPlayer src={resolvedSrc} sections={sections} />
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
