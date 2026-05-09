# Review: refactor/s1-audiosync-determinism
Date: 2026-05-09
Reviewer: AI (review-pr skill) — session bias: CLEAN
PR: NONE (summary provided inline by developer)
Review iterations: 2 (second pass after developer addressed B1, W3, S1)

## Verdict
APPROVED WITH SUGGESTIONS

## Summary
This PR makes `AudioSyncer.findBestLag()` deterministic by collecting near-maximum correlation peaks within a 0.5 SNR threshold and tie-breaking on earliest scan order, and converts the floating-point lag to a frame-exact integer offset at 30 fps. After the developer addressed the only blocker (non-deterministic test) and both open warnings (stale API call, missing edge-case test), no blockers remain. Three minor warnings remain that should be addressed in a follow-up.

## Blockers
None — all blockers resolved.

~~### B1 — validatePeak test used Math.random() and only type-checked return values~~
**RESOLVED (2nd pass):** Replaced `Math.random()` with deterministic `0.01` noise floor. Added `expect(result.isReliable).toBe(false)` and `expect(result.snr).toBeGreaterThan(0)` — now genuinely behavioural.

## Warnings (should address)

### W1 — frameRate = 30 duplicated in two methods
- **Type:** QUALITY
- **File:** [scripts/sync/AudioSyncer.js](scripts/sync/AudioSyncer.js) (lines 206 and 220)
- **Finding:** `const frameRate = 30` is declared as a local variable in both `findBestLag()` and `validatePeak()`. If the sync frame-rate assumption changes, both declarations must be updated together.
- **Suggestion:** Hoist to a module-level constant: `const SYNC_FRAME_RATE = 30;`. Add to the CLAUDE.md Common Constants table.

### W2 — SNR nearness threshold (0.5) and reliability threshold (3.0) are unnamed magic numbers
- **Type:** QUALITY
- **File:** [scripts/sync/AudioSyncer.js](scripts/sync/AudioSyncer.js) (lines 193 and 226)
- **Finding:** `Math.abs(v - maxVal) <= 0.5` and `snr >= 3.0` use raw literals. Neither is discoverable by grep, documented in CLAUDE.md, or annotated with units (`0.5` is in correlation-amplitude units, not dB).
- **Suggestion:** Extract as `const PEAK_NEARNESS_THRESHOLD = 0.5;` and `const RELIABILITY_SNR_THRESHOLD = 3.0;` at module level.

### W3 — validatePeak "happy path" (isReliable = true) is untested
- **Type:** COVERAGE
- **File:** [scripts/__tests__/AudioSyncer.test.js](scripts/__tests__/AudioSyncer.test.js) (lines 113–133)
- **Finding:** The existing test uses `lagSeconds = 0.033` which at `sampleRate = 8000` maps to sample 267 → wraps to index 67 (the comment "maps to index 50" is incorrect). The test checks the noise floor, not the peak. The `isReliable: snr >= 3.0` branch is never exercised with a `true` result. Add a second case where the lag maps to the actual peak and assert `isReliable = true` with a high SNR bound.
- **Suggestion:** Add a test with `lagSeconds = 0` (maps to index 0), peak at index 0 with high amplitude vs. low noise, assert `isReliable = true` and `snr > 3`.

~~### W4 — Stale extra argument in determinism test~~
**RESOLVED:** `findBestLag(correlation, 50)` updated to `findBestLag(correlation)`.

## Suggestions resolved

~~### S1 — Missing test: near-equal peak appearing before global maximum~~
**RESOLVED:** New test `'should prefer global max over near-equal peaks appearing before it'` added in `AudioSyncer.determinism.test.js`, correctly documenting and verifying the algorithm's single-pass behaviour.

## Test plan verification

| Item | Status | Notes |
|------|--------|-------|
| npm test passes | PASS | 244 tests (13 AudioSyncer), 2 skipped |
| npm run test:react | SKIPPED | No React files changed |
| npm run test:e2e | SKIPPED | No Phase 8 UI flows changed |
| tsc --noEmit | PASS | Clean |
| Manual: identical lag across runs | NOT RUN | Marked ✅ by developer |
| Manual: frame-exact timing | NOT RUN | Marked ✅ by developer |
| Manual: deterministic peak selection on real data | NOT RUN | Marked ✅ by developer |

## Patterns observed
- **Non-deterministic test setup (Math.random in test body)** — new pattern added to SKILL.md (first pass)
