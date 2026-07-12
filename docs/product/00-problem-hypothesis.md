# Problem Hypothesis

Write this yourself, fast, before doing any research below. This is your working claim — not yet validated, meant to be challenged by what follows (the canvas, the interviews). Timebox: 30–60 minutes. If you're stuck on a prompt, write "I don't know yet, but I believe X" and move on.

## What's broken today?

*From your own experience building and running ragTech's pipeline — be specific. Not "editing podcasts is hard" but the actual moments that cost you time or made you want to quit. (You already have a technical version of this in `docs/rfcs/0001-native-desktop-rewrite.md` — this should be the human/time-cost version, not the architecture version.)*

- Editing long-form podcasts is a timely process with many repeated elements, especially so for podcasters who are not yet established and have full-time work commitments.
- We are often using free softare like Capcut or Microsoft Clipchamp due to lack of funds, which can be buggy and take up more editing time
- It takes a dedicated half a day at least to do a standard 30min-1H podcast edit, consindering we have to clean audio, sync audio and video, cut between speakers, add intro and name title cards, and outro
- Creating short-form content through clipping for publicity from the long-form takes another day, especially when you want to create enough to distribute and promote across 1-2 weeks
- our ragTech team rotates the task amongst three of us every two weeks per episode, but even then the process is tedious. We want to focus on the content, on engaging with our audience and our products, not just social media marketing and editing.
- We don't have the funds to outsource this, and we also want to retain consistency and quality across edits
- Three of us have different editing styles and tastes, but we want to be consistent throughout and hold ourselves to high standards. However those standards inevitably falter when we don't have time. Before we built the internal prototype, each of us edited with our own software/taste and consistency suffered noticeably; the prototype has already improved this somewhat. Consistency is a problem we want the product to actively solve (e.g. house style/brand rules baked in so output quality doesn't depend on who's editing that cycle) — but it's a lower priority than raw editing speed.
- We have an intermediary prototype that works for our own videos, but it is hacky. Now we want to scale up to editing for other podcasts so this can be a viable business

## Who else likely has this problem?

*Hypothesis, not yet validated. Solo creators? Small teams like yours (2-3 person podcasts)? Agencies editing for multiple clients? Be as specific as you can about who — "podcasters" is too broad to interview against later.*

- Small podcast teams just starting out — small and growing, not yet established. (400-500 followers is a rough observation from podcasters we personally know, not a strict threshold; the defining trait is "small and growing," not a specific follower count.) Split further into: (1) founders who have side businesses and income, and pay podcast studios to edit their videos and create short-form. (2) people with full-time work trying to start a podcast, editing on their own with their own resources and software like Riverside.
- Companies who want to start their own podcasts for marketing and lead generation.
- Both of the above are live/plausible segments for us right now — we haven't picked one over the other, and which we chase first may partly depend on who approaches the podcast studio rental partnership below rather than a deliberate choice we've made ourselves.
- Podcast studio rental companies who want to offer editing services to their own clients (we were reached out by one and are in the midst of securing the partnership). The shape of this partnership: they route editing work to us as a subcontractor — we do not expect them to operate our tool themselves; we (ragTech) use it internally to fulfill the work.

## Why now?

*What's changed that makes this worth building now rather than 2 years ago, or worth someone switching tools for now?*

- Content creation has become more accessible, including podcast creation, due to social media and editing tools
- More companies are using podcasts for marketing and lead generation
- podcast rental studios are becoming more popular and automated (https://www.thelfgpod.com/), as well as affordable, but editing services for long-form are still largely manual and require expertise. Poddster for example, charges ~$200+ for a full episode edit, and another $200+ for 3 shortform clips from there.
- AI is being used for video editing increasingly, but commercial/cloud AI models are expensive per-token and carry real ethical/sustainability costs. ragTech is branded around being responsible technologists — building on local, efficient AI models (transcription, diarization, etc. running on-device rather than through cloud APIs) gives us a legitimate, concrete cost and sustainability advantage over AI-heavy competitors, not just a philosophical stance.

## What does success look like in 12 months?

*Concrete, not aspirational. E.g. "ragTech renders episodes in under 1 hour instead of 8" and/or "10 other podcast teams are using this weekly."*

- ragTech renders episodes in under 1 hour instead of 8
- ragTech operates as a **service business powered by internal tooling** — we are editing for 10 other podcast teams weekly, delivered as subcontracted/outsourced editing work (e.g. via the studio-rental partnership), not as a self-serve product those teams operate themselves.
- Beyond 12 months (not a year-1 commitment): if the service model validates real demand and pricing, we want the option to evolve toward a self-serve product other teams operate directly. The service business is how we keep improving the product with real usage while we figure out if/when that transition makes sense.

## Explicit non-goals

*What are you deliberately NOT trying to solve, at least for v1? (E.g. not a general-purpose NLE, not competing with Premiere/Resolve, not supporting every camera format.) This matters more than it seems — scope creep here becomes scope creep in the engineering RFC.*

- Not solving for generic video-editing — scoped to podcast-style content: single-host/interview formats and multi-camera/multi-speaker conversational shows. In scope: both the long-form episode edit AND repurposed derivatives from that same source footage (short-form clips, marketing cuts) — this is not long-form-only, it explicitly includes content repurposing/marketing use cases.
- Not GA'ing the *software* to self-serve external users this year — the tool stays internal, operated only by our team. What we sell externally in year one is the editing *service* (subcontracted work, e.g. via the studio-rental partnership), not the app itself. A self-serve product other teams operate directly is a possible future direction (see 12-month success metric above), not a v1 goal.
