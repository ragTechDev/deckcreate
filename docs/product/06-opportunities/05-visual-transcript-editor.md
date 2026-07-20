# Opportunity: Visual transcript editor

## Problem statement

The current editing interface is a plain text file (`transcript.doc.txt`) with a custom cue syntax edited in a code editor. This is not intuitive for timing-sensitive or visual decisions — the editor cannot see the video while placing cuts, cannot verify a cut boundary without rendering, and must write timing estimates as raw numbers rather than placing them on a visual timeline. The gap between "editing the text" and "seeing the result" is the dominant source of trial-and-error in the current workflow.

## Evidence

- **Internal dogfooding:** Transcript editing currently happens in a VSCode extension (`vscode-transcript-language/src/extension.js`) that provides syntax highlighting for the cue format but no video preview, no waveform, and no playback. Cut decisions are made by reading the text, not by watching the moment.
- **Internal dogfooding:** Hook clip boundaries (`hookFrom?/hookTo?`) require manually typing float timestamps estimated from memory — not from scrubbing to the frame. This is the direct consequence of having no visual editor synced with the transcript; see [Opportunity 04 — timing accuracy](./04-transcript-timing-accuracy.md) for the alignment-side complement to this problem.
- **Internal dogfooding:** The cue syntax itself (curly braces for word cuts, `> SPEAKER` splits, `> CAM` directives, `> HOOK` annotations) is expressive but not discoverable. New team members need to read the format documentation to use it; there's no visual affordance showing which words are cut, which segments are camera-switched, or where hooks begin and end.
- Root `CLAUDE.md` Phase 8 plan: `app/editor/page.tsx` (transcript editor) and `app/editor/Timeline.tsx` (630-line timeline component) are already identified as requiring a `PreviewPlayer`, scroll-sync, waveform, and decomposition — the existing Next.js codebase already reached this conclusion, it just hasn't been built yet.

## Proposed direction

A visual transcript editor where the text representation and the video/timeline representation stay in sync — editing either one updates the other. Specifically:

- **Waveform + playhead** synced to the transcript text: clicking a word in the transcript scrubs the video to that word's timestamp; moving the playhead in the timeline highlights the corresponding word in the transcript.
- **Visual cut placement:** dragging a cut boundary on the timeline updates `t_dtw`/`t_end` in the underlying transcript; the text representation reflects the cut without requiring the editor to type a float.
- **In-context preview:** the edited cut plays back immediately in the editor without a full render — the same compositor used for final render (RFC Decision §2) drives the preview, so what you see in the editor is what renders.
- The cue syntax (curly braces, directives) becomes the *persistence format*, not the *editing interface* — power users can still edit the text directly, but the visual layer is the primary interaction for timing-sensitive decisions.

This is one of the motivations for the egui + wgpu native GUI in RFC Decision §2, which explicitly calls out the timeline/waveform editor as a natural fit for egui's immediate-mode model and notes the paradigm carries over from the existing Next.js canvas timeline.

## Success metric

- An editor can place a cut boundary to within 1 frame (≤16ms at 60fps) by scrubbing visually — no float estimation required.
- An editor can complete a hook clip boundary (`hookFrom`/`hookTo`) by setting in/out points on the timeline rather than writing numbers in the doc.
- The in-editor preview matches the final render output for the same segment — no "looked fine in preview, broken in render" class of bug.
- A new team member can make a basic cut (mark a word range, preview it, approve it) without reading the cue syntax documentation.

## Related RFC / technical context

- [RFC §Decision #2](../rfcs/0001-native-desktop-rewrite.md) — Native GUI (egui + wgpu); one compositor library shared by preview surface and final-render encoder. The "preview matches render" guarantee is structural, not incidental.
- RFC §Decision #2 — "egui's immediate-mode painting model is a good fit for a timeline/waveform editor specifically, since per-frame redraw of playheads, waveforms, and clip lanes is the natural way that kind of UI already worked in the existing custom-canvas Next.js timeline editor."
- RFC §Build Order Step 4 — Native GUI built after the compositor API is stable (Step 1), so the editor isn't chasing a moving target.
- Root `CLAUDE.md` Phase 8 — `app/editor/page.tsx`, `app/editor/Timeline.tsx` — existing Next.js editor identified for PreviewPlayer + scroll-sync + waveform; this opportunity supersedes that plan in the new codebase.
- Root `CLAUDE.md` — `vscode-transcript-language/src/extension.js` — the current editing surface being replaced.

## Status

Validated — internal dogfooding. The pain (blind text-based cuts, float estimation for hook timings, no in-context preview) is directly observed in every episode edit. Priority: P2 — depends on the render/compositor engine (RFC Build Order Step 1) being stable before the GUI is built on top of it.
