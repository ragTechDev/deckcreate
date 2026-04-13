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

// ── Concept overlays (programming/engineering fundamentals) ───────────────────
export {
  CodingOverlay,
  EngineeringOverlay,
  type CodingOverlayProps,
  type EngineeringOverlayProps,
} from './concepts';

// ── Tech overlays (languages, frameworks, tools) ─────────────────────────────
export {
  LanguageOverlay,
  FrameworkOverlay,
  type LanguageOverlayProps,
  type FrameworkOverlayProps,
} from './tech';

// ── Role overlays (job titles and career paths) ────────────────────────────────
export {
  RoleOverlay,
  type RoleOverlayProps,
} from './roles';

// ── Practice overlays (best practices, standards, methodologies) ───────────────
export {
  PracticeOverlay,
  type PracticeOverlayProps,
} from './practices';

// ── Infrastructure overlays (deployment, servers, networking) ─────────────────
export {
  InfrastructureOverlay,
  type InfrastructureOverlayProps,
} from './infrastructure';

// ── AI overlays (artificial intelligence concepts) ────────────────────────────
export {
  AIOverlay,
  type AIOverlayProps,
} from './ai';

// ── Education overlays (learning, training, mindset) ───────────────────────────
export {
  EducationOverlay,
  type EducationOverlayProps,
} from './education';

// ── Awards overlays (achievements, recognition, milestones) ────────────────────
export {
  AwardsOverlay,
  type AwardsOverlayProps,
} from './awards';

// ── Lower-third overlays (dynamic full-screen callouts) ───────────────────────
export {
  ConceptExplainer,
  SpeakerIntro,
} from './lower-thirds';
