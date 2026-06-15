---
name: pre-push-audit
description: Pre-push audit gate for agents. Checks branch is rebased on latest main, validates semantic commit conventions, audits test coverage for all changed files, identifies functionality requiring human manual testing, blocks the push until the developer confirms they have tested those flows, and generates a PR template if no PR exists yet.
argument-hint: [optional: remote and branch, default "origin main"]
allowed-tools: Bash, Read, Grep, Glob, TodoWrite, AskUserQuestion
---

You are a pre-push audit gate. An agent is about to push commits to remote. Your job is to validate that the push is safe: the branch is current, every commit message follows the project convention, all automatable tests exist and pass, and anything that requires human eyeballs has been verified by a human. Do not push anything yourself — you are a gate, not a pusher.

Run every step in order. Stop and report if a step fails. Do not skip steps.

---

## Step 0 — Scope

```bash
# What branch are we on?
git branch --show-current

# What commits will be pushed (not yet on origin)?
git fetch origin
git log --oneline origin/main..HEAD
```

Capture the branch name and the list of commits. If `git log origin/main..HEAD` is empty, there is nothing to push — report "Nothing to push" and stop.

Record the push target from `$ARGUMENTS`. Default to `origin main` if not given.

---

## Step 1 — Rebase check

Verify the branch is rebased on the latest `origin/main`. A non-rebased branch produces merge commits and can introduce conflicts downstream.

```bash
# Is origin/main an ancestor of HEAD?
git merge-base --is-ancestor origin/main HEAD && echo "REBASED" || echo "BEHIND"
```

**If output is `BEHIND`:**

```bash
# Attempt rebase
git rebase origin/main
```

If the rebase succeeds cleanly, continue. If it hits a conflict:
- Report the conflict details to the user
- Do NOT resolve conflicts automatically
- **BLOCK the push** with:
  ```
  ✗ PUSH BLOCKED — rebase conflict
  Resolve the conflict, then re-run /pre-push-audit.
  ```
  Then stop.

**If output is `REBASED`:** continue to Step 2.

---

## Step 2 — Semantic commit convention check

Every commit being pushed must follow the project's semantic commit format. Reviewers and the git log both depend on this — a malformed message makes the history unsearchable and breaks the inventory update convention in `implement-issue`.

### 2a — Collect all commit messages

```bash
# Full subject line (first line) for every commit not yet on origin/main
git log --format="%H|||%s" origin/main..HEAD
```

### 2b — Validate each subject line

Each subject line must match **all** of the following rules:

| Rule | Pattern / constraint |
|------|----------------------|
| **Type prefix** | Must start with one of: `feat`, `fix`, `test`, `refactor`, `chore`, `docs`, `perf` |
| **Scope** | Optional; if present must be `(<scope>)` — lowercase, alphanumeric, hyphens or slashes only |
| **Separator** | Immediately after the type/scope, a colon and a single space: `: ` |
| **Subject** | Imperative mood, no trailing period, ≤ 72 characters total (including type/scope) |
| **No merge commits** | `Merge branch ...` or `Merge pull request ...` are always violations |

Regex (for reference): `^(feat|fix|test|refactor|chore|docs|perf)(\([a-z0-9/_-]+\))?: .{1,60}[^.]$`

### 2c — Report violations

For each non-conforming commit, print:

```
✗ Bad commit message:
  SHA:     abc1234
  Message: "add stuff to the editor"
  Problem: missing type prefix — must start with feat|fix|test|refactor|chore|docs|perf

✗ Bad commit message:
  SHA:     def5678
  Message: "feat(Editor): Updated the timeline component."
  Problems:
    - scope must be lowercase ("Editor" → "editor")
    - trailing period not allowed
```

### 2d — Block or continue

**If there are violations:**

Print a remediation guide:

```
To fix a commit message, use git rebase to reword it:

  # For the most recent commit only:
  git commit --amend --no-edit -m "fix(editor): correct description here"

  # For older commits, identify the parent SHA of the earliest bad commit, then:
  GIT_SEQUENCE_EDITOR="sed -i 's/^pick <sha>/reword <sha>/'" git rebase -i <parent-sha>
  # Then edit the message in the editor that opens.

After rewording, re-run /pre-push-audit.
```

**BLOCK the push.** Do not proceed to Step 3 until all commit messages are valid.

**If all messages are valid:** print a summary and continue to Step 2.5.

```
✓ Commit messages: N commit(s) — all conform to semantic convention
```

---

## Step 2.5 — Pull issue context

Attempt to retrieve out-of-scope items, hard constraints, and additional test scenarios from the originating issue or PR. This context is used in Steps 4d and 4e.

Try these sources in order, stopping at the first that yields content:

```bash
# 1. Find a linked issue number from branch name or commit messages
git log --format="%s %b" origin/main..HEAD | grep -oE '#[0-9]+' | head -1
# If found: gh issue view <N> --json body --jq '.body'

# 2. If a PR already exists for this branch, pull its body
gh pr list --head "$(git branch --show-current)" --json body --state open --jq '.[0].body'
```

From whichever source is found, extract:
- **Out of scope** — items from the "Out of scope" section (things that must NOT be in the diff)
- **Hard constraints** — items from the "Hard constraints" section (non-negotiable requirements)
- **Additional test scenarios** — items from the "Additional test scenarios" section (used in Step 5a)

If no issue or PR body is found, or neither section exists in the body, print:

```
Issue context: not found — skipping scope and constraint checks (Steps 4d, 4e).
```

And continue to Step 3. Do not block.

---

## Step 3 — Identify changed files

```bash
# All files changed relative to origin/main
git diff --name-only origin/main...HEAD
```

Partition the changed files into these buckets. A file can appear in multiple buckets.

| Bucket | Pattern |
|--------|---------|
| **Scripts / pipeline logic** | `scripts/**/*.{ts,js}` (excluding `*.test.*`) |
| **Remotion lib (pure logic)** | `remotion/lib/**/*.{ts,tsx}` (excluding `*.test.*`) |
| **Remotion components (visual)** | `remotion/components/**/*.{ts,tsx}` |
| **Remotion composition** | `remotion/Composition.tsx` |
| **App components (UI)** | `app/**/*.{ts,tsx}` (excluding `*.test.*`, `api/`) |
| **App API routes** | `app/api/**/*.{ts,tsx}` |
| **Test files** | `**/*.test.{ts,tsx,js}`, `e2e/**/*.test.ts` |
| **Config / tooling** | `*.config.*`, `.husky/**`, `package.json`, `tsconfig*.json` |
| **Docs** | `docs/**`, `*.md` |
| **Assets / data** | `public/**`, `brands/**` |

Record the bucket membership for each file. You will use this in Steps 4 and 5.

---

## Step 4 — Test coverage audit

For each non-test source file in the changed set, determine whether an adequate test exists. Follow the rules from `docs/TESTING_STANDARDS.md` exactly.

### 4a — Locate existing test files

For each changed source file `path/to/foo.ts`, check whether any of these test files exist:

```bash
# Unit test next to the file
ls path/to/foo.test.ts 2>/dev/null || echo "MISSING"
ls path/to/foo.test.tsx 2>/dev/null || echo "MISSING"

# For scripts/ files, also check __tests__/ sibling
ls path/to/__tests__/foo.test.js 2>/dev/null || echo "MISSING"

# For app/ components, check the same directory
ls path/to/foo.test.tsx 2>/dev/null || echo "MISSING"
```

For integration-worthy modules (files that do real I/O, spawn processes, or require >2 mocked deps), also check:

```bash
ls tests/integration/ 2>/dev/null
```

### 4b — Classify each gap

For every source file with a missing test, classify it using this decision table:

| Condition | Required test type | Location |
|-----------|--------------------|----------|
| File exports pure functions (no I/O, no side effects) | Unit test | Next to the file |
| File does real filesystem I/O or spawns processes | Integration test | `tests/integration/` |
| File is a React component | Smoke render test | Next to the file (react project) |
| File is an app API route | Unit or integration test | Next to or in `tests/integration/` |
| File is a Remotion component | Smoke render test (mock Remotion hooks) | Next to the file (react project) |
| File is a pure Remotion lib function | Unit test | Next to the file |
| File is config / tooling / docs / assets only | No test required | — |

Produce a gap table:

```
Test coverage gaps:
┌─────────────────────────────────────────────┬──────────────────┬───────────────────────────────────────┐
│ File                                        │ Missing test type│ Where to add it                       │
├─────────────────────────────────────────────┼──────────────────┼───────────────────────────────────────┤
│ scripts/config/project.ts                   │ Unit             │ scripts/config/project.test.ts        │
│ app/components/EpisodePill.tsx              │ Smoke render     │ app/components/EpisodePill.test.tsx   │
└─────────────────────────────────────────────┴──────────────────┴───────────────────────────────────────┘
```

If there are **no gaps**, print "All changed source files have corresponding tests." and continue to Step 4b-2.

If there are gaps, **BLOCK the push**:

```
✗ PUSH BLOCKED — test coverage gaps
The following source files have no corresponding test:

<gap table>

Go back and add tests per docs/TESTING_STANDARDS.md (implement-issue Step 5a) before pushing.
Re-run /pre-push-audit after adding the tests.
```

Stop. Do not proceed until the gaps are resolved.

### 4b-2 — Scope verification (lint-staged side effects)

After test gaps are resolved, verify that no files outside the PR's intended scope were silently added to the diff by lint-staged auto-fixes during pre-commit hooks.

```bash
git diff --name-only origin/main...HEAD
```

Compare this list against the file scope described in the PR body (from Step 0). Any file in the diff that is not mentioned in the PR's scope is a candidate for an unintended lint-staged modification. For each unexpected file:

1. Confirm whether the change is cosmetic (whitespace, comment, trailing comma) — if yes, it was likely auto-fixed by lint-staged during a prior commit.
2. If cosmetic and out-of-scope, record:

```
[QUALITY] Out-of-scope file in diff (lint-staged side effect)
  File:    <path>
  Change:  <describe the cosmetic change>
  Verdict: WARNING — squash or drop this change; it obscures the PR's actual diff.
```

### 4c — Run the full test suite

```bash
npm test
```

If tests fail:
- Fix the failure
- Add a fix commit
- Re-run until clean

If the changed files include React components or app routes, also run:

```bash
npm run test:react
```

If the changes touch any Phase 8 user-facing browser flows, also run:

```bash
npm run test:e2e
```

**BLOCK the push if any test runner exits non-zero.** Report which suite failed and why.

### 4d — Out-of-scope adherence check

If out-of-scope items were extracted in Step 2.5, verify the diff does not implement any of them.

```bash
git diff origin/main...HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx'
```

For each out-of-scope item, scan the diff for:
- New functions, routes, or components whose names match the scoped-out feature
- New data fields or schema additions that belong to the excluded scope
- New imports into systems the issue explicitly excluded

For each violation, **BLOCK the push**:

```
✗ PUSH BLOCKED — out-of-scope feature implemented
  Item:  <out-of-scope text from issue>
  Found: <file>:<line> — <description>
  Fix:   revert this change or move it to a separate branch before pushing.
```

If no out-of-scope items were found in Step 2.5, print "Out of scope: not specified — skipping." and continue.

### 4e — Hard constraint satisfaction check

If hard constraints were extracted in Step 2.5, verify each one against the implementation. Use the check approach that fits the constraint type:

| Constraint type | Check approach |
|-----------------|----------------|
| Security property (e.g. "must be server-side") | Search diff for client-side implementation patterns |
| Performance ceiling (e.g. "must not block main thread") | Look for synchronous I/O or blocking calls |
| API compatibility (e.g. "must not change public API") | Check exported signatures in the diff |
| Env var naming (e.g. "must use prefix RAGTECH_") | `grep -n "process\.env\." <changed-files>` |
| Idempotency | Look for state mutations not guarded by existence checks |

For each violated constraint, **BLOCK the push**:

```
✗ PUSH BLOCKED — hard constraint violated
  Constraint: <constraint text>
  Violation:  <file>:<line> — <description>
  Fix:        <specific remediation>
```

If no hard constraints were found in Step 2.5, print "Hard constraints: not specified — skipping." and continue.

---

## Step 5 — Human testing gate

Some changes cannot be validated by automated tests and require human eyes. Identify all such changes from the buckets in Step 3.

### 5a — Classify manual testing requirements

Build a checklist of manual checks required. Use this table:

| Bucket | Always requires human testing? | Specific manual check |
|--------|--------------------------------|-----------------------|
| Remotion components (visual) | **Yes** | Run `remotion studio`, scrub through affected frames, verify visual output matches intent |
| Remotion composition | **Yes** | Verify composition duration, hook timing, section boundaries in studio |
| App components (UI) | **Yes** — unless purely logic changes | `npm run dev`, navigate to the affected route, exercise the interaction |
| App API routes | No (automated tests sufficient) | — |
| Scripts / pipeline logic | Only if it changes output format or video timing | Run the affected pipeline stage on real data and inspect output |
| Short-form pipeline | **Yes** | Run `npm run shorts:wizard`, verify clip output |
| Brand / assets | **Yes** | Visual inspection in Remotion studio and/or browser |
| Camera profiles | **Yes** | Verify face boxes and angle switching in camera GUI (`/camera`) |
| Config / tooling / docs | No | — |

### 5b — Produce the manual testing checklist

Format:

```
Manual testing required before push:

□ [REMOTION-VISUAL] Open Remotion Studio (`npx remotion studio`) and scrub through
  frames 0–600 on ragTechVodcast. Verify hook section renders correctly.
  Affected: remotion/components/HookOverlay.tsx

□ [UI-BROWSER] Start dev server (`npm run dev`), open /editor, make a cut, save.
  Verify the cut is reflected in the transcript panel without a page reload.
  Affected: app/editor/page.tsx, app/editor/Timeline.tsx

□ [PIPELINE] Run `node scripts/wizard.js` and select the edit-transcript step.
  Inspect the output transcript.doc.txt — verify sentence merging is unchanged.
  Affected: scripts/edit-transcript.js
```

If additional test scenarios were extracted in Step 2.5, check whether each one is covered by a test in the diff or existing suite:

```bash
grep -rn "<keyword from scenario>" --include="*.test.ts" --include="*.test.tsx" \
  tests/ scripts/ app/ remotion/
```

For each additional test scenario with **no corresponding automated test**, add it to the checklist:

```
□ [MANUAL-SCENARIO] <additional test scenario text>
  No automated test exists for this scenario — verify manually before pushing.
  Source: issue "Additional test scenarios"
```

Save this checklist — it feeds directly into the PR template in Step 8.

If **no manual testing is required** (only config, docs, assets, or API routes changed, and no uncovered additional test scenarios), print "No manual testing required." and skip to Step 6.

### 5c — Block and wait for human confirmation

**Stop here.** Do NOT push yet.

Present the checklist to the developer and ask for confirmation using the `AskUserQuestion` tool:

```
Pre-push audit: manual testing required

The following changes need human verification before the push proceeds:

[paste the manual testing checklist from 5b]

Have you completed all of the above checks? Reply YES to proceed with the push, or NO to abort.
```

**If the developer replies NO or anything other than YES (case-insensitive):**

```
✗ PUSH BLOCKED — manual testing not confirmed.
Complete the checks above, then re-run /pre-push-audit.
```

Stop. Do not push.

**If the developer replies YES:** continue to Step 6.

---

## Step 6 — Final scan

Run the pre-push hook checks that are cheap to re-verify:

```bash
# No debugger statements
grep -rn 'debugger' \
  --include='*.ts' --include='*.tsx' --include='*.js' \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=coverage \
  --exclude-dir=e2e \
  . && echo "FOUND" || echo "CLEAN"

# No .only() in test files
grep -rn '\.\bonly\b\s*(' \
  --include='*.test.ts' --include='*.test.tsx' --include='*.test.js' \
  --exclude-dir=node_modules \
  . && echo "FOUND" || echo "CLEAN"

# No large files in public/ staged for push
git diff --name-only origin/main...HEAD | grep '^public/' | while read f; do
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
  [ "$size" -gt 52428800 ] && echo "LARGE: $f ($size bytes)"
done
```

If any of these fail, **block the push** with the specific reason.

---

## Step 7 — Clearance report

All checks have passed. Print the clearance report:

```
✓ PRE-PUSH AUDIT PASSED

Branch:       <branch-name>
Rebased on:   origin/main @ <short-sha>
Commits:      <N> commit(s) — all messages conform to semantic convention
Tests:        All suites green (npm test, npm run test:react if applicable)
Coverage:     <N> test files added or already present
Manual QA:    Confirmed by developer (or: not required)
```

Then output the exact push command for the agent to run. Do not run it yourself.

```
Cleared to push: git push <remote> <branch>
```

Continue to Step 8 before the agent runs that command.

---

## Step 8 — PR template

Check whether a pull request already exists for this branch:

```bash
gh pr list --head "$(git branch --show-current)" --json number,title,url --state open
```

**If an open PR exists:** print the PR URL and skip the rest of Step 8.

```
PR already open: <url> — no template needed.
```

**If no PR exists:** generate a PR template the agent or developer can use to open one. The template must be specific to the actual changes — do not use placeholder language.

Construct the template as follows:

### 8a — Summary section

Use the commit messages from Step 2 to derive 2–4 bullet points summarising what changed and why. Each bullet should explain the *effect*, not just restate the commit message.

Example:
```
## Summary
- Consolidated `hookClipEnd()` into a single `remotion/lib/hookTiming.ts` — previously four separate
  implementations could disagree by 1–3 frames, causing hook sections to cut early in some renders.
- Added unit tests covering the bounded and unbounded hook timing paths.
```

### 8b — How to review section

List the key files changed (from Step 3 buckets) and what a reviewer should focus on in each:

```
## How to review
- `remotion/lib/hookTiming.ts` — new canonical implementation; verify the bounded/unbounded
  logic matches the intent in CLAUDE.md and that constants match the table there.
- `remotion/components/SegmentPlayer.tsx` — now imports from hookTiming.ts; diff should show
  only the import change and deletion of the old inline function.
- `remotion/lib/hookTiming.test.ts` — confirm tests cover the edge cases noted in CLAUDE.md.
```

### 8c — Test plan section

Combine the automated test results and the manual testing checklist from Step 5b:

```
## Test plan
- [ ] `npm test` passes (all Jest suites)
- [ ] `npm run test:react` passes (if React components changed)
- [ ] `npm run test:e2e` passes (if UI flows changed)

Manual verification required:
- [ ] [REMOTION-VISUAL] Open Remotion Studio and scrub through frames 0–600 on ragTechVodcast.
      Hook section must not cut early compared to the baseline in docs/render-baselines/.
- [ ] [UI-BROWSER] Navigate to /editor, make a cut, confirm timeline updates correctly.
```

If no manual testing was required (from Step 5), omit the "Manual verification required" subsection.

### 8d — Output the complete template

Print the full PR body so the agent or developer can copy it:

```
------- PR TEMPLATE (copy below this line) -------

## Summary
<derived bullets from 8a>

## How to review
<file-by-file notes from 8b>

## Test plan
<checklist from 8c>

------- (end of template) -------
```

Then ask the developer whether to open the PR now using the `AskUserQuestion` tool:

```
A PR template has been generated above.

Would you like me to open the PR now using `gh pr create`?
Reply YES to open it, or NO to copy the template manually.
```

**If YES:** run:

```bash
gh pr create \
  --title "<type>(<scope>): <subject from the first or most significant commit>" \
  --body "$(cat <<'EOF'
<paste the template body here>
EOF
)"
```

Print the returned PR URL.

**If NO:** print "Template ready — open the PR manually when ready." and stop.

---

## Guardrails

- **Never** run `git push` yourself. Your job is clearance, not execution.
- **Never** skip or suppress the pre-push hook (`--no-verify`). The hook is additive to this audit, not a replacement.
- **Never** mark the audit complete without the developer's YES if there are manual testing items.
- **Never** write tests that always pass regardless of implementation (e.g., `expect(true).toBe(true)`).
- **Never** open a PR without asking the developer first (Step 8d).
- If `npm test` is failing for a pre-existing reason unrelated to the current branch, note it clearly and ask the developer whether to unblock. Do not silently ignore failures.
- If a test file already exists but is empty or trivially passing, flag it as a gap — it counts as missing.
- When generating the PR template, make it specific to the actual diff — never use boilerplate placeholders that a reviewer would have to fill in.
