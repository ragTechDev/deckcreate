/** Normalised crop/zoom viewport. cx/cy are the centre (0–1), w/h are crop dimensions (0–1). */
export type CropViewport = {
  cx: number;
  cy: number;
  w: number;
  h: number;
};

export type SpeakerProfile = {
  label: string;
  /** Landscape close-up crop region */
  closeupViewport: CropViewport;
  /** Portrait reel: horizontal strip centre (0–1). w/h fixed by output aspect ratio. */
  portraitCx?: number;
};

export type CameraProfiles = {
  sourceWidth: number;
  sourceHeight: number;
  /** Output dimensions — change to 1080×1920 to activate portrait mode */
  outputWidth: number;
  outputHeight: number;
  /** Default wide-shot viewport. Landscape: { cx:0.5, cy:0.5, w:1, h:1 }. Portrait: { w:0.5625, h:1 }. */
  wideViewport: CropViewport;
  speakers: Record<string, SpeakerProfile>;
};

/** A camera shot: a viewport applied to output timeline frames [startFrame, endFrame). */
export type CameraShot = {
  startFrame: number;
  endFrame: number;
  viewport: CropViewport;
};
