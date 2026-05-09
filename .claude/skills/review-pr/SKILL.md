---
name: review-pr
description: Reviewer-side PR audit. Detects generator bias and starts a fresh session if needed, rebases the branch and resolves straightforward conflicts, collects PR context and derives a test plan if absent, checks code quality (no eslint-disable, no duplicate constants, no orphaned files, env var coverage), audits test coverage against acceptance criteria, runs the full build and test suite, documents findings, and self-updates this skill with any new gap patterns observed.
argument-hint: [optional: PR number or branch name, default is current branch]
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, TodoWrite, AskUserQuestion
---

You are a PR reviewer. Your job is to catch problems before a merge — not to implement fixes yourself, but to identify, document, and block on issues that matter. Be specific: name the file, line, and rule. Do not approve by silence.

Run every step in order. Do not skip steps. If a step produces blockers, document them and continue to the next step — collect all findings before reporting.

---

## Step 0 — Generator bias detection

Before reviewing any code, determine whether this session generated the code you are about to review. Reviewing code you wrote in the same session introduces generator bias: you will miss your own blind spots.

### 0a — Identify changed files

```bash
git fetch origin
git diff --name-only origin/main...HEAD
```

Capture the list of changed files.

### 0b — Introspect session history

Scan your own conversation context for this session. Look for any `Write` or `Edit` tool calls that targeted a file appearing in the diff list from Step 0a.

This is a self-check: if you wrote or edited any file in the diff during this session, you have generator bias.

### 0c — Decision

| Condition | Action |
|-----------|--------|
| No overlap — you did not generate any of these files | Continue to Step 1 |
| Overlap found — you wrote or edited ≥ 1 file in the diff | Stop and present the generator bias warning below |

**Generator bias warning (present and block):**

```
⚠️  GENERATOR BIAS DETECTED

This agent session was used to write or modify the following files that are now under review:

  <list the overlapping files>

Reviewing code you generated in the same session is unreliable — you will tend to overlook
the same mistakes you made when writing it.

Recommended action: start a fresh Claude Code session and run /review-pr from there.

Reply PROCEED to continue this review anyway (at your own risk), or STOP to abort.
```

Use `AskUserQuestion` to ask the reviewer. If they reply `STOP` or anything other than `PROCEED` (case-insensitive), print "Review aborted — restart in a fresh session." and stop.

If they reply `PROCEED`, print a note that the review is proceeding with known generator bias and continue.

---

## Step 1 — Rebase check

Verify the branch is on top of the latest `origin/main`. Stale branches produce false conflicts and make diffs harder to read.

```bash
git merge-base --is-ancestor origin/main HEAD && echo "REBASED" || echo "BEHIND"
```

**If `REBASED`:** continue to Step 2.

**If `BEHIND`:** attempt a rebase:

```bash
git rebase origin/main
```

If the rebase completes cleanly, print:

```
✓ Rebase: branch fast-forwarded onto origin/main
```

Continue to Step 2.

**If the rebase hits conflicts:**

For each conflicted file, open it and classify the conflict:

| Conflict type | Condition | Action |
|---------------|-----------|--------|
| **Trivial** | One side added entirely new lines with no overlap (e.g., new import, new constant, new function) | Resolve by accepting both sides; keep incoming addition + main addition |
| **Formatting-only** | The only difference is whitespace, trailing commas, or import order | Resolve by accepting the branch version (it came last) |
| **Unambiguous** | One side deleted a line the other side did not touch, or one side is a pure addition the other does not conflict with | Resolve deterministically; log the decision |
| **Ambiguous** | Both sides changed the same logic, or the intent of one side is unclear without domain knowledge | Stop, show the conflict, and ask the human |

For each **ambiguous conflict**, use `AskUserQuestion`:

```
Rebase conflict — human decision required

File: <path/to/file.ts>
Conflict:

<<<<<<< HEAD (main)
<main side — paste the relevant lines>
=======
<branch side — paste the relevant lines>
>>>>>>> <commit-sha> (<branch-name>)

Context: <one sentence explaining what each side is doing>

Which version should win, or how should the two sides be merged?
Reply with: MAIN | BRANCH | <custom resolution>
```

Apply the human's resolution, stage the file, and continue the rebase:

```bash
git add <file>
git rebase --continue
```

Repeat for each conflicted file. If the human ever replies `ABORT`, run `git rebase --abort` and stop with:

```
✗ REVIEW BLOCKED — rebase aborted at developer request.
Resolve the conflicts manually, then re-run /review-pr.
```

After all conflicts are resolved, print a summary:

```
✓ Rebase complete
  Trivial conflicts resolved automatically: <N>
  Conflicts resolved with human input: <N>
```

---

## Step 2 — Collect PR context

Gather the PR description, acceptance criteria, and any linked issues.

### 2a — Try GitHub

```bash
gh pr list --head "$(git branch --show-current)" --json number,title,body,url --state open
```

If a PR is found, extract:
- **PR number and URL**
- **Summary / description**
- **Acceptance criteria** (look for "Acceptance Criteria", "AC", "Definition of Done" sections)
- **Test plan** (look for "Test plan", "Testing", "QA" sections)
- **Linked issues** (look for `Closes #N`, `Fixes #N`, `Resolves #N`)

If no open PR is found, continue to 2b.

### 2b — Fallback: ask the developer

Use `AskUserQuestion`:

```
No open PR found for this branch.

Please paste the PR description (body) here, or reply NONE if there is no PR yet.
```

If the developer replies `NONE` or pastes nothing useful, note "No PR body available" and continue to Step 3 using only the diff as context.

### 2c — Record context

Print a summary of what was found:

```
PR context:
  PR:                  #<N> — <title> (<url>) | NONE
  Acceptance criteria: found (<N> items) | not found
  Test plan:           found | not found
  Linked issues:       #N, #M | none
```

---

## Step 3 — Test plan

### 3a — If a test plan exists

Extract it verbatim from the PR body. Convert it to a checklist if it is not already one.

Print:

```
Test plan (from PR):
□ <item 1>
□ <item 2>
...
```

### 3b — If no test plan exists

Derive one. Use the following inputs:
- Acceptance criteria (if any, from Step 2)
- Changed files (from Step 0a), partitioned into buckets (scripts, Remotion, app components, API routes, config, docs)
- Any obvious user-facing or pipeline-facing behaviour changed by the diff

Produce a checklist of the form:

```
Test plan (derived — no test plan in PR):
Automated:
□ npm test passes
□ npm run test:react passes (React files changed)
□ npm run test:integration passes (integration files changed)
□ npm run test:e2e passes (Phase 8 / UI flows changed)
□ tsc --noEmit clean

Manual (requires human):
□ [REMOTION-VISUAL] <specific check> — Affected: <file>
□ [UI-BROWSER] <specific check> — Affected: <file>
□ [PIPELINE] <specific check> — Affected: <file>
```

Only include buckets that have changed files. Be specific — name the component or script being tested.

Note the derivation for the review findings doc in Step 7.

---

## Step 4 — Code quality checks

Run each check against all files in the diff. Collect all findings; do not stop on first failure.

### 4a — ESLint disable comments

```bash
git diff origin/main...HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx' | grep '^\+' | grep -E 'eslint-disable'
```

Every `eslint-disable` or `eslint-disable-next-line` added in this diff is a finding.

For each occurrence, record:

```
[QUALITY] eslint-disable used
  File:   <path>
  Line:   <approximate location>
  Rule:   <which rule is disabled, if specified>
  Risk:   Suppressing lint rules hides real bugs. Prefer fixing the root cause.
  Verdict: BLOCKER — remove the disable comment or justify it explicitly in the PR.
```

### 4b — Duplicate constants

Check whether any magic number or string literal in the diff already exists as a named constant in:
- `CLAUDE.md` → **Common Constants** table
- Any `*constants.ts`, `*config.ts`, or `remotion/lib/*.ts` file in the repo

```bash
# Find existing constant files
find . -name "*constants*" -o -name "*config*" \
  | grep -v node_modules | grep -v .next | grep -v coverage \
  | grep -E '\.(ts|js)$'
```

For each magic literal in the diff that matches a value in those files, record:

```
[QUALITY] Duplicate constant
  File:    <path-in-diff>
  Value:   <literal value>
  Already defined in: <existing-file>:<constant-name>
  Verdict: BLOCKER — import the shared constant instead of re-declaring.
```

### 4c — Orphaned files

For each **new file** added in the diff (not modified — added), check whether it is referenced anywhere in the codebase:

```bash
# For a new file scripts/foo/bar.ts:
grep -rn "bar" --include="*.ts" --include="*.tsx" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.next . | grep -v "bar.ts"
```

Also check:
- Is it exported from an `index.ts`?
- Is it imported anywhere?
- Is it referenced in `scripts/wizard.js` or a pipeline runner?

If a new file is unreferenced, record:

```
[QUALITY] Orphaned file
  File:    <path>
  Status:  Added but not imported or referenced anywhere in the codebase.
  Verdict: WARNING — confirm this file is intentional and will be wired up, or delete it.
```

### 4d — Environment variable coverage

Find all `process.env.` references added in the diff:

```bash
git diff origin/main...HEAD -- '*.ts' '*.tsx' '*.js' | grep '^\+' | grep 'process\.env\.'
```

For each `process.env.VAR_NAME` found, check whether `VAR_NAME` appears in `.env.example` (or `.env.sample` / `.env.template`):

```bash
find . -name ".env.example" -o -name ".env.sample" -o -name ".env.template" \
  | grep -v node_modules
```

```bash
grep "VAR_NAME" .env.example 2>/dev/null || echo "MISSING"
```

For each missing variable, record:

```
[QUALITY] Missing env var documentation
  Variable: <VAR_NAME>
  Used in:  <file>
  Missing from: .env.example
  Verdict: BLOCKER — add VAR_NAME= with a placeholder value and a comment to .env.example.
```

---

## Step 5 — Test coverage audit

### 5a — Identify source files changed

From the Step 0a diff, filter to non-test source files:

```bash
git diff --name-only origin/main...HEAD \
  | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '^e2e/' \
  | grep -E '\.(ts|tsx|js|jsx)$'
```

### 5b — Check for corresponding test files

For each source file `path/to/foo.ts`, check:

```bash
ls path/to/foo.test.ts 2>/dev/null || echo "MISSING"
ls path/to/foo.test.tsx 2>/dev/null || echo "MISSING"
ls tests/integration/ 2>/dev/null
```

Use the decision table from `docs/TESTING_STANDARDS.md`:

| Condition | Required test type | Location |
|-----------|--------------------|----------|
| Pure functions (no I/O) | Unit test | Next to the file |
| Filesystem I/O or spawns processes | Integration test | `tests/integration/` |
| React component | Smoke render test | Next to the file (react project) |
| App API route | Unit or integration test | Next to or in `tests/integration/` |
| Remotion component | Smoke render test (mock remotion hooks) | Next to the file (react project) |
| Pure Remotion lib function | Unit test | Next to the file |
| Config / tooling / docs / assets | No test required | — |

### 5c — Cross-check tests against acceptance criteria

For each acceptance criterion in the test plan (Step 3), verify that at least one test exists that could falsify it. A criterion like "readProject() throws ProjectNotFoundError when file missing" must have a test that exercises that path.

If a criterion has no corresponding test, record:

```
[COVERAGE] Uncovered acceptance criterion
  AC:    <criterion text>
  Gap:   No test exercises this path.
  Verdict: BLOCKER — add a test before merging.
```

### 5d — Test quality spot-check

For each test file in the diff, scan for trivially passing tests:
```bash
grep -n "expect(true)" <test-file>
grep -n "expect.*toBeTruthy()" <test-file>
grep -n "toBeDefined()" <test-file>
```

A test that only asserts `expect(true).toBe(true)` or `expect(result).toBeDefined()` with no behavioural assertion is a gap — it passes regardless of implementation.

For each such test, record:

```
[COVERAGE] Trivially passing test
  File:  <test-file>
  Line:  <N>
  Issue: Assertion does not verify behaviour — will pass even if implementation is broken.
  Verdict: WARNING — replace with a behavioural assertion.
```

---

## Step 6 — Build and test suite

### 6a — Type check

```bash
npx tsc --noEmit
```

If this exits non-zero, record each error as:

```
[BUILD] TypeScript error
  File: <path>
  Error: <message>
  Verdict: BLOCKER
```

### 6b — Unit and integration tests

```bash
npm test
```

If tests fail, record:

```
[TEST] Test suite failure
  Suite: npm test
  Failures: <test names>
  Verdict: BLOCKER
```

### 6c — React tests (if applicable)

If any `app/**` or `remotion/**` files changed:

```bash
npm run test:react
```

Record failures as above with `Suite: npm run test:react`.

### 6d — E2E tests (if applicable)

If the diff includes Phase 8 user-facing browser flows or changes to `app/` routes:

```bash
npm run test:e2e
```

Record failures as above with `Suite: npm run test:e2e`.

### 6e — Build

```bash
npm run build 2>/dev/null || npx next build 2>/dev/null || echo "NO_BUILD_SCRIPT"
```

If the build fails and it is not `NO_BUILD_SCRIPT`, record it as a BLOCKER.

---

## Step 7 — Document findings

Create a findings file:

```
docs/review-findings/YYYY-MM-DD-<branch-name>.md
```

(Use today's date from the environment. Branch name: `git branch --show-current`.)

### 7a — Structure

```markdown
# Review: <branch-name>
Date: YYYY-MM-DD
Reviewer: AI (review-pr skill) — session bias: CLEAN | GENERATOR BIAS (developer overrode)
PR: #<N> <url> | NONE

## Verdict
APPROVED | APPROVED WITH SUGGESTIONS | CHANGES REQUESTED

## Summary
<2–3 sentences: what the PR does, what the main risk areas are>

## Blockers (must fix before merge)
<!-- One entry per BLOCKER finding -->
### B1 — <short title>
- **Type:** QUALITY | COVERAGE | BUILD | TEST
- **File:** <path>
- **Finding:** <description>
- **Fix:** <specific remediation>

## Warnings (should address)
<!-- One entry per WARNING finding -->
### W1 — <short title>
- **Type:** QUALITY | COVERAGE
- **File:** <path>
- **Finding:** <description>
- **Suggestion:** <specific suggestion>

## Suggestions (optional improvements)
<!-- Lightweight items that don't block the merge -->

## Test plan verification
<!-- Reproduce the test plan from Step 3 with status for each item -->
| Item | Status | Notes |
|------|--------|-------|
| npm test passes | PASS / FAIL / NOT RUN | |
| ...  | | |

## Patterns observed
<!-- Reserved for Step 8 — leave blank here -->
```

### 7b — Verdict rules

| Condition | Verdict |
|-----------|---------|
| Zero BLOCKER findings, zero WARNING findings | APPROVED |
| Zero BLOCKER findings, ≥ 1 WARNING findings | APPROVED WITH SUGGESTIONS |
| ≥ 1 BLOCKER finding | CHANGES REQUESTED |

Print the verdict prominently after generating the file:

```
Review complete → docs/review-findings/YYYY-MM-DD-<branch-name>.md

Verdict: CHANGES REQUESTED | APPROVED WITH SUGGESTIONS | APPROVED

Blockers: <N>
Warnings: <N>
```

---

## Step 8 — Pattern recognition and self-update

Review all findings collected across Steps 4–6. Ask: **is this a pattern I have seen before, or a new class of problem?**

### 8a — Check known patterns

Read the `## Known Gap Patterns` section at the bottom of this SKILL.md. Each pattern has a name and a description. If a current finding matches a known pattern, note it in the findings doc under "Patterns observed" and skip to Step 9.

### 8b — Identify new patterns

A finding qualifies as a **new pattern** if:
- It represents a class of mistake (not a one-off), AND
- It is not already described in the known patterns list, AND
- It would be useful to watch for in future reviews of this codebase

Examples of pattern-worthy findings:
- A lint disable comment used to suppress a real type error
- A magic number duplicated from an existing constant
- An orphaned migration or schema file added without a corresponding loader
- A `process.env` read added without `.env.example` coverage
- A test file that only asserts `.toBeDefined()` without a behavioural assertion

### 8c — Add new patterns to this skill

For each new pattern, append an entry to the `## Known Gap Patterns` section of this file:

```markdown
### <Pattern name>
**Category:** QUALITY | COVERAGE | BUILD | CONVENTION
**Trigger:** <one sentence describing when to look for this>
**Check:** <specific grep or inspection step to detect it>
**Verdict:** BLOCKER | WARNING
**First seen:** <branch-name> — <YYYY-MM-DD>
```

Write the update with the Edit tool targeting this file (`SKILL.md`). The patterns section is append-only — never remove entries, only add them.

### 8d — Update CLAUDE.md if warranted

A new pattern warrants a CLAUDE.md update when it represents a **code convention** that all contributors (human and AI) should follow going forward — not just something to catch in review.

Criteria:
- The pattern involves a structural or architectural decision (e.g., "all env vars must appear in `.env.example`")
- It would prevent the same mistake from being generated in the first place
- It is not already captured in CLAUDE.md

If warranted, add a concise rule to the appropriate CLAUDE.md section. Common targets:
- **Common Constants** table — if a constant was duplicated
- A new "Code conventions" subsection under the relevant Phase or component section
- **Key Source Files** — if a new canonical file should always be the source of truth

Commit the CLAUDE.md update:

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude-md): add convention rule from review-pr pattern detection

Pattern: <pattern name>
Observed in: <branch-name>
EOF
)"
```

---

## Step 9 — Final report

Print a terse, scannable summary:

```
Review: <branch-name>
═══════════════════════════════════════════════════════════════

Verdict:      CHANGES REQUESTED | APPROVED WITH SUGGESTIONS | APPROVED
Blockers:     <N>  (must fix before merge)
Warnings:     <N>  (should address)

Rebase:       ✓ clean | ✓ resolved (<N> trivial, <N> human) | ✗ aborted
Generator bias: CLEAN | OVERRIDDEN by developer

Test suite:   npm test — PASS | FAIL
              npm run test:react — PASS | FAIL | SKIPPED
              npm run test:e2e — PASS | FAIL | SKIPPED
TypeScript:   CLEAN | <N> errors

Findings doc: docs/review-findings/YYYY-MM-DD-<branch-name>.md
New patterns: <N> added to SKILL.md | none
CLAUDE.md:    updated | unchanged
```

Then list each BLOCKER concisely (one line each) so the developer knows exactly what to fix:

```
Blockers to fix:
  B1 — <file>: <one-line description>
  B2 — <file>: <one-line description>
```

If there are no blockers, print:

```
No blockers — branch is ready to merge.
```

---

## Guardrails

- **Never** approve a PR with a BLOCKER finding — the verdict must be CHANGES REQUESTED.
- **Never** skip the generator bias check — it runs first, before touching any diff.
- **Never** resolve an ambiguous rebase conflict without asking the human.
- **Never** run `git push` — this skill reviews, it does not push.
- **Never** write a trivially passing test yourself to close a coverage gap — that would defeat the purpose; flag it as a BLOCKER.
- **Never** add a `docs/review-findings/` entry without filling in all sections.
- If `npm test` is failing for a pre-existing reason, note it clearly and ask the developer before treating it as a BLOCKER introduced by this branch.
- The self-update in Step 8 is an append — never delete or modify existing pattern entries; only add new ones.

---

## Known Gap Patterns

_This section is populated automatically by Step 8c as patterns are observed in real reviews. Do not edit manually._

<!-- Entries are appended here by the skill -->

### Integration test placed in scripts/ instead of tests/integration/
**Category:** CONVENTION
**Trigger:** A new test file in `scripts/` uses `os.tmpdir()`, `fs.mkdtempSync`, or any real filesystem read/write in its test body or setup.
**Check:** `grep -rn "mkdtemp\|os\.tmpdir\|fs\.mkdtempSync" scripts/**/*.test.ts` — any match means the test uses real I/O and must live in `tests/integration/` not next to the source file.
**Verdict:** BLOCKER
**First seen:** refactor/s1-project-file — 2026-05-09

### Runtime directory not added to .gitignore
**Category:** QUALITY
**Trigger:** A new module creates a directory under `process.cwd()` (or the project root) that is intended to hold generated/runtime files (artifacts, run logs, cache) rather than source code.
**Check:** For every directory path written by new code (grep `mkdirSync` or `mkdir` in the diff), verify the directory appears in `.gitignore`. Common offenders: `.ragtech/`, `runs/`, `cache/`, `artifacts/`.
**Verdict:** BLOCKER
**First seen:** refactor/s1-artifacts — 2026-05-09

### Lint-staged sweeping out-of-scope files into the commit
**Category:** QUALITY
**Trigger:** The diff contains changes to files not mentioned in the PR description or implementation doc — typically cosmetic comment moves or eslint-disable removals in unrelated source files.
**Check:** Compare `git diff --name-only origin/main...HEAD` against the file list in the PR description. Any file in the diff that is not in the PR's "Files changed" table is a scope violation. Common cause: lint-staged running `eslint --fix` on all staged files during the pre-commit hook, auto-modifying files the developer didn't intend to change.
**Verdict:** BLOCKER
**First seen:** fix/pre-existing-failing-test-suites — 2026-05-09

### Non-deterministic test setup using Math.random()
**Category:** COVERAGE
**Trigger:** A test file uses `Math.random()` (or `Date.now()`, `crypto.randomUUID()`, or any other non-seeded random source) inside a `test()` or `it()` block to construct input data for the function under test.
**Check:** `grep -n "Math\.random\|Date\.now\|crypto\.random" scripts/**/*.test.{js,ts} app/**/*.test.{ts,tsx} remotion/**/*.test.{ts,tsx}` — any match inside a test body (not a mock implementation) is a candidate. Then verify whether the assertions check specific output values; if assertions are only type-level (`typeof`, `toHaveProperty`, `toBeDefined`), flag as BLOCKER.
**Verdict:** BLOCKER
**First seen:** refactor/s1-audiosync-determinism — 2026-05-09
