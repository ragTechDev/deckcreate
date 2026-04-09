# RAG Tech Podcast — Project Context

## Show
**RAG Tech** is a biweekly tech podcast that explores real-life topics in tech. New episodes drop every other week.

## Cohosts
| Name | Role | Image path |
|------|------|------------|
| Natasha | Software Engineer | `public/assets/team/natasha.PNG` |
| Saloni | Software Developer | `public/assets/team/saloni.PNG` |
| Victoria | Solutions Engineer | `public/assets/team/victoria.PNG` |

All cohost images have transparent backgrounds.

## Mascot
**Techybara** — a capybara mascot. Individual PNGs live in `public/assets/techybara/`.

## Brand
Brand config: `public/brand.json` (colors, typography, logo, shape radius).
Logo: `public/assets/logo/transparent-bg-logo.png`
Font: Nunito (variable, loaded via `remotion/loadFonts.ts`)

## Platforms
- **Audio/Video:** Spotify, YouTube, Apple Podcasts
- **Social:** Instagram, TikTok, LinkedIn
- **Handle:** `@ragtechdev` (same on all platforms)

## Tone
Fun and accessible — tech content that doesn't take itself too seriously.

## Key assets
| Asset | Path |
|-------|------|
| Intro/outro music | `public/sounds/intro-outro-music.mp3` |
| Background music (main) | `public/sounds/jazz-cafe-music.mp3` |
| Techybara images | `public/assets/techybara/` |
| Cohost photos | `public/assets/team/` |
| Logo | `public/assets/logo/` |

## Remotion compositions
| ID | Component | Notes |
|----|-----------|-------|
| `ragTechVodcast` | `MyComposition` | Full episode (hooks → intro → main video) |
| `PodcastIntro` | `PodcastIntroComposition` | Standalone 7 s intro (420 frames @ 60 fps) |

## Video pipeline overview
1. **Hooks** — selected transcript segments play first as teasers, with karaoke captions and the Techybara mascot overlay (`HookOverlay`).
2. **Intro** — `PodcastIntro` plays between hooks and the main episode content.
3. **Main episode** — full edited recording with optional camera punch-ins (`CameraPlayer`).

Forced alignment (`npm run align`) populates `token.t_end` (word-end boundary) alongside `token.t_dtw` (word start), enabling exact cut boundaries when words are marked for removal. Without it, cut boundaries fall back to heuristic bias constants. See `AGENTS.md` for full architecture details.

Transcript editing scripts live in `scripts/`. Transcription pipeline is in `scripts/transcribe/`.
