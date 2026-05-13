# Review: refactor/s1-brand-registry
Date: 2026-05-13
Reviewer: AI (review-pr skill) — session bias: CLEAN
PR: NONE (description provided inline)

## Verdict
CHANGES REQUESTED

## Summary
This PR introduces the brand overlay registry (`getBrandOverlays`), refactors `OverlayRenderer` to dispatch brand overlays through the registry instead of hardcoded imports, and adds `id: string` to the `Brand` type to enable the registry pattern. It also fixes a `next/babel` → Jest CJS/ESM ordering bug. Two blockers were found: the `Brand` type spec in `PRODUCTION_REFACTOR_PLAN.md` was not updated to include `id`, and a destructuring rename (`_` → `_brand`) introduced a needless `eslint-disable` comment that is likely suppressing a rule not in the project's ESLint config.

## Blockers (must fix before merge)

### B1 — PRODUCTION_REFACTOR_PLAN.md: Brand type spec missing `id: string`
- **Type:** QUALITY (spec / convention)
- **File:** `docs/PRODUCTION_REFACTOR_PLAN.md` line 296
- **Finding:** The `Brand` type definition in the spec block does not include `id: string`, but the implementation adds it to `remotion/types/brand.ts`. The spec code snippets at lines 357–360 already reference `brand.id`, making the type block internally inconsistent. Per the project convention ("Type shapes match spec — if a type is defined in docs/PRODUCTION_REFACTOR_PLAN.md, the implementation must use the exact field names…"), the spec must be updated when the implementation diverges from it.
- **Fix:** Add `id: string` as the first field in the `Brand` type block at line 296 of `PRODUCTION_REFACTOR_PLAN.md`:
  ```typescript
  export type Brand = {
    id: string;          // brand registry key (e.g. 'ragtech')
    // Existing (keep)
    colors: BrandColors;
    ...
  ```
  This is a one-line spec update, not a code change.

### B2 — OverlayRenderer.tsx:250: `_brand` rename introduces vacuous `eslint-disable` comment
- **Type:** QUALITY
- **File:** `remotion/components/OverlayRenderer.tsx` line 250
- **Finding:** The original code used `const { brand: _, ...otherProps }` — the `_` prefix is the idiomatic TypeScript/ESLint convention for intentionally unused destructured bindings and requires no suppression. The PR renames it to `_brand` and adds `// eslint-disable-next-line @typescript-eslint/no-unused-vars`. The project's `.eslintrc` only configures `@remotion/recommended` — the `@typescript-eslint/no-unused-vars` rule does not appear to be active in this config, making the disable comment vacuous cargo-cult noise. The rename + comment is strictly worse than the original.
- **Fix:** Revert to `const { brand: _, ...otherProps }` and remove the disable comment entirely.

## Warnings (should address)

### W1 — Four `@typescript-eslint/no-explicit-any` disable comments suppress a rule not in the ESLint config
- **Type:** QUALITY
- **File:** `remotion/components/OverlayRenderer.tsx` lines 28, 37, 252; `remotion/lib/brandRegistry.ts` line 17
- **Finding:** Four `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments were added. The project's `.eslintrc` only enables `plugin:@remotion/recommended` — there is no `@typescript-eslint/recommended` or explicit `@typescript-eslint/no-explicit-any` rule configured. These suppress comments may be vacuous. The `React.FC<any>` pattern is pre-existing tracked technical debt (Phase 5 target: `remotion/types/overlayProps.ts` discriminated union per CLAUDE.md).
- **Suggestion:** If `@typescript-eslint/no-explicit-any` is not active in this project's ESLint config, remove the suppress comments — they add noise without benefit. If the rule IS active (e.g. via the remotion plugin transitively), add a one-line justification to the PR description: "React.FC\<any\> suppress: blocked on Phase 5 overlayProps discriminated union."

### W2 — `componentMap` reconstructed on every Remotion frame (performance regression)
- **Type:** QUALITY
- **File:** `remotion/components/OverlayRenderer.tsx` lines 78–82
- **Finding:** The original code assigned `componentMap` via a ternary that selected between two pre-built module-level constants — zero per-frame allocation. The new code creates a new object every render via three spreads plus a `getBrandOverlays()` call. In Remotion at 60 fps, this produces 60 new objects/second with ~16 property assignments each. The `getBrandOverlays()` function itself is cheap, but the churn is unnecessary.
- **Suggestion:** Memoize the map:
  ```typescript
  const componentMap = useMemo(() => ({
    ...CORE_TEMPLATE_MAP,
    ...(isShortForm ? SHORTFORM_OVERRIDES : {}),
    ...getBrandOverlays(brand.id),
  }), [brand.id, isShortForm]);
  ```

### W3 — Spread order gives brand overlays higher precedence than shortform overrides
- **Type:** QUALITY
- **File:** `remotion/components/OverlayRenderer.tsx` lines 78–82
- **Finding:** The spread order is `[CORE_TEMPLATE_MAP, SHORTFORM_OVERRIDES, getBrandOverlays(brand.id)]`. This means brand overlay keys can silently override shortform variants (e.g. if a future brand supplies a `ConceptExplainer`, it overrides `ConceptExplainerShort` in short-form). For ragtech this is harmless (all 11 brand overlay keys are unique vs core/shortform keys), but the ordering is a footgun for future brands.
- **Suggestion:** Either document the intentional precedence in a comment, or reverse brand and shortform: `[CORE_TEMPLATE_MAP, getBrandOverlays(brand.id), SHORTFORM_OVERRIDES]` to guarantee shortform variants always win.

## Suggestions (optional improvements)

- `remotion/lib/brandRegistry.ts`: Consider extracting the `RAGTECH_OVERLAYS` object as a named module-level constant. Currently the object literal is constructed inside the `if` branch on every call. Minor; the function is pure and cheap.
- `remotion/components/OverlayRenderer.test.tsx`: The `passes isShortForm=true without crashing` test (smoke only — `.not.toThrow()`) is acceptable as a guard, but a follow-up test asserting that `SHORTFORM_OVERRIDES` entries are present in the resolved map would give stronger coverage of the shortform path.

## Test plan verification

| Item | Status | Notes |
|------|--------|-------|
| `npm test` passes | PASS | 253 tests, 11 suites, 0 failures; 2 skipped (pre-existing) |
| `npm run test:react` passes | PASS | 7 tests, 2 suites |
| `tsc --noEmit` | PASS | No errors |
| `npm run test:e2e` | SKIPPED | No e2e-applicable changes in this PR |
| [REMOTION-VISUAL] Remotion Studio scrub | NOT RUN | Human verification required (marked ✓ by author) |

## Patterns observed

- **B1** matches known pattern: "Implementation diverges from documented spec without updating the spec" (first seen refactor/s1-brand-types, 2026-05-10). The `id: string` field was added to the implementation without updating the `Brand` type block in `PRODUCTION_REFACTOR_PLAN.md`.
- **B2** is a new pattern: renaming a `_` placeholder to a more descriptive `_foo` name breaks the idiomatic ESLint-ignore convention and introduces a vacuous disable comment. Recorded in SKILL.md.
- **W1** is a new pattern: `eslint-disable` comments added for rules not present in the project ESLint config. Recorded in SKILL.md.
- **W2** is a new pattern: per-render object spread replacing module-level constant references in a Remotion component body. Recorded in SKILL.md.
