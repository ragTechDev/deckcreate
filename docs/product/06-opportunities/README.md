# Opportunities

One file per opportunity, named `NN-short-slug.md` (e.g. `01-faster-multicam-render.md`). This is the direct bridge from product discovery to engineering — every opportunity doc here should become one or more epics/issues in the new repo, and every engineering issue in the new repo should be traceable back to one of these.

**Rule: if you can't fill in the Evidence section, it's not ready to become an opportunity doc yet.** Go back to the journey map or interviews first. An opportunity based only on "we personally find this annoying" is a hypothesis, not a validated opportunity — that's fine, just label it as such rather than skipping the step.

## Template (copy into a new file per opportunity)

```markdown
# Opportunity: [short name]

## Problem statement
One or two sentences. What's broken, for whom, framed from the customer's side (not "our renderer is slow" but "editors wait N hours before they can review a cut").

## Evidence
- Journey map stage(s): (link to `../04-journey-map.md` row)
- Interview quotes/findings: (link to specific interview #s in `../03-customer-interviews/synthesis.md`)
- If evidence is currently only "our own dogfooding, not yet validated externally" — say so explicitly.

## Proposed direction
What we think the solution looks like, at a product level (not implementation detail — that's what the engineering issue is for).

## Success metric
How we'd know this opportunity was actually addressed. Tie to a Lean Canvas Key Metric if possible.

## Related RFC / technical context
Link to the relevant section of `docs/rfcs/0001-native-desktop-rewrite.md` if this opportunity has technical implications already scoped there.

## Status
Hypothesis / Validated / In progress / Shipped
```
