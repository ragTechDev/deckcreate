## Summary

<!-- 2–4 bullets: what changed and why. Focus on effect, not just what the commit messages say. -->

-
-

## How to review

<!-- Key files changed and what a reviewer should focus on in each. -->

| File | What to check |
|------|---------------|
|  |  |

## Test plan

- [ ] `npm test` passes
- [ ] `npm run test:react` passes (if React/Remotion components changed)
- [ ] `npm run test:e2e` passes (if Phase 8 user-facing flows changed)

<!-- If Remotion components changed, add manual checks below: -->

Manual verification:
- [ ] <!-- [REMOTION-VISUAL] Remotion Studio: describe what to scrub and verify -->
- [ ] <!-- [UI-BROWSER] npm run dev: describe route and interaction to test -->

## Checklist

- [ ] Behaviour parity — relevant `npm run` scripts or Remotion compositions smoke-tested
- [ ] `tsc --noEmit` passes
- [ ] No new hardcoded paths in `scripts/`; no new duplicated timing constants in `remotion/`
- [ ] Type shapes match spec in `docs/PRODUCTION_REFACTOR_PLAN.md` (if types changed)
- [ ] Scope discipline — only files listed in the implementation doc were touched
