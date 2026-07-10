# Customer Interviews

Goal: test the riskiest assumptions in `01-lean-canvas.md` against people **outside ragTech**. You already know your own pain intimately — the open question is whether it generalizes, to whom, and whether it's painful enough that someone would switch tools or pay.

## Who to recruit

Pull from the Lean Canvas's "Early adopters" box. Aim for 5-8 people across your target segment(s) for a first round — enough to spot patterns, not so many you're stalling on research instead of building. Prioritize people who currently do multi-camera/multi-speaker video editing (other podcasters, video-first creators, small content teams) over people who don't edit video at all.

## How to run it (Mom Test style)

The #1 failure mode is asking questions that let people be polite instead of honest. Ground rules:

- Ask about **specific past behavior**, not hypotheticals. "Walk me through the last time you edited an episode" beats "would you use a tool that does X?"
- Don't pitch the product during the interview. You're gathering evidence, not selling.
- Follow the pain, not your solution. If they don't bring up something close to your hypothesized problem unprompted, that's a real signal — don't lead them to it.
- Ask about money/switching concretely: "What do you currently pay for editing (tool, freelancer, your own time)?" / "What would have to be true for you to switch from what you use today?"

## Starter question list

*Adapt per segment, but keep the shape — concrete and past-tense.*

1. Walk me through the last time you produced an episode/video, start to finish. Where did the time actually go?
2. What was the most annoying or frustrating part of that process?
3. What tools do you currently use for editing/production? What do you like and dislike about each?
4. Have you tried to fix or work around [the specific pain you're probing]? What did you try? Did it work?
5. What do you currently pay for tools, freelance editing, or your own time on this — roughly?
6. Who else on your team is involved in this workflow, and where does it get handed off?
7. If you could wave a magic wand and fix one thing about this process, what would it be? *(Ask this last — it's the closest thing to a leading question on this list.)*

## Logistics

- Record with permission; store raw recordings/transcripts outside git if they contain identifying info (see `.gitignore` note below).
- Transcribe (even roughly) within a day or two — memory of nuance fades fast.
- After each interview, spend 10 minutes writing 3-5 bullet takeaways in `synthesis.md` before moving to the next one. Don't batch this to the end.

## Files in this folder

- `transcripts/` — raw or lightly-cleaned transcripts. **Redact/anonymize before committing** if names or company details are sensitive; consider keeping raw audio out of git entirely (see the repo's `.gitignore` conventions for runtime/generated artifacts).
- `synthesis.md` — the living summary: recurring themes, direct quotes worth keeping, surprises, and anything that contradicts the Lean Canvas.
