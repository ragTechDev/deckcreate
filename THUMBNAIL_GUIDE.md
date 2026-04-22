# RAG Tech Podcast Thumbnail Guide

## RAG Tech Podcast Thumbnail Rules

### Required elements (exactly 3)
1. Hook text — ≤4 words from `hookPhrase` in `transcript.json`; Nunito Black; large
2. Speaker cutout(s) — extracted from episode video, expression-scored, background removed
3. Terminal window panel — dark (#1e1e1e), hook text displayed as terminal output line

### Text
- Source priority: Tier 1 = `hookPhrase` from hook segment; Tier 2 = first hook segment `text`; Tier 3 = `meta.title`
- Truncate to 4 words; strip trailing `,;` from last word; preserve `?!`
- Display inside terminal body as: `> "hook text here"`
- Font: Nunito Black (weight 900); no thin/script fonts
- NO logo, NO emoji, NO title duplication

### Faces (episode-specific — NOT static team assets)
- Extract frames from video during hook/active speaker segments
- Score with MediaPipe FaceMesh: open mouth (MAR) + wide eyes (EAR) + eyebrow raise
- Remove background with `rembg`; crop using `closeupViewport` from camera-profiles.json
- Cutouts saved to: `public/transcribe/output/thumbnail/{speaker_lower}_cutout.png`

### Colors
- Terminal panel bg: `#1e1e1e`; title bar: `#252526`; border: `{secondary}40`
- Traffic lights: `#FF5F57` / `#FEBC2E` / `#28C840`
- Hook text inside terminal: brand primary (`#eebf89`), weight 900
- Speaker name badges: per-cohost nameBg (orange/teal/peach — see COHOSTS in PodcastIntro.tsx)
- Background floats: brand palette blobs (reuse FLOATS from PodcastIntro.tsx)

### Avoid
- Lower-right 180×50px zone (YouTube timestamp) — keep clear
- Static `public/assets/team/*.PNG` — use extracted episode cutouts
- Identical layout every episode — rotate `left`/`right`/`center` variants
- Logo on thumbnail

---

## General Best Practices

### Core Formula
Theory (80%) matters more than design (20%). People click on videos they want to watch, not on pretty thumbnails.
- Theory = curiosity gap, FOMO, emotion, value communication
- Design = technical execution of the above

### Visual Hierarchy
Rank elements by importance:
1. Get attention
2. Appeal to interest
3. Hook with curiosity

### Elements
- **3 Element Rule**: Keep to 3 or fewer elements. Up to 5 only in rare cases.
- **No channel logo**: It's clutter. Your logo already appears next to the video title.
- **Remove busy backgrounds**: Cutout/mask foreground elements; blur or darken distracting backgrounds.

### Text
- **Quantity**: 4 words maximum
- **Colors**: Black or white; yellow only if you understand color theory
- **Visibility**: Use outlines or place over high-contrast background
- **Size**: Large — readable at thumbnail size
- **Font**: Sans-serif, bold/thick/block style; no script or thin fonts
- **Don't duplicate title**: Use different words or remove text entirely

### Curiosity Gap
Best thumbnails tease just enough to create FOMO:
- Tease / create curiosity
- Communicate value
- Trigger emotion
- Show a pain point
- State end goal
- Before/After
- Benefits over features: "Productivity App Review" → "Get 3 Extra Hours a Day"
- Pixel-blur an element to provoke curiosity

### Faces
- Use faces with genuine emotion whenever possible
- Emotions: happiness, sadness, surprise, fear, disgust, anger
- Look to camera — eyes connect with potential viewer
- Use close-ups
- **Rule of Thirds**: Keep eyes on upper ⅓ horizontal line
- "YouTube face" (open mouth, whites of eyes, exaggerated emotion) still outperforms neutral

### Symbols
- Arrows: direct attention to curiosity-provoking area
- Red ✗ / Green ✔: comparison thumbnails perform well
- Circles: alternative to arrows for "look here"
- Punctuation `!` `?`: evoke emotion and create curiosity
- **No emojis**: feels amateur, doesn't improve CTR

### Quality
- Use clear, high-resolution images
- Ask: would this be mistaken for a large YouTuber's thumbnail?
- Low-effort thumbnails signal low-quality video — viewers skip

### Sizing
- **16:9 ratio, 1280×720** — YouTube's recommended size; resize yourself rather than letting YouTube scale it
- File size: < 2MB

---

## Layout & Composition

### No Man's Land
- **Avoid lower-right corner**: YouTube timestamp covers it — nothing important here
- **Avoid right edge**: Some overlay buttons appear there (lesser priority than lower-right)

### Composition Rules
- **Don't waste space**: Make the interesting element the focus; no empty gaps that dilute impact
- **Overlap elements**: Let elements overlap or bleed off edges — creates depth and fills space
- **Avoid edge magnetism**: Don't place elements so their edges just barely touch the frame
- **Text behind subject**: Placing text partially behind a subject looks modern but only works with high contrast
- **Rule of Thirds**: Place key elements at third-line intersections

### Background
- **Bokeh/blur**: Blur or darken background to make foreground pop
- **White backgrounds**: Minimalist white can work when done well; avoid when everything uses it
- **Avoid solid colors alone**: Solid color backgrounds look amateur; use gradients, stock images, or patterns
- **Soft border**: Subtle vignette border helps thumbnail stand out against YouTube's background — don't let it crowd elements

### Shrink / Blink / 6-Foot Test
Can you read and understand the thumbnail at mobile/small size on first glance?
- Run the blink test on someone who hasn't seen it
- Ask them what they think the video is about

---

## Color

### Rules
- **Complementary colors**: Use colors opposite each other on the color wheel
- **Bright and saturated**: Higher saturation wins more clicks
- **High contrast**: Elements over contrasting light/dark backgrounds; add glow or outline to make elements pop
- **Stroke/Outline**: Hard-edged outlines make elements pop; use glows/drop-shadows sparingly
- **Avoid hard-line borders around the full edge**: Looks bad with YouTube's rounded-corner thumbnails

---

## Branding

### Style Consistency Without Templates
- The general look and feel (or your face) is the brand — not a logo
- **Avoid nearly identical thumbnails**: Videos using the same PowerPoint-style template with small changes look like reruns — subscribers think they've already seen the video
- Podcasts and livestreams are especially prone to this trap

---

## Clickbait

- **Good clickbait**: Accurately portrays the video, sets expectations, creates curiosity
- **Bad clickbait**: Deceptive — mismatched expectations cause high video abandonment

---

## Screenshots / Frame Grabs
- Well-composed photos work for vlogs — feel authentic, set expectations
- Add light contrast and saturation in post-processing
- Apply composition principles: visual hierarchy, rule of thirds, shallow depth, limited clutter

---

## Workflow

### Invest Time
- Create multiple versions
- Use YouTube's A/B/C thumbnail tester
- Check CTR early and adjust

### Plan Before Shooting
- Mr. Beast and top creators create thumbnails before the video
- Write and shoot the video to deliver on thumbnail expectations

### Work in Tandem with Title and Intro
- Thumbnail → Title → Video Intro should build on each other, not repeat
- Don't start the video with "Today I'm going to show you how to X" when the title says "How to X"
- Build curiosity from thumbnail → title → hook intro

### Find Inspiration
- Research competitors covering the same topic
- Screenshot YouTube and paste your thumbnail next to competitors — would viewers click yours?

---

## Faces — Reference
See examples at: https://imgur.com/gallery/100-great-youtube-thumbnail-examples-how-to-make-good-thumbnails-3Z1bbzm (click "Load More Images" to see all 100+)

## Color Tool
https://color.adobe.com/create/color-wheel

## Further Learning
Search: "Gumroad Jay Alto How To Make Effective Thumbnails" — 9-part framework
Search: "Veritasium clickbait effectiveness" — theory on why good clickbait works
Search: "Mr Beast thumbnails interview" and "Ryan Trahan thumbnails interview" — creator insights
