# Review: refactor/s1-brand-types
Date: 2026-05-10
Reviewer: AI (review-pr skill) — session bias: CLEAN
PR: NONE (gh CLI unavailable — description provided by developer)

## Verdict
CHANGES REQUESTED

## Summary
The PR adds `BrandHost` and `BrandMascot` types and extends `Brand` in `remotion/types/brand.ts` as Phase 0.5 Step 1. The TypeScript compilation and unit test suite both pass. However, the type shapes diverge materially from the spec in `docs/PRODUCTION_REFACTOR_PLAN.md`, which means downstream Phase 0.5 steps (steps 6–7) reference fields that will not exist. Additionally, one out-of-scope file was included in the diff.

---

## Blockers (must fix before merge)

### B1 — `BrandHost` does not match the spec
- **Type:** QUALITY
- **File:** `remotion/types/brand.ts:28-37`
- **Finding:** The refactor plan (`PRODUCTION_REFACTOR_PLAN.md:275-282`) specifies:
  ```typescript
  export type BrandHost = {
    name: string;
    role: string;
    imgSrc: string;       // relative to brands/{brandId}/
    nameBgColor: string;
  };
  ```
  The PR implementation omits `role`, renames `imgSrc` → `avatar?` (and makes it optional), omits `nameBgColor`, and adds unspecced fields `bio?` and `social?`. Step 7 of Phase 0.5 replaces `COHOSTS` with `brand.hosts` — the downstream migration will break without `imgSrc` and `nameBgColor`.
- **Fix:** Align with the spec. Use `imgSrc: string` and `nameBgColor: string` as required fields. If `bio` and `social` are desired additions, update `PRODUCTION_REFACTOR_PLAN.md` first and get agreement before including them.

### B2 — `BrandMascot` does not match the spec
- **Type:** QUALITY
- **File:** `remotion/types/brand.ts:39-43`
- **Finding:** The refactor plan (`PRODUCTION_REFACTOR_PLAN.md:284-296`) specifies:
  ```typescript
  export type BrandMascot = {
    enabled: boolean;
    name: string;
    assets: {
      holdingMic?: string;
      teacher?: string;
      raisingHand?: string;
      holdingLaptop?: string;
      holdingLaptop2?: string;
      sparkleEyes?: string;
      [key: string]: string | undefined;
    };
  };
  ```
  The PR omits `enabled` and `assets` entirely, and adds unspecced `image?` and `description?`. Phase 0.5 Step 6 explicitly guards mascot rendering with `brand.mascot.enabled` — without that field, the guard cannot be implemented and all overlays that call it will need a workaround or will error.
- **Fix:** Add `enabled: boolean` and the `assets` index map per spec. Remove `image?` and `description?` unless the spec is updated to include them.

### B3 — `Brand` identity / audio / background fields don't match spec
- **Type:** QUALITY
- **File:** `remotion/types/brand.ts:45-70`
- **Finding:** The refactor plan (`PRODUCTION_REFACTOR_PLAN.md:298-323`) specifies the following required (non-optional) fields with specific names:
  ```
  identity.terminalPath: string     → used in step 6: replace ~/ragtech
  identity.socialHandle: string     → used in step 6
  audio.introOutroMusic: string     → used in step 7
  audio.backgroundMusic: string     → used in step 7
  background.episodeGridAssets: string[]  → used in step 7
  ```
  The PR implementation:
  - Makes `identity`, `hosts`, `mascot`, `audio`, `background` all optional (`?`)
  - Renames `introOutroMusic` → `theme` and `backgroundMusic` → `background` (conflicts with the top-level `background` field name)
  - Omits `terminalPath`, `socialHandle`, `episodeGridAssets`
  - Adds unspecced `tagline?`, `description?`, `stinger?`, `image?`, `video?`, `pattern?`

  Steps 6 and 7 reference `brand.identity.terminalPath`, `brand.audio.*`, and `brand.background.episodeGridAssets` by exact field name — mismatches will cause TypeScript errors when those steps are implemented.
- **Fix:** Use the field names from the spec. Required fields (`identity`, `hosts`, `mascot`, `audio`, `background`) should be required on `Brand` (the refactor plan does not mark them optional). If making them optional is a deliberate backward-compat choice, note it explicitly and update the spec.

### B4 — No implementation guide for Phase 0.5
- **Type:** CONVENTION
- **File:** `docs/implementation-guides/` (missing `REFACTOR_P0_BRAND.md`)
- **Finding:** `PRODUCTION_REFACTOR_PLAN.md:444` references `Doc: docs/implementation-guides/REFACTOR_P0_BRAND.md`. This file does not exist. CLAUDE.md mandates: *"Write an implementation doc in `docs/implementation-guides/` before starting"* for any multi-step task. Phase 0.5 has 8 steps. Without the guide, scope discipline and status checks cannot be enforced across steps.
- **Fix:** Create `docs/implementation-guides/REFACTOR_P0_BRAND.md` with all 8 steps from the refactor plan (verbatim or refined), each with a Status check command. Commit it before or alongside the type changes.

---

## Warnings (should address)

### W1 — Out-of-scope file in diff
- **Type:** QUALITY
- **File:** `docs/REFACTOR_ISSUE_INVENTORY.md`
- **Finding:** The diff adds a ✅ Done annotation to inventory item #2 (artifact storage). This is unrelated to brand type schema changes and is not mentioned in the PR description. Per CLAUDE.md: *"Scope discipline — only files listed in the implementation doc touched."* The artifact storage completion annotation belongs in the artifact storage PR.
- **Suggestion:** Remove the inventory change from this branch; add it via a separate commit or include it in the artifact storage PR.

### W2 — Branch name doesn't match the spec
- **Type:** CONVENTION
- **File:** (branch: `refactor/s1-brand-types`)
- **Finding:** `PRODUCTION_REFACTOR_PLAN.md:444` specifies `Branch: refactor/p0-brand` for Phase 0.5. This PR is on `refactor/s1-brand-types`. Diverging branch names make it harder to cross-reference plan → branch → PR.
- **Suggestion:** Either rename the branch to match the spec, or update the refactor plan's branch field to document the deviation.

### W3 — Non-semantic commit message
- **Type:** CONVENTION
- **File:** commit `b0c145e`
- **Finding:** The commit message is `phase-0-5-step-1-brand-types` — no conventional commit type prefix (`feat:`, `refactor:`, `types:`). CLAUDE.md convention: commit slug should match the implementation doc heading. Since the guide doesn't exist yet (B4), the message cannot match it, but the prefix is still missing.
- **Suggestion:** Reword to e.g. `refactor(brand): extend Brand type with identity/hosts/mascot/audio/background (Phase 0.5 step 1)`.

---

## Suggestions

- The `audio` field has a sub-field named `background` (`audio.background`), while there is also a top-level `background` field. Even if the field names are changed to match the spec (`introOutroMusic`, `backgroundMusic`), consider whether `audio.background` will cause confusion when reading code like `brand.audio.background` vs `brand.background`.
- The PR description's "Type of Change" marks this as "Breaking change (backward compatible)" — those two terms are contradictory. Use "Non-breaking change" or "Additive" instead.

---

## Test plan verification

| Item | Status | Notes |
|------|--------|-------|
| `tsc --noEmit` clean | PASS | Zero errors |
| `npm test` passes | PASS | 244 passed, 2 skipped, 9 suites |
| `npm run test:react` | PRE-EXISTING FAIL | No React test files exist in the project yet — not caused by this PR |
| No runtime tests required | N/A | Type-only changes — correct per TESTING_STANDARDS.md |
| Backward compatibility preserved | PARTIAL | New fields are optional, so existing `Brand` objects remain valid. However, field names differ from spec, which will break forward compatibility when downstream steps are implemented. |

---

## Patterns observed

- B1–B3 match a new pattern: **Implementation diverges from documented spec without updating the spec**. See Step 8 — new pattern added to SKILL.md.
