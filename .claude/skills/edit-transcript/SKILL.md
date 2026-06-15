---
name: edit-transcript
description: Applies a full editorial pass to a podcast transcript doc — structural cleanup, chapter markers, concept overlays, hooks, camera cues, and visual media. Works on any podcast episode of any topic. Optionally runs merge-doc.
argument-hint: "[--transcript path/to/transcript.doc.txt] [--section structure|chapters|concepts|hooks|camera|media|all] [--merge]"
allowed-tools: Read, Grep, Glob, Bash, Edit, WebSearch, AskUserQuestion
---

You are performing an editorial pass on a podcast transcript doc, adding all the annotations that turn a raw Whisper output into a polished produced episode.

## Arguments

Parse `$ARGUMENTS`:
- `--transcript <path>` — path to the doc file (default: `public/edit/transcript.doc.txt`)
- `--section <name>` — limit to one pass: `structure`, `metadata`, `chapters`, `concepts`, `hooks`, `camera`, `media`, or `all` (default: `all`)
- `--merge` — run merge-doc automatically after edits complete without asking

## Paths

Derive these from `--transcript`:

```
DOC_PATH     = (from --transcript arg, or default) public/edit/transcript.doc.txt
TRANSCRIPT   = replace .doc.txt with .json in DOC_PATH
               e.g. public/edit/transcript.json
               e.g. public/shorts/ghost-workers/transcript.json
ASSETS_ROOT  = public/assets/episodes/
CAMERA_JSON  = public/camera/camera-profiles.json
```

**Merge command** — longform (default):
```bash
npm run transcript:merge
```

**Merge command** — shorts (if DOC_PATH is under `public/shorts/<id>/`):
```bash
node scripts/shorts/merge-short-doc.js \
  --doc <DOC_PATH> \
  --parent-transcript public/edit/transcript.json \
  --id <id>
```

---

## Step 0 — Read and assess

Read `DOC_PATH` in full. Parse:
1. Skip the header guide (lines 1–130 roughly — the === TRANSCRIPT EDITOR === block)
2. `# THUMBNAIL` section — note which fields are filled vs blank
3. `# SPEAKERS` section — extract all speaker names (left side of `Name: Display`)
4. All segments: identify kept (no leading `-`) vs cut (leading `-[N]`)

Also check what's present:
```bash
ls public/assets/episodes/ 2>/dev/null
cat public/camera/camera-profiles.json 2>/dev/null | head -60
```

Build an inventory of what's already done:

```
Inventory:
  > START marker:           [ yes | no ]
  > END marker:             [ yes | no ]
  THUMBNAIL fields:         [ complete | partial | empty ]
  > NameTitle per speaker:  [ all | partial: missing X, Y | none ]
  > ChapterMarker count:    N
  > ConceptExplainer count: N
  > TermTypewriter count:   N
  > HOOK count:             N
  > Callout / QuoteCard:    N
  > CAM cue count:          N
  > ImageWindow count:      N
  > FullscreenMedia count:  N
```

Report the inventory, then proceed with the passes indicated by `--section`.

---

## Pass 1 — Structural Cleanup (`--section structure` or `all`)

### Segments to cut

Identify segments that are outside the intended show content and prefix them with `-`:

| Pattern | Examples |
|---------|----------|
| Pre-show setup | "can you hear me?", "let me have a seat", equipment adjustments, waiting for recording to start |
| False starts / restarts | "let's redo that", "I lost my flow", "can we go again?", "okay let's do the policy question again" |
| Off-topic technical issues | "the TV was moving", "the book might fall", "I have to show myself", crosstalk about mics/cameras |
| Post-show wind-down | chatter after the final on-air sign-off ("yay we did it", "okay good thank you", "clapping") |
| Pure noise | "[laughter]" alone with no spoken content, single-word acknowledgements mid-setup ("Okay.", "- Yeah.") |

To cut a segment: change `[N]  text...` → `-[N]  text...` using Edit tool.

Also remove obvious word-level noise in kept segments:
- Transcription artifacts: `{--}`, repeated stutters ("and and and")
- Pure filler where it doesn't add character: `{um}`, `{uh}` (use curly-brace cut syntax)
- Do NOT cut thinking pauses or natural speech patterns that feel authentic

### START / END markers

Find the first segment that opens the show (first on-air sentence of the real intro):
- Add before it: `> START "firstwords"` — quote the opening 2–3 words for precise timing
- If `> START` is already present, skip

Find the last segment of the actual show (final sign-off, "stay tuned", "thanks for watching"):
- Add after it: `> END`
- If `> END` is already present, skip

---

## Pass 2 — Thumbnail Metadata (`--section metadata` or `all`)

The `# THUMBNAIL` block looks like:
```
# THUMBNAIL
bg=""
middlespeaker="GuestName"
title="Episode **Title**"
extendedTitle="Extended subtitle"
episodeNumber="N"
```

If all fields are already filled, skip this pass.

Otherwise fill in what's derivable from the transcript content:
- `bg=""` — leave blank unless an episode assets folder exists at `public/assets/episodes/<slug>/` with a `bg.jpg`/`bg.png`; if so, set `bg="assets/episodes/<slug>/bg.jpg"`
- `middlespeaker="Name"` — the primary guest, or all hosts comma-separated if no guest
- `title="Phrase **Key Hook**"` — derive from the episode's central theme; wrap 1–3 words in `**` for accent highlighting
- `extendedTitle="..."` — one-line subtitle elaborating the topic
- `episodeNumber="N"` — leave blank if not determinable from context

If the THUMBNAIL section is entirely empty and the episode topic is unclear, use AskUserQuestion to ask for: episode title, guest name (if any), episode number.

---

## Pass 3 — Speaker Introductions (`--section metadata` or `all`)

For each speaker in `# SPEAKERS`, find their **first substantive speaking turn** after `> START` (skip cut segments).

If no `> NameTitle` annotation exists on or near that turn, add one immediately after the segment line:
```
    > NameTitle  at="FirstWord"  duration=6  name="Full Name"  title="Role / Title"
```

- `at=` — first word of their turn
- `duration=` — 5–8 s for hosts, 6–10 s for a guest
- `name=` — use full name if mentioned in transcript; otherwise use display name from SPEAKERS section
- `title=` — infer from transcript if stated; leave as `title=""` and note for user if unknown

Do not add duplicate NameTitle if one already exists within 5 segments of their first turn.

---

## Pass 4 — Chapter Structure (`--section chapters` or `all`)

Chapters provide YouTube chapter markers and visual section titles on screen.

### Where to place chapters

1. **After introductions** — when the intro wraps up and the first real question begins
2. **At each topic/question shift** — when a host asks a new question or pivots to a new theme
3. **At the closing segment** — "wrap up", "final question", "key takeaways"

### How to identify boundaries

Look for:
- Host question openers: "what do you think...", "can you tell us...", "how does...", "what are...", "I wanted to ask..."
- Transition phrases: "that leads me to...", "let me ask...", "moving on...", "now..."
- Segment-level topic shifts: speaker wraps a topic with a summary, then a new question begins
- Existing `> ChapterMarker` annotations (do not duplicate)

### Format

At the segment starting a new chapter, add **both** lines — ChapterMarkerEnd closes the previous chapter, ChapterMarker opens the new one:
```
    > ChapterMarkerEnd  at="firstword"  duration=1
    > ChapterMarker  at="firstword"  duration=300  chapterTitle="Section Title"
```

- Omit `ChapterMarkerEnd` for the very first chapter (nothing to close)
- `duration=300` is the standard run time (it will be closed by the next ChapterMarkerEnd)
- `chapterTitle` — 2–5 words, title-cased, describing what this section covers
- `at=` — first word of the segment

---

## Pass 5 — Concept Definitions (`--section concepts` or `all`)

Scan kept segments for terms the audience may not know, frameworks the speaker defines, and notable people referenced.

### ConceptExplainer — for terms worth a full explanation

```
    > ConceptExplainer  at="keyword"  duration=10  keyPhrase="Full Term"  description="Accessible 2–3 sentence explanation. What it means, why it matters here."
```

Use when:
- A technical or specialist term is introduced ("ghost workers", "data sovereignty", "frugal innovation")
- A named framework or concept is defined by the speaker
- A notable person is cited (academic, researcher, author, Nobel laureate)
- An organization or initiative is mentioned that the audience likely doesn't know

`at=` — the word that triggers the overlay (first word of the term, or person's last name)
`duration=` — 8–15 s based on description length
`description=` — standalone, accessible, no assumed prior knowledge; 2–4 sentences max

### TermTypewriter — brief concept flash

```
    > TermTypewriter  at="keyword"  duration=3  term="Term"  label="concept"  emoji="🔬"
```

Use for terms that are:
- Short (1–4 words)
- Self-explanatory OR already explained inline by the speaker
- Worth emphasizing on screen without a full explainer

Choose an emoji relevant to the subject area (💡 for innovation, 🌍 for geography, 📊 for data, etc.).

### Order of operations

If both a ConceptExplainer and a TermTypewriter are warranted for the same concept, use ConceptExplainer on first occurrence and optionally TermTypewriter on a later callback.

---

## Pass 6 — Key Quotes & Callouts (`--section concepts` or `all`)

### Callout — speaker's own memorable lines

```
    > Callout  at="word"  duration=8  text="The exact phrase highlighted."
```

Use for:
- Punchy statements that encapsulate the episode's core argument
- Provocative claims that challenge conventional thinking
- Strong calls to action

`at=` — first word of the phrase
`duration=` — 6–10 s
`text=` — exact or lightly paraphrased version of what was said (attribution is implied to the speaker)

### QuoteCard — verbatim external quotes

```
    > QuoteCard  at="word"  duration=12  quote="Verbatim quote."  attribution="Person, Work (Year)"
```

Use when a speaker reads or paraphrases an exact quote from a book, paper, or speech. Always include full attribution.

---

## Pass 7 — Hooks (`--section hooks` or `all`)

If **≥ 15 `> HOOK` annotations** already exist, skip this pass entirely — the episode is already hooked. Instead, note "hooks appear complete" in the summary.

Otherwise, annotate 15–35 hook moments across the episode.

### What makes a hook-worthy moment

1. A surprising or counterintuitive claim
2. A rhetorical question that builds curiosity or tension
3. A sharp metaphor or analogy that reframes the topic
4. An emotional or personal revelation from a speaker
5. The satisfying "landing" of a big idea (the punchline of an argument)
6. A striking statistic or quantified claim
7. A confrontational or provocative statement

### Format

```
    > HOOK "exact phrase"
```
or, for the whole segment:
```
    > HOOK
```
or, with explicit timing (read from transcript.json if available):
```
    > HOOK "exact phrase" <start>-<end>
```

Rules:
- 4-space indent, placed immediately after the segment line (before other annotations on that segment)
- `"exact phrase"` — must match the transcript text exactly (case-insensitive match is fine; punctuation can differ slightly)
- At least one hook per speaker who has kept segments
- Do not place on cut segments
- Spread hooks across the episode — avoid more than 3 on consecutive segments
- For timing: read `public/edit/transcript.json` (or the shorts transcript.json) and find the token with matching text to get `t_dtw` and `t_end` for the hook phrase

---

## Pass 8 — Camera Cues (`--section camera` or `all`)

Camera cues control which shot is on screen. Check camera-profiles.json for available angles and speaker viewport mappings.

### What to add

1. **Speaker introduction** — when a guest is first introduced by name, cut to them:
   ```
       > CAM GuestName  at="GuestName"  [angle="angleN"]
   ```
2. **Topic transitions** — add a wide shot at the start of a new chapter or after a long close-up run:
   ```
       > CAM wide  at="word"  [angle="angleN"]
   ```
3. **Active speaker** — when the conversation shifts from a long host monologue to a guest answer, cut to the guest:
   ```
       > CAM GuestName  at="firstword"
   ```
4. **Periodic wide** — approximately every 45 seconds of continuous close-up, insert a brief wide shot

### Existing camera rules

If `> CAM` annotations are already sparse (< 5 total), add them systematically. If there are already many, only add where clearly missing (e.g., a guest is discussed for 3+ segments without a camera cut to them).

### Format

```
    > CAM SpeakerName  at="word"  [angle="angleN"]
    > CAM wide  at="word"  [angle="angleN"]
```

If camera-profiles.json is not found or has no angle names, omit `angle=` and note this for the user.

---

## Pass 9 — Visual Media (`--section media` or `all`)

Visual overlays make abstract ideas concrete and keep viewers engaged. Apply them liberally but purposefully.

### ImageWindow — for entities, people, orgs, books

Trigger an ImageWindow when the speaker mentions:
- A **person** (researcher, author, public figure, historical figure)
- An **organization, initiative, or institution**
- A **book, paper, or publication** being discussed
- A **product or platform** with a recognizable visual identity
- A **place or landmark** (when the visual matters to the point)

```
    > ImageWindow  at="keyword"  duration=N  src="URL_or_path"  title="Title"  [caption="Optional"]
```

- `at=` — first distinctive word (last name for a person, first keyword of org name)
- `duration=` — 3–6 s for passing mentions, 4–8 s for key references
- `src=` — find a direct image URL using WebSearch (must end in .jpg, .png, .webp, .jpeg, or .gif); prefer official sources, Wikipedia infoboxes, organization homepages
- `title=` — the entity's name or a descriptive label
- `caption=` — optional one-line descriptor

**Finding images:** Use WebSearch queries like:
- `"[Person Name]" wikipedia site:en.wikipedia.org` → look for thumbnail image URL
- `"[Organization Name]" logo OR official site` → find official website image
- `"[Book Title]" cover image`

Only add ImageWindow if you can find a real, working image URL. If not found, skip and note it in the summary.

### FullscreenMedia — GIFs and b-roll for abstract concepts

Use a `> FullscreenMedia` GIF overlay to illustrate abstract points:
- Emotional moments ("the purpose of life is...", "we don't want to be passive users")
- Abstract concepts ("technology will shape you", "innovation under constraints")
- Scale or statistics ("75% of the world population")
- Metaphors being explained ("AI bicycle vs rocket")

```
    > FullscreenMedia  at="word"  duration=N  src="giphy_url_or_local_path"  mediaType="gif|video|image"
```

**Finding GIFs:** Use WebSearch to find Giphy GIF URLs. Search `site:giphy.com [concept keyword]`. Use direct media URLs in the form:
`https://media{0-4}.giphy.com/media/{id}/giphy.gif`

**Using local assets:** Check `public/assets/episodes/` for episode-specific b-roll:
```bash
ls public/assets/episodes/ 2>/dev/null
```

If a matching video exists (e.g. `data-workers.mp4`), prefer that over a GIF.

`duration=` — 2–8 s; shorter for quick visual punctuation, longer for concepts being explained in real time.

### Brand overlay

If the podcast's own brand/show name is mentioned explicitly in the audio:
```
    > RagtechOverlay  at="BrandKeyword"  duration=5
```
Only use if the word is actually spoken (not just the show concept).

### Media placement strategy

- Add ImageWindow on **first meaningful mention** of an entity; skip on callbacks unless it's a different context
- Add FullscreenMedia GIFs to roughly 20–30% of kept segments — enough to create visual rhythm without overwhelming
- Never stack more than 2 consecutive FullscreenMedia on back-to-back segments
- FullscreenMedia runs concurrently with the video; it's not exclusive — the camera feed is still visible behind it (it's an overlay)

---

## Step 10 — Summary Report

After completing all requested passes, output a structured summary:

```
Edit pass complete — <doc_path>

=== Structural ===
  Segments cut:     N  (pre-show: N, failed takes: N, post-show: N)
  START marker:     [set | already present | not set]
  END marker:       [set | already present | not set]
  Word cuts:        N filler words wrapped in {}

=== Metadata ===
  Thumbnail:        [complete | partial | skipped]
  NameTitle intros: N added  (Speaker1, Speaker2, ...)

=== Content ===
  ChapterMarkers:   N chapters — ["Title 1", "Title 2", ...]
  ConceptExplainer: N
  TermTypewriter:   N
  Callouts:         N
  QuoteCards:       N

=== Engagement ===
  HOOK annotations: N
  Camera cues:      N
  ImageWindows:     N
  FullscreenMedia:  N

=== Needs review ===
  - NameTitle for "SpeakerX" — title unknown, set to "" — please fill
  - ImageWindow at [NN] for "Entity" — no image URL found, skipped
  - (any other items that need human attention)
```

---

## Step 11 — Merge (optional)

**If `--merge` was passed**: run the merge command immediately and check output.

**Otherwise**: ask using AskUserQuestion:
> "Run merge-doc now to apply these doc changes to transcript.json?"

Options:
- "Yes, run merge-doc now" — run the merge command
- "No, I'll review the doc first" — stop here

**Running merge:**
```bash
npm run transcript:merge
# (or the shorts variant if applicable)
```

After running, scan the output for `phrase not found` warnings. For each warning:
1. Find the `> HOOK "phrase"` or `at="phrase"` annotation that failed
2. Read the surrounding segment text in the doc to find the correct verbatim text
3. Fix the annotation using Edit and re-run merge

Do not report success until merge exits cleanly with no warnings.

---

## Notes for edge cases

**Already fully edited transcript**: If the inventory shows most annotation types are already present (>5 of each), report what's there and ask the user which passes to run rather than silently adding duplicates.

**Shorts transcript** (doc path under `public/shorts/`): The doc covers only a clip. Only add annotations relevant to the clip's time range. For hooks, apply the same criteria but note that short-form docs typically already come from create-short which adds hooks — check first.

**Non-English transcript**: All format rules still apply. For ConceptExplainer descriptions and chapter titles, write in English (the overlay UI is English). For `at=` values and `> HOOK "phrase"` values, use the text exactly as it appears in the doc.

**Very short episode / clip (< 5 minutes)**: Skip ChapterMarkers. Keep ConceptExplainers to the most important 3–5 terms. Aim for 5–10 hooks instead of 15–35.
