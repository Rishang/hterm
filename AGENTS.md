# Agent Guide

## Source of coding conventions

Read and follow [STYLE.md](STYLE.md) before changing code. It is the single source of truth for repository coding standards, architecture conventions, API/wire shapes, and language-specific practices. Do not duplicate style guidance here.

## Repository navigation

- `src/` is the Rust/Axum server. `src/main.rs` composes routes and process startup; feature modules own configuration, PTY/WebSocket terminal transport, REST/files/tools, MCP, and LSP.
- `ui/` is the Svelte 5/Vite frontend. `ui/src/App.svelte` composes feature components; `ui/src/autocomplete/` holds editor/LSP adapters; `ui/src/global.css` is the global theme.
- `openapi.yaml` is the checked-in REST/MCP contract embedded by the binary.
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

1. Locate the boundary that owns the behavior before editing; prefer existing shared primitives and extension maps over parallel implementations.
2. Keep backend, browser, and API contract changes consistent when a public route, tool, or wire payload changes.
3. Do not edit generated/ignored build outputs (`target/`, `ui/dist/`, `ui/node_modules/`, `.task/`).
4. Review `git diff` and report the validation actually run, including any unavailable checks.
