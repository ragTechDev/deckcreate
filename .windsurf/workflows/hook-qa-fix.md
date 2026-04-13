---
description: Read the hook QA report, diagnose hook segment issues, and fix them. Use when hook-qa has been run and produced a report with failures.
---

# Hook QA Fix Workflow

This workflow reads the hook-qa report, interprets diagnostics, fixes the root causes, and re-runs the QA to verify.

---

## Step 1 — Read the report

Read the hook QA report:

```
public/transcribe/output/hook-qa/hook-qa-report.json
```

Focus on these sections in order:

1. **`summary`** — get the overall pass/fail and counts
2. **`diagnostics.conclusions[]`** — the auto-detected patterns (sorted by severity: HIGH → MEDIUM → LOW)
3. **`segmentMetadata[]`** — per-hook config snapshot (hookFrom, hookTo, bounded/unbounded, sourceStart/sourceEnd, last spoken token times, tail pad applied)
4. **`perSegmentBreakdown[]`** — issues grouped by segment, with `nearBoundary` flags and `distToClipEndSec`
5. **`driftTrends[]`** — per-segment drift statistics (mean, median, direction, monotonic)

Skip `matchedSample` unless you need to verify a specific token alignment.

---

## Step 2 — Triage diagnostics by pattern

For each `diagnostics.conclusions[]` entry, follow the appropriate fix path below. Work HIGH severity first, then MEDIUM.

### Pattern: `tailClipping` (HIGH)

**Meaning:** Tokens near the end of a hook clip are missing — the clip ends too early.

**Investigation steps:**

1. Look at `perSegmentBreakdown[].missing[]` for entries where `nearBoundary === "tail"`. Note `distToClipEndSec` — this tells you how close the token was to the clip edge.
2. Look at `segmentMetadata[]` for the affected segments. Check:
   - `isBounded` — if true, `hookTo` in `transcript.doc.txt` may be set too early
   - `lastSpokenTend` vs `sourceEnd` — if `lastSpokenTend` is very close to or past `sourceEnd`, tail padding is insufficient
   - `tailPadApplied` — the padding constant used (0.02s for bounded, 0.16s for unbounded)
3. Read `remotion/components/SegmentPlayer.tsx`, function `getHookSubClips()` — verify `sourceEnd` calculation uses `t_end` of last spoken token (not just `t_dtw`)
4. Read `remotion/components/HookOverlay.tsx`, function `buildHookTimings()` — verify its `sourceEnd` calc matches `getHookSubClips` exactly

**Possible fixes (choose the minimal one):**

- If `hookTo` is wrong in `transcript.doc.txt`: edit the `HOOK` annotation to extend `hookTo`
- If tail padding is too small: increase `HOOK_TAIL_PAD_BOUNDED_SECONDS` or `HOOK_TAIL_PAD_UNBOUNDED_SECONDS` in `SegmentPlayer.tsx` (and mirror in `HookOverlay.tsx` and `scripts/hook-qa.js`)
- If `sourceEnd` calc is wrong: fix the logic in `getHookSubClips()` and mirror in `buildHookTimings()`

### Pattern: `headClipping` (HIGH)

**Meaning:** Tokens near the start of a hook clip are missing — the clip starts too late.

**Investigation steps:**

1. Look at `perSegmentBreakdown[].missing[]` for entries where `nearBoundary === "head"`.
2. Check `segmentMetadata[]` for the affected segment's `hookFrom` and `sourceStart`.
3. Read the segment in `transcript.doc.txt` — verify the `HOOK` annotation's start time (`hookFrom`) is correct.
4. Read `remotion/components/SegmentPlayer.tsx` → `getHookSubClips()`: `sourceStart = segment.hookFrom ?? segment.start`

**Possible fixes:**

- If `hookFrom` is wrong: edit the `HOOK` annotation in `transcript.doc.txt`, then run `npm run merge-doc`
- If source segment `start` is wrong: check the original transcript alignment

### Pattern: `accumulatingDrift` (HIGH)

**Meaning:** Timing drift increases monotonically through a segment — the QA script's expected-time model diverges from what Remotion actually renders.

**Investigation steps:**

1. Look at `driftTrends[]` for affected segments: note `minDriftMs`, `maxDriftMs`, and `spread`.
2. The most likely cause is a mismatch between how `scripts/hook-qa.js` → `buildExpectedHookTokens()` accumulates `cumulativeFrames` vs how Remotion's `buildSections()` / `SectionGroupPlayer` maps source frames to output frames.
3. Read `scripts/hook-qa.js` lines around `buildExpectedHookTokens` — check `toClipFrames()` rounding (Math.floor/Math.ceil) and `outputStartSec = cumulativeFrames / fps`.
4. Read `remotion/components/SegmentPlayer.tsx` → `buildSections()` — compare how `trimBefore` and `trimAfter` are computed for hook sections.
5. Check if FPS is consistent (script uses `const FPS = 60`, Remotion composition should also be 60).

**Possible fixes:**

- Align the rounding in `toClipFrames()` with Remotion's `trimBefore = Math.floor(start * fps)` / `trimAfter = Math.ceil(end * fps)`
- If the issue is cumulative rounding, consider computing expected times from frame counts rather than floating-point seconds

### Pattern: `systematicDrift` (MEDIUM)

**Meaning:** All tokens in a segment are consistently early or late by a similar amount.

**Investigation steps:**

1. Look at `driftTrends[]` for the `meanDriftMs` and `direction` of affected segments.
2. If drift is consistent across ALL segments: likely a global offset — check `remotion/Composition.tsx` for how hook duration / intro frames are calculated.
3. If drift is only in later segments: likely cumulative frame rounding — same investigation as `accumulatingDrift`.
4. If drift is only in one segment: could be an alignment issue in the source transcript — check the segment's token `t_dtw` values in `public/transcribe/output/edit/transcript.json`.

**Possible fixes:**

- Global offset: adjust the frame offset in `buildExpectedHookTokens()` or in Remotion's composition
- Per-segment: fix the specific segment's source alignment or hook boundaries

### Pattern: `asrNoise` (LOW)

**Meaning:** Substitutions and extras are Whisper/WhisperX transcription differences, not rendering bugs.

**Action:** No code fix needed. If substitution count is very high (>20% of expected tokens), consider:
- Using a larger Whisper model for the QA transcription step
- Increasing `--drift-threshold-ms` to reduce false timing mismatches

---

## Step 3 — Read source files for context

Before making any fix, always read the relevant source files listed in the diagnostic's `investigate[]` array. Key files:

| File | What to look for |
|---|---|
| `remotion/components/SegmentPlayer.tsx` | `getHookSubClips()`, `buildSections()`, `SectionGroupPlayer`, hook/main section frame math |
| `remotion/components/HookOverlay.tsx` | `buildHookTimings()`, `buildCaptions()` — must mirror SegmentPlayer timing |
| `remotion/Composition.tsx` | `calculateMetadata()` — hook duration, intro frames, total duration |
| `remotion/lib/tokens.ts` | `isSpokenToken()` — token filtering logic |
| `scripts/hook-qa.js` | `buildExpectedHookTokens()`, `getHookClipRange()` — QA's expected-time model |
| `scripts/edit-transcript.js` | `deriveCuts()` — how token cuts become TimeCut ranges |
| `public/transcribe/output/edit/transcript.doc.txt` | HOOK annotations — human-editable source of hookFrom/hookTo |

**Critical rule:** Any timing change in `SegmentPlayer.tsx` must be mirrored in `HookOverlay.tsx` and `scripts/hook-qa.js` to keep video, captions, and QA in sync. These three files share the same clip boundary math.

---

## Step 4 — Apply the minimal fix

Follow the project's bug-fixing discipline:

- Prefer minimal upstream fixes over downstream workarounds
- Use single-line changes when sufficient
- Do NOT change constants without understanding the downstream impact on all three files (SegmentPlayer, HookOverlay, hook-qa.js)
- Do NOT modify or weaken the QA report logic to make it pass

---

## Step 5 — Verify syntax

After making changes, run syntax checks on all modified files:

```bash
# For .js files
node --check scripts/hook-qa.js

# For .tsx/.ts files — use TypeScript compiler
npx tsc --noEmit
```

---

## Step 6 — Re-run hook QA

// turbo
Re-run the hook QA to verify the fix:

```bash
npm run hook-qa -- --skip-render
```

Use `--skip-render` if only the comparison logic or transcript changed (not the rendering code). If you changed rendering code (SegmentPlayer, HookOverlay, Composition), run the full pipeline:

```bash
npm run hook-qa
```

Or in Docker:

```bash
npm run hook-qa:docker
```

---

## Step 7 — Interpret results

Read the new report's `summary` and `diagnostics.conclusions[]`.

- **Pass** (`pass: true`): all hooks render correctly with no missing tokens and no timing mismatches beyond threshold. Done.
- **Fewer issues**: progress is being made. Go back to Step 2 with the new report.
- **Same or more issues**: the fix didn't work or introduced a regression. Revert and re-investigate.

Report the final summary to the user with:
- Before/after comparison of `missingTokenCount`, `timingMismatchCount`, and active diagnostic patterns
- Which files were changed and why
- Any remaining issues that need human judgment (e.g., hookFrom/hookTo values in transcript.doc.txt)
