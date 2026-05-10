---
description: Phase 0.5 — Brand Abstraction Layer Implementation Guide
---

# Phase 0.5 — Brand Abstraction Layer

**Branch:** `refactor/p0-brand`
**Goal:** All brand content out of code into config. Adding a new brand = creating files only + VSCode extension improvements.

---

## Implementation Steps

### Step 1: Extend brand types
**Status:** ✅ DONE
- [x] Extend `remotion/types/brand.ts` with `identity`, `hosts`, `mascot`, `audio`, `background` types
- [x] Add `BrandHost` and `BrandMascot` type definitions
- [x] Update `Brand` type with new required fields

**Status check:**
```bash
tsc --noEmit
```

### Step 2: Create brand structure and migrate config
**Status:** ⏳ PENDING
- [ ] Create `brands/ragtech/` directory
- [ ] Migrate `public/brand.json` → `brands/ragtech/brand.json` with all new fields
- [ ] Update `BrandContext` to load from `brands/{brandId}/brand.json` using `brandId` from `project.json`

**Status check:**
```bash
node -e "console.log('Brand loading not yet implemented')"
```

### Step 3: Move keyword overlays to brand structure
**Status:** ⏳ PENDING
- [ ] Move overlays to `brands/ragtech/components/`:
  - `AIOverlay`
  - `AwardsOverlay`
  - `CodingOverlay`
  - `EngineeringOverlay`
  - `FrameworkOverlay`
  - `LanguageOverlay`
  - `InfrastructureOverlay`
  - `EducationOverlay`
  - `BestPracticesOverlay`
  - `RolesOverlay`
  - `RagtechOverlay`
- [ ] Export from `brands/ragtech/components/index.ts`

**Status check:**
```bash
ls -la brands/ragtech/components/ | wc -l  # Should show 11 overlay files + index.ts
```

### Step 4: Create brand registry
**Status:** ⏳ PENDING
- [ ] Create `remotion/lib/brandRegistry.ts` with `getBrandOverlays(brandId)` static switch

**Status check:**
```bash
node -e "console.log('Brand registry not yet implemented')"
```

### Step 5: Update OverlayRenderer
**Status:** ⏳ PENDING
- [ ] Update `OverlayRenderer`: remove hardcoded keyword imports
- [ ] Use `{ ...CORE_TEMPLATE_MAP, ...getBrandOverlays(brand.id) }`

**Status check:**
```bash
grep -r "AIOverlay\|RagtechOverlay" remotion/components/OverlayRenderer.tsx | wc -l  # Should be 0
```

### Step 6: Move remaining overlays and parameterize
**Status:** ⏳ PENDING
- [ ] Move remaining overlays to `remotion/components/overlays/templates/`
- [ ] Parameterize mascot with `brand.mascot.enabled` guard
- [ ] Replace `~/ragtech` with `brand.identity.terminalPath`

**Status check:**
```bash
grep -r "natasha\|saloni\|victoria\|techybara\|ragtechdev\|~/ragtech" remotion/components/ | wc -l  # Should be 0
```

### Step 7: Update podcast components
**Status:** ⏳ PENDING
- [ ] Update `PodcastIntro`: `COHOSTS` → `brand.hosts`
- [ ] Update `PodcastOutro`: `COHOSTS` → `brand.hosts`
- [ ] Update `PodcastThumbnail`: `EPISODES` → `brand.background.episodeGridAssets`
- [ ] Update audio paths → `brand.audio.*`

**Status check:**
```bash
grep -r "COHOSTS\|EPISODES" remotion/components/ | wc -l  # Should be 0
```

### Step 8: VSCode extension improvements
**Status:** ⏳ PENDING
- [ ] Add `Wrap in cut` command (Cmd+D) to wrap selected text in `{}`
- [ ] Add `> NOTE` directive support
- [ ] Add `> SPEAKER` snippet

**Status check:**
```bash
code --list-extensions | grep vscode-transcript-language  # Should show extension
```

---

## Final Status Checks

All steps must pass these final verification commands:

```bash
# No hardcoded brand references
grep -r "natasha\|saloni\|victoria\|techybara\|ragtechdev\|~/ragtech" remotion/components/ | wc -l  # Should be 0

# No hardcoded overlay imports
grep -r "AIOverlay\|RagtechOverlay" remotion/components/OverlayRenderer.tsx | wc -l  # Should be 0

# TypeScript compilation
tsc --noEmit  # Should pass with zero errors

# Visual regression test
# Frame comparison: RAG Tech compositions pixel-identical to pre-refactor baseline
```
