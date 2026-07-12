# Opportunity: Multi-brand support

## Problem statement

The current tool is built for exactly one brand — ragTech — with its logo, colors, Nunito font, Techybara mascot, overlays, intro/outro music, and host identities baked into the codebase. Editing a client's podcast means their footage runs through ragTech's visual identity. The service business (studio-rental partnership, any future direct client work) cannot operate without brand-per-job support; every client has their own logo, palette, font, and show format.

## Evidence

- **Internal dogfooding:** Brand assets are hardcoded throughout the current codebase — `public/brand.json` holds a single brand config, `public/assets/` contains only ragTech team images and Techybara PNGs, intro/outro music (`public/sounds/`) is ragTech-specific, and `remotion/lib/brandRegistry.ts` implements only the ragTech brand. `OverlayRenderer.tsx` dispatches via `CORE_TEMPLATE_MAP + getBrandOverlays(brand.id)` but `getBrandOverlays` only returns ragTech overlays. Source: root `CLAUDE.md`.
- **Internal dogfooding:** The in-place refactor to fix this (Phase 0.5, `refactor/p0-brand` branch) is already underway in the current codebase — `public/brand.json` is being migrated to `brands/ragtech/brand.json`, brand overlays are being moved to `brands/ragtech/components/`, and `brandRegistry.ts` is being updated to load brands dynamically. The fact that a dedicated refactor phase exists confirms the hardcoding was a real constraint, not a hypothetical one.
- **Service business requirement:** Lean Canvas §2 Segment 1 (podcast studio-rental partnership, active deal in motion) routes client editing work to us as a fulfillment partner. Those clients have their own podcast brands — their own logos, color palettes, fonts, hosts, overlays, and show music. Delivering their edited footage with ragTech's branding would not be deliverable.
- **Problem hypothesis:** "Now we want to scale up to editing for other podcasts so this can be a viable business." Multi-brand is the prerequisite, not a nice-to-have.

## Proposed direction

Brand configuration should be a first-class, per-job input to the pipeline — not a compile-time or repo-level constant. Each brand specifies:

- **Identity:** name, logo (with transparent background), primary/secondary/accent colors, font(s).
- **Hosts:** per-host name, image, camera angle mapping — equivalent to the current `speakers` section of `camera-profiles.json`, but owned by the brand config.
- **Audio:** intro/outro music file, background music file (or none).
- **Overlays and templates:** which intro sequence, which name card style, which lower-thirds, which outro — either picking from a library of core templates or supplying brand-specific overlay components.
- **Mascot/visual assets:** optional; ragTech has Techybara, another brand may have nothing or something different.

The compositor selects brand assets at job time, not at build time. Adding a new brand means adding a new brand directory and config — no code change to the core pipeline.

The new codebase should build this in from the start. The existing codebase is retrofitting it via Phase 0.5; the rewrite should not repeat that pattern.

## Success metric

- A pipeline run for Brand A and Brand B on the same raw footage produces two different outputs — correct logos, colors, fonts, host name cards, intro/outro — with zero manual file-swapping between runs.
- Adding a third brand requires only: a new brand config file + asset directory. No changes to pipeline code, compositor, or overlay logic.
- ragTech's own episodes continue to render correctly as Brand 0 — the first brand in the system, not a special case.

## Related RFC / technical context

- Root `CLAUDE.md` Phase 0.5 (`refactor/p0-brand`) — the in-place brand abstraction work underway in the current codebase. The new codebase should treat this as a solved design problem (the Phase 0.5 schema is the reference), not repeat the discovery.
- Root `CLAUDE.md` — `remotion/types/brand.ts`: "Brand design tokens + extended identity/hosts/mascot/audio; `id: string` field required by registry." This type shape is the starting point for the new codebase's brand config schema.
- Root `CLAUDE.md` — `remotion/lib/brandRegistry.ts`: `getBrandOverlays(brandId)` registry pattern — the right abstraction, currently only ragTech-populated.
- Root `CLAUDE.md` — `OverlayRenderer.tsx`: "Remove remaining brand hardcoding (Phase 0.5 Steps 6–7)" — confirms hardcoding is still present in the current codebase.
- [RFC §Decision #3](../rfcs/0001-native-desktop-rewrite.md) — frozen JSON schemas as the interop contract. Brand config should be a versioned schema alongside `transcript.json` and `camera-profiles.json`, not ad hoc.

## Status

Validated — internal dogfooding + active service business requirement. The constraint is directly observed (ragTech branding is hardcoded), and the studio-rental partnership deal makes multi-brand support a prerequisite for the service business to function. Priority: P1 — required before taking on any client work outside ragTech's own episodes.
