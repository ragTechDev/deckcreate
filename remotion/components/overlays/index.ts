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
  CodingOverlay,
  EngineeringOverlay,
  type CodingOverlayProps,
  type EngineeringOverlayProps,
  LanguageOverlay,
  FrameworkOverlay,
  type LanguageOverlayProps,
  type FrameworkOverlayProps,
  RoleOverlay,
  type RoleOverlayProps,
  PracticeOverlay,
  type PracticeOverlayProps,
  InfrastructureOverlay,
  type InfrastructureOverlayProps,
  AIOverlay,
  type AIOverlayProps,
  EducationOverlay,
  type EducationOverlayProps,
  AwardsOverlay,
  type AwardsOverlayProps,
} from './keywords';

// ── Lower-third overlays (dynamic full-screen callouts) ───────────────────────
export {
  ConceptExplainer,
  NameTitle,
  type NameTitleProps,
} from './lower-thirds';
