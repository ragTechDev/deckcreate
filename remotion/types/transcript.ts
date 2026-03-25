export type Token = {
  /** Seconds from start of audio (converted from whisper.cpp centiseconds) */
  t_dtw: number;
  text: string;
  cut: boolean;
};

/** Maps 1:1 to a component in remotion/components/graphics/ */
export type GraphicType = 'LowerThird' | 'Callout' | 'ChapterMarker';

export type GraphicsCue = {
  type: GraphicType;
  /** Absolute timestamp in seconds */
  at: number;
  /** Duration in seconds */
  duration: number;
  /** Passed directly as props to the matching graphic component */
  props: Record<string, unknown>;
};

/** A time range to skip during rendering, derived from token cut flags */
export type TimeCut = {
  from: number;
  to: number;
};

export type Segment = {
  id: number;
  /** Seconds from start of audio */
  start: number;
  end: number;
  speaker: string;
  text: string;
  /** Cuts the entire segment */
  cut: boolean;
  tokens: Token[];
  /** Derived from token cut flags by edit-transcript. Used by Remotion for time remapping. */
  cuts: TimeCut[];
  graphics: GraphicsCue[];
};

export type TranscriptMeta = {
  title: string;
  /** Total duration in seconds */
  duration: number;
  fps: number;
  /** Video start time in seconds — segments before this are excluded from rendering */
  videoStart?: number;
  /** Video end time in seconds — segments after this are excluded from rendering */
  videoEnd?: number;
};

export type Transcript = {
  meta: TranscriptMeta;
  segments: Segment[];
};
