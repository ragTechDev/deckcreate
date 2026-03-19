import { 
    useCurrentFrame, 
    OffthreadVideo, 
    Audio,
    staticFile,
    CalculateMetadataFunction
 } from "remotion";
 import { parseMedia } from "@remotion/media-parser";

type MyCompositionProps = {
  src: string;
  audioSrc?: string;
  audioStartFrom?: number; // in seconds
};

 export const calculateMetadata: CalculateMetadataFunction<MyCompositionProps> = async ({props}) => {
  const {slowDurationInSeconds, dimensions} = await parseMedia({
    src: staticFile(props.src),
    fields: {
      slowDurationInSeconds: true,
      dimensions: true,
    },
  });

  if (dimensions === null) {
    // For example when passing an MP3 file:
    throw new Error('Not a video file');
  }

  const fps = 60;

  return {
    durationInFrames: Math.floor(slowDurationInSeconds * fps),
    fps,
    width: dimensions.width,
    height: dimensions.height,
  };
};

export const MyComposition = ({ src, audioSrc, audioStartFrom = 0 }: MyCompositionProps) => {
  return (
    <>
      <OffthreadVideo src={staticFile(src)} />
      {audioSrc && (
        <Audio 
          src={staticFile(audioSrc)} 
          startFrom={audioStartFrom}
        />
      )}
    </>
  );
};