---
name: implement-issue
description: Implements a code change from an issue prompt. Checks inventory relevance, ensures correct branch, derives acceptance criteria, writes tests per project standards, commits atomically with semantic messages, updates CLAUDE.md/README.md/inventory on completion, and only marks done when all tests pass.
argument-hint: [issue text or path to issue file]
allowed-tools: Read, Edit, Write, Bash, Glob, Grep, TodoWrite
---

You are implementing a code change described in an issue or prompt. Follow every step in order. Do not skip steps or combine commits.

## Arguments

`$ARGUMENTS` contains either:
- Raw issue text (title, description, acceptance criteria)
- A file path to an issue/doc (read it with Read)
- A plain description of the change to make

If no arguments are given, ask the user what they want to implement before proceeding.

---

## Step 0 — Parse the issue

Extract the following from `$ARGUMENTS`:

| Field | Where to find it | Fallback |
|-------|-----------------|----------|
| **Title** | First heading or first sentence | Ask the user |
| **Branch name** | Explicit branch field in issue, or derive from title | See naming rules below |
| **Description** | Body of the issue | The full prompt |
| **Acceptance criteria** | "Acceptance Criteria" / "AC" / "Definition of Done" section | Derive them yourself (Step 2) |
| **Affected files / scope** | "Files", "Scope", or "Touches" section | Identify from description |
| **Test requirements** | "Testing" section | Follow project defaults |

**Branch naming rules** (in priority order):
1. Use the branch name explicitly stated in the issue (e.g. `refactor/p0-project-file`)
2. Derive from the issue title: lowercase, hyphens, prefixed with type:
   - New feature → `feat/<slug>`
   - Bug fix → `fix/<slug>`
   - Refactor → `refactor/<slug>`
   - Infrastructure / tooling → `chore/<slug>`
   - Docs only → `docs/<slug>`
   - Keep slug under 40 characters; drop articles and filler words

---

## Step 0.5 — Inventory relevance check

Read `docs/REFACTOR_ISSUE_INVENTORY.md` and check whether the issue title or description matches any item in that file.

**If NOT found in the inventory:** skip this step entirely and continue to Step 1.

**If found in the inventory**, do the following before writing any code:

### 0.5a — Locate the issue

Find the matching issue by number and title. Note its sprint and position.

### 0.5b — Check for superseding or blocking issues

Read the issues immediately around it (same sprint and adjacent sprints). Ask:

1. **Is this issue already superseded?** — does a later issue in the same sprint or a subsequent sprint render this one obsolete or absorbed into a larger change?
2. **Is this issue blocked?** — does it depend on another issue that has not yet been implemented? (Look for dependency language: "consumes", "reads from", "requires", "after X is done".)
3. **Does this issue conflict with an already-completed issue?** — would implementing it undo or contradict work already merged?

To check what has already been done, run:
```bash
git log --oneline --all | head -40
```
Also grep the inventory for any `✅` markers from previous runs of this skill.

### 0.5c — Relevance decision

Based on 0.5b, make one of three calls:

| Verdict | Condition | Action |
|---------|-----------|--------|
| **Relevant — proceed** | No superseding, no conflicts, dependencies met | Continue to Step 1 |
| **Blocked — pause** | A dependency issue is not yet implemented | Report which dependency is missing; ask the developer whether to implement the dependency first or proceed anyway |
| **Stale — flag and stop** | The issue is superseded, absorbed, or would conflict with existing work | Report the exact reason with references to which commits or issues made it stale; do NOT implement; ask the developer to remove or update the inventory entry |

If the verdict is **Stale**, output a clear flag:

```
⚠️  STALE ISSUE DETECTED
Issue: #<N> — <title>
Reason: <one sentence>
Evidence: <commit hash or inventory issue # that supersedes it>
Recommendation: remove or update this entry in docs/REFACTOR_ISSUE_INVENTORY.md
```

Then stop. Do not proceed to Step 1 without developer confirmation.

---

## Step 1 — Branch setup

Run these checks in order. Stop and report if anything is unexpected.

```bash
# 1a. What branch am I on?
git branch --show-current

# 1b. What is the default branch? (usually main)
git remote show origin | grep 'HEAD branch'
```

**If currently on main (or the default branch):**
```bash
git pull origin main
git checkout -b <branch-name>
```

**If currently on an existing feature branch that matches the target branch name:**
- Verify it is branched from a recent commit of main:
```bash
git merge-base --is-ancestor $(git rev-parse origin/main) HEAD || echo "BEHIND MAIN"
```
- If behind, rebase: `git fetch origin && git rebase origin/main`

**If currently on an unrelated branch:**
- Do NOT check out main and trash the unrelated work.
- Report to the user: "Currently on branch X which does not match the target branch Y. Please confirm you want to switch."
- Wait for confirmation before proceeding.

**Verify the final state before continuing:**
```bash
git status && git log --oneline -5
```

---

## Step 2 — Acceptance criteria

If the issue already has explicit acceptance criteria, list them verbatim.

If acceptance criteria are missing or vague, **derive them yourself** from the description. Write them as a numbered checklist of verifiable, binary outcomes. Each criterion must be falsifiable — "the code works" is not acceptable; "running X produces output Y" is.

Example format:
```
Acceptance Criteria (derived):
1. `scripts/config/project.ts` exports a `readProject()` function that returns typed `ProjectConfig`.
2. `readProject()` throws a typed `ProjectNotFoundError` when `.ragtech/project.json` is absent.
3. `npm test` passes with ≥ 1 unit test per exported function.
4. `tsc --noEmit` passes with no errors.
```

Write the acceptance criteria to a TodoWrite task list so you can track them as you go.

---

## Step 3 — Implementation plan

Before writing any code, plan the atomic commits you will make. Each commit should:
- Change one logical unit (one module, one type, one feature boundary)
- Leave the repo in a passing-tests state
- Have a semantic commit message (see Step 6 for format)

Output the commit plan as a numbered list. Example:
```
Commit plan:
1. feat(config): add ProjectConfig type and schema
2. feat(config): implement readProject() with error handling
3. test(config): unit tests for readProject()
4. chore(config): wire project.ts into existing entry points
```

Use TodoWrite to track each commit as a task.

---

## Step 4 — Read testing standards

Before writing a single test, re-read the relevant sections of `docs/TESTING_STANDARDS.md`. Key decisions:

| Question | Answer from standards |
|----------|-----------------------|
| Is the new function pure (no I/O)? | Unit test in same directory, `.test.ts` suffix |
| Does it touch the filesystem or spawn processes? | Integration test in `tests/integration/` |
| Does it require a real browser? | E2E test in `e2e/` (only for Phase 8 UI features) |
| Does it involve React? | Jest `react` project, `.test.tsx`, use `@testing-library/react` |
| Does it use Remotion hooks? | Mock `remotion` module per-test |
| Does it need >2 mocked dependencies? | Integration test, not unit test |

Identify which test types are needed for this issue and note them.

---

## Step 5 — Implement each commit

For each commit in your plan:

### 5a. Write the test(s) first (or alongside the implementation)

- Follow the exact file locations from `docs/TESTING_STANDARDS.md`
- Use the patterns from the standards doc (dependency injection, pure function tests, render-and-assert, page object model)
- Every new pure function: at least one happy-path test + one edge-case test
- Every new React component: at least one smoke render test
- Run only the related tests to confirm they fail correctly before implementing:
```bash
npx jest --testPathPattern="<test-file>" --no-coverage
```

### 5b. Write the implementation

- Stay within the scope of this commit — do not touch unrelated files
- No hardcoded paths; use shared path helpers from `scripts/config/paths.ts` if they exist
- No new duplicated timing constants in `remotion/` — use the constants table in CLAUDE.md
- Follow existing code style in the file being edited

### 5c. Run the tests

```bash
# Run related tests
npx jest --testPathPattern="<test-file>" --no-coverage

# If React component:
npm run test:react -- --testPathPattern="<test-file>"

# If integration:
npm run test:integration -- --testPathPattern="<test-file>"
```

Fix any failures before proceeding to commit. Do not commit with a known failing test.

### 5d. Type-check (if TypeScript files changed)

```bash
npx tsc --noEmit
```

Fix all type errors before committing.

### 5e. Commit

```bash
git add <specific-files>   # never git add -A
git commit -m "$(cat <<'EOF'
<type>(<scope>): <short imperative summary under 72 chars>

<Blank line>
<Body: 2–5 lines explaining WHY this change exists, what problem it solves,
and any non-obvious decisions. Any future agent reading git log should
understand the intent without opening the files.>

<Optional: list the acceptance criteria this commit satisfies>
AC: #1, #2
EOF
)"
```

**Commit type prefixes:**

| Prefix | Use when |
|--------|----------|
| `feat` | New production functionality |
| `fix` | Bug correction |
| `test` | Adding or fixing tests only |
| `refactor` | Code restructured, no behaviour change |
| `chore` | Build, tooling, dependencies, config |
| `docs` | Documentation only |
| `perf` | Performance improvement |

**Scope** = the module or directory being changed (e.g. `config`, `camera`, `segmentPlayer`, `dag`, `editor`).

Repeat Step 5 for every commit in your plan.

---

## Step 6 — Full test suite

After all commits are made, run the complete test suite:

```bash
npm test
```

If any test fails:
- Fix the failure
- Add a new commit (`fix(<scope>): <what broke and why>`)
- Re-run until clean

If the issue touched React components or app routes, also run:
```bash
npm run test:react
```

If the issue is Phase 8 or involves user-facing browser flows, also run:
```bash
npm run test:e2e
```

Do not mark the work complete until `npm test` exits with code 0.

---

## Step 7 — Acceptance criteria verification

Go through each acceptance criterion from Step 2. For each one, run the exact command or check the exact condition that proves it is met. Record the result:

```
AC #1 — PASS: readProject() exported; tsc --noEmit clean
AC #2 — PASS: throws ProjectNotFoundError when file missing (verified by test)
AC #3 — PASS: npm test passes, 3 unit tests written
AC #4 — PASS: tsc --noEmit passes
```

If any criterion is not met, implement what is missing and add a commit before reporting done.

---

## Step 8 — Update living documentation

Once all acceptance criteria pass, update the three living docs to reflect the completed work. Each update is its own commit if it touches real content; skip a doc if there is genuinely nothing new to record.

### 8a — Mark the issue complete in the inventory

Open `docs/REFACTOR_ISSUE_INVENTORY.md`. Find the matching issue heading. Append a `✅ Done` badge and a one-line note on the branch/PR, directly under the heading:

```markdown
### 1. Create project file configuration layer
✅ Done — `refactor/p0-project-file` — readProject/writeProject helpers, ProjectConfig type
```

Do not change the issue text or numbering. If a dependent issue is now unblocked, add a `> Unblocks: #N` note on the same line.

Commit:
```
docs(inventory): mark issue #<N> complete
```

### 8b — Update CLAUDE.md

Read `CLAUDE.md` and identify which sections are affected by the work just done. Update only what changed — do not rewrite sections that are still accurate. Common updates:

| What changed | Where in CLAUDE.md |
|---|---|
| New file created | Add a row to **Key Source Files** table |
| New constant introduced | Add a row to **Common Constants** table |
| Phase branch now active / done | Update the **Phase map** row |
| New script command added | Update the relevant pipeline section |
| Known bug fixed | Remove or update the **Known correctness bugs** list item |
| New target directory created | Update **Target directory additions** tree |

Do not add information that duplicates what the code already makes obvious. Only record non-obvious facts that a future agent or developer would not discover by reading the files.

Commit:
```
docs(claude-md): reflect changes from issue #<N>
```

### 8c — Update README.md

Read `README.md`. If the completed work adds or changes any user-facing behaviour, update the relevant section. Common updates:

| What changed | Where in README.md |
|---|---|
| New `npm run` command | Add a row to the relevant command table |
| Changed prerequisite | Update **Prerequisites** |
| New wizard mode or step | Update the **Wizard modes** table or the numbered walkthrough |
| New output file or directory | Update the relevant step description |
| Removed or renamed command | Delete/update the old entry |

Do not add developer-internal details to README.md — it is user-facing. If nothing user-facing changed, skip this commit entirely.

Commit:
```
docs(readme): reflect changes from issue #<N>
```

### 8d — Update env example files

If the implementation introduces, renames, or removes any environment variable, update every `.env.example` / `.env.sample` / `.env.template` file in the repo to match. Run:

```bash
find . -name ".env.example" -o -name ".env.sample" -o -name ".env.template" | grep -v node_modules
```

For each file found:
- Add any new variable with a blank or placeholder value and a one-line comment explaining what it is
- Remove or rename any variable that no longer exists
- Never write a real secret or credential into an example file

If no environment variables changed, skip this step entirely.

Commit:
```
chore(env): update example env for issue #<N>
```

---

## Step 9 — Report

Summarise the work:

1. **Branch:** the branch name
2. **Commits:** list each commit hash + message (from `git log --oneline`)
3. **Tests added:** count and type (unit / integration / e2e)
4. **Acceptance criteria:** all passed / any outstanding
5. **Docs updated:** which of inventory / CLAUDE.md / README.md were changed and why; which were skipped and why
6. **Next step:** what the human needs to do (e.g. "review and push", "run Remotion studio to verify frames")

Keep it under 20 lines. Do not repeat code that is already visible in the diff.

---

## Guardrails

- **Never** commit to `main` or the default branch directly.
- **Never** use `git add -A` or `git add .` — always name specific files.
- **Never** use `--no-verify` to skip hooks.
- **Never** mark a task done if `npm test` is failing.
- **Never** combine two logical changes into one commit; isolation enables partial recovery.
- **Never** write a commit message that describes WHAT the code does instead of WHY it exists.
- If a pre-commit hook fails, fix the underlying issue and create a new commit — do NOT amend.

### .gitignore

If the implementation creates new output directories, build artefacts, temp files, secrets, or generated files that should not be tracked, update `.gitignore` in the same commit that introduces the pattern. Do not leave untracked noise for the developer to clean up.

### npm vulnerabilities

The pre-push hook runs `npm audit --audit-level=moderate` and blocks the push if any installed package has a moderate, high, or critical vulnerability. If a dependency you introduced or updated triggers this:

1. Run `npm audit fix` — applies safe, semver-compatible fixes automatically
2. If `npm audit fix` cannot resolve it (breaking-change required), pin to the last safe version or find an alternative package
3. Never use `--no-verify` to bypass this check — a known-vulnerable dependency in remote is worse than a blocked push

Low-severity advisories are informational only and do not block the push.

### Large files in `public/`

Video editing produces large binary files under `public/` (raw video, synced output, transcription models, audio, rendered MP4s). These **may** be committed to a local feature branch as work-in-progress checkpoints — that is intentional and supported. They must **never** be pushed to the remote.

The pre-push hook enforces this. Do not bypass it (`--no-verify`). If a push is blocked because `public/` contains large files, that is correct behaviour — remove those files from the commit or move them to a `.gitignore`d path before pushing code changes.
