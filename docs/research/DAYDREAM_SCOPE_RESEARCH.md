# Daydream Scope — Research Reference

> Written: 2026-05-08. Open-source; all detail sourced from `github.com/daydreamlive/scope`. No need to re-visit source URLs.
>
> **Note:** Daydream Scope (`daydream.live`) is a separate product from Daydream Video (`daydreamvideo.com`) — they share a brand name but are architecturally unrelated. See [DAYDREAM_VIDEO_RESEARCH.md](DAYDREAM_VIDEO_RESEARCH.md) for the closed-source post-production editor.

---

## What It Does

Daydream Scope transforms live video inputs into AI-generated outputs in real time using autoregressive video diffusion models. Primary use cases: live performance (VJing), immersive installations, music-reactive visuals, AI-assisted live streaming.

**Core user-facing features:**
- Real-time video-to-video and text-to-video generation at interactive framerates
- Node-based visual workflow editor (graph editor)
- LoRA style customization with runtime hot-swapping
- VACE (Video All-in-One Creation and Editing) for reference-image guidance, inpainting, depth/pose control
- Beat-synchronized parameter changes (Ableton Link, MIDI clock)
- Multi-output: Spout (Windows), Syphon (macOS), NDI, WebRTC, MPEG-TS, MP4 recording
- Plugin system for third-party pipeline extensions
- Cloud GPU backend via Livepeer
- OSC control from external tools (TouchDesigner, Resolume, MaxMSP)
- MCP server interface for AI agent control
- Electron desktop app wrapping Python backend + React frontend

---

## Tech Stack

### Backend (Python)

| Category | Library | Version |
|----------|---------|---------|
| HTTP framework | FastAPI | 0.116.1+ |
| ASGI server | uvicorn | 0.35.0+ |
| WebRTC | aiortc | 1.13.0+ |
| Data models | Pydantic | — |
| Deep learning | torch | 2.9.1 |
| Vision | torchvision | 0.24.1 |
| Transformers | transformers | 4.49.0 |
| Diffusers | diffusers | 0.31.0 |
| Training utils | accelerate | 1.1.1 |
| Attention kernel | flash-attn | 2.8.3 |
| Sage attention | sageattention | 2.2.0 |
| Triton kernels | triton | 3.5.1 |
| LoRA | peft | 0.18.1 |
| Quantization | torchao | 0.15.0 |
| Async HTTP | aiohttp | 3.9.0+ |
| WebRTC signaling | Twilio | 9.8.0+ |
| Config | omegaconf | 2.3.0+ |
| Safetensors | safetensors | 0.6.2+ |
| MCP | mcp | 1.0.0+ |
| OSC | python-osc | 1.9.0+ |
| CLI | click | 8.3.1+ |
| Package manager | uv | — |
| Plugin hooks | pluggy | — |
| Video encoding | PyAV | — |
| Kafka telemetry | aiokafka | 0.10.0+ (optional) |
| Ableton Link | aalink | 0.1.1+ (optional) |
| MIDI | mido + python-rtmidi | optional |

Python requirement: ≥3.12

### Frontend (TypeScript/React)

| Category | Library |
|----------|---------|
| Framework | React 19 |
| Build tool | Vite 7.x |
| Styling | Tailwind CSS + Radix UI |
| UI components | Radix primitives |
| Node graph | React Flow |
| Notifications | Sonner |
| HTTP client | Custom `useApi` hook |
| WebRTC client | Custom `useUnifiedWebRTC` hook |

### Desktop (Electron)

| Category | Library |
|----------|---------|
| Electron | 32.2.1 |
| electron-builder | 25.1.8 |
| electron-updater | 6.3.9 |
| electron-log | 5.2.4 |
| Build | Vite (multi-target: main + preload + renderer) |

### Browser SDK (`@daydreamlive/browser`)

| Category | Detail |
|----------|--------|
| Language | TypeScript (100%) |
| Streaming protocol | WebRTC via WHIP (broadcast) + WHEP (playback) |
| Packaging | ES module + CJS dual export |
| Testing | Vitest |
| Bundler | tsup |

---

## Repository Structure

```
daydreamlive/scope
├── src/scope/
│   ├── server/           # FastAPI app + all server logic
│   └── core/             # Pipelines, nodes, plugins, config
├── frontend/src/         # React/TypeScript SPA
│   ├── pages/            # StreamPage.tsx (single-page app)
│   ├── components/       # All UI components
│   │   ├── graph/        # Node graph editor (React Flow)
│   │   └── ...
│   ├── hooks/            # 22 custom React hooks
│   ├── contexts/         # 8 React contexts
│   └── types/
├── app/                  # Electron desktop wrapper
│   └── src/
│       ├── main.ts       # Electron main process
│       ├── preload.ts    # IPC bridge
│       └── renderer.tsx
├── docs/                 # 15+ markdown documentation files
│   ├── architecture/     # pipelines.md, plugins.md, livepeer.md
│   └── ...              # osc.md, vace.md, workflows.md, etc.
├── pyproject.toml        # Python deps (uv)
├── .mcp.json             # MCP server config
├── CLAUDE.md             # Agent instructions
└── Dockerfile / Dockerfile.cloud
```

---

## Architecture

### Layer Model

```
[Desktop App (Electron)]
  ├── main.ts: spawns Python backend on dynamic port
  ├── health polls until backend ready
  └── loads frontend (backend-served SPA)

[Python Backend (FastAPI / uvicorn)]
  ├── REST API (pipeline, WebRTC, OSC, plugins, assets)
  ├── WebRTC sessions (aiortc)
  ├── MCP server (stdio, --mcp flag)
  └── OSC UDP server (port 8000)

[Frame Processing Pipeline]
  FrameProcessor
    ├── SourceManager   → NDI / Syphon / WebRTC input sources
    ├── GraphExecutor   → DAG of pipeline nodes
    │     └── PipelineProcessor (per node)
    │           └── Pipeline.__call__(frame) → tensor THWC
    ├── SinkManager     → Spout / NDI / Syphon / recording fan-out
    └── ParameterScheduler + ModulationEngine → beat-synced param updates

[Frontend (React SPA)]
  StreamPage.tsx
    ├── InputAndControlsPanel  (prompts, parameters)
    ├── VideoOutput            (WebRTC playback via WHEP)
    ├── GraphEditor            (React Flow node graph)
    ├── PromptTimeline         (temporal prompt sequencing)
    ├── SettingsPanel / OutputsPanel
    └── StatusBar / LogPanel

[Browser SDK (@daydreamlive/browser)]
  Broadcast (WHIP) → server ingests video
  Player    (WHEP) → client plays processed video
```

**Import rule (critical):** `scope.server` can import from `scope.core`, but `scope.core` must **never** import from `scope.server`. Enforces one-way dependency.

---

## Pipeline Architecture

### Base Class Pattern

```python
# All pipelines are Nodes (unified post-refactor)
Pipeline = Node  # src/scope/core/pipelines/interface.py

class MyPipeline(Pipeline):
    def get_config_class(self) -> type[BasePipelineConfig]:
        return MyPipelineConfig  # Pydantic model

    def prepare(self) -> Requirements:
        # Declares how many input frames needed before processing
        return Requirements(input_size=4)

    def __call__(self, **kwargs) -> dict:
        # Returns {"video": tensor}  # THWC format, values [0,1]
        ...
```

### BasePipelineConfig Schema

```python
class BasePipelineConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Identity
    pipeline_id: ClassVar[str]
    pipeline_name: ClassVar[str]
    pipeline_description: ClassVar[str]
    estimated_vram_gb: ClassVar[float]

    # Capability flags
    supports_lora: ClassVar[bool]
    supports_vace: ClassVar[bool]
    supports_cache_management: ClassVar[bool]
    supports_quantization: ClassVar[bool]
    produces_video: ClassVar[bool]
    produces_audio: ClassVar[bool]

    # I/O ports
    inputs: ClassVar[list[str]]    # e.g. ["video", "vace_input_frames"]
    outputs: ClassVar[list[str]]   # e.g. ["video"]

    # Modes
    modes: ClassVar[dict[str, ModeDefaults]]

    # Fields (runtime-configurable)
    height: int
    width: int
    base_seed: int = 42
    manage_cache: bool = True
    denoising_steps: list[int] | None
    noise_scale: float  # 0.0–1.0
    lora_merge_strategy: Literal["permanent_merge", "runtime_peft"]
```

### ModeDefaults

```python
class ModeDefaults(BaseModel):
    default: bool = False
    height: int | None = None
    width: int | None = None
    denoising_steps: list[int] | None = None
    noise_scale: float | None = None
    noise_controller: bool | None = None
    input_size: int | None = None
    default_temporal_interpolation_steps: int | None = None
```

### Built-in Pipelines (13 registered)

| Pipeline ID | Description | VRAM | Res |
|-------------|-------------|------|-----|
| `streamdiffusionv2` | StreamDiffusion v2 autoregressive | 20 GB | 512×512 |
| `longlive` | LongLive text/video-to-video | — | 576×320 |
| `krea_realtime_video` | Krea Realtime Video (Wan2.1 14B) | ~55 GB with VACE | 512×512 |
| `reward_forcing` | RewardForcing | — | 576×320 |
| `memflow` | MemFlow optical flow | — | 576×320 |
| `passthrough` | No-op passthrough | minimal | 512×512 |
| `rife` | RIFE frame interpolation | — | — |
| `optical_flow` | Optical flow preprocessor | — | — |
| `video_depth_anything` | Depth estimation | ~1 GB | — |
| `scribble` | Edge/scribble extraction | — | — |
| `gray` | Grayscale conversion | — | — |
| `controller_viz` | Controller visualization | — | — |
| `wan2_1` | Wan2.1 base | — | — |

---

## Graph / Workflow Schema

### GraphConfig (core data structure)

```python
class GraphNode(BaseModel):
    id: str                           # e.g. "input", "yolo_plugin"
    type: Literal["source","pipeline","sink","record","node"]
    pipeline_id: str | None           # Registry key for pipeline nodes
    node_type_id: str | None          # NodeRegistry key for custom nodes
    params: dict                      # Per-node configuration
    # Source-specific
    mode: str | None                  # e.g. "camera", "file", "ndi"
    name: str | None
    flip_vertical: bool
    # Sink-specific
    output_mode: str | None           # "spout", "ndi", "syphon"

class GraphEdge(BaseModel):
    from_node: str
    from_port: str
    to_node: str
    to_port: str
    kind: Literal["stream","parameter"]   # frame queue vs chunk-level data

class GraphConfig(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
```

**Execution model:** Queue-based DAG. Node-to-node connections use `maxsize=1` (backpressure). Pipeline-to-pipeline connections use larger queues. Each sink gets its own independent copy of frames.

### Workflow File Schema (`.scope-workflow.json`)

```json
{
  "format": "scope-workflow",
  "format_version": "1.x",
  "metadata": { ... },
  "pipelines": [ { "pipeline_id": "...", "load_params": {...} } ],
  "timeline": [ ... ],
  "prompts": [ ... ]
}
```

---

## WebRTC Architecture

**Protocol flow:**
1. Frontend fetches ICE server config: `GET /api/v1/webrtc/ice-servers`
2. Frontend creates SDP offer with video/audio transceivers (VP8 codec enforced)
3. POST offer to `POST /api/v1/webrtc/offer` → receives session ID + SDP answer
4. Trickle ICE via `PATCH /api/v1/webrtc/offer/{session_id}`
5. Data channel `"parameters"` handles real-time parameter updates (JSON)
6. Backend signals stop via data channel

**Server-side WebRTC (aiortc):**
```
Browser → WebRTC → VideoProcessingTrack → MediaRelay
                                         ├── WebRTC output (to browser)
                                         ├── RecordingManager (MP4)
                                         └── SinkOutputTrack (Spout/NDI/Syphon)
```

**Cloud relay mode:** `CloudTrack` forwards browser video to Livepeer cloud, receives processed frames, relays back to browser.

**Browser SDK reconnection:**
- Broadcast: exponential backoff (`delay = baseDelay × 2^attempts`)
- Player: 10 fixed retries then exponential, capped at 60s

---

## API Endpoints (FastAPI)

**Base URL:** `http://localhost:8000` (dynamic port when Electron-managed)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serve SPA index.html |
| GET | `/health` | Status, version, git commit, uptime |
| POST | `/api/v1/restart` | Restart server (exits code 42 in managed mode) |
| POST | `/api/v1/pipeline/load` | Load pipeline(s) |
| GET | `/api/v1/pipeline/status` | Pipeline load status |
| GET | `/api/v1/pipelines/schemas` | Legacy pipeline schemas (cached) |
| GET | `/api/v1/nodes/definitions` | Unified node catalog (memoized) |
| GET | `/api/v1/webrtc/ice-servers` | ICE server config |
| POST | `/api/v1/webrtc/offer` | SDP offer → answer + session ID |
| PATCH | `/api/v1/webrtc/offer/{id}` | Trickle ICE candidates |
| GET | `/api/v1/osc/status` | OSC server state |
| GET | `/api/v1/osc/paths` | Active OSC control paths |
| GET | `/api/v1/osc/stream` | SSE stream of OSC commands |
| PUT | `/api/v1/osc/settings` | Update OSC settings |
| GET | `/api/v1/hardware/info` | GPU VRAM, Spout/NDI/Syphon availability |
| GET/POST | `/api/v1/models/status` | Model download status |
| POST | `/api/v1/models/download` | Download pipeline models |
| GET | `/api/v1/assets` | List assets (images/videos) |
| POST | `/api/v1/assets` | Upload asset |
| GET | `/api/v1/lora/list` | List installed LoRAs |
| GET | `/api/v1/tempo/status` | Tempo sync state |
| POST | `/api/v1/tempo/enable` | Enable Ableton Link or MIDI clock |
| GET/POST | `/api/v1/plugins` | List / install plugins |
| DELETE | `/api/v1/plugins/{name}` | Uninstall plugin |
| POST | `/api/v1/plugins/{name}/reload` | Hot-reload editable plugin |
| GET | `/api/v1/stream` | MPEG-TS streaming endpoint |
| GET | `/docs` | Swagger UI |

**Cache invalidation:** Three server-level caches (`_pipeline_schemas_cache`, `_node_definitions_cache`, `_plugins_list_cache`) cleared on plugin install/uninstall/cloud connect.

**Cloud proxy pattern:** Routes decorated with `@cloud_proxy()` automatically redirect to cloud backend URL when a cloud connection is active — zero changes to individual route handlers needed.

---

## MCP Server (AI Agent Interface)

**Config (`.mcp.json`):**
```json
{ "mcpServers": { "scope": { "type": "stdio", "command": "uv", "args": ["run", "daydream-scope", "--mcp"] } } }
```

**All MCP tools (35 total):**

| Category | Tools |
|----------|-------|
| Connection | `connect_to_scope`, `connect_to_cloud`, `disconnect_from_cloud`, `get_cloud_status` |
| Pipelines | `list_pipelines`, `get_pipeline_status`, `load_pipeline`, `get_models_status`, `download_models` |
| Runtime | `update_parameters`, `get_parameters` |
| Sessions | `start_stream`, `stop_stream`, `get_stream_url` |
| Capture | `capture_frame(quality, sink_node_id)`, `get_session_metrics` |
| Recording | `start_recording`, `stop_recording`, `download_recording` |
| Assets | `list_assets` |
| LoRAs | `list_loras`, `install_lora`, `download_lora`, `delete_lora` |
| Plugins | `list_plugins`, `install_plugin`, `uninstall_plugin`, `reload_plugin` |
| System | `get_health`, `get_hardware_info`, `get_logs` |
| Inputs | `list_input_source_types`, `list_input_sources` |
| OSC | `get_osc_status`, `get_osc_paths` |
| Workflow | `resolve_workflow` |
| API keys | `list_api_keys`, `set_api_key`, `delete_api_key` |
| Resources | `current_log_file` (URI: `logs://current`) |

---

## Plugin Architecture

**Plugin discovery:** Python entry points under `[project.entry-points."scope"]` in `pyproject.toml`.

**Hook system:** `pluggy` — plugins implement `@hookimpl` on `register_pipelines(register)` callback.

**Minimum plugin structure:**
```
my-scope-plugin/
├── pyproject.toml          # entry-points."scope" = {"my-plugin": "my_scope_plugin.plugin"}
└── my_scope_plugin/
    ├── plugin.py           # @hookimpl def register_pipelines(register): register(MyPipeline)
    └── pipelines/
        ├── schema.py       # BasePipelineConfig subclass
        └── pipeline.py     # Pipeline subclass with __call__ returning THWC tensor
```

**Lifecycle:**
1. Pre-validation: entry points loaded tentatively; broken ones recorded as `FailedPluginInfo` (never crash server)
2. GPU-aware registration: pipelines with `estimated_vram_gb` exceeding available VRAM are skipped
3. Installation: uv resolves deps against `uv.lock` constraints; rollback on failure
4. Restart protocol: managed mode exits with code 42; Electron respawns; standalone uses `os.execv`

---

## Frontend Architecture

**Single-page app** — one route: `StreamPage.tsx` is the entire app.

**Provider stack (outermost → innermost):**
```
TelemetryProvider
  CloudStatusProvider
    BillingProvider
      PipelinesProvider
        LoRAsProvider
          PluginsProvider
            ServerInfoProvider
              OnboardingProvider
                StreamPage
```

**Main layout sections of StreamPage:**
- `Header` — branding, connection status
- `InputAndControlsPanel` — prompt input, parameter sliders
- `VideoOutput` — WebRTC live preview
- `GraphEditor` — React Flow node graph (27+ node types)
- `PromptTimeline` — horizontal timeline for prompt sequencing
- `SettingsPanel` / `OutputsPanel` — global config, output destinations
- `StatusBar` — FPS, session info
- `LogPanel` — backend log stream (SSE)

**Two rendering modes:**
- **Perform Mode**: Traditional controls panel layout
- **Graph Mode**: Node-based editor replaces pipeline controls (`nonLinearGraph` flag disables pipeline selector and load controls)

### State Hooks (22 total)

| Hook | Purpose |
|------|---------|
| `useUnifiedWebRTC` | WebRTC peer connection, SDP, data channel |
| `usePipeline` | Pipeline loading, status |
| `usePipelines` | All pipeline metadata |
| `useVideoSource` | Camera/file input management |
| `useStreamState` | Persisted user preferences |
| `useTempoSync` | Beat-sync coordination |
| `useTimelinePlayback` | Prompt timeline playback |
| `usePromptManager` | Prompt CRUD |
| `useNodeDefinitions` | Backend node catalog |
| `useApi` | Typed API client |
| `useLoRAFiles` | LoRA list |
| `usePlugins` | Plugin management |
| `useServerInfo` | Backend version/health |
| `useCloudStatus` | Cloud connection |
| `useLogStream` | SSE log tail |
| `useMIDIController` | MIDI device input |
| `useControllerInput` | General controller input |
| `useWebRTCStats` | FPS/frame metrics |
| `useWorkflowDependencies` | Workflow import dependency check |
| `useDependencyTracker` | Version dependency resolution |
| `useLocalVideo` | Local video file player |
| `useLocalSliderValue` | Debounced slider state |

### Graph Node Types (27+)

| Category | Nodes |
|----------|-------|
| Source | `SourceNode`, `ImageNode`, `AudioNode` |
| Processing | `PipelineNode`, `VaceNode`, `LoraNode`, `PromptListNode`, `PromptBlendNode`, `SchedulerNode` |
| Control | `SliderNode`, `KnobsNode`, `XYPadNode`, `BoolNode`, `TriggerNode`, `MidiNode`, `TempoNode`, `TupleNode` |
| Output | `SinkNode`, `OutputNode`, `RecordNode` |
| Utility | `NoteNode`, `RerouteNode`, `PrimitiveNode`, `ControlNode`, `MathNode` |
| Subgraph | `SubgraphNode`, `SubgraphInputNode`, `SubgraphOutputNode`, `CustomNode` |

---

## Frame Processing Data Flow

```
Input
 └── SourceManager (NDI/Syphon/WebRTC/file)
      ↓ numpy frames via _on_frame callback
      ↓ convert to GPU tensor (per-thread pinned buffers)
 └── GraphExecutor (DAG)
      ↓ queue-based streaming, maxsize=1 for node-to-node
 └── PipelineProcessor (per node)
      ↓ Pipeline.__call__(**kwargs) → {"video": THWC tensor [0,1]}
 └── SinkManager fan-out
      ├── WebRTC (aiortc MediaRelay → browser)
      ├── RecordingCoordinator (MP4 via PyAV, libx264 + AAC)
      ├── HeadlessSession (MPEG-TS or direct MP4)
      ├── Spout/Syphon/NDI (platform-specific)
      └── Kafka (telemetry heartbeats every 10s)
```

**Output tensor format:** THWC (time/frames, height, width, channels), values normalized `[0, 1]`.

---

## Recording Implementation

- Uses `PyAV` (not aiortc's built-in recorder)
- Container: MP4 with flags `{"use_editlist": "0", "movflags": "+faststart"}`
- Video codec: libx264 at 30 FPS
- Audio codec: AAC
- Subscribes to same `MediaRelay` as WebRTC output (non-destructive)
- Thread-safe state via `recording_lock`
- Handles odd-dimension frames via padding

---

## OSC Control System

- UDP port 8000
- Address format: `/scope/<node-slug>/<param>`
- Node slugs derived from display titles (kebab-case)
- Three layers: runtime globals, pipeline params, graph nodes
- Validation: type constraints (float, int, bool, string, integer_list), min/max, enum
- SSE endpoint for observing received OSC commands
- Auto-generated HTML docs at `/api/v1/osc/docs`

---

## Tempo Sync / Beat-Synchronized Parameters

**Sources:** Ableton Link (`aalink`) or MIDI clock (`mido + python-rtmidi`)

**Quantization options:** Immediate, Beat, Bar, 2 Bars, 4 Bars

**Modulation waveforms:** sine, cosine, triangle, saw, square, exp_decay

**Architecture (5 layers):**
```
Tempo sources (Link/MIDI) → TempoManager → ParameterScheduler → ModulationEngine → Pipeline injection
```

**ParameterScheduler logic:** Schedules parameter changes ahead of beat boundaries by a configurable lookahead (0–1000ms) to compensate for pipeline processing latency. Uses `threading.Timer`. Merges concurrent updates without re-calculating boundaries.

---

## Electron Desktop App

**Main process (`app/src/main.ts`):**
- Spawns Python backend (`uv run daydream-scope`) on a dynamically allocated port
- Polls `/health` endpoint until backend is ready
- Opens `BrowserWindow` pointing to `http://localhost:<port>`
- Detects backend restart signals (exit code 42) and respawns

**Restart protocol:**
- Managed mode (Electron): backend exits code 42 → Electron respawns → frontend polls `/health`
- Standalone mode: `os.execv()` (Unix) or `subprocess.Popen` (Windows)

**Build targets:** `dist:win`, `dist:mac`, `dist:linux` via electron-builder

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `PIPELINE` | Pre-warm pipeline on startup |
| `HF_TOKEN` | Hugging Face token (model downloads + Cloudflare TURN) |
| `CIVITAI_API_TOKEN` | CivitAI LoRA downloads |
| `VERBOSE_LOGGING` | Debug log output |

---

## Development Conventions

- **Import style:** Relative imports for 1–2 levels; absolute otherwise
- **Code quality:** ruff (Python), prettier + eslint (frontend)
- **Commit sign-off:** DCO required on all commits
- **Testing:** `uv run pytest` (backend), `vitest` (frontend)
- **MCP testing:** Use HTTP API directly rather than MCP tools when testing server behavior
- **Pre-commit hooks:** `uv run pre-commit install`

---

## Key Architectural Patterns Relevant to deckcreate Refactor

### 1. Pipeline = Node Unification
After their refactor, "a pipeline is just a config-driven node." This simplifies the registry and enables composing pipelines in graphs interchangeably with custom nodes. Applied to deckcreate: transcript processing stages (transcribe, align, diarize, merge) could become unified `Node` types with a shared config interface.

### 2. Pydantic-Driven UI
Pipeline schemas auto-generate frontend forms via `/api/v1/nodes/definitions`. The `ui_field_config()` helper attaches rendering metadata (order, category, mode-visibility, is_load_param) to Pydantic `Field` definitions. Applied to deckcreate: `transcript.json` schema changes could drive UI updates automatically.

### 3. Queue-Based DAG with Backpressure
Node-to-node edges use `maxsize=1` queues, creating natural backpressure. Sink nodes get independent queue copies to decouple recording from display. Applied to deckcreate: the multi-step pipeline (sync → transcribe → diarize → align → merge) maps naturally to this pattern.

### 4. Two Rendering Modes (Perform / Graph)
"Perform Mode" (traditional panel layout) and "Graph Mode" (node editor) coexist behind a `nonLinearGraph` flag that disables pipeline selector and load controls. Applied to deckcreate: could distinguish between "simple timeline editing" vs. "advanced composition graph" modes.

### 5. MCP as Primary Agent Interface
The MCP server is a thin wrapper over the HTTP API. All editing operations are accessible to AI agents via `--mcp` flag. Applied to deckcreate: exposing transcript edits, cut operations, and render triggers as MCP tools would enable AI-driven editing (the same model as Daydream Video).

### 6. Plugin Restart Protocol via Exit Code 42
A deliberate restart signal via exit code is a clean pattern for coordinating desktop app ↔ backend restarts across platforms. Electron respawns on code 42; standalone uses `os.execv`.

### 7. Cloud Proxy Decorator
`@cloud_proxy()` transparently redirects requests to cloud backend when connected — zero changes to individual route handlers needed. Applied to deckcreate: could route heavy processing (whisper, alignment) to cloud when available.

### 8. Per-Thread Pinned GPU Buffers
Prevents race conditions when multiple input sources upload frames concurrently to GPU. Applied to deckcreate: relevant if adding parallel video track processing.

### 9. SSE for Live Log Streaming
`GET /api/v1/osc/stream` and log endpoints use Server-Sent Events for real-time backend output in the frontend. Applied to deckcreate: transcription/alignment progress could stream to UI via SSE instead of polling.

### 10. Dynamic Port Allocation + Health Polling
Electron spawns backend on a dynamic port and polls `/health` until ready. This is cleaner than hardcoding a port, avoids conflicts, and gives a clean startup signal. Applied to deckcreate if adding a local backend service.

---

## Sources

- [https://daydream.live/](https://daydream.live/) — Daydream Scope landing page
- [https://github.com/daydreamlive/scope](https://github.com/daydreamlive/scope) — Full open-source codebase
