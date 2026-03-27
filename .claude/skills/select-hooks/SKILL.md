---
name: select-hooks
description: Selects 3–4 compelling hook segments or phrases from a video transcript doc and writes HOOK annotations for them. Ensures at least one hook per speaker. Use when you want to add hooks to a transcript.
argument-hint: <transcript-doc-path> [topic]
allowed-tools: Read, Grep, Glob, Bash, Edit
---

You are selecting 3–4 compelling hook clips to prepend to the video as a teaser/cold open.

## Arguments

`$ARGUMENTS` contains: `<path-to-transcript.doc.txt>` and optionally a topic description.

If no path is provided, look for `transcript.doc.txt` under `public/` using Glob.

## Process

**Step 1 — Read the doc**

Read the transcript doc file. Identify:
- The speakers (from the `# SPEAKERS` section)
- Which content is in scope (between `> START` and `> END` markers — only segments after `> START` and before `> END` are in the rendered video)
- Any segments already marked with `> HOOK` (note them, do not duplicate)

**Step 2 — Understand the topic**

If a topic was provided in `$ARGUMENTS`, use it. Otherwise, infer the topic from the content between `> START` and `> END`.

**Step 3 — Identify candidates**

Read through the in-scope segments looking for moments that make strong hooks:
- Bold claims or surprising statements
- Questions that create curiosity
- Punchy, quotable one-liners
- Moments of contrast or tension
- Statements that challenge assumptions

Avoid:
- Segments marked `CUT`
- Segments that reference something the viewer hasn't seen yet in a confusing way
- Filler or transition sentences
- Very short fragments (< 3 words)

**Step 4 — Select 3–4 hooks**

Choose the best 3–4 candidates. Requirements:
- At least one hook per speaker (check the `=== Speaker ===` section headers to see which speaker each segment belongs to)
- Prefer specific phrases within a segment over the whole segment — quote the exact words for precision
- Spread the hooks across the video (not all from the opening)
- Each hook should feel compelling in isolation — a viewer encountering it as a cold open should be intrigued

**Step 5 — Write the hooks**

For each selected hook, add a `> HOOK "phrase"` annotation line immediately after the segment line in the doc. The annotation must be indented with 4 spaces:

```
[42]  the most surprising thing about AI is that it makes you think more
    > HOOK "the most surprising thing about AI is that it makes you think more"
```

Use the exact words from the segment text (they must match token text for phrase resolution to work — do not paraphrase).

If the whole segment is the hook (not just a phrase), use `> HOOK` with no phrase:

```
[42]  that was the moment everything clicked.
    > HOOK
```

Do not add a hook annotation if one already exists on a segment.

**Step 6 — Run merge-doc**

After editing the doc, run:

```bash
npm run merge-doc
```

This resolves phrase timings and writes them back to the doc. Report any warnings (phrase not found means the quoted text didn't match token text — you may need to adjust the phrase to match the exact words in the segment line).

**Step 7 — Report**

List the hooks you added with their segment IDs, speakers, and the phrase selected. Note if any phrase resolution failed and suggest corrections.
