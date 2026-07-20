# Product Founding Docs — poddedit

**Naming note:** ragTech is the podcast/team. **poddedit** is the name of the product being built — the native rewrite described in the technical RFC, plus the editing-service business built on top of it. Use "poddedit" when referring to the product itself in these docs; "ragTech" refers to the team/podcast specifically.

This directory is the product/discovery half of the poddedit planning work — the companion to [`docs/rfcs/0001-native-desktop-rewrite.md`](../docs/rfcs/0001-native-desktop-rewrite.md), which is the *technical* half. That RFC justifies the rewrite from engineering pain (Remotion's render ceiling, hardware inconsistency). This directory exists to justify it from **customer** pain, and to build the artifacts that turn "we personally find this painful" into engineering issues grounded in evidence beyond the three of us.

Related, deal-specific collateral currently lives on the `editing-services` branch (`docs/PRICING_TIERS.md`, `docs/EDITING_PACKAGES.md`, `docs/FINANCIAL_PROJECTIONS.md`) — written to negotiate the podcast-studio partnership. The concrete pricing/market figures from that work have been folded into `01-lean-canvas.md` below; see that branch for the full negotiation-specific detail.

It's designed to be portable: when the new repo is created, copy this whole `product/` folder over as-is. Nothing in here depends on the current codebase.

## Why this exists

ragTech's editing pipeline started as an internal tool. This rewrite is being scoped as if it might become a product other podcasters/video teams use — which means before writing engineering issues, we should know: is the pain we feel actually general, who else has it, would they pay, and what does their current workflow actually look like (not just ours).

## Recommended order

Do these roughly in sequence — each one narrows/grounds the next. Don't skip straight to interviews or a PRD without the earlier steps; you'll end up validating assumptions you never stated.

| # | File | Purpose | Time to first draft |
|---|------|---------|---------------------|
| 1 | [`00-problem-hypothesis.md`](00-problem-hypothesis.md) | Your own claim, before any research — what's broken, who else might have it, why now | 30–60 min |
| 2 | [`01-lean-canvas.md`](01-lean-canvas.md) | Turn the hypothesis into 9 falsifiable claims on one page | 45 min |
| 3 | [`02-stakeholder-map.md`](02-stakeholder-map.md) | Who has a say, who's affected, who needs to be kept informed | 20 min |
| 4 | [`03-customer-interviews/`](03-customer-interviews/) | Test the riskiest Lean Canvas boxes against real people outside ragTech | 1–2 weeks (5–8 interviews) |
| 5 | [`04-journey-map.md`](04-journey-map.md) | Map a target customer's current workflow, pain-annotated, using interview findings + our own dogfooding | after interviews |
| 6 | [`05-personas.md`](05-personas.md) | 1–2 lightweight personas distilled from interview clusters | after interviews |
| 7 | [`06-opportunities/`](06-opportunities/) | One doc per opportunity surfaced above — the direct bridge to epics/issues in the new repo | ongoing |

## What "done" looks like at each phase

### Phase 1 — internal dogfooding (current phase)

The tool stays internal; what we sell externally is the editing service, not the app. Engineering issues can begin once:

- Opportunity docs exist in `06-opportunities/` for each area of work, with evidence explicitly labeled (internal dogfooding, RFC analysis, or financial modeling — not just "we find this annoying").
- Each opportunity doc links to the RFC section or product doc that grounds it — if that link doesn't exist, it's a hypothesis without a paper trail, not a ready opportunity.
- The journey map (`04-journey-map.md`) is filled in from ragTech's own pipeline experience, with pain points tied to observed time costs or named failure modes.

Interviews and external validation are **not** a gate for Phase 1. The studio-rental partnership (Lean Canvas §2, Segment 1) is the one near-term external relationship that matters; it may produce real-usage feedback, but it does not replace the internal dogfooding track.

### Phase 2 — before scaling externally / self-serve product

When we are satisfied with the product internally (multiple videos, multiple brands, stable quality) and want to begin serving external customers directly — not just fulfilling via the studio partner — the following should be true before treating any new opportunity as validated:

- At least 5 interviews with people outside ragTech, synthesized in `03-customer-interviews/synthesis.md`.
- The journey map revised at least once based on real interview findings — not just ragTech's own pipeline.
- Lean Canvas revised at least once based on real interview feedback.
- Each new opportunity doc cites a specific journey-map pain point or interview quote as evidence — if it can't, it stays labeled "hypothesis."
