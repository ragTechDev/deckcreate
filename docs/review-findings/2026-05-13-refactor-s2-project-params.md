# Review: refactor/s2-project-params
Date: 2026-05-13
Reviewer: AI (review-pr skill) — session bias: CLEAN
PR: NONE (no open PR; description provided in /review-pr invocation)

## Verdict
APPROVED WITH SUGGESTIONS

## Summary
This PR closes Issue #3: it replaces the `[key: string]: unknown` index signature in `PipelineParams` with four typed, optional fields that match the spec in `docs/PRODUCTION_REFACTOR_PLAN.md` exactly, and wires `diarize-audio.js`, `transcribe-audio.js`, and `edit-transcript.js` to read the relevant param from `.ragtech/project.json` before falling back to CLI flags. Dead code (`OUTRO_DURATION_SECS`, `actualEnd`, `baseStart`) is also removed from `edit-transcript.js`. The main risk area is the duplicated `readProjectParams` helper; the only coverage gap is the missing integration test for `edit-transcript.js`.

## Blockers (must fix before merge)
_None._

## Warnings (should address)

### W1 — `readProjectParams` duplicated across three `.js` scripts
- **Type:** QUALITY
- **File:** `scripts/diarize/diarize-audio.js:20`, `scripts/transcribe/transcribe-audio.js:19`, `scripts/edit-transcript.js:23`
- **Finding:** All three files define an identical `readProjectParams(cwd)` function body that directly reads `.ragtech/project.json` and returns `params ?? {}`. The canonical `readProject()` in `scripts/config/project.ts` cannot be imported from `.js` files (no compiled output, `noEmit: true` tsconfig), so duplication is pragmatically unavoidable until Phase 3. However, if `PROJECT_DIR` (`.ragtech`) or `PROJECT_FILENAME` is ever renamed in `project.ts`, all three scripts would silently stop reading the project file with no compile error.
- **Suggestion:** Add a brief comment in each copy pointing to `project.ts` as the canonical source (`// matches PROJECT_DIR / PROJECT_FILENAME in scripts/config/project.ts`), so Phase 3 migration has a clear signal to consolidate. No code change required before merge.

### W2 — `edit-transcript.js` entrypoint lacks integration test coverage
- **Type:** COVERAGE
- **File:** `tests/integration/project-params-entrypoints.test.ts`
- **Finding:** `diarize-audio.js` and `transcribe-audio.js` each have 3 integration tests covering all three resolution paths (project-file, absent-file fallback, CLI override). `edit-transcript.js` received the same `timestamp_offset` wiring but has zero integration tests in this PR. The only coverage is the manual verification step in the test plan. The pattern is low-risk because it's identical to the tested scripts, but the entrypoint itself is untested.
- **Suggestion:** Add 2–3 integration tests for `edit-transcript.js` to `project-params-entrypoints.test.ts` mirroring the `transcribe-audio.js` block. Note that spawning `edit-transcript.js` requires a `transcript.raw.json` fixture; if that's too heavy, a lighter approach is to test `readProjectParams` as a shared helper once it's extracted in Phase 3.

## Suggestions (optional improvements)

- The `diarization_seed` and `sync_window_seconds` fields are typed in `PipelineParams` but not yet consumed by any script. No action needed — this is intentional (scope of this issue is `num_speakers` + `timestamp_offset`). Phase 2 DAG runner will wire `sync_window_seconds`; diarize seed wiring can follow.
- `transcribe-audio.js` changed the guard from `cli.timestampOffset || 0` to `cli.timestampOffset ?? projectParams.timestamp_offset ?? 0`. This is a subtle but correct improvement: `||` coerces the valid value `0` to the default, while `??` correctly treats `0` as an explicit user choice. No action needed — just noting it as a correctness fix bundled in the PR.

## Test plan verification

| Item | Status | Notes |
|------|--------|-------|
| `npm test` passes (15 suites, 272 tests) | PASS | 2 tests skipped (pre-existing); no failures |
| `tsc --noEmit` clean | PASS | No TypeScript errors |
| `[PIPELINE]` transcribe with project `timestamp_offset: 0.5` prints `Offset: -0.5s` | NOT RUN | Manual step; marked done by developer in PR description |
| `[PIPELINE]` diarize with project `num_speakers: 3` prints `Speakers: 3 (locked)` | NOT RUN | Manual step; marked done by developer in PR description |

## Patterns observed
- W1 above is a variant of a pattern already tracked ("Implementation diverges from documented spec…") but applies specifically to `.js`↔`.ts` boundary duplication pre-Phase 3. Not a new pattern — existing `readProject` vs inline copy is an expected transitional state.
- No new patterns identified.
