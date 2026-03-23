import {
  OffthreadVideo,
  Audio,
  Sequence,
  staticFile,
  CalculateMetadataFunction,
  useVideoConfig,
  delayRender,
  continueRender,
} from 'remotion';
import { parseMedia } from '@remotion/media-parser';
import React, { useState, useEffect } from 'react';
import { SegmentPlayer, getEffectiveDuration } from './components/SegmentPlayer';
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

function computeEffectiveDuration(transcript: Transcript): number {
  return transcript.segments
    .filter(s => !s.cut)
    .reduce((sum, s) => sum + getEffectiveDuration(s), 0);
}

export const calculateMetadata: CalculateMetadataFunction<MyCompositionProps> = async ({ props }) => {
  const fps = 60;
  const fallback = { durationInFrames: 300, fps, width: 1920, height: 1080 };

  try {
    const src = staticFile(normalizeStaticPath(props.src));
    const parsed = await parseMedia({
      src,
      fields: { slowDurationInSeconds: true, dimensions: true },
    });

    if (parsed.dimensions === null) return fallback;

    const durationInFrames = props.transcriptSrc
      ? Math.max(1, Math.floor(computeEffectiveDuration(await fetchTranscript(props.transcriptSrc)) * fps))
      : Math.max(1, Math.floor(parsed.slowDurationInSeconds * fps));

    return { durationInFrames, fps, width: parsed.dimensions.width, height: parsed.dimensions.height };
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

    let frameOffset = 0;
    const layout = transcript.segments
      .filter(s => !s.cut)
      .map(segment => {
        const durationFrames = Math.round(getEffectiveDuration(segment) * fps);
        const from = frameOffset;
        frameOffset += durationFrames;
        return { segment, from, durationFrames };
      })
      .filter(({ durationFrames }) => durationFrames > 0);

    return (
      <>
        {layout.map(({ segment, from, durationFrames }) => (
          <Sequence key={segment.id} from={from} durationInFrames={durationFrames}>
            <SegmentPlayer src={resolvedSrc} segment={segment} />
          </Sequence>
        ))}
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
