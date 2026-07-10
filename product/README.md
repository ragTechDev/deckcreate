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

## What "done" looks like before writing the first engineering issue in the new repo

- Lean Canvas has been revised at least once based on real interview feedback (not just your own assumptions).
- At least 5 interviews with people outside ragTech, synthesized (not just raw transcripts sitting unread).
- A journey map that names specific pain points with evidence (a quote, a timing observation), not just "editing is slow."
- Each opportunity doc traces back to a specific journey-map pain point or interview finding — if you can't point to the evidence, it's not ready to become an epic yet.
