import {
  Audio,
  Loop,
  Sequence,
  staticFile,
  CalculateMetadataFunction,
  useVideoConfig,
  delayRender,
  continueRender
} from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';
import React, { useState, useEffect, useMemo } from 'react';
import { SegmentPlayer, buildSections, buildMainSubClips } from './components/SegmentPlayer';
import { CameraPlayer } from './components/CameraPlayer';
import { CaptionOverlay } from './components/CaptionOverlay';
import { OverlayRenderer } from './components/OverlayRenderer';
import { EpisodePill } from './components/overlays/EpisodePill';
import { HookTitle } from './components/overlays/HookTitle';
import { ShortFormOutro } from './components/overlays/ShortFormOutro';
import { loadNunito } from './loadFonts';
import { Transition } from './components/Transition';
import type { Transcript, Segment } from './types/transcript';
import type { CameraProfiles } from './types/camera';
import type { Brand } from './types/brand';

type ShortFormClipProps = {
  src: string;
  audioSrc?: string;
  audioStartFrom?: number;
  transcriptSrc?: string;
  cameraProfilesSrc?: string;
  brandSrc?: string;
  hookMusicSrc?: string;
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

const HOOK_TAIL_PAD_UNBOUNDED_SECONDS = 0.16;
const HOOK_TAIL_PAD_BOUNDED_SECONDS = 0.02;
const HOOK_BRIDGE_MAX_GAP_SECONDS = 1.0;

/** Returns the effective end time for a hook clip, extending by 0.5 s when
 *  spoken tokens drift past the segment boundary. */
function hookClipEnd(s: Segment, nextHookStart?: number): number {
  const baseEnd = s.hookTo ?? s.end;
  const isBoundedHook = s.hookTo !== undefined && s.hookTo !== null;
  let sourceEnd = baseEnd;

  if (s.hookTo === undefined || s.hookTo === null) {
    const latestSpokenToken = s.tokens
      .filter(t => !/_[A-Z]+_/.test(t.text.trim()) && t.text.trim() !== '')
      .reduce((max, t) => Math.max(max, t.t_dtw), -Infinity);
    if (latestSpokenToken > baseEnd) {
      const drift = latestSpokenToken - baseEnd;
      const extension = Math.min(1.5, drift + 0.4);
      sourceEnd = baseEnd + extension;
    }
  }

  const hasSpokenTokenAfterEnd = s.tokens.some(
    (t) => !/_[A-Z]+_/.test(t.text.trim())
      && t.text.trim() !== ''
      && t.t_dtw > sourceEnd + 0.02,
  );
  const endsAtSegmentTail = !hasSpokenTokenAfterEnd;
  const canBridgeToNextHook = nextHookStart !== undefined
    && nextHookStart > sourceEnd
    && nextHookStart - sourceEnd <= HOOK_BRIDGE_MAX_GAP_SECONDS;

  if (endsAtSegmentTail && canBridgeToNextHook) {
    sourceEnd = nextHookStart;
  }

  const withPad = sourceEnd + (isBoundedHook ? HOOK_TAIL_PAD_BOUNDED_SECONDS : HOOK_TAIL_PAD_UNBOUNDED_SECONDS);
  return nextHookStart !== undefined ? Math.min(withPad, nextHookStart) : withPad;
}

function computeEffectiveDuration(transcript: Transcript): number {
  const hooks = transcript.segments.filter(s => s.hook && !s.cut);
  const hookDuration = hooks.reduce((sum, s, idx) => {
    const start = s.hookFrom ?? s.start;
    const next = hooks[idx + 1];
    const nextHookStart = next ? (next.hookFrom ?? next.start) : undefined;
    return sum + (hookClipEnd(s, nextHookStart) - start);
  }, 0);

  const { videoStart, videoEnd } = transcript.meta;
  const mainInRange = getActiveSegments(transcript).filter(s => !s.hook);
  const mainDuration = buildMainSubClips(mainInRange, videoStart, videoEnd)
    .reduce((sum, c) => sum + (c.sourceEnd - c.sourceStart), 0);

  return hookDuration + mainDuration;
}

export const calculateShortMetadata: CalculateMetadataFunction<ShortFormClipProps> = async ({ props }) => {
  const fps = 60;
  const fallback = { durationInFrames: 300, fps, width: 1080, height: 1920 };

  if (!props.transcriptSrc) return fallback;

  try {
    const transcript = await fetchJson<Transcript>(props.transcriptSrc);
    const durationInFrames = Math.max(1, Math.floor(computeEffectiveDuration(transcript) * fps));
    let overrideProps: ShortFormClipProps = transcript.meta.videoSrc
      ? { ...props, src: transcript.meta.videoSrc }
      : { ...props };
    if (props.hookMusicSrc) {
      const hookMusicDurationSecs = await getAudioDurationInSeconds(
        staticFile(normalizeStaticPath(props.hookMusicSrc)),
      ).catch(() => 0);
      overrideProps = { ...overrideProps, hookMusicDurationSecs };
    }
    return { durationInFrames, fps, width: 1080, height: 1920, props: overrideProps };
  } catch {
    return fallback;
  }
};

// ── Transcript-driven sub-component ──────────────────────────────────────────

type TranscriptCompositionProps = {
  resolvedSrc: string;
  audioSrc?: string;
  hookMusicSrc?: string;
  hookMusicDurationSecs: number;
  audioStartFromFrames: number;
  transcript: Transcript;
  cameraProfiles: CameraProfiles | null;
  brand: Brand;
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
  const { fps, durationInFrames } = useVideoConfig();

  const hookSegments = useMemo(
    () => transcript.segments.filter(s => s.hook && !s.cut),
    [transcript],
  );

  const orderedSegments: Segment[] = useMemo(() => {
    const mainSegments = getActiveSegments(transcript).filter(s => !s.hook);
    return [...hookSegments, ...mainSegments];
  }, [transcript, hookSegments]);

  const { hookSections, mainSections } = useMemo(
    () => buildSections(orderedSegments, fps, transcript.meta.videoStart, transcript.meta.videoEnd),
    [orderedSegments, fps, transcript.meta.videoStart, transcript.meta.videoEnd],
  );

  const totalHookFrames = hookSections.reduce((sum, s) => sum + s.trimAfter - s.trimBefore, 0);
  const hasHooks = hookSegments.length > 0;

  const videoEl = cameraProfiles
    ? (
      <CameraPlayer
        src={resolvedSrc}
        hookSections={hookSections}
        mainSections={mainSections}
        mainOffset={0}
        segments={orderedSegments}
        profiles={cameraProfiles}
        isShortForm
      />
    )
    : <SegmentPlayer src={resolvedSrc} hookSections={hookSections} mainSections={mainSections} mainOffset={0} />;

  return (
    <>
      {videoEl}

      {/* Full-video caption overlay — always active for short-form */}
      <CaptionOverlay
        segments={orderedSegments}
        brand={brand}
        totalHookFrames={totalHookFrames}
        hookSections={hookSections}
        mainSections={mainSections}
      />

      {/* Overlay graphics from transcript segments (NameTitle, ConceptExplainer, etc.) */}
      <OverlayRenderer
        segments={orderedSegments}
        brand={brand}
        mainSections={mainSections}
        hookSections={hookSections}
        mainStartFrame={totalHookFrames}
        isShortForm
      />

      {/* Episode pill and title — persistent top-right overlay */}
      {transcript.meta.thumbnail?.episodeNumber && (
        <EpisodePill
          brand={brand}
          episodeNumber={transcript.meta.thumbnail.episodeNumber}
          title={transcript.meta.thumbnail?.title || transcript.meta.title || ''}
        />
      )}

      {/* Hook title — displayed during hooks section (center, above captions) */}
      {hasHooks && transcript.meta.hookTitle && totalHookFrames > 0 && (
        <HookTitle
          brand={brand}
          title={transcript.meta.hookTitle}
          startFrame={0}
          endFrame={totalHookFrames}
        />
      )}

      {/* Outro overlay — last 5 seconds */}
      <Sequence from={Math.max(0, durationInFrames - 3 * fps)}>
        <ShortFormOutro brand={brand} />
      </Sequence>

      {/* Transition effect between hooks and main content */}
      {hasHooks && totalHookFrames > 0 && (
        <Transition
          startFrame={totalHookFrames}
          durationInFrames={30}
        />
      )}

      {/* Hook music — looped over hook duration */}
      {!!hookMusicSrc && hasHooks && hookMusicDurationSecs > 0 && (
        <Sequence from={0} durationInFrames={totalHookFrames}>
          <Loop durationInFrames={Math.round(hookMusicDurationSecs * fps)}>
            <Audio src={staticFile(normalizeStaticPath(hookMusicSrc))} volume={0.07} />
          </Loop>
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

// ── Root composition ───────────────────────────────────────────────────────

export const ShortFormClip = ({
  src,
  audioSrc,
  audioStartFrom = 0,
  transcriptSrc,
  cameraProfilesSrc,
  brandSrc = 'brand.json',
  hookMusicSrc = 'sounds/hook-music.mp3',
  hookMusicDurationSecs = 0,
}: ShortFormClipProps) => {
  const { fps } = useVideoConfig();
  const audioStartFromFrames = Math.max(0, Math.round(audioStartFrom * fps));
  const resolvedSrc = staticFile(normalizeStaticPath(src));

  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [cameraProfiles, setCameraProfiles] = useState<CameraProfiles | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [cameraReady, setCameraReady] = useState(!cameraProfilesSrc);

  const [transcriptHandle] = useState(() => transcriptSrc ? delayRender('Loading transcript') : null);
  const [cameraHandle] = useState(() => cameraProfilesSrc ? delayRender('Loading camera profiles') : null);
  const [brandHandle] = useState(() => brandSrc ? delayRender('Loading brand') : null);
  const [fontHandle] = useState(() => delayRender('Loading Nunito font'));

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

  // ── Transcript-driven rendering ───────────────────────────────────────────
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

  return null;
};
