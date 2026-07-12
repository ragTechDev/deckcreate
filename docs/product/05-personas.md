# Personas

Keep this light — 1-2 primary personas. During Phase 1 (internal dogfooding — see `README.md`), personas can be derived from direct observation of how the tool is used day-to-day, not just from interviews. Label the evidence source clearly. When interviews happen (Phase 2), revise with real quote evidence from `03-customer-interviews/synthesis.md`.

A persona invented from imagination with no evidence trail is worse than none — it feels authoritative without being grounded. But a persona derived from months of direct, daily use of the tool is real evidence; don't withhold it just because it came from dogfooding rather than a formal interview.

## Persona template (copy per persona)

### [Name] — [one-line descriptor, e.g. "solo podcast host editing their own multi-cam episodes"]

**Segment:** (from Lean Canvas customer segments)

**Role/context:**

**Goals:** *What are they actually trying to accomplish — not "use good software" but the real outcome (e.g. "publish weekly without burning a full day on editing").*

**Frustrations:** *Pull directly from interview quotes where possible.*

**Representative quote:** *A real quote from `03-customer-interviews/`, not a paraphrase.*

**Current tools:**

**Tech comfort level:**

**What would make them switch to a new tool:**

---

## Persona 1

### The ragTech Operator — "engineer-editor rotating through the pipeline biweekly"

**Segment:** Not a canvas customer segment — this is the internal operator persona. The actual day-to-day user of the tool is a ragTech team member regardless of whether the footage is our own episode or a client's. poddedit has to work for this persona before it can work for anyone else.

**Evidence source:** Internal dogfooding — direct observation from building and operating the pipeline since it was first prototyped. Not yet validated externally.

**Role/context:** Full-time software engineer who rotates podcast editing duty every two weeks. Not a professional editor. Knows the codebase well enough to debug when something breaks, but the goal is that they shouldn't have to.

**Goals:** Get from raw footage to delivered edit (long-form + short-form clips) without spending more than 2 hours of hands-on time, without the render blocking them from doing other work, and without the output quality depending on which machine or which team member ran it.

**Frustrations:**
- Render takes 6–18 hours — can't review the cut until the next day.
- Pipeline behaves differently on different machines (Mac M2 vs Mac M3 vs Windows/NVIDIA) — unclear whether a difference in output is a bug or hardware.
- Short-form clipping is a full separate manual pass, not a first-class output of the same run.
- When something breaks, the failure mode is often silent (wrong encoder silently chosen, stale frame decode not surfaced as an error).

**Current tools:** The internal ragTech pipeline (deckcreate repo) — the very thing being rewritten.

**Tech comfort level:** High — can read and modify the codebase, run scripts, debug FFmpeg flags. But the tool should not require this; the goal is that a team member who is less deep in the codebase can operate it without debugging.

**What would make them switch (or: what does "done" look like for this persona):** Render under 1 hour, consistent output across all three hardware targets, short-form clips as a first-class output, and silent failures surfaced as actual errors.

---

## Persona 2

*(Only add when interviews or real client usage surfaces a second distinct operator type — e.g. an external editor operating the tool for client work who is not a ragTech engineer. Don't force it before that evidence exists.)*
