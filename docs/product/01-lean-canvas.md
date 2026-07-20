# Lean Canvas

Fill this out in one sitting, ~45 minutes, all three cofounders in the room if possible. Don't overthink any single box — the point is to get your current best guess down so it can be tested, not to be right on the first pass. Expect to revise this after the first few customer interviews; that revision is the artifact working as intended, not a failure.

Reference: [Ash Maurya's Lean Canvas](https://leanstack.com/lean-canvas) — 9 boxes, fill in roughly this order (1 → 9):

## 1. Problem

*Top 1-3 problems. Pull directly from `00-problem-hypothesis.md`.*

- Editing a standard 30min-1hr multi-cam podcast episode takes a full half-day minimum (audio cleanup, sync, cutting between speakers, intro/outro), plus another full day to cut short-form clips for 1-2 weeks of promotion — unsustainable for teams with full-time jobs or limited budget.
- Affordable DIY tools (CapCut, Clipchamp) are buggy and slow editing down further; professional alternatives are priced per-episode in a way that doesn't scale with volume, and hiring in-house/freelance editors isn't affordable for small/early teams.
- Editing quality/style consistency suffers when work is split across multiple people or done ad hoc — a real problem for anyone trying to hold a brand/production standard.

### Existing alternatives

*What do people with this problem do today? (Remotion/DaVinci/Premiere themselves, a video editor they hire, just not editing multi-cam at all, Descript, etc.) Naming the real alternative — including "doing nothing" or "hiring a freelancer" — matters more than naming a direct competitor.*

- DIY with free/prosumer tools: CapCut, Clipchamp, Riverside — free or cheap but buggy, slow, no automation for multi-cam jump cuts or transcript-driven editing.
- Paid editing services/studios: e.g. Poddster (Singapore) — S$273 recording + S$280 standard episode edit + S$453 manual-subtitle add-on + S$280 for 3 highlight clips = S$1,286/cycle for a comparable bundled outcome; line-item add-on pricing, not bundled. Full comparison in `docs/PRICING_TIERS.md` (`editing-services` branch).
- In-house or freelance editor — costs money, and (per our own experience) still needs consistency/QA oversight.
- Doing nothing / publishing raw or minimally-edited footage — some early podcasters skip proper editing entirely due to cost/time, at the expense of quality.

## 2. Customer Segments

*Who exactly. Refine the "who else has this problem" guess from the hypothesis doc into something specific enough to recruit interviews against.*

Three named segments (aligned with `docs/EDITING_PACKAGES.md` on the `editing-services` branch):

- **Segment 1 — primary near-term, real deal in motion: Podcast Studios and Agency Partners (B2B2B).** Studios/agencies running production for multiple podcast clients who want to expand editing capacity/margin without building an in-house team. We fulfill; they route work and own the client relationship. Currently negotiating with one such studio — pricing tiers (Essential/Growth/Premium, S$179-S$749) are being proposed as what the studio can offer *its* clients, with poddedit fulfilling behind the scenes. This is the segment with a real, live competitive purchase decision, so it's the one the UVP is written against.
- **Segment 2 — live: Independent and Creator-Led Podcasts.** Solo hosts/small teams publishing consistently on YouTube/Spotify/TikTok, need multi-format repurposing without a large time investment. Could be reached directly (tiered self-serve packages) or via a studio/agency.
- **Segment 3 — live: Business and Thought-Leadership Podcasts.** Founder-led/B2B/company podcasts using episodes for brand and demand-gen; want polished output without managing in-house post-production. Likely willing to pay more for reliability/speed than Segment 2, per willingness-to-pay analysis in `docs/FINANCIAL_PROJECTIONS.md`.
- Segment priority isn't fully locked — Segment 1 is the immediate focus because a deal is actively in motion, but 2 and 3 are real, named, and not just hypotheses waiting on Segment 1 to fall through.
- **ragTech itself is not treated as a canvas customer segment** — we're the maker, not a market test, since we can't lose our own business to a competitor. But note: the actual day-to-day *operator* of the tool is a ragTech team member either way (our own episodes or client work) — poddedit has to work for that operator persona regardless of which segment's footage it is.

### Early adopters

*Within that segment, who would try something rough/unfinished first? These are who you interview and design-partner with first — not the mainstream of the segment.*

- The specific podcast studio rental company currently in partnership talks — real, already in motion, highest priority to convert into a design partner for both the service and the underlying product.
- Other studio-rental or podcast-production agencies in the same category (similar to thelfgpod.com) who may have the same "we want to offer editing without building it ourselves" need.

## 3. Unique Value Proposition

*One sentence. What do you offer that's different/better, and why should a target customer care in the first 10 seconds?*

- Fast, consistent multi-cam podcast editing — delivered in hours, not days — powered by efficient local AI instead of expensive cloud-token models.
- *(For Segment 1 specifically: reliable, affordable subcontracted editing capacity a studio can route client work to without building an editing team themselves.)*

## 4. Solution

*Top 3 features that address the top problems above. Resist listing everything in the RFC's build order — this is the customer-facing subset, not the technical roadmap.*

1. Automated multi-cam jump-cut editing driven by the transcript (sync, camera switching, cuts) — removes the most repetitive manual work.
2. Fast native rendering — turns a many-hour render into under an hour, enabling same-day turnaround for subcontracted client work.
3. Built-in short-form/clip repurposing from the same long-form source — covers the "another full day" of clipping work in one pipeline, not a separate tool/pass.

## 5. Channels

*How would target customers actually find/reach this? (Podcast communities, YouTube creator forums, word of mouth from ragTech's own audience, etc.)*

- B2B2B: direct relationship-building with podcast studio rental companies / production agencies — the current partnership is the first channel, not a hypothetical one.
- ragTech's own audience/network — credibility as working podcasters who built this to solve our own problem.
- Podcast creator communities — relevant mainly if/when Segment 2 or 3 becomes the near-term focus.

## 6. Revenue Streams

*If this becomes a product — subscription, one-time license, usage-based, or genuinely undecided. It's fine to write "undecided" but write down the options you're actually considering.*

- **Primary: per-episode tiered packages.** Essential (S$179-229) / Growth (S$279-399) / Premium (S$499-749), scaled by episode length, plus add-ons (extra clip +S$30, extra carousel +S$50, rush +25%, chapter markers S$29, custom branding S$299++, annual retainer = 1 month free). Full detail in `docs/PRICING_TIERS.md` and `docs/EDITING_PACKAGES.md` (`editing-services` branch).
- Deal-specific and still to be settled in the studio negotiation itself: whether the studio pays these tiers directly as a wholesale/fulfillment rate (flat fee or rev-share with the studio's own markup on top) vs. some other split — this doc's `docs/EDITING_PACKAGES.md` presents the tiers as what a studio could offer *its own clients*, not necessarily poddedit's price to the studio itself.
- Possible future, not v1: subscription or usage-based self-serve pricing if a direct-to-creator/product path opens up (Segments 2/3 without a studio intermediary).

## 7. Cost Structure

*Rough — engineering time (the big one right now), infra/hosting if any, model/API costs if you keep any cloud-dependent ML features.*

- Engineering time — dominant cost right now (the native rewrite itself).
- Editor labor time — the real constraint once doing paid client work. `docs/FINANCIAL_PROJECTIONS.md` estimates hands-on time per tier (Essential ~1.0h, Growth ~2.0h, Premium ~4.0h) implying effective hourly returns of S$156-204/h across tiers even before the render-speed improvements this rewrite targets — meaning faster rendering directly increases effective hourly rate, not just "nice to have."
- Compute — local/on-device AI models (whisper.cpp, ONNX) avoid ongoing cloud API/token costs; this is a deliberate cost-structure choice, not just a UVP talking point.
- No hosting/infra cost currently — this is a native desktop tool operated internally, not a hosted service.

## 8. Key Metrics

*The few numbers that would tell you this is working. (E.g. time-to-render-an-episode, weekly active editors, retention after first project, NPS.)*

- Render time per episode (RFC target: under 1 hour, down from up to 8).
- Edit turnaround time per client project — raw footage to delivered edit.
- Episode volume per person/month — `docs/FINANCIAL_PROJECTIONS.md` Scenario B (Growth-led) targets ~17 episodes/month/person at S$5,658/month; team-of-3 target S$16,500-18,000/month (~51 episodes/month combined). These are the concrete version of the 12-month "10 client teams weekly" success metric in `00-problem-hypothesis.md` — worth reconciling the two into one number once the studio deal's actual terms are known.
- Rework/revision rate per client project — a consistency proxy.
- Cost per episode edited (labor + compute) vs. revenue per episode — unit economics of the service business.

## 9. Unfair Advantage

*Something competitors can't easily copy. Be honest — for a v1 this might legitimately be "nothing yet" or "our own dogfooding/domain expertise as working podcasters," which is a real but modest advantage.*

- We are working podcasters *and* full-time software engineers — deep, lived domain expertise in the exact workflow we're building for, plus the ability to build the fix ourselves rather than commission it or wait for someone else to. That combination is rare: most people who feel this pain can't build the solution, and most people who could build it don't feel the pain.
- Local/efficient AI architecture (vs. expensive cloud-token competitors) is a real, structural cost advantage tied directly to the native rewrite's technical decisions — not just brand positioning.
- An inbound B2B2B relationship already in motion — real distribution advantage vs. competitors who'd have to cold-sell into studio partnerships from scratch.

---

## Revision log

*Every time you revise a box based on real evidence (an interview, a churned assumption), note it here with the date and what changed. This is what makes the canvas a living hypothesis document instead of a one-time exercise.*

| Date | Box changed | What changed | Why (evidence) |
|------|-------------|--------------|-----------------|
| 2026-07-10 | Existing Alternatives, Customer Segments, Revenue Streams, Cost Structure, Key Metrics | Replaced "undecided" placeholders with concrete pricing tiers, three named segments, and financial targets | Reconciled with pre-existing negotiation collateral on the `editing-services` branch (`docs/PRICING_TIERS.md`, `EDITING_PACKAGES.md`, `FINANCIAL_PROJECTIONS.md`), written by Natasha to negotiate the podcast-studio partnership offer. Not yet validated by customer interviews — still a hypothesis, just a more concrete one. |
