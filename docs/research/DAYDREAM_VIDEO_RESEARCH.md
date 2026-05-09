# Daydream Video — Research Reference

> Written: 2026-05-08. Closed-source product; all detail is inferred from the landing page. No need to re-visit source URLs.
>
> **Note:** The GitHub org `daydreamlive` belongs to the separate open-source product *Daydream Scope* — see [DAYDREAM_SCOPE_RESEARCH.md](DAYDREAM_SCOPE_RESEARCH.md). The two share the Daydream brand but are architecturally unrelated.

---

## What It Does

Daydream Video is an AI-native post-production video editor that operates as an **MCP (Model Context Protocol) server**, allowing AI agents (Claude Code, ChatGPT, Codex, Cursor) to control editing operations programmatically. It also has its own native chat interface.

**Core user-facing features:**
- **Transcript-based editing**: Cut bad takes, filler words, and silences by editing the transcript. AI can do this automatically on instruction.
- **Natural language editing**: Trim clips, add b-roll, generate graphics by describing what you want.
- **Timeline editing with contextual precision**: AI understands artistic intent, not just mechanical cuts.
- **Export to professional tools**: MP4, Final Cut Pro, DaVinci Resolve, Premiere Pro.
- **Platform optimization**: Output formatted for TikTok, YouTube, Instagram.
- **Local-first privacy**: All video stays on-device, never uploaded to cloud.
- **No watermarks.**

---

## Pricing

| Plan | Price | Processing | Transcription | MCP calls |
|------|-------|------------|---------------|-----------|
| Free | $0/mo | 1 hr/mo | 1 hr/mo | 100/mo |
| Pro | $16/mo (annual) | 20 hrs/mo | 10 hrs/mo | 1M/mo |
| Business | Custom | Extended | Extended | Extended |

---

## Tech Stack (Inferred — closed-source)

- Runs as a local MCP server (Model Context Protocol)
- Desktop app (local-first, no cloud video upload)
- Exports to FCPXML, XML, MP4
- Integrates with AI agent interfaces via MCP stdio or local socket
- Team: ex-Cisco, Meta, Workday, Twitch, Amazon, The Athletic

---

## Architecture Pattern

Daydream Video exposes its editing capabilities as MCP tools. An AI agent running in Claude Code (or similar) calls these tools to perform editing operations. The video never leaves the local machine — the MCP server runs locally and AI agents interact with it via stdio or local socket.

This is the same MCP-as-primary-agent-interface pattern used by Daydream Scope (open-source). See [DAYDREAM_SCOPE_RESEARCH.md § MCP Server](DAYDREAM_SCOPE_RESEARCH.md) for a fully inspectable implementation of that pattern.

---

## Relevance to deckcreate Refactor

- **MCP as primary agent interface**: Exposing transcript edits, cut operations, and render triggers as MCP tools would enable AI-driven editing in deckcreate, mirroring how Daydream Video works.
- **Transcript-based editing as first-class UX**: Daydream Video treats the transcript as the primary editing surface, not the timeline. deckcreate's existing transcript pipeline already has this foundation.
- **Local-first**: No cloud video upload is a strong user trust signal; deckcreate's current architecture already matches this.

---

## Source

- [https://www.daydreamvideo.com/](https://www.daydreamvideo.com/) — landing page
