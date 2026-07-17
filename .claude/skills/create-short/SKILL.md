---
name: create-short
description: Creates a new short-form clip from the longform transcript. Scans for strong clip candidates (60–120 s, clear concept, compelling hook potential), extracts the doc, annotates hooks, and merges. Use when you want to produce a new TikTok/Reels/YouTube Short from the episode.
argument-hint: "<id> | <concept-description> | --from <seconds> --to <seconds> --id <name>"
allowed-tools: Read, Grep, Glob, Bash, Edit
---

You are creating a new short-form clip (portrait 9:16, 60–120 s) from the longform episode transcript.

## Arguments

`$ARGUMENTS` may contain:
- Nothing — scan the transcript and propose candidates, then pick the best one
- A concept keyword or phrase (e.g. "ghost workers", "frugal innovation") — find the best matching clip
- `--from <seconds> --to <seconds> --id <name>` — use explicit boundaries and skip candidate selection
- An existing short `<id>` (e.g. `ghost-workers`) — resume: skip extract, go straight to hook annotation + merge

Parse `$ARGUMENTS` first. Detect the `--from/--to/--id` form with a regex; otherwise treat the whole string as a concept/topic hint (or empty for auto-scan).

## Paths

```
LONGFORM_TRANSCRIPT  = public/edit/transcript.json
LONGFORM_DOC         = public/edit/transcript.doc.txt
SHORTS_ROOT          = public/shorts/
EXTRACT_SCRIPT       = node scripts/shorts/extract-short-doc.js
MERGE_SCRIPT         = node scripts/shorts/merge-short-doc.js
```

---

## Step 1 — Read the longform doc

Read `public/edit/transcript.doc.txt`. Identify:
- The `# SPEAKERS` section (note all speakers)
- The `> START` and `> END` markers (which section is in scope)
- All non-cut segments between START and END (those without a leading `-`)

---

## Step 2 — Scan existing shorts for overlap

```bash
ls public/shorts/
```

For each existing short folder, read its `transcript.json` and note `meta.videoStart` and `meta.videoEnd`. Build a list of covered time ranges:

```
existing coverage:
  ai-bicycle:         514.2s – 619.3s
  frugal-innovation:  731.5s – 797.7s
  global-south:       424.7s – 512.7s
```

A candidate clip **overlaps** an existing short if its time range shares more than 5 seconds with any covered range. Overlapping candidates must be excluded or adjusted so they don't duplicate existing content.

---

## Step 3 — Find clip candidates (skip if `--from/--to/--id` given)

Scan the in-scope segments for **clip boundaries** using these rules:

### What makes a good START:
- A direct question that introduces a concept (e.g. "what is global south?")
- The first sentence of a clear concept explanation (e.g. "frugal innovation is...")
- A surprising claim or sharp metaphor that stands alone without prior context
- Avoid: mid-sentence continuations ("and...", "so...", "but then..."), preamble greetings, setup filler

### What makes a good END:
- A punchy, quotable phrase that resolves the idea (metaphor landing, memorable statement)
- A natural pause before a new topic begins (look for `> ChapterMarker` or `> ChapterMarkerEnd` as natural seams)
- Do NOT end mid-thought, mid-list, or on a transition word
- Aim for 60–120 seconds of content (check segment timestamps)

### How to estimate duration:
- Read timestamps from `public/edit/transcript.json` for the candidate segment IDs — `segment.start` and `segment.end` in seconds
- 60–120 s is the sweet spot; under 45 s feels thin; over 150 s loses short-form attention

### Concept matching:
If a concept/topic hint was provided, prioritise segments where that concept is first introduced or most clearly explained. Check for `> ConceptExplainer`, `> TermTypewriter`, or `> Callout` annotations near candidate segments — these mark concept definitions.

**Find 3–5 candidate clips** that do not overlap existing shorts. Describe each as:

```
Candidate N — "<Concept Title>"
  Start: segment [X] "first words..."  (~<start>s)
  End:   segment [Y] "last words..."   (~<end>s)
  Duration: ~<N>s
  Why: one sentence on why this clip works as a standalone short
```

Clearly mark any candidate that was excluded due to overlap with `[SKIPPED — overlaps <existing-id>]`.

---

## Step 4 — Let the user choose

Present the candidates to the user and ask which to create:

Use AskUserQuestion with:
- A multi-select question listing all candidates as options
- Include "All of the above" as a final option
- Example options: `["Candidate 1 — Ghost Workers (~88s)", "Candidate 2 — Data Colonisation (~95s)", "Candidate 3 — Digital Proletariat (~72s)", "All of the above"]`

Wait for the user's selection before proceeding. Only create the shorts the user selected.

---

## Step 5 — For each selected clip: derive ID

For each selected candidate:
- Convert the concept title to kebab-case, max 3 words (e.g. "Ghost Workers" → `ghost-workers`)
- Check `public/shorts/` for collisions — append `-2`, `-3` if the folder already exists

---

## Step 6 — For each selected clip: get precise timestamps

Read `public/edit/transcript.json`. Find `segment.start` of the first in-clip segment and `segment.end` of the last. These become `--from` and `--to`.

---

## Step 7 — For each selected clip: extract

```bash
node scripts/shorts/extract-short-doc.js \
  --transcript public/edit/transcript.json \
  --from <from_seconds> \
  --to <to_seconds> \
  --id <id>
```

Verify: `ls public/shorts/<id>/`

If creating multiple clips, run extract for all of them before moving to annotation — this batches the disk writes.

---

## Step 8 — For each selected clip: annotate hooks

Read `public/shorts/<id>/transcript.doc.txt`. Find all non-cut segments between `> START` and `> END`.

Select **5–15 hook annotations** using patterns from the existing ai-bicycle, frugal-innovation, and global-south clips:

**Hook-worthy moments:**
1. Contrarian/surprising claims that challenge assumptions
2. Rhetorical questions that create curiosity
3. Sharp metaphors or analogies (e.g. "AI bicycle vs rocket")
4. Emotional/personal moments — speaker sharing personal stakes
5. Concept definitions that reframe the topic
6. Striking statistics (75% of world population, etc.)
7. Strong call-to-action or challenge phrases

**Format rules:**
- `> HOOK "exact phrase"` — for a specific phrase (must match exact token text)
- `> HOOK` — for the entire segment
- `> HOOK "exact phrase" 12.450-15.300` — explicit timing override (seconds, 3 dp); merge writes resolved times back so you can fine-tune
- `> HOOK "phrase" title="My Title"` — with title overlay
- `> HOOK "phrase" title="My Title" placement="upper"` — with title + placement (`upper` or `middle`)
- 4-space indent after the segment line
- At least one hook per speaker in the clip
- Do not duplicate existing `> HOOK` annotations
- After `merge-short-doc.js` runs, resolved `from-to` times are written back into the doc — edit them and re-run to adjust

---

## Step 9 — For each selected clip: merge

```bash
node scripts/shorts/merge-short-doc.js \
  --doc public/shorts/<id>/transcript.doc.txt \
  --parent-transcript public/edit/transcript.json \
  --id <id>
```

Check output for "phrase not found" warnings — fix any failed phrase matches and re-run.

---

## Step 10 — Report

For each created short:

```
✓ public/shorts/<id>/
  Title:    "<Concept Title>"
  Duration: ~<N>s  (from <from>s to <to>s)
  Hooks:    <count> annotations added
  Speakers: <list with hooks>
```

Then list next steps once for all created shorts:

```
Next steps (for each short):
  1. Review: public/shorts/<id>/transcript.doc.txt
  2. Adjust > START / > END phrases if timing feels off
  3. Portrait camera (if needed):
       node scripts/shorts/portrait-camera-setup.js --source public/camera/camera-profiles.json
  4. Preview: npm run dev  →  ShortFormClip-<id>
  5. Render:  node scripts/shorts/render-short.js --id <id>
```

---

## Resuming

If `$ARGUMENTS` is a bare word matching an existing `public/shorts/<id>/` folder, skip Steps 2–7. Jump to Step 8 (add missing hooks) and Step 9 (re-merge).
