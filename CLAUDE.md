# RAG Tech Podcast — Project Context

## Show
**RAG Tech** — biweekly tech podcast. Episodes drop every other week.

## Cohosts
| Name | Role | Image |
|------|------|-------|
| Natasha | Software Engineer | `public/assets/team/natasha.PNG` |
| Saloni | Software Developer | `public/assets/team/saloni.PNG` |
| Victoria | Solutions Engineer | `public/assets/team/victoria.PNG` |

All cohost images have transparent backgrounds.

## Brand
- Config: `public/brand.json` (colors, typography, logo, shape radius)
- Logo: `public/assets/logo/transparent-bg-logo.png`
- Font: Nunito (variable, loaded via `remotion/loadFonts.ts`)
- Mascot: **Techybara** (capybara) — PNGs in `public/assets/techybara/`

## Platforms
Spotify · YouTube · Apple Podcasts · Instagram · TikTok · LinkedIn — handle `@ragtechdev`

## Key assets
| Asset | Path |
|-------|------|
| Intro/outro music | `public/sounds/intro-outro-music.mp3` |
| Background music | `public/sounds/jazz-cafe-music.mp3` |
| Techybara images | `public/assets/techybara/` |
| Cohost photos | `public/assets/team/` |
| Logo | `public/assets/logo/` |

## Remotion compositions
| ID | Component | Notes |
|----|-----------|-------|
| `ragTechVodcast` | `MyComposition` | Full episode: hooks → intro → main video |
| `PodcastIntro` | `PodcastIntroComposition` | 7 s intro (420 frames @ 60 fps) |

## Pipeline overview
```
[sync]           Audio ↔ video alignment → synced-output.mp4
[transcribe]     Whisper.cpp → token-level timestamps
[diarize]        Speaker turn detection
[assign-speakers] Labels segments with speaker names
[align]          WhisperX forced alignment → populates token.t_end
[edit-transcript] Merges phrases into sentences → transcript.doc.txt
Human edits doc (cuts, corrections, hooks, camera cues)
[merge-doc]      Applies doc edits → transcript.json
[setup-camera]   Face detection + GUI → camera-profiles.json
Remotion         transcript.json + camera-profiles.json → composed video
```

Intermediate files: `public/transcribe/output/`. Synced video: `public/sync/output/`.

## transcript.json key schema
```
meta
  videoSrc?:   string     path relative to /public (overrides composition prop)
  videoSrcs?:  string[]   all angle paths for multi-angle shoots
  videoStart?: number     source seconds — segments before excluded
  videoEnd?:   number     source seconds — segments after excluded
  fps:         60
segments[]
  id, start, end, speaker, text, cut: boolean
  tokens[]:    { t_dtw, t_end?, text, cut }
  cuts[]:      [{ from, to }]  intra-segment ranges to skip
  hook?        hookFrom?, hookTo?  hook clip bounds
  cameraCues[] explicit camera overrides (> CAM directives)
```

`token.t_end` is populated only after forced alignment — enables exact cut boundaries; without it, heuristic biases apply.

## camera-profiles.json key schema
```json
{
  "sourceWidth": 1920, "sourceHeight": 1080,
  "outputWidth": 1920, "outputHeight": 1080,
  "wideViewport": { "cx": 0.5, "cy": 0.5, "w": 1, "h": 1 },
  "angles": {                                   // multi-angle only
    "angle1": { "videoSrc": "sync/output/synced-output-1.mp4",
                "sourceWidth": 1920, "sourceHeight": 1080 },
    "angle2": { "videoSrc": "sync/output/synced-output-2.mp4",
                "sourceWidth": 1920, "sourceHeight": 1080 }
  },
  "speakers": {
    "Natasha": {
      "label": "Natasha",
      "angleName": "angle1",                    // multi-angle only
      "closeupViewport": { "cx": 0.3, "cy": 0.4, "w": 0.35, "h": 0.35 },
      "portraitCx": 0.3
    }
  }
}
```

**Multi-angle rendering**: `CameraPlayer` stacks one `SegmentPlayer` per unique angle video, switches visibility via `opacity` at shot boundaries. Non-active layers are `muted`. All angles share the same jump-cut sections (cuts are audio-driven). See `AGENTS.md` for full architecture.
