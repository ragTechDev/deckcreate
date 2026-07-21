export type CaptionLine = {
  id: number;
  speaker: string;
  text: string;
  /** Milliseconds from start of the source video */
  startMs: number;
  endMs: number;
};

export type LineCaptionsMeta = {
  title: string;
  /** Total duration in seconds */
  duration: number;
  fps: number;
  /** Path to the source video relative to /public */
  videoSrc?: string;
};

export type LineCaptionsDoc = {
  meta: LineCaptionsMeta;
  lines: CaptionLine[];
};
