# Render Instructions

Rendering a full episode at 60 fps takes 20–90 minutes depending on machine. Prevent your machine from sleeping during the render and optionally split the render across multiple terminals to speed it up.

---

## Prevent sleep during render

### macOS — caffeinate

Wrap the render command with `caffeinate`:

```sh
caffeinate -dims npm run render:episode -- --overwrite
caffeinate -dims npm run render:hook-intro -- --overwrite
```

Flags:
- `-d` — prevent display sleep
- `-i` — prevent system idle sleep
- `-m` — prevent disk sleep
- `-s` — prevent sleep when on AC power

`caffeinate` exits automatically when the render command finishes.

### Windows — PowerShell keep-awake

Open a **second** PowerShell window and run this before starting the render in your main terminal. It holds the execution state until you Ctrl-C it.

```powershell
# Run in a separate PowerShell window; Ctrl-C to release when render finishes
Add-Type -TypeDefinition '
  using System;
  using System.Runtime.InteropServices;
  public class Sleep {
    [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);
  }
'
[Sleep]::SetThreadExecutionState(0x80000003)  # CONTINUOUS | SYSTEM_REQUIRED | DISPLAY_REQUIRED
Write-Host "System sleep blocked. Ctrl-C to release."
while ($true) { Start-Sleep 60 }
```

Then start your render in the main terminal as normal:

```cmd
npm run render:episode -- --overwrite
```

When the render finishes, Ctrl-C the PowerShell window to restore normal sleep behaviour.

> **Alternative:** install [Caffeine for Windows](https://www.zhornsoftware.co.uk/caffeine/) and toggle it on before rendering.

---

## Resumable render with WARP detection

If you have Cloudflare WARP installed, it can auto-connect mid-render and kill it. `render:episode:resume` handles this automatically: it renders in chunks, detects WARP turning on, kills the current chunk immediately (instead of waiting for the 5-minute timeout), and waits for you to disable WARP before retrying. Completed chunks are saved to disk, so the render also survives machine restarts.

```sh
caffeinate -dims npm run render:episode:resume
```

Progress is tracked in `public/renders/.chunks/progress.json`. If the render is interrupted for any reason, just re-run the same command — it skips already-completed chunks automatically.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--chunk-size <n>` | `20000` | Frames per chunk (~5.5 min of output @ 60 fps) |
| `--total-frames <n>` | auto-detected | Skip the compositions query and use this value directly |
| `--warp` | — | Enable WARP monitoring without prompting |
| `--no-warp` | — | Disable WARP monitoring without prompting |
| `--reset` | — | Discard saved progress and start fresh |

All other flags (`--transcript`, `--out`, `--timeout`, etc.) work the same as `render:episode`.

On first run the script checks whether `warp-cli` is installed. If found, it prompts once: `Enable WARP monitoring? [y/N]`. The answer is saved in the progress file so resuming never re-prompts. On machines without `warp-cli` the prompt is skipped silently and chunk rendering still runs for resilience against other network issues.

### When WARP turns on mid-render

The script polls `warp-cli` every 5 seconds. When WARP connects:

1. The current chunk render is killed immediately
2. The terminal prints: `Disable WARP and rendering will continue automatically.`
3. Once you turn WARP off via the menu bar, the script detects it and resumes within ~7 seconds — no manual restart needed

> **Note:** Use the menu bar toggle to *disconnect* WARP (not just pause it). The GUI pause leaves the status as `Disconnected / Reason: Paused`, which the script correctly reads as inactive.

---

## Split render across multiple terminals

Use the `--frames` flag to divide the work. Each terminal renders a non-overlapping range and writes to a separate file; you then stitch them together with ffmpeg.

### 1 — Find total frame count

Run the render with `--help` to see the frame count printed by the script, or check the Remotion Studio:

```sh
npm run remotion:studio
# Open composition → note duration in frames
```

Alternatively, run a quick calculateMetadata call via Remotion CLI:

```sh
npx remotion compositions remotion/index.ts
```

The total frame count for a typical 1-hour episode at 60 fps is ~216 000 frames.

### 2 — Divide into N parts

With **3 terminals** splitting 0–215999 evenly:

| Terminal | `--frames` | Output file |
|----------|-----------|-------------|
| A | `0-71999` | `episode-part-0.mp4` |
| B | `72000-143999` | `episode-part-1.mp4` |
| C | `144000-215999` | `episode-part-2.mp4` |

### 3 — Render each part

Run each in its own terminal (add `caffeinate -dims` on macOS):

```sh
# Terminal A
caffeinate -dims npm run render:episode -- \
  --frames 0-71999 \
  --out public/renders/episode-part-0.mp4 \
  --overwrite

# Terminal B
caffeinate -dims npm run render:episode -- \
  --frames 72000-143999 \
  --out public/renders/episode-part-1.mp4 \
  --overwrite

# Terminal C
caffeinate -dims npm run render:episode -- \
  --frames 144000-215999 \
  --out public/renders/episode-part-2.mp4 \
  --overwrite
```

On **Windows** (no `caffeinate`; use the PowerShell block above in a separate window):

```cmd
npm run render:episode -- --frames 0-71999 --out public/renders/episode-part-0.mp4 --overwrite
```

### 4 — Stitch parts together

Create a concat list file, then run ffmpeg:

```sh
# Create concat list
cat > /tmp/parts.txt << 'EOF'
file 'public/renders/episode-part-0.mp4'
file 'public/renders/episode-part-1.mp4'
file 'public/renders/episode-part-2.mp4'
EOF

# Stitch — stream-copy (no re-encode), fast
ffmpeg -f concat -safe 0 -i /tmp/parts.txt -c copy public/renders/episode.mp4
```

On **Windows** (PowerShell):

```powershell
@"
file 'public/renders/episode-part-0.mp4'
file 'public/renders/episode-part-1.mp4'
file 'public/renders/episode-part-2.mp4'
"@ | Set-Content -Path "$env:TEMP\parts.txt"

ffmpeg -f concat -safe 0 -i "$env:TEMP\parts.txt" -c copy public/renders/episode.mp4
```

### Tips

- Each terminal uses its own CPU cores. Reduce `--concurrency` if the machine is also being used for other work (default is half the logical cores).
- Parts must be rendered from the **same transcript and camera-profiles**. Rendering the same composition props guarantees seamless splices.
- Remotion renders frames independently — there are no cross-frame dependencies, so any split point is valid.
- The hook+intro render (`render:hook-intro`) is short enough that splitting is rarely needed.
