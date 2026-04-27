export type Token = {
  /** Start time in seconds (word onset, from WhisperX forced alignment or Whisper t_dtw) */
  t_dtw: number;
  /** End time in seconds (word offset, populated by forced alignment). When present,
   *  deriveCuts and autoCutPauses use exact word boundaries instead of heuristic biases. */
  t_end?: number;
  text: string;
  cut: boolean;
};

/** Maps 1:1 to a component in remotion/components/graphics/ or remotion/components/overlays/ */
export type GraphicType =
  // Legacy graphics
  | 'LowerThird' | 'Callout'
  // Chapter markers (persistent overlays)
  | 'ChapterMarker' | 'ChapterMarkerEnd'
  // Lower-third overlays
  | 'ConceptExplainer' | 'NameTitle'
  // Keyword overlay components
  | 'AwardsOverlay' | 'CodingOverlay' | 'EngineeringOverlay'
  | 'AIOverlay' | 'InfrastructureOverlay' | 'PracticeOverlay'
  | 'RoleOverlay' | 'LanguageOverlay' | 'FrameworkOverlay'
  | 'EducationOverlay' | 'RagtechOverlay'
  | 'ImageWindow'
  | 'GifWindow';

export type CameraCue = {
  /** 'closeup' on a named speaker, or 'wide' for the wide shot */
  shot: 'closeup' | 'wide';
  /** Speaker name — only present when shot === 'closeup' */
  speaker?: string;
  /** Absolute timestamp in seconds (same coordinate space as t_dtw) */
  at: number;
};

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
  /** Time-range cuts created by the visual editor. Written as > CUT from-to in the doc. */
  visualCuts?: TimeCut[];
  graphics: GraphicsCue[];
  /** Explicit camera cut overrides — take priority over the pacing algorithm */
  cameraCues?: CameraCue[];
  /** When true, this segment is prepended to the video as a hook/teaser */
  hook?: boolean;
  /** The specific phrase within the segment used as the hook clip */
  hookPhrase?: string;
  /** Start time (seconds) of the hook clip — resolved from hookPhrase tokens */
  hookFrom?: number;
  /** End time (seconds) of the hook clip */
  hookTo?: number;
  /** Techybara asset filename (no extension) to show alongside this hook clip */
  hookChar?: string;
  /** Image path relative to /public to display above captions during this hook clip */
  hookGraphic?: string;
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
  /** Path to the source video relative to /public — overrides the composition's src prop */
  videoSrc?: string;
  /**
   * Paths to all synced video angle files relative to /public (multi-angle shoots).
   * The first entry is the primary angle (matches videoSrc). Used by setup-camera
   * to know which angles to run face detection on.
   */
  videoSrcs?: string[];
  /** Episode number for display in thumbnail/preview overlays */
  episodeNumber?: string;
  /** Title from first hook segment — displayed during hooks section */
  hookTitle?: string;
  /** Thumbnail configuration for portrait shorts */
  thumbnail?: {
    bg?: string | string[];
    middleSpeakers?: string[];
    title?: string;
    extendedTitle?: string;
    episodeNumber?: string;
  };
};

export type Transcript = {
  meta: TranscriptMeta;
  segments: Segment[];
};
