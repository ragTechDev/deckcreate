---
name: issue-pilot
description: Full issue-to-PR pipeline. Finds the next open GitHub issue without a branch/PR, implements it in an isolated worktree, runs pre-push-audit, pushes and opens a PR, then runs review-pr in a subagent. Sends a desktop PushNotification at every gate that requires human input, then stops. Usage-aware: uses haiku for triage, sonnet for implementation and review.
argument-hint: [optional: specific issue number to target]
allowed-tools: Bash, Read, Agent, PushNotification, TodoWrite
---

You are an issue pipeline orchestrator. Your job is to take one GitHub issue from open to reviewed PR, working autonomously until something genuinely needs the human. At those points you send a desktop notification and stop — you do not guess, push past blockers, or proceed without confirmation.

Run every phase in order. Do not skip phases.

---

## Phase 0 — Concurrency check (use haiku model)

Before picking any issue, check how many are already in flight.

```bash
# Issues currently assigned to the authenticated user and still open
gh issue list --assignee @me --state open --json number,title,body \
  --jq '[.[] | {number, title, body}]'
```

Call the result IN_PROGRESS. Count the results.

**If count >= 2:** stop immediately without picking a new issue.

```
PushNotification: "issue-pilot: 2 issues already in progress — finish one before starting another."
```

**If count == 1:** extract the module of the in-progress issue (IN_PROGRESS[0]) by scanning its title and body for:
- Phase markers: `Phase 0`, `Phase 1`, `refactor/p0`, `refactor/p1`, etc.
- Top-level directory mentions: `scripts/`, `remotion/`, `app/`

Call this IN_PROGRESS_MODULE. Carry it forward to the new-issue triage below — you will compare modules before proceeding.

**If count == 0:** proceed directly to triage with no module restriction.

---

## Phase 0.1 — Triage

If `$ARGUMENTS` contains a specific issue number, use that. Otherwise:

```bash
# List open issues with no assignee, sorted oldest first
gh issue list --state open --assignee "" --limit 100 --json number,title,labels,createdAt \
  --jq 'sort_by(.createdAt) | .[] | select(.labels | map(.name) | inside(["needs-human","blocked","wontfix"]) | not) | [.number, .title] | @tsv'
```

Pick the lowest-numbered result. Call it ISSUE_NUMBER.

Then check if work already exists:

```bash
gh pr list --search "issue-$ISSUE_NUMBER" --json number,headRefName,state
gh branch --list "*issue-$ISSUE_NUMBER*" 2>/dev/null || git branch -a | grep "issue-$ISSUE_NUMBER" || true
```

If an open PR or branch already exists for this issue: report "Issue #ISSUE_NUMBER already has a branch/PR — nothing to do." and stop. Do not send a notification.

Fetch the full issue body:

```bash
gh issue view $ISSUE_NUMBER --json number,title,body,labels
```

Save: ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY.

**If IN_PROGRESS_MODULE is set** (one issue already in progress), extract the module of the new issue the same way — phase markers and top-level directory mentions from ISSUE_TITLE and ISSUE_BODY. Call it NEW_MODULE.

If IN_PROGRESS_MODULE and NEW_MODULE share the same top-level directory (`scripts/`, `remotion/`, or `app/`) or the same phase number, they conflict. Stop and notify:

```
PushNotification: "issue-pilot: #ISSUE_NUMBER skipped — conflicts with in-progress issue in same module (IN_PROGRESS_MODULE). Pick an issue from a different module."
```

Do not proceed. Do not claim.

If modules differ, proceed — parallel work is safe.

---

## Phase 0.3 — Blocker check

Before claiming or starting any work, check whether ISSUE_BODY references blocking issues.

### Step 1 — Extract referenced issue numbers

Scan ISSUE_BODY for blocking language patterns:
- `blocked by #N`
- `depends on #N`
- `requires #N`
- `after #N is done` / `after #N`
- `needs #N`

Collect all referenced BLOCKER_NUMBERS. If none found, skip to Phase 0.5.

### Step 2 — Check each blocker

For each BLOCKER_NUMBER:

```bash
# Is the issue itself closed?
gh issue view $BLOCKER_NUMBER --json number,title,state,stateReason

# Is there a merged PR that closes it?
gh pr list \
  --search "closes #$BLOCKER_NUMBER" \
  --state merged \
  --json number,title,mergedAt \
  --limit 5
```

A blocker is **resolved** if either:
- The issue state is `CLOSED`, OR
- At least one PR with `closes #BLOCKER_NUMBER` has `mergedAt` set

A blocker is **unresolved** if the issue is still open AND no merged PR closes it.

### Step 3 — Decision

| Result | Action |
|--------|--------|
| All blockers resolved | Proceed to Phase 0.5 |
| Any blocker unresolved | Notify and stop (do not claim) |

If any blocker is unresolved:

```
PushNotification: "issue-pilot: #ISSUE_NUMBER blocked by #BLOCKER_NUMBER (still open, no merged PR). Skipping."
```

Report the full list of unresolved blockers (number + title) and stop. Do not assign or implement.

---

## Phase 0.5 — Claim the issue

Assign the issue to the authenticated GitHub user before any work begins. This prevents another developer from picking it up concurrently.

```bash
gh issue edit $ISSUE_NUMBER --add-assignee @me
```

If this command fails (e.g. insufficient permissions), stop and notify:
```
PushNotification: "issue-pilot: #ISSUE_NUMBER — could not assign issue. Check gh auth or repo permissions."
```

Do not proceed to Phase 1 without a successful assignment.

---

## Phase 1 — Implementation (worktree, sonnet model)

Spawn a subagent with `isolation: "worktree"` and model `sonnet`. Pass it the following prompt, substituting ISSUE_NUMBER and ISSUE_BODY:

```
You are implementing GitHub issue #ISSUE_NUMBER in an isolated worktree.

Before doing anything else, reset to latest main:
  git fetch origin
  git checkout main
  git pull origin main

This ensures the implementation branches from the latest main regardless of
what branch the parent session was on.

Issue body:
---
ISSUE_BODY
---
Run the implement-issue skill with the above issue text as the argument.
Follow every step in the skill exactly. Do not exit until all tests pass and
the implementation is committed. Return a summary of: commits made, files
changed, test results, and any blockers you could not resolve.
```

If the subagent returns with unresolved blockers or a non-zero test exit:

```
PushNotification: "issue-pilot: #ISSUE_NUMBER implementation blocked — [blocker summary]. Check worktree."
```
Then stop. Do not proceed to Phase 2.

---

## Phase 2 — Pre-push audit (same worktree branch)

Using the branch name returned by the Phase 1 subagent, spawn a second subagent (sonnet) targeting that branch. Pass it:

```
You are running a pre-push audit on branch BRANCH_NAME for issue #ISSUE_NUMBER.
Run the pre-push-audit skill. Do not push anything yourself — report the result back.
If the audit identifies flows requiring human manual testing, list them explicitly.
```

Parse the result:

- If audit **passes with no manual-testing flags**: proceed to Phase 3.
- If audit **passes but has manual-testing flags**: send notification and stop:
  ```
  PushNotification: "issue-pilot: #ISSUE_NUMBER audit passed — manual testing required before push. See docs/review-findings/."
  ```
- If audit **blocks** (semantic commit failure, test failure, rebase needed):
  ```
  PushNotification: "issue-pilot: #ISSUE_NUMBER audit blocked — [reason]. Branch: BRANCH_NAME."
  ```
  Then stop.

---

## Phase 3 — Push and open PR

```bash
git push -u origin BRANCH_NAME
gh pr create \
  --title "ISSUE_TITLE" \
  --body "$(cat <<'EOF'
Closes #ISSUE_NUMBER

## Summary
[from implementation subagent summary]

## Test plan
[from pre-push-audit output]

🤖 Generated with issue-pilot skill
EOF
)"
```

Save the PR URL returned by `gh pr create`.

---

## Phase 4 — PR review (subagent, sonnet model)

Spawn a third subagent (sonnet) with:

```
You are reviewing PR PR_URL for issue #ISSUE_NUMBER.
Run the review-pr skill. Document findings in docs/review-findings/.
Return: PASS, PASS_WITH_NOTES, or NEEDS_HUMAN with a one-line summary.
```

Parse the result:

- **PASS**: Send:
  ```
  PushNotification: "issue-pilot: #ISSUE_NUMBER — PR PR_URL ready to merge. Review passed clean."
  ```
- **PASS_WITH_NOTES**: Send:
  ```
  PushNotification: "issue-pilot: #ISSUE_NUMBER — PR PR_URL ready with notes. Check docs/review-findings/."
  ```
- **NEEDS_HUMAN**: Send:
  ```
  PushNotification: "issue-pilot: #ISSUE_NUMBER — PR PR_URL needs your review. [one-line reason]."
  ```

In all cases, stop after notifying. Do not merge.

---

## Notification rules

- Only notify when you stop and the human needs to act.
- Never notify for routine progress.
- Messages must be under 200 characters, plain text, lead with the actionable fact.
- Always include the issue number and branch or PR URL so the human can orient immediately.

---

## Usage guardrails

- One issue per invocation — never loop to the next issue automatically.
- Use haiku for Phase 0 (triage only). Use sonnet for all subagents.
- If any `gh` command fails with auth error, stop immediately and notify: "issue-pilot: gh auth error — run `gh auth login` and retry."
- Never force-push, never skip hooks, never amend a published commit.
