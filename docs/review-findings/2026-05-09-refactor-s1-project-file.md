# Review: refactor/s1-project-file
Date: 2026-05-09
Reviewer: AI (review-pr skill) — session bias: CLEAN
PR: NONE (no gh CLI available; PR description provided inline)

## Verdict
CHANGES REQUESTED

## Summary
Scaffolds `scripts/config/project.ts` as the typed foundation for the project-file layer: `ProjectFile` interface, `readProject`/`writeProject` helpers, and `ProjectNotFoundError`. Scope is well-contained and the implementation is clean. The one blocker is a test-placement convention violation — the new tests use real filesystem I/O and must live in `tests/integration/` per the project's TESTING_STANDARDS.

## Blockers (must fix before merge)

### B1 — Test file uses real I/O but lives outside `tests/integration/`
- **Type:** COVERAGE / CONVENTION
- **File:** `scripts/config/project.test.ts`
- **Finding:** The test file uses `fs.mkdtempSync(path.join(os.tmpdir(), ...))` and real filesystem reads/writes. Per `docs/TESTING_STANDARDS.md`: "Integration tests are allowed to: Read and write real files in `os.tmpdir()` temp directories" and "Exception: integration tests always go in `tests/integration/`." Verified by running `npm run test:integration` — it returns zero matches, so these tests are entirely hidden from that runner.
- **Fix:** Move `scripts/config/project.test.ts` → `tests/integration/project.test.ts` and update the import path from `'./project'` to `'../../scripts/config/project'`. The 6 tests pass and require no other changes.

## Warnings (should address)

### W1 — `project.ts` not yet imported anywhere
- **Type:** QUALITY
- **File:** `scripts/config/project.ts`
- **Finding:** No file in the codebase imports `readProject`, `writeProject`, `ProjectFile`, or `ProjectNotFoundError`. The file is unreferenced at merge time.
- **Suggestion:** Expected for Sprint 1 scaffolding and documented in the implementation guide — confirm this is intentional. Future pipeline stages that import this module will close the gap.

### W2 — `as ProjectFile` cast silently swallows structural errors
- **Type:** COVERAGE
- **File:** `scripts/config/project.ts:53` (`readProject`)
- **Finding:** `JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ProjectFile` performs no structural validation. A project.json that is syntactically valid JSON but missing required fields (e.g., no `episode` key) will return a `ProjectFile`-shaped object with `undefined` properties, causing silent downstream failures. No test exercises this path.
- **Suggestion:** Acceptable for Sprint 1 scaffolding. Add a `// TODO: validate against ProjectFile schema (Phase 0)` comment or a note in the implementation guide so this doesn't get lost before pipeline stages start consuming this file.

## Suggestions (optional improvements)

- `ProjectNotFoundError` sets `this.name = 'ProjectNotFoundError'` manually, which is the correct pattern for custom errors in TypeScript. Consider adding a test that asserts `error.name === 'ProjectNotFoundError'` to lock in this contract — useful if callers ever switch from `instanceof` to name-checking.
- The `readProject` implementation uses `existsSync` then `readFileSync` (TOCTOU pattern). For a single-user CLI tool this is fine; worth noting if the module is ever used in a server context.

## Test plan verification

| Item | Status | Notes |
|------|--------|-------|
| `npx jest --testPathPattern="scripts/config/project.test" --no-coverage` | PASS | 6/6 tests pass |
| `npm test` (full suite) | PRE-EXISTING FAILURES | 23 failures in `CarouselGenerator` and other suites unrelated to this branch; same count on `origin/main` |
| `npm run test:integration` | NOT FOUND | 0 matches — B1 above |
| `npx tsc --noEmit` | CLEAN | No type errors |
| `npm run test:react` | SKIPPED | No `app/` or `remotion/` files changed |

## Patterns observed
<!-- Step 8 — populated below -->
- **New pattern detected:** Integration test placed in `scripts/` instead of `tests/integration/` (see B1). Added to SKILL.md Known Gap Patterns.
