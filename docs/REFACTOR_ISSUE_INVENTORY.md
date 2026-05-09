# DeckCreate Engine — Sprint 1–7 Issue Inventory

## Sprint 1 — Deterministic Foundation

### 1. Create project file configuration layer
✅ Done — `refactor/s1-project-file` — `ProjectFile` type, `readProject`/`writeProject` helpers, `ProjectNotFoundError`
Create the `.ragtech/project.json` foundation and typed helpers for reading/writing project state. This becomes the single source of truth for pipeline parameters, tool versions, and deterministic run metadata.

### 2. Implement content-addressed artifact storage
Create the artifact storage system that writes outputs into `.ragtech/artifacts/` using SHA-256-derived filenames. Identical content must resolve to identical artifact IDs.

### 3. Persist pipeline parameters in project file
Move runtime parameters such as diarization seed, timestamp offset, and number of speakers out of CLI flags and into the project file so pipeline runs are reproducible.

### 4. Add deterministic metadata to generated artifacts
Ensure every JSON artifact includes schema version and tool version metadata so outputs can be traced to exact execution conditions.

---

## Sprint 2 — Hardware Abstraction

### 5. Implement hardware detection layer
Create a centralized hardware detection module that identifies available execution environments (Apple Silicon / NVIDIA / CPU-only) and exposes a typed hardware profile.

### 6. Build typed FFmpeg command abstraction
Create a typed FFmpeg command builder that maps encoding/decoding operations to the appropriate hardware acceleration path.

### 7. Migrate inline FFmpeg calls to shared command builder
Replace scattered inline FFmpeg process invocations with the shared command builder so command construction is centralized.

---

## Sprint 3 — Pipeline DAG Foundation

### 8. Create DAG node contract
Define the typed node interface for the new pipeline execution model, including node identity, inputs, outputs, and run behavior.

### 9. Implement DAG runner core
Build the DAG execution engine that resolves dependency order, executes nodes safely, and supports cached artifact reuse.

### 10. Implement pipeline run logging
Add structured run logs under `.ragtech/runs/` capturing execution metadata, inputs, outputs, parameters, and timing.

### 11. Rewrite wizard as thin DAG wrapper
Refactor the current wizard so it becomes a thin UX wrapper over the DAG runner instead of owning execution logic directly.

---

## Sprint 4 — Pipeline Stage Migration

### 12. Implement sync pipeline node
Move sync logic into a DAG node with declared inputs/outputs and artifact-aware execution behavior.

### 13. Implement transcribe pipeline node
Move transcription into a DAG node that reads synced inputs and writes transcript artifacts.

### 14. Implement diarize pipeline node
Move diarization into a DAG node with deterministic seed handling and declared artifact outputs.

### 15. Implement align pipeline node
Move alignment into a DAG node that consumes transcription outputs and produces aligned transcript artifacts.

---

## Sprint 5 — Script Infrastructure

### 16. Create centralized path resolver
Build shared path helpers so scripts no longer hardcode file locations.

### 17. Implement shared CLI argument parser
Create a reusable typed CLI parser to replace ad hoc argument parsing logic across scripts.

### 18. Implement shared script error handling and cleanup
Create shared fatal error handling and cleanup utilities so interrupted runs fail consistently and safely.

### 19. Define Python interop type contracts
Create shared TypeScript interfaces for JSON emitted by Python scripts so the JS/Python boundary becomes typed and explicit.

---

## Sprint 6 — Script Testability + Determinism Hardening

### 20. Add dependency injection to script services
Refactor core services so filesystem and subprocess behavior can be injected for testing.

### 21. Extract pure transcript transformation functions
Extract transcript-building and merge logic into pure functions with no I/O dependencies.

### 22. Add deterministic FFT tie-breaking in audio sync
✅ Done — `refactor/s1-audiosync-determinism` — deterministic peak selection with earliest tie-break, frame-exact lag offsets
Fix non-deterministic FFT peak selection so sync chooses a stable result when multiple peaks are near-equivalent.

### 23. Store lag as integer frame offset
✅ Done — `refactor/s1-audiosync-determinism` — implemented frame-exact integer lag offsets at 30fps
Normalize sync lag to frame-exact integer offsets instead of floating-point seconds.

---

## Sprint 7 — Engine Correctness + Final Pipeline Completion

### 24. Implement assign-speakers pipeline node
Create the speaker-assignment stage that combines transcript and diarization outputs into speaker-tagged transcript artifacts.

### 25. Implement merge-doc pipeline node
Create the merge-doc stage that combines human-edited transcript directives with pipeline outputs into the final transcript artifact.

### 26. Add pipeline stale-state detection
Build the dependency invalidation mechanism that determines which downstream nodes become stale when upstream artifacts change.

### 27. Add pipeline status command
Implement a status command that reports cached, stale, and missing pipeline stages.

### 28. Standardize artifact hashing utilities
Move hashing logic into shared reusable utilities so all artifact identity calculations follow one implementation.

### 29. Add full pipeline determinism validation command
Create a validation command that re-runs relevant stages and confirms identical outputs across deterministic runs.