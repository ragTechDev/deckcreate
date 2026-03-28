import {
  OffthreadVideo,
  Audio,
  Loop,
  Sequence,
  staticFile,
  CalculateMetadataFunction,
  useVideoConfig,
  delayRender,
  continueRender,
  useCurrentFrame,
} from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';
import React, { useState, useEffect, useMemo } from 'react';
import { SegmentPlayer, buildSections, getEffectiveDuration } from './components/SegmentPlayer';
import { CameraPlayer } from './components/CameraPlayer';
import { HookOverlay } from './components/HookOverlay';
import { PodcastIntroComposition, INTRO_DURATION_FRAMES } from './components/PodcastIntro';
import { loadNunito } from './loadFonts';
import type { Transcript, Segment } from './types/transcript';
import type { CameraProfiles } from './types/camera';
import type { Brand } from './types/brand';

type MyCompositionProps = {
  src: string;
  audioSrc?: string;
  audioStartFrom?: number;
  /** Path to transcript.json relative to /public, e.g. "output/transcript.json" */
  transcriptSrc?: string;
  /** Path to camera-profiles.json relative to /public. When set, enables punch-in/punch-out cuts. */
  cameraProfilesSrc?: string;
  /** Path to brand.json relative to /public. Defaults to "brand.json". */
  brandSrc?: string;
  /**
   * Path to hook intro music relative to /public. Defaults to "sounds/hook-music.mp3".
   * Place your audio file there (e.g. the "Euphoric" track from Remotion's asset library).
   * Set to empty string "" to disable hook music.
   */
  hookMusicSrc?: string;
  /** Duration of the hook music track in seconds — set by calculateMetadata for looping. */
  hookMusicDurationSecs?: number;
};

const normalizeStaticPath = (src: string) => src.replace(/^\/+/, '');

async function fetchJson<T>(src: string): Promise<T> {
  const res = await fetch(staticFile(normalizeStaticPath(src)));
  if (!res.ok) throw new Error(`Failed to load ${src}: ${res.status}`);
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

const INTRO_DURATION_SECS = INTRO_DURATION_FRAMES / 60;

function computeEffectiveDuration(transcript: Transcript): number {
  const hooks = transcript.segments.filter(s => s.hook && !s.cut);
  const hookDuration = hooks.reduce((sum, s) => {
    if (s.hookFrom !== undefined && s.hookTo !== undefined) return sum + (s.hookTo - s.hookFrom);
    return sum + (s.end - s.start);
  }, 0);
  const introDuration = hooks.length > 0 ? INTRO_DURATION_SECS : 0;
  const mainDuration = getActiveSegments(transcript)
    .filter(s => !s.hook && !s.cut)
    .reduce((sum, s) => sum + getEffectiveDuration(s), 0);
  return hookDuration + introDuration + mainDuration;
}

export const calculateMetadata: CalculateMetadataFunction<MyCompositionProps> = async ({ props }) => {
  const fps = 60;
  const fallback = { durationInFrames: 300, fps, width: 1920, height: 1080 };

  if (!props.transcriptSrc) return fallback;

  try {
    const transcript = await fetchJson<Transcript>(props.transcriptSrc);
    const durationInFrames = Math.max(1, Math.floor(computeEffectiveDuration(transcript) * fps));
    let overrideProps: MyCompositionProps = transcript.meta.videoSrc
      ? { ...props, src: transcript.meta.videoSrc }
      : { ...props };
    if (props.hookMusicSrc) {
      const hookMusicDurationSecs = await getAudioDurationInSeconds(
        staticFile(normalizeStaticPath(props.hookMusicSrc)),
      ).catch(() => 0);
      overrideProps = { ...overrideProps, hookMusicDurationSecs };
    }
    return { durationInFrames, fps, width: 1920, height: 1080, props: overrideProps };
  } catch {
    return fallback;
  }
};

// ── Transcript-driven sub-component ──────────────────────────────────────────
// Isolated so all hooks run unconditionally at the top level.

type TranscriptCompositionProps = {
  resolvedSrc:   string;
  audioSrc?:     string;
  hookMusicSrc?: string;
  hookMusicDurationSecs: number;
  audioStartFromFrames: number;
  transcript:    Transcript;
  cameraProfiles: CameraProfiles | null;
  brand:         Brand;
};

const TranscriptComposition: React.FC<TranscriptCompositionProps> = ({
  resolvedSrc,
  audioSrc,
  hookMusicSrc,
  hookMusicDurationSecs,
  audioStartFromFrames,
  transcript,
  cameraProfiles,
  brand,
}) => {
  const { fps } = useVideoConfig();

  const hookSegments = useMemo(
    () => transcript.segments.filter(s => s.hook && !s.cut),
    [transcript],
  );

  const orderedSegments: Segment[] = useMemo(() => {
    const mainSegments = getActiveSegments(transcript).filter(s => !s.hook);
    return [...hookSegments, ...mainSegments];
  }, [transcript, hookSegments]);

  const { hookSections, mainSections } = useMemo(() => buildSections(orderedSegments, fps), [orderedSegments, fps]);

  const totalHookFrames = hookSections.reduce((sum, s) => sum + s.trimAfter - s.trimBefore, 0);
  const hasHooks        = hookSegments.length > 0;
  // PodcastIntro plays between hooks and main content (only when there are hooks)
  const introFrames     = hasHooks ? INTRO_DURATION_FRAMES : 0;

  const videoEl = cameraProfiles
    ? (
      <CameraPlayer
        src={resolvedSrc}
        hookSections={hookSections}
        mainSections={mainSections}
        mainOffset={introFrames}
        segments={orderedSegments}
        profiles={cameraProfiles}
      />
    )
    : <SegmentPlayer src={resolvedSrc} hookSections={hookSections} mainSections={mainSections} mainOffset={introFrames} />;

  return (
    <>
      {videoEl}

      {/* Hook overlay: pill, captions, logo, Techybara character.
          Stays mounted for stable frame transitions; returns null outside hook frames. */}
      {hasHooks && (
        <HookOverlay hookSegments={hookSegments} brand={brand} />
      )}

      {/* Hook music — looped so it continues if total hook duration exceeds one track length */}
      {!!hookMusicSrc && hasHooks && hookMusicDurationSecs > 0 && (
        <Sequence from={0} durationInFrames={totalHookFrames}>
          <Loop durationInFrames={Math.round(hookMusicDurationSecs * fps)}>
            <Audio src={staticFile(normalizeStaticPath(hookMusicSrc))} volume={0.07} />
          </Loop>
        </Sequence>
      )}

      {/* PodcastIntro — plays immediately after hooks, before main episode */}
      {hasHooks && (
        <Sequence from={totalHookFrames} durationInFrames={INTRO_DURATION_FRAMES}>
          <PodcastIntroComposition brandSrc="brand.json" />
        </Sequence>
      )}

      {/* Optional music bed for the full video */}
      {audioSrc && (
        <Audio
          src={staticFile(normalizeStaticPath(audioSrc))}
          startFrom={audioStartFromFrames}
        />
      )}
    </>
  );
};

// ── Root composition ──────────────────────────────────────────────────────────

export const MyComposition = ({
  src,
  audioSrc,
  audioStartFrom = 0,
  transcriptSrc,
  cameraProfilesSrc,
  brandSrc = 'brand.json',
  hookMusicSrc = 'sounds/hook-music.mp3',
  hookMusicDurationSecs = 0,
}: MyCompositionProps) => {
  const { fps } = useVideoConfig();
  const audioStartFromFrames = Math.max(0, Math.round(audioStartFrom * fps));
  const resolvedSrc = staticFile(normalizeStaticPath(src));

  const [transcript, setTranscript]         = useState<Transcript | null>(null);
  const [cameraProfiles, setCameraProfiles] = useState<CameraProfiles | null>(null);
  const [brand, setBrand]                   = useState<Brand | null>(null);
  const [cameraReady, setCameraReady]       = useState(!cameraProfilesSrc);

  const [transcriptHandle] = useState(() => transcriptSrc     ? delayRender('Loading transcript')      : null);
  const [cameraHandle]     = useState(() => cameraProfilesSrc ? delayRender('Loading camera profiles') : null);
  const [brandHandle]      = useState(() => brandSrc          ? delayRender('Loading brand')           : null);
  const [fontHandle]       = useState(() => delayRender('Loading Nunito font'));

  useEffect(() => {
    if (!transcriptSrc || !transcriptHandle) return;
    fetchJson<Transcript>(transcriptSrc)
      .then(data => { setTranscript(data); continueRender(transcriptHandle); })
      .catch(err => { console.error(err); continueRender(transcriptHandle); });
  }, [transcriptSrc, transcriptHandle]);

  useEffect(() => {
    if (!cameraProfilesSrc || !cameraHandle) return;
    fetchJson<CameraProfiles>(cameraProfilesSrc)
      .then(data => { setCameraProfiles(data); })
      .catch(err => { console.warn('Camera profiles not loaded (will render without):', err.message); })
      .finally(() => { setCameraReady(true); continueRender(cameraHandle); });
  }, [cameraProfilesSrc, cameraHandle]);

  useEffect(() => {
    if (!brandSrc || !brandHandle) return;
    fetchJson<Brand>(brandSrc)
      .then(data => { setBrand(data); continueRender(brandHandle!); })
      .catch(err => { console.warn('Brand not loaded:', err.message); continueRender(brandHandle!); });
  }, [brandSrc, brandHandle]);

  useEffect(() => {
    loadNunito().finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  // ── Transcript-driven rendering ─────────────────────────────────────────────
  if (transcriptSrc) {
    if (!transcript || !cameraReady || !brand) return null;

    return (
      <TranscriptComposition
        resolvedSrc={resolvedSrc}
        audioSrc={audioSrc}
        hookMusicSrc={hookMusicSrc}
        hookMusicDurationSecs={hookMusicDurationSecs}
        audioStartFromFrames={audioStartFromFrames}
        transcript={transcript}
        cameraProfiles={cameraProfiles}
        brand={brand}
      />
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
