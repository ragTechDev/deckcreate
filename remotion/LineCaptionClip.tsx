import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  CalculateMetadataFunction,
  delayRender,
  continueRender,
} from 'remotion';
import React, { useState, useEffect } from 'react';
import { LineCaptionOverlay } from './components/LineCaptionOverlay';
import { loadNunito } from './loadFonts';
import type { LineCaptionsDoc } from './types/lineCaptions';
import type { Brand } from './types/brand';

type LineCaptionClipProps = {
  /** Path to the source video relative to /public. Defaults to lines.json's meta.videoSrc. */
  src?: string;
  linesSrc: string;
  brandSrc?: string;
  /** Brand ID to load from brands/{brandId}/brand.json. Takes precedence over brandSrc if provided. */
  brandId?: string;
};

const normalizeStaticPath = (src: string) => src.replace(/^\/+/, '');

async function fetchJson<T>(src: string): Promise<T> {
  const res = await fetch(staticFile(normalizeStaticPath(src)));
  if (!res.ok) throw new Error(`Failed to load ${src}: ${res.status}`);
  return res.json();
}

export const calculateLineCaptionMetadata: CalculateMetadataFunction<LineCaptionClipProps> = async ({ props }) => {
  const fps = 60;
  const fallback = { durationInFrames: 300, fps, width: 1080, height: 1920 };

  try {
    const linesDoc = await fetchJson<LineCaptionsDoc>(props.linesSrc);
    const durationInFrames = Math.max(1, Math.ceil(linesDoc.meta.duration * fps));
    const overrideProps: LineCaptionClipProps = props.src ? props : { ...props, src: linesDoc.meta.videoSrc };
    return { durationInFrames, fps, width: 1080, height: 1920, props: overrideProps };
  } catch {
    return fallback;
  }
};

export const LineCaptionClip: React.FC<LineCaptionClipProps> = ({
  src,
  linesSrc,
  brandSrc = 'brand.json',
  brandId,
}) => {
  const resolvedBrandSrc = brandId ? `brands/${brandId}/brand.json` : brandSrc;

  const [linesDoc, setLinesDoc] = useState<LineCaptionsDoc | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);

  const [linesHandle] = useState(() => delayRender('Loading line captions'));
  const [brandHandle] = useState(() => delayRender('Loading brand'));
  const [fontHandle] = useState(() => delayRender('Loading Nunito font'));

  useEffect(() => {
    fetchJson<LineCaptionsDoc>(linesSrc)
      .then(data => { setLinesDoc(data); continueRender(linesHandle); })
      .catch(err => { console.error(err); continueRender(linesHandle); });
  }, [linesSrc, linesHandle]);

  useEffect(() => {
    fetchJson<Brand>(resolvedBrandSrc)
      .then(data => { setBrand(data); continueRender(brandHandle); })
      .catch(err => { console.warn('Brand not loaded:', err.message); continueRender(brandHandle); });
  }, [resolvedBrandSrc, brandHandle]);

  useEffect(() => {
    loadNunito().finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  if (!linesDoc || !brand) return null;

  const resolvedSrc = staticFile(normalizeStaticPath(src ?? linesDoc.meta.videoSrc ?? ''));

  return (
    <AbsoluteFill>
      <OffthreadVideo src={resolvedSrc} />
      <LineCaptionOverlay lines={linesDoc.lines} brand={brand} />
    </AbsoluteFill>
  );
};
