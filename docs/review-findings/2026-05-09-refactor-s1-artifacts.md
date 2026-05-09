# Review: refactor/s1-artifacts
Date: 2026-05-09
Reviewer: AI (review-pr skill) — session bias: CLEAN
PR: NONE (PR description provided inline by developer)

## Verdict
CHANGES REQUESTED

## Summary
This PR introduces a content-addressed artifact storage module (`scripts/config/artifacts.ts`) with `storeArtifact()` and `resolveArtifactPath()` helpers, backed by SHA-256 hashing and deduplication. The implementation is clean and the tests pass, but the test file violates the project's integration-test placement rule (known gap pattern), and the `.ragtech/` runtime directory is missing from `.gitignore`, creating a risk of accidentally committing large binary artifacts.

## Blockers (must fix before merge)

### B1 — Test with real I/O placed in `scripts/__tests__/` instead of `tests/integration/`
- **Type:** CONVENTION
- **File:** `scripts/__tests__/artifacts.test.ts`
- **Finding:** The test suite calls `fs.existsSync`, `fs.rmSync`, `fs.readFileSync`, `fs.readdirSync`, and (via `storeArtifact`) `fs.mkdirSync` + `fs.writeFileSync` — all real filesystem writes against `process.cwd()/.ragtech/artifacts/`. Per CLAUDE.md: *"If a test uses os.tmpdir(), fs.mkdtempSync, real file reads/writes, or spawns a process, it is an integration test — place it in tests/integration/"*. This matches the known gap pattern "Integration test placed in scripts/ instead of tests/integration/".
- **Fix:** Move the file to `tests/integration/artifacts.test.ts`. Also consider passing a base directory parameter to `storeArtifact` (or mocking `process.cwd()`) so the test can operate in an isolated temp directory rather than the live project root.

### B2 — `.ragtech/` not in `.gitignore`
- **Type:** QUALITY
- **File:** `.gitignore`
- **Finding:** `storeArtifact()` creates `.ragtech/artifacts/<hash>` files under `process.cwd()` (the project root). `.ragtech/` does not appear in `.gitignore`. If the `afterAll` cleanup in the test (or a future run) fails, binary artifact files will appear as untracked in the repo and could be committed accidentally. The CLAUDE.md refactor plan documents `.ragtech/` as a runtime directory (episode metadata, artifact store, run logs) — none of these should be source-controlled.
- **Fix:** Add `.ragtech/` to `.gitignore`.

## Warnings (should address)

### W1 — Hash truncated to 12 chars; CLAUDE.md spec says `{sha256}` (full hash)
- **Type:** QUALITY
- **File:** `scripts/config/artifacts.ts:15`
- **Finding:** `const shortHash = hash.substring(0, 12)` uses 48 bits of the 256-bit SHA-256 digest. CLAUDE.md documents the artifact path as `.ragtech/artifacts/{sha256}.mp4`, implying the full hash. 12 hex chars gives ~281 trillion values — astronomically unlikely to collide in this use case, but it diverges from the spec and makes artifact identity ambiguous if the store ever grows or is used as a cache key in external tools.
- **Suggestion:** Use the full 64-char hex hash, or at minimum align the chosen length with the spec and document the decision.

### W2 — Artifact files have no extension; CLAUDE.md spec shows `.mp4`
- **Type:** QUALITY
- **File:** `scripts/config/artifacts.ts:24`
- **Finding:** `const artifactPath = path.join(artifactsDir, shortHash)` stores files with no extension. The CLAUDE.md spec shows `.ragtech/artifacts/{sha256}.mp4`. Bare-hash filenames are opaque — file managers, `file` commands, and future tooling cannot infer content type.
- **Suggestion:** Accept an optional `ext` parameter (e.g. `storeArtifact(content, '.mp4')`) or use a fixed extension for the current use case. Alternatively, confirm the generic-store design is intentional and update CLAUDE.md.

### W3 — `process.cwd()` coupling makes the module context-sensitive
- **Type:** QUALITY
- **File:** `scripts/config/artifacts.ts:18`
- **Finding:** `const artifactsDir = path.join(process.cwd(), ARTIFACTS_DIR)` resolves relative to wherever the Node process is started. If a script is invoked from a subdirectory, artifacts land in the wrong location. The existing `scripts/config/project.ts` uses a similar pattern; a shared `projectRoot()` helper would make this robust.
- **Suggestion:** Accept an optional `baseDir` parameter that defaults to `process.cwd()`, or import/create a `projectRoot()` utility in `scripts/config/paths.ts` (planned in the refactor) and use it here.

### W4 — `storeArtifact` / `resolveArtifactPath` are not yet imported by any other module
- **Type:** QUALITY
- **File:** `scripts/config/artifacts.ts`
- **Finding:** No production code imports the new functions. Orphaned modules are not a blocker for a staged implementation, but the functions should be wired up in a follow-on commit or the PR description should note this is a foundation-only commit.
- **Suggestion:** Add a note to the PR description clarifying that these functions will be consumed in the next sprint step.

## Suggestions (optional improvements)

- `resolveArtifactPath` does not verify the artifact exists before returning the path. Callers passing a bad hash silently get a non-existent path. Consider adding an existence check or renaming to `getArtifactPath` to signal it is a pure path builder with no validation.
- The `beforeEach` in the test deletes `.ragtech/artifacts/` before every test. Because the cleanup targets `process.cwd()` (the live project root), a test runner crash between `beforeEach` deletion and `afterAll` cleanup leaves the directory absent but no harm done. If the directory contained real artifacts from a prior run, `beforeEach` would silently destroy them. Using a dedicated temp directory resolves this entirely.

## Test plan verification

| Item | Status | Notes |
|------|--------|-------|
| `npm test -- scripts/__tests__/artifacts.test.ts` passes (8/8) | PASS | All 8 tests pass |
| `npm test` (full suite) | PRE-EXISTING FAILURES | 4 suites fail (CarouselGenerator, generate-carousel, CaptionExtractor, transcript-caption) — none are in this diff; failures predate this branch |
| `tsc --noEmit` | PASS | No type errors |
| Manual: `npx tsx -e "import './scripts/config/artifacts.ts'"` | NOT RUN | |
| Manual: `storeArtifact('test')` returns hash | NOT RUN | |

## Patterns observed

- **B1** matches the known gap pattern: "Integration test placed in scripts/ instead of tests/integration/" (first seen refactor/s1-project-file — 2026-05-09). No new pattern entry needed.
- **B2** (missing `.gitignore` entry for runtime directory) is a new pattern — see Step 8 note.
