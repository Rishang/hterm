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

Use the narrowest relevant check after a change. Always use the repository `Taskfile.yml` through `task` targets for builds; do not invoke `pnpm build` or `cargo build` directly.

- Frontend: `task ui` (build) and `cd ui && pnpm run lint` (lint).
- Rust: `cargo test` for the crate’s inline tests; use `cargo fmt --check` when the local toolchain provides it.
- End-to-end release artifact: `task build` (builds UI, copies OpenAPI into assets, then builds the release binary).
- Development server: `task dev`.
- Browser behavior (any UI, terminal, or WebSocket change): drive the real app with agent-browser; see below.
- Documentation-only changes: `git diff --check`.

`task clean` removes generated Rust/UI artifacts; run it only when that cleanup is intended.

## Browser testing with agent-browser

Use [agent-browser](https://github.com/vercel-labs/agent-browser) for browser automation, not ad-hoc Puppeteer/Playwright or CDP scripts. Its skill is checked in at `.claude/skills/agent-browser/`; it is a stub, so run `agent-browser skills get core` before the first command (and `agent-browser skills get dogfood` for exploratory QA).

- Install once: `npm i -g agent-browser && agent-browser install`. Keep it current with `task sync:skills`, which upgrades the CLI and syncs the checked-in skill to it; commit the skill if it changed.
- Test a release build (`task build`), not the Vite dev server: run `target/release/hterm -W -p <free port>` from a scratch directory, so the shell's files land there and not in the repo.
- Use your own session, so you don't take over another agent's browser: `export AGENT_BROWSER_SESSION=hterm-<task>`.
- The terminal draws to a canvas, so its text is not in `snapshot` or `read`:
  - focus it with `agent-browser click canvas`, then type with `keyboard type` and `press Enter`;
  - check results through the shell (`echo $$ > pid`, then read the file) or with `screenshot`.
- The explorer, tabs, settings and menus are ordinary DOM: use `snapshot -i` and `@eN` refs.
- For network conditions (latency, a tunnel that drops or stalls), put a small TCP proxy between the browser and hterm; agent-browser alone can't cut a WebSocket.
- Finish with `agent-browser close` and stop the hterm you started.

## Change workflow

1. Locate the boundary that owns the behavior before editing.
2. Keep backend, browser, and API contract changes consistent when a public route, tool, or wire payload changes.
3. Do not edit generated/ignored build outputs.
4. Review `git diff` and report the validation actually run, including any unavailable checks.
