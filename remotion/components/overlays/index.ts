// ═══════════════════════════════════════════════════════════════════════════════
//  Remotion Graphic Overlay Components
//  Import from remotion/components/overlays for easy access
// ═══════════════════════════════════════════════════════════════════════════════

// ── Core reusable components ───────────────────────────────────────────────────
export {
  BaseOverlay,
  TextOverlay,
  IconBadge,
  CodeBlock,
  type OverlayProps,
  type TextOverlayProps,
  type IconBadgeProps,
  type CodeBlockProps,
} from './core';

// ── Keyword-triggered overlays (topic/keyword-specific) ───────────────────────
export {
  RagtechOverlay,
  type RagtechOverlayProps,
} from './keywords';

// ── Lower-third overlays (dynamic full-screen callouts) ───────────────────────
export {
  ConceptExplainer,
  NameTitle,
  type NameTitleProps,
  TermTypewriter,
  type TermTypewriterProps,
} from './lower-thirds';

// ── Special animated overlays ──────────────────────────────────────────────────
export { ImageWindowOverlay, type ImageWindowOverlayProps } from './ImageWindowOverlay';
export { GifWindowOverlay, type GifWindowOverlayProps } from './GifWindowOverlay';
export { FullscreenMediaOverlay, type FullscreenMediaOverlayProps } from './FullscreenMediaOverlay';
export { GlobalSouthMap, type GlobalSouthMapProps } from './GlobalSouthMap';
export { DataFlowAnimation, type DataFlowAnimationProps } from './DataFlowAnimation';
