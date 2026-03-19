import { 
    OffthreadVideo, 
    Audio,
    staticFile,
    CalculateMetadataFunction,
    useVideoConfig
 } from "remotion";
import { parseMedia } from "@remotion/media-parser";
import React from 'react';

type MyCompositionProps = {
  src: string;
  audioSrc?: string;
  audioStartFrom?: number; // in seconds
};

const normalizeStaticPath = (src: string) => src.replace(/^\/+/, '');

export const calculateMetadata: CalculateMetadataFunction<MyCompositionProps> = async ({props}) => {
  const fps = 60;
  const fallback = {
    durationInFrames: 300,
    fps,
    width: 1920,
    height: 1080,
  };

  try {
    const src = staticFile(normalizeStaticPath(props.src));
    const parsed = await parseMedia({
      src,
      fields: {
        slowDurationInSeconds: true,
        dimensions: true,
      },
    });

    if (parsed.dimensions === null) {
      return fallback;
    }

    return {
      durationInFrames: Math.max(1, Math.floor(parsed.slowDurationInSeconds * fps)),
      fps,
      width: parsed.dimensions.width,
      height: parsed.dimensions.height,
    };
  } catch {
    return fallback;
  }
};

export const MyComposition = ({
  src,
  audioSrc,
  audioStartFrom = 0,
}: MyCompositionProps) => {
  const {fps} = useVideoConfig();
  const audioStartFromFrames = Math.max(0, Math.round(audioStartFrom * fps));

  return (
    <>
      <OffthreadVideo
        src={staticFile(normalizeStaticPath(src))}
        muted={!!audioSrc}
      />

      {audioSrc && (
        <Audio
          src={staticFile(normalizeStaticPath(audioSrc))}
          startFrom={audioStartFromFrames}
        />
      )}
    </>
  );
};