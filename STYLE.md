# hterm Style Guide

`STYLE.md` is the single source of truth for repository coding and architecture conventions. It records repeated patterns in tracked code; do not treat it as generic guidance. `AGENTS.md` covers agent workflow and validation.

## Repository-wide architecture and organization

### Layout and boundaries

| Path | Owns |
| --- | --- |
| `src/` | Single Rust server: config, route composition, terminal WebSocket/PTY, MCP, tools, files, and LSP. |
| `ui/` | Separately built Svelte 5/Vite application. |
| `ui/src/autocomplete/` | CodeMirror completion and browser-side LSP adapters. |
| `ui/public/` | PWA/static assets. |
| `openapi.yaml` | Checked-in REST/MCP contract embedded into the release artifact. |
| `Taskfile.yml` | UI, release build, development, and cleanup tasks. |
| `docs/superpowers/` | Dated feature specifications and plans. |

`src/main.rs` is the composition root: it overlays CLI/config values, builds `Arc<AppState>`, mounts routes, embeds assets, and selects serving mode. Keep endpoint groups in responsibility-specific modules with local `router()` functions; mount them in `main.rs`.

Backend responsibilities are explicit: `config` models configuration, `pty` owns Unix PTYs, `ws` owns the terminal transport and `AppState`, `tools` owns reusable tools/authentication, `rest` owns HTTP tool/files routes, `watch` owns inotify-backed filesystem change notification for the explorer, `mcp` owns JSON-RPC-over-SSE, and `lsp` owns language-server pooling/bridge routes. REST and MCP share `tools::call_tool`; REST, MCP, and LSP share `tools::check_auth`. Extend shared behavior centrally instead of duplicating it per transport.

The UI is component-first. `App.svelte` owns tabs, layout, persisted settings, global shortcuts, and file opening. Focused components own their interaction; reusable non-component logic is a named-export JavaScript module. `GlobalSearch.svelte` owns search/replace state and presentation while `globalSearch.js` owns command construction, parsing, limits, and text replacement. Browser and backend LSP language/server mappings must remain paired (`ui/src/autocomplete/lsp.js`, `src/lsp.rs`).

### Shared conventions

- Constrain external work: commands, files, LSP messages/sessions, channels, search results, and terminal buffering use limits, timeouts, or bounded queues. Search limits apply to both source lines and expanded occurrences; truncation must remain visible to callers.
- Make resource ownership and cleanup explicit: PTYs, SSE sessions, editor views, observers, timers, sockets, and event listeners are disposed by their owners. The file explorer closes its filesystem-watch SSE session when hidden and reconnects when shown.
- Keep filesystem watches demand-driven: watch only visible expanded directories, use bounded per-session and process-wide caps, and handle inotify descriptor removal/aliasing without dropping remaining paths.
- Preserve security boundaries: read-only is default; authenticate before privileged work; check `writable` before mutation; normalize filesystem mutation paths; keep browser config separate from server secrets.
- Use maps/tables for extensible sets: tool definitions, language/server mappings, language loaders, file icons, and completion options.
- Comments explain ownership, protocol rules, security/performance rationale, or non-obvious behavior. Long Rust/CSS files use concise section headings.

### Cross-language naming and interfaces

- Rust: `UpperCamelCase` types, `snake_case` values/modules, `UPPER_SNAKE_CASE` constants. JavaScript/Svelte: `camelCase`. CSS: kebab-case classes/custom properties.
- Files name their primary responsibility: `tools.rs`, `FilePane.svelte`, `fileList.js`; plans/specs use `YYYY-MM-DD-topic.md`.
- Import packages before local modules. Rust groups external, `std`, then `crate` imports.
- Route families are `/api/*`, `/ws`, `/mcp/*`, and root/static assets; all are mounted under `base_path`.
- JSON casing is endpoint-specific. Config/LSP use camelCase serde mapping; filesystem entries use `is_dir`; preserve the existing operation schema rather than imposing a global casing rule.
- Tool calls use `{ name, arguments }`; results use `{ content: [{ type: "text", text }], isError }`; definitions use `name`, `description`, and `inputSchema`.
- WebSocket terminal frames begin with input `0`, output `1`, resize `2`, error `3` (browser-rendered), or working directory `4` (UTF-8 path, server → client, sent only when the shell's directory changes); resize encodes big-endian `u16` columns/rows. Change browser and server together.
- For published REST/MCP/LSP behavior, update code, browser caller where applicable, and `openapi.yaml` together.

## Rust (Rust 2021, Tokio, Axum)

### Structure, modeling, and patterns

Use one responsibility-focused `src/*.rs` module. Keep most implementation items private; route modules expose a narrow `Router<Arc<AppState>>` API. Use `AppState` for shared request data and keep connection-specific resources local—e.g., the PTY task owns `PtySession` directly.

Use serde structs for stable config/request/response shapes and `serde_json::Value`/`json!` for dynamic tool and protocol payloads:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletionRequest {
    path: String,
    language: String,
    server: Option<String>,
}
```

Established patterns: composition root plus feature routers; `Arc<AppState>`; actor-style WebSocket reader → PTY owner → writer channels; `Drop` cleanup for PTY/SSE resources; LSP pooling/eviction; and mapping tables for supported languages/servers.

### Formatting, errors, and logging

Follow rustfmt-shaped four-space formatting, trailing commas in multiline expressions, brace-grouped imports, and early returns. Preserve nearby vertical alignment in existing config/CLI blocks, but it is not global style. HTTP handler names end in `_handler`.

Authenticate first; for mutations check `writable`; validate/normalize inputs; then perform I/O. Keep a route family's existing response shape: successful typed JSON, status-only auth failures, JSON `{ "error": ... }`, and plain-text errors all exist. Low-level I/O uses `io::Result`; boundary helpers also use `Result<_, String>` when errors are rendered directly.

Do not hold `AppState` standard locks across `.await`. Use bounded channels, caps/timeouts, and cleanup around external processes. Use `tracing` with fields for operational context:

```rust
tracing::info!(tool = cmd_name, success = ok, "command finished");
tracing::warn!(origin = o, host = h, "WebSocket upgrade rejected: origin mismatch");
```

### Configuration and dependencies

`AppConfig` is the complete serde model. Load JSON first, overlay explicit CLI flags, and fall back to defaults with warnings for missing/invalid/partial config. Return a separate `ConfigResponse` to the browser. `Cargo.toml` groups dependencies by role, includes explicit features, and comments only non-obvious choices. The release profile prioritizes binary size; `Cross.toml` has one documented table per Linux target.

## Svelte 5 and JavaScript (Vite, CodeMirror, Ghostty Web)

Use ESM. `main.js` mounts `App.svelte` and imports global CSS. Components are PascalCase; helper modules expose named camelCase functions and documented data tables. Use Svelte 5 runes: `$props`, `$state`, `$derived`, `$effect`, and `$bindable`. Put JSDoc prop/callback types immediately above nontrivial `$props()` declarations.

```svelte
/** @type {{ servers?: Record<string, string>, onchange?: (language: string, server: string) => void }} */
let { servers = {}, onchange } = $props();
```

Pass callbacks as `on…` props (`onchange`, `onsave`, `onFocus`) and use direct DOM event attributes. Keep trivial state changes inline; extract complex/reused behavior. No repository-wide quote or semicolon convention exists—preserve the surrounding file's style.

Derive a deployment-aware request base path for browser API/WebSocket calls:

```js
const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");
```

Check `response.ok` for user-visible work and store loading/error/save state with the owning component. Protect asynchronous UI work: de-duplicate loads, queue autosaves, use `AbortController` plus staleness checks for LSP, and invalidate terminal-search results when output changes. Use `onMount`/`onDestroy` to clean up third-party instances, timers, animation frames, observers, listeners, and WebSockets. Catch expected best-effort operations locally.

Extend CodeMirror language loading in `CodeEditor.svelte` through shared loader helpers and alias tables; preserve every supported extension when consolidating aliases. Add local completion via predicate/source modules in `autocomplete/`; keep browser LSP adaptation in `autocomplete/lsp.js`. `TermTab.svelte` owns Ghostty Web lifecycle, terminal WebSocket behavior, resize, input handling, terminal search, and cleanup. Terminal search coordinates must be converted from displayed text to buffer-cell columns so wide, combining, and emoji cells select correctly; synthetic selection events must never reach mouse-tracking applications.

## CSS

Keep product styling in `ui/src/global.css`; component-local styles are for integration host/layout needs. Group global rules by feature and prefix class families (`fm-*`, `cmdp-*`, `csb-*`, `lsp-*`, `tab-*`, `workspace-*`).

Use semantic `:root` tokens (`--bg-*`, `--text-*`, `--accent-*`, `--border-*`, `--status-*`, file colors, shadows) instead of repeating literal colors. Terminal code reads the same tokens with `getComputedStyle`. Use flex/grid with `min-width: 0`/`min-height: 0` for nested panes, state classes or Svelte `class:` directives for states, and the existing `@media (max-width: 760px)` breakpoint for stacked layout.

```css
.fm-node.is-drop-target {
  background: var(--bg-surface-hover);
  box-shadow: inset 2px 0 0 var(--accent);
}
```

## HTML and PWA assets

`ui/index.html` is a minimal Vite shell; application markup belongs in Svelte. Keep public URLs compatible with `/static/`. `manifest.json` contains PWA identity/icons; the intentionally minimal service worker skips waiting and claims clients. Do not introduce a competing client-side routing layer.

## YAML (OpenAPI, Task, GitHub Actions)

Use two-space indentation. `openapi.yaml` is OpenAPI 3.0.3: group operations by route, tag by concern, quote numeric response keys, reuse `$ref` components, and put examples near their operations/schemas. Component names are `UpperCamelCase`; wire-property casing follows the existing operation.

`Taskfile.yml` is Task v3: lowercase imperative task names (`ui`, `build`, `dev`, `clean`), concise `desc`, `cmds`, explicit `sources`/`generates`, and `deps` for staged builds. The UI task runs under `ui`; release builds depend on it. Release CI uses a two-target Linux matrix and the shared Task build entry point; retain rationale comments in `Cross.toml`.

## TOML

Use conventional Cargo/Cross tables, explicit feature lists, and comments only for operational rationale. Align related fields only where the surrounding table does. This crate uses Rust edition 2021 and one Cross table per target.

## JSON and JavaScript tooling configuration

JSON uses two-space indentation. `config.json` is a partial runtime config; Rust supplies omitted defaults. Preserve browser-facing camelCase where present and never add secrets to browser-visible config. `package.json` separates runtime libraries from build/lint tooling. `jsconfig.json` has `checkJs: true`; frontend source remains `.js` and `.svelte`.

## Markdown documentation

`README.md` is product-facing and uses a centered hero, feature/API tables, collapsible examples, and shell/JSON/Docker fences. Keep claims, endpoint lists, tool descriptions, and technology names synchronized with code. `docs/superpowers/{specs,plans}` stores dated feature records with scope, decisions, file references, code blocks, and checklists; those documents do not replace this guide.

## Generated artifacts

Do not edit or infer source conventions from `target/`, `ui/dist/`, `ui/node_modules/`, `.task/`, `.codegraph/`, `.understand-anything/`, or `.pi-subagents/`. They are build output, dependencies, caches, or local tooling state.
