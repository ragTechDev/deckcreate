# Customer Journey Map

Build this from ragTech's own pipeline experience first — the technical stages are already documented in `docs/rfcs/0001-native-desktop-rewrite.md` and the root `CLAUDE.md`, and the time costs and failure modes are directly observed. Label each pain point's evidence source honestly (internal dogfooding, RFC analysis, financial modeling). When external interviews happen (Phase 2 per `README.md`), revise the relevant rows and update the evidence trail — don't wait to fill this in.

Map one representative persona/segment at a time — if you have multiple segments with meaningfully different workflows (e.g. ragTech operator vs. external solo creator), do a separate map for each rather than averaging them into a mushy composite.

## Persona / segment for this map

**ragTech Operator** — engineer-editor rotating through the pipeline biweekly. See [`05-personas.md` Persona 1](05-personas.md).

*A second map for an external client operator (someone outside the ragTech team using the tool to edit their own podcast) should be created once the studio-rental partnership produces real usage — do not fabricate it from assumptions.*

## Stages

*Stages reflect ragTech's actual pipeline as of 2026-07. Short-form clip creation is a separate stage (not part of the scaffolded template) because it is a full additional pipeline pass, not a publish-side step. Evidence source for all rows: internal dogfooding unless noted otherwise.*

| Stage | What they're doing | What they're thinking/feeling | Pain points (with evidence) | Time cost | Opportunity |
|-------|----------------------|----------------------------------|-------------------------------|-----------|--------------|
| Record | Recording the episode across 3 camera angles + separate audio source | "Did the cameras all start at roughly the same time? Was audio clean?" | Sync issues are only discovered post-recording — no way to know during the session if an angle will be unusable | Low; not a pipeline step we control | — |
| Sync | Running FFT cross-correlation (`scripts/sync/AudioSyncer.js`) to align camera angles to audio; verifying `synced-output-{N}.mp4` files by spot-checking | "Did it actually sync, or is there a drift I'll only notice mid-edit?" | No automated quality signal for sync accuracy — verification is manual spot-checking; silent failure (drift present but not obvious until a cut looks wrong) produces errors that are expensive to debug later. Hardware inconsistency: `AudioSyncer.js` branches on platform for encoder but downstream scripts hardcode `libx264` regardless. | ~15–30 min automated + manual spot-check | [Opportunity 02](06-opportunities/02-hardware-inconsistency.md) |
| Transcribe | Running whisper.cpp via subprocess; waiting for transcript.raw.json | "How many timing errors will I have to correct this time?" | Token start/end timestamps (`t_dtw`, `t_end`) are not frame-accurate; `t_end` only populated after forced alignment, so `deriveCuts` falls back to `CUT_START_BIAS = 1.0` / `WORD_DURATION_ESTIMATE = 0.4s` heuristics as default. Accuracy determines how much downstream manual correction is needed. | ~10–30 min depending on episode length and hardware | [Opportunity 04](06-opportunities/04-transcript-timing-accuracy.md) |
| Diarize / label speakers | Running pyannote diarization + WhisperX forced alignment (Python subprocesses); manually assigning speaker names to diarized segments | "Did it split the speaker turns correctly? How many do I need to fix?" | Diarization errors (missed turns, wrong boundaries) require manual correction in the doc; no visual way to verify speaker labels against the video. Forced alignment populates `t_end` but quality is uneven — some tokens still land on wrong frames. | ~20–40 min to verify and correct | [Opportunity 04](06-opportunities/04-transcript-timing-accuracy.md) |
| Edit transcript | Opening `transcript.doc.txt` in VSCode; marking word cuts with `{curly braces}`, adding `> SPEAKER` splits, `> CAM` directives, `> HOOK` annotations; running `merge-doc` to apply edits | "I can't see the video while I'm doing this. I'm guessing whether this cut will sound right." | (1) No video preview while editing — all cut decisions are made by reading text, not watching the moment. (2) Hook clip boundaries (`hookFrom`/`hookTo`) require typing estimated float timestamps, not scrubbing to a frame. (3) Cue syntax is not discoverable — new team members need documentation. (4) No feedback on cut quality until a full render completes. (5) Single-brand only — ragTech assets are hardcoded; client footage cannot be edited with a different brand. | Largest hands-on time block; majority of the "half a day minimum" per `00-problem-hypothesis.md` | [Opportunity 04](06-opportunities/04-transcript-timing-accuracy.md), [Opportunity 05](06-opportunities/05-visual-transcript-editor.md), [Opportunity 06](06-opportunities/06-multi-brand-support.md) |
| Camera / framing setup | Running `setup-camera.js` (face detection via mediapipe); reviewing and adjusting closeup viewports per speaker in the camera GUI (`app/camera/page.tsx`) | "Did face detection crop correctly? I need to check every angle manually." | Face detection requires manual verification for every episode — viewport crops drift when speakers move. Adjustments cannot be previewed against real footage in context; changes are applied and then checked by re-running. | ~30–60 min | [Opportunity 05](06-opportunities/05-visual-transcript-editor.md) |
| Render / export | Triggering Remotion render (headless Chromium); waiting; reviewing output | "I've started the render. I can't use this machine for the next several hours. I hope it doesn't fail." | (1) 6–18 hours for a 60-minute 3-angle episode at 60fps — same-day review is impossible. (2) Silent hardware degradation: Windows/NVIDIA silently falls back to `libx264`; no error, just slower encode and inconsistent output. (3) If output has a bug, fix + re-render adds another 6–18 hours. | 6–18 hours elapsed; ~10 min hands-on | [Opportunity 01](06-opportunities/01-render-speed.md), [Opportunity 02](06-opportunities/02-hardware-inconsistency.md) |
| Short-form clip creation | Separate pipeline pass: running `scripts/shorts/wizard`, selecting clip ranges from long-form transcript, running sync/transcribe/align/edit/render again for portrait format | "This is a whole separate day of work to get 3–5 clips for the week's promotion." | Short-form is not a first-class output of the long-form pipeline — it is a full second pipeline pass with its own transcription, editing, and render cycle. The same render bottleneck (Opportunity 01) applies again. Requires another ~1 full day per `00-problem-hypothesis.md`. | ~1 full additional day | [Opportunity 01](06-opportunities/01-render-speed.md), [Opportunity 03](06-opportunities/03-edit-time-end-to-end.md) |
| Publish / distribute | Uploading long-form to YouTube/Spotify/Apple; short-form to Instagram/TikTok/LinkedIn | "Just need to get this uploaded before the week is out." | Not a pipeline pain point we're solving — out of scope for v1. | Variable | — |

## Biggest pain point overall

**Render time (Opportunity 01) and the transcript editing loop (Opportunities 04 + 05) together.** Render time is the single largest calendar-time cost and the hard blocker on same-day delivery. The transcript editing loop (inaccurate timing → blind text editing → full render to verify) is the largest *hands-on* time cost and the most friction-per-minute of work. They compound: a mis-timed cut discovered post-render means correcting the transcript and waiting another 6–18 hours.

Evidence source: internal dogfooding — directly observed across multiple episode production cycles. Not yet validated externally.

## Evidence trail

All rows: **internal dogfooding** — direct observation from building and operating the ragTech pipeline. No external interview evidence yet (Phase 2, per `README.md`).

Specific supporting sources per row:
- Sync: `scripts/sync/AudioSyncer.js` (platform branching); RFC §Context #3 (hardcoded `libx264` in downstream scripts)
- Transcribe: root `CLAUDE.md` schema note on `t_end`; `WORD_DURATION_ESTIMATE`, `CUT_START_BIAS` constants in `scripts/edit-transcript.js`
- Diarize: root `CLAUDE.md` pipeline diagram; WhisperX forced alignment subprocess
- Edit transcript: direct operator experience; `00-problem-hypothesis.md` "half a day minimum"; `vscode-transcript-language/` as current editing surface
- Camera setup: `app/camera/page.tsx`; `scripts/camera/setup-camera.js`
- Render/export: RFC §Context #1 (2–5fps ceiling, 6–18h for 60-min episode); RFC §Context #2 (Windows/NVIDIA silent fallback)
- Short-form: `00-problem-hypothesis.md` "another full day"; `scripts/shorts/wizard`
