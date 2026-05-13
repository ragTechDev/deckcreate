# Review: refactor/s1-brand-loader
Date: 2026-05-13
Reviewer: AI (review-pr skill) — session bias: CLEAN
PR: NONE (description provided inline)

## Verdict
CHANGES REQUESTED

## Summary
This PR adds `brand.audio.hookMusic` resolution to `calculateMetadata` / `calculateShortMetadata`, replaces the `@remotion/sfx` CDN whoosh with a local file, and fixes the Babel/Jest test environment. The core logic is sound and tests pass cleanly. Two issues block merge: the `hookMusic?` field was added to `Brand.audio` without updating the canonical spec, and the new `brand.json` references a non-existent audio file (`background-music.mp3`).

## Blockers (must fix before merge)

### B1 — `hookMusic?` in Brand type diverges from spec
- **Type:** QUALITY
- **File:** `remotion/types/brand.ts` line 77 + `docs/PRODUCTION_REFACTOR_PLAN.md`
- **Finding:** `docs/PRODUCTION_REFACTOR_PLAN.md` defines `Brand.audio` as `{ introOutroMusic: string; backgroundMusic: string; }` with no `hookMusic` field. This PR adds `hookMusic?: string` without updating the spec. Per the CLAUDE.md convention: "If the spec must change, update it first and get agreement before diverging in code. Downstream phase steps depend on specific field names by reference."
- **Fix:** Add `hookMusic?: string` to the `audio` block in the extended Brand type in `docs/PRODUCTION_REFACTOR_PLAN.md` Phase 0.5. The spec update should precede or accompany the implementation change.

### B2 — `brand.json` references non-existent audio file
- **Type:** QUALITY
- **File:** `public/brands/ragtech/brand.json` line 67
- **Finding:** `"backgroundMusic": "/sounds/background-music.mp3"` points to a file that does not exist in `public/sounds/`. The directory contains `intro-outro-music.mp3`, `jazz-cafe-music.mp3`, and `whoosh.wav` — no `background-music.mp3`. While no component currently reads `brand.backgroundMusic`, this brand.json is being introduced as the canonical config and the broken path will silently fail when Phase 0.5 wires up the audio fields.
- **Fix:** Change to `"/sounds/jazz-cafe-music.mp3"` (the existing background music track per CLAUDE.md), or add the actual file and document it.

## Warnings (should address)

### W1 — Vacuous `eslint-disable-next-line @typescript-eslint/no-explicit-any`
- **Type:** QUALITY
- **File:** `tests/setup.react.ts` line 25
- **Finding:** `@typescript-eslint/no-explicit-any` is not present in the project's ESLint config (`eslint-config-next` does not enable it; confirmed by grepping `node_modules/eslint-config-next`). The disable comment suppresses nothing and adds noise. This matches the known "eslint-disable comments added for rules not active in the project ESLint config" pattern.
- **Suggestion:** Remove the comment. If explicit-any is a concern, type the factory as `React.ComponentPropsWithRef<'img'>`.

### W2 — Saloni missing from `hosts` array in `brand.json`
- **Type:** QUALITY
- **File:** `public/brands/ragtech/brand.json` (hosts array)
- **Finding:** CLAUDE.md lists three cohosts: Natasha, Saloni, Victoria. The new `brand.json` hosts array only contains Natasha and Victoria. No component consumes `brand.hosts` yet (confirmed by grep), but this file is being introduced as the canonical brand source of truth; Saloni will be absent when Phase 0.5 consumes it.
- **Suggestion:** Add Saloni's entry: `{ "name": "Saloni", "role": "Software Developer", "imgSrc": "/assets/team/saloni.PNG", "nameBgColor": "<colour>" }`.

### W3 — Team image paths use lowercase `.png` vs. actual `.PNG` filenames
- **Type:** QUALITY
- **File:** `public/brands/ragtech/brand.json` (hosts[*].imgSrc)
- **Finding:** Actual files on disk are `natasha.PNG`, `saloni.PNG`, `victoria.PNG` (uppercase extension). The brand.json uses `/assets/team/natasha.png` (lowercase). This works on macOS (case-insensitive) but will break on Linux (Docker, CI).
- **Suggestion:** Align `imgSrc` values to use `.PNG`, or rename the asset files to `.png` for portability.

## Suggestions (optional improvements)

- `remotion/Composition.tsx` and `remotion/ShortFormClip.tsx` both define `const normalizeStaticPath = ...` identically. This duplication predates this PR but the brand-fetch block added here uses it in both files. Consider extracting to `remotion/lib/utils.ts` in the Phase 5/6 cleanup.

## Test plan verification

| Item | Status | Notes |
|------|--------|-------|
| `npm test` passes | PASS | 264 passed, 2 skipped |
| `npm run test:react` passes | PASS | 20 passed, 5 suites |
| `tsc --noEmit` clean | PASS | No errors |
| `npm run test:e2e` | SKIPPED | No Phase 8 browser flows changed |
| [REMOTION-VISUAL] ShortFormClip hook music from brand | NOT RUN | Developer self-attested ✓ |
| [REMOTION-VISUAL] Transition whoosh from local file | NOT RUN | Developer self-attested ✓ |
| [REMOTION-VISUAL] ragTechVodcast hook section renders | NOT RUN | Developer self-attested ✓ |

## Patterns observed
- B1 matches known pattern: **Implementation diverges from documented spec without updating the spec**
- W1 matches known pattern: **eslint-disable comments added for rules not active in the project ESLint config**
