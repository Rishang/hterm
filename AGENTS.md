# Agent Guide

## Source of coding conventions

Read and follow [STYLE.md](STYLE.md) before changing code. It is the single source of truth for repository coding standards, architecture conventions, API/wire shapes, and language-specific practices. Do not duplicate style guidance here.

## Repository navigation

- `src/` is the Rust/Axum server; start at `src/main.rs` to navigate a backend change.
- `src/watch.rs` owns filesystem change notification for the file explorer: inotify watches over the SSE routes nested at `/api/files/watch`, so changes made outside the browser (shell commands, builds, VCS operations) are pushed instead of polled. Its browser counterpart is the watch section of `ui/src/FileManager.svelte`; change the two together.
- `ui/` is the Svelte 5/Vite frontend; start at `ui/src/App.svelte` for cross-feature UI work.
- `openapi.yaml` is the checked-in REST/MCP contract.
- `Taskfile.yml` defines UI, release build, development, and cleanup automation.
- `docs/superpowers/` contains dated feature specifications and plans; treat them as context for their specific feature.

## Execution and validation

Use the narrowest relevant check after a change:

- Frontend: `task ui` (build) and `cd ui && pnpm run lint` (lint).
- Rust: `cargo test` for the crate’s inline tests; use `cargo fmt --check` when the local toolchain provides it.
- End-to-end release artifact: `task build` (builds UI, copies OpenAPI into assets, then builds the release binary).
- Development server: `task dev`.
- Documentation-only changes: `git diff --check`.

`task clean` removes generated Rust/UI artifacts; run it only when that cleanup is intended.

## Change workflow

1. Locate the boundary that owns the behavior before editing.
2. Keep backend, browser, and API contract changes consistent when a public route, tool, or wire payload changes.
3. Do not edit generated/ignored build outputs.
4. Review `git diff` and report the validation actually run, including any unavailable checks.
