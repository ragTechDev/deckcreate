/** Normalised crop/zoom viewport. cx/cy are the centre (0–1), w/h are crop dimensions (0–1). */
export type CropViewport = {
  cx: number;
  cy: number;
  w: number;
  h: number;
};

/**
 * Configuration for one camera angle in a multi-angle shoot.
 * Each angle corresponds to a separate synced video file.
 */
export type AngleConfig = {
  /** Path to the synced video file relative to /public (e.g. "sync/output/synced-output-2.mp4") */
  videoSrc: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Per-angle wide-shot viewport. Falls back to CameraProfiles.wideViewport when absent. */
  wideViewport?: CropViewport;
};

export type SpeakerProfile = {
  label: string;
  /** Landscape close-up crop region */
  closeupViewport: CropViewport;
  /** Portrait reel: horizontal strip centre (0–1). w/h fixed by output aspect ratio. */
  portraitCx?: number;
  /**
   * Named angle this speaker appears in (key into CameraProfiles.angles).
   * When set, this speaker's shots use the angle's video source instead of the primary src.
   * Omit for single-angle workflows — existing behaviour is preserved.
   */
  angleName?: string;
};

export type CameraProfiles = {
  /** Primary (or only) video source dimensions */
  sourceWidth: number;
  sourceHeight: number;
  /** Output dimensions — change to 1080×1920 to activate portrait mode */
  outputWidth: number;
  outputHeight: number;
  /** Default wide-shot viewport. Landscape: { cx:0.5, cy:0.5, w:1, h:1 }. Portrait: { w:0.5625, h:1 }. */
  wideViewport: CropViewport;
  speakers: Record<string, SpeakerProfile>;
  /**
   * Named camera angles for multi-angle shoots.
   * Keys are arbitrary angle names (e.g. "angle1", "angle2").
   * Omit entirely for single-angle workflows.
   */
  angles?: Record<string, AngleConfig>;
};

/** A camera shot: a viewport applied to output timeline frames [startFrame, endFrame). */
export type CameraShot = {
  startFrame: number;
  endFrame: number;
  viewport: CropViewport;
  /**
   * Which video source to display for this shot (path relative to /public).
   * Undefined means use the primary `src` passed to CameraPlayer.
   */
  videoSrc?: string;
};
