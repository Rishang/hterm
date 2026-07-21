# hterm Coding Style Guide

`STYLE.md` is the repository's single source of truth for coding conventions. It describes patterns observed in the tracked codebase; it intentionally does not introduce generic rules where the repository has no established practice. `AGENTS.md` contains agent workflow and navigation only.

## Repository-wide architecture and organization

### Layout

| Path | Responsibility |
| --- | --- |
| `src/` | Rust binary: configuration, HTTP routing, WebSocket/PTY terminal transport, MCP, tools, file API, and LSP bridge. |
| `ui/` | Svelte 5/Vite browser application and its pnpm workspace. |
| `ui/src/` | Feature components, editor/terminal integrations, plain JavaScript helpers, and global UI styling. |
| `ui/src/autocomplete/` | CodeMirror completion and LSP-specific adapters. |
| `ui/public/` | PWA manifest, service worker, and static terminal icon. |
| `openapi.yaml` | Checked-in REST/MCP API contract embedded by the Rust binary and copied into `ui/dist/` at release build time. |
| `Taskfile.yml` | Development/build entry points and the UI → binary build dependency. |
| `Cargo.toml`, `Cross.toml` | Rust package/release profile and Linux cross-compilation configuration. |
| `.github/workflows/release.yml` | Release-published CI build and artifact upload. |
| `docs/superpowers/` | Dated feature design/specification and implementation-plan records. |

The executable is a single Rust crate, not a workspace. The browser application is a separately built static asset bundle embedded into the Rust binary through `rust_embed` (`src/main.rs::Assets`). `Taskfile.yml` expresses that coupling: `build` depends on `ui`, copies `openapi.yaml` into `ui/dist/`, then builds the release binary.

### Boundaries and dependencies

`src/main.rs` is the composition root. It owns CLI/config precedence, process validation, shared `Arc<AppState>`, route mounting, static assets, and the three serving modes. Keep route composition there; expose module-local `router()` functions for independently owned endpoint groups.

The backend boundaries are responsibility-based rather than a layered framework:

- `config`: config model and browser-safe config response.
- `pty`: Unix PTY lifecycle only.
- `ws`: terminal WebSocket protocol and shared `AppState`.
- `tools`: authentication plus the reusable command/file tool primitives.
- `rest`: tool and filesystem HTTP routes.
- `mcp`: JSON-RPC-over-SSE protocol routes.
- `lsp`: language-server selection, pooling, protocol, and editor endpoints.

The `tools` module is intentionally shared: REST and MCP both dispatch through `tools::call_tool`, and REST/MCP/LSP use `tools::check_auth`. Extend a tool centrally (schema, dispatcher, implementation) rather than creating protocol-specific copies. Similarly, add LSP support through the language/server mapping helpers in `src/lsp.rs` and their matching browser mappings in `ui/src/autocomplete/lsp.js`.

The UI is component-first. `ui/src/App.svelte` owns cross-feature state (terminal/file tabs, layout, persisted settings, global shortcuts) and composes focused components. Reusable non-component logic stays in named JavaScript modules; editor/LSP integrations are grouped in `ui/src/autocomplete/`.

### Shared engineering principles reflected in code

- **Constrain resources at boundaries.** Command output, file reads, custom index files, LSP messages/documents/sessions, channels, and output coalescing all have explicit caps or timeouts. Cleanup is explicit for PTYs, MCP streams, LSP sessions, browser observers, timers, editor views, and WebSockets.
- **Keep hot paths allocation- and lock-conscious.** Examples include a precomputed Basic-auth header, cached `/api/config` and OpenAPI responses, `Bytes` slices for terminal input, PTY output coalescing, static `LazyLock` tool payloads, and `std` locks only when not held across `.await`.
- **Make security and permission boundaries explicit.** Read-only is the default; mutations check `writable`. HTTP auth goes through the shared check. Paths are normalized before file mutations. Browser config deliberately omits credentials and key paths.
- **Degrade editor assistance rather than break editing.** Unavailable LSP servers return empty completions or `null` hover results, while local completion remains usable.
- **Use data-driven extension maps.** Language/server lists, CodeMirror language loaders, LSP settings, file-icon mappings, and tool definitions are tables/maps, not scattered route or component conditionals.

### Cross-language naming and wire conventions

- Native code uses its language idiom: Rust types `UpperCamelCase`, Rust functions/fields `snake_case`, JavaScript/Svelte functions/variables `camelCase`, and CSS custom properties/classes `kebab-case`.
- Public JSON/browser/MCP wire keys preserve the protocol or browser convention. Rust uses `#[serde(rename_all = "camelCase")]` and targeted `#[serde(rename = ...)]` where a Rust `snake_case` member crosses that boundary. Examples: `ThemeConfig::font_family` → `fontFamily`; `RenameFileRequest::new_path` → `newPath`; MCP uses `inputSchema` and `isError`.
- Files are named after their primary responsibility: Rust module names are lowercase (`rest.rs`, `tools.rs`); Svelte components are PascalCase (`FilePane.svelte`); JavaScript helpers are lower camel/lowercase (`fileList.js`, `fuzzy.js`); dated plans/specs use `YYYY-MM-DD-topic.md`.
- User-facing HTTP endpoints are namespaced by transport: `/api/*` for REST, `/mcp/*` for MCP, and `/ws` for terminal WebSocket. `base_path` is applied when mounting all routes.

### Imports, documentation, and tests

- Group Rust imports by external crate, `std`, then `crate` modules; use brace groups for related imports. Frontend code imports dependencies first, then relative feature modules.
- Comments and doc comments explain lifecycle, invariants, performance/security reasoning, protocol semantics, or non-obvious behavior. Section rulers such as `// ── Router ──` and concise functional CSS section headers are used to divide long files.
- Rust has focused inline tests where pure behavior is practical (`src/lsp.rs`); an external-dependency test is explicitly `#[ignore]`. The current UI has no test runner; its pure helper modules are written as exported functions that can be exercised directly with Node, as reflected in the dated command-palette plan.
- `tracing` is backend-only logging. The frontend presents operation status/errors locally or intentionally ignores expected best-effort failures; it does not establish a browser logging convention.

## Rust (Rust 2021, Tokio, Axum)

### File and module organization

Keep one responsibility-focused module per `src/*.rs` file and declare private modules from `main.rs`. Public APIs are selectively exposed across sibling modules (`pub`, `pub(crate)`); most implementation types/functions remain private. Route modules provide `pub fn router() -> Router<Arc<AppState>>`, while `main.rs` mounts them.

Use `AppState` as the explicit shared request-state object. Long-lived connection-specific ownership remains local: `pty_main_loop` owns `PtySession` directly rather than wrapping it in an `Arc`; LSP sessions are protected by an async mutex only for serialized protocol access.

### Formatting, imports, and naming

Use rustfmt-shaped four-space indentation, trailing commas in multiline literals/calls, brace-grouped imports, and compact early-return branches where the operation is simple. Dense initialization and CLI-overlay blocks deliberately vertically align fields/assignments for scanability.

```rust
if let Some(p) = cli.port          { cfg.port          = p; }
if let Some(h) = cli.host          { cfg.host          = h; }
if cli.readonly                    { cfg.writable      = false; }
```

Types, traits, and enum variants are `UpperCamelCase`; functions, fields, modules, and locals are `snake_case`; constants are `UPPER_SNAKE_CASE`. Name state by ownership/responsibility (`AppState`, `PtySession`, `CommandCapture`, `SessionKey`, `RequestContext`) and handlers with an explicit `_handler` suffix.

### Modeling and patterns

Use structs plus `derive` for stable request/response/config models and `serde_json::Value`/`json!` for dynamic or method-dependent protocol payloads.

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletionRequest {
    path: String,
    language: String,
    server: Option<String>,
    content: String,
    position: Position,
}
```

Observed patterns:

- **Shared application state:** `Arc<AppState>` is extracted by Axum handlers.
- **Composition root + subrouters:** `main.rs` mounts feature routers; `rest::router`, `rest::files_router`, and `lsp::router` own local routes.
- **Actor-style task ownership:** WebSocket reader → PTY owner → WebSocket writer communicate through bounded channels; each task owns the resource it writes.
- **RAII cleanup:** `Drop` for `PtySession` hangs up/reaps a child and `SessionStream` removes an MCP transmitter.
- **Pool/cache with eviction:** `LspManager` keys sessions by language/server/workspace/environment and retires idle/failed entries.
- **Data tables for extension:** LSP `ServerCommand` arrays and language mapping functions select supported servers.

Use `Option` for absent/optional data and enum-like domain values where the code needs an explicit state distinction (`FileRead::{Text, Binary}`, `PtyCmd::{Input, Resize}`). Avoid a generic exception layer; low-level functions return `io::Result` where I/O semantics matter and many service/protocol functions return `Result<_, String>` for direct boundary mapping.

### Async, errors, resource handling, and logging

Do not hold a lock across `.await`; the code comments this explicitly for `std::sync` locks in `AppState`. Use bounded channels, Tokio timeouts, caps, and process cleanup for external or unbounded work. Commands that time out are killed; output is still drained after reaching its shared cap.

At HTTP boundaries, authenticate first, reject invalid/read-only operations early, and translate errors into the endpoint’s established response shape: status-only `401`, `403`, `503`; typed JSON for stable success payloads; ad hoc JSON `{ "error": ... }` or text for simple bad requests. MCP maps failures to JSON-RPC envelopes/codes. LSP availability failures produce usable empty/null editor responses.

Use `tracing` structured macros, with values carried as fields when useful. `info!` records startup and completed tool/session lifecycle; `warn!` records recoverable configuration/security/resize issues; `debug!` captures expected protocol notifications and unavailable LSP behavior; `error!` precedes fatal startup or PTY failures.

```rust
tracing::info!(tool = cmd_name, success = ok, "command finished");
tracing::warn!(origin = o, host = h, "WebSocket upgrade rejected: origin mismatch");
```

### Configuration and API contracts

`AppConfig` is a complete serde model with field-level defaults. JSON config is loaded first; explicitly supplied CLI values then overlay it. Partial/invalid/missing config files fall back to defaults and warn rather than abort. Client-visible config uses the separate `ConfigResponse` type so secrets remain server-only.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub writable: bool,
    #[serde(default)]
    pub theme: ThemeConfig,
}
```

`openapi.yaml` is the REST/MCP contract: it is parsed from YAML and served as cached JSON by `serve_openapi`, and copied into bundled UI output by the build task. When changing implemented documented REST/MCP behavior, keep the contract in sync. The LSP routes are implemented under `/api/lsp` but are not currently present in the OpenAPI document; do not treat undocumented paths as a documented contract without adding them.

## Svelte 5 and JavaScript (Vite, CodeMirror, xterm.js)

### Organization and imports

`ui/src/main.js` mounts `App.svelte` and imports the one global stylesheet. `App.svelte` owns app-wide tab/layout/settings state and passes behavior downward through props/callbacks. Feature components are PascalCase; helper modules expose named camelCase functions and uppercase constants.

```js
import { onMount } from "svelte";
import FileManager from "./FileManager.svelte";
import { fileIcon } from "./fileIcon.js";
```

Use ESM throughout (`ui/package.json` declares `"type": "module"`). The repository currently uses both single- and double-quoted JavaScript strings and both semicolon-light and semicolon-terminated styles; ESLint provides recommended correctness rules but no project formatter or quote/semicolon policy. Preserve the surrounding file’s local style rather than normalizing unrelated code.

### Component interfaces, state, and events

Svelte components use Svelte 5 runes: `$props()` for props, `$state` for local mutable state, `$derived` for derived values, `$effect` for reactive work, and `$bindable` for two-way bindings. JSDoc above prop declarations documents the runtime interface, including callback signatures and external library types.

```svelte
/** @type {{ open: boolean, openFileByPath: (path: string) => void }} */
let { open = $bindable(false), openFileByPath } = $props();

const results = $derived(fuzzyFilter(allFiles, query.trim(), 50));
```

Use direct DOM event attributes (`onclick`, `onkeydown`, `oninput`, `ondragstart`, etc.) and inline small state transitions. Event handlers that own keyboard behavior prevent default propagation deliberately. Parent components pass callbacks named `on…` (`onchange`, `onsave`, `onFocus`, `onOpenSidebar`) rather than dispatching a custom event abstraction.

Components managing platform/external resources use `onMount`/`onDestroy` and clean up subscriptions, timers, observers, socket handlers, and third-party views. Async initialization guards against late completion after destruction (`disposed` in `CodeEditor.svelte`).

### Browser APIs and error handling

Frontend requests use `fetch` against a deployment-aware base path:

```js
const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");
```

For user-facing filesystem/editor operations, check `response.ok`, read or construct an error, and store loading/error/save state in the owning component. Preserve races intentionally: `FilePane` queues autosaves, `FileManager` de-duplicates in-flight directory loads, and LSP completion/hover uses an `AbortController` plus post-response staleness checks.

Expected best-effort operations (clipboard permission/access, fitting terminal, background refresh) are caught locally without a global reporting mechanism. LSP failure returns `null` so CodeMirror can continue with local completion behavior.

### Editor and terminal extension patterns

- Extend syntax loading in `CodeEditor.svelte` through the `langMap` dynamic-import table and its derived `supportedLangs` list. Dynamic imports allow Vite to keep CodeMirror language modes as separate chunks.
- Add specialized editor completion through predicate/source modules in `ui/src/autocomplete/` (`isDockerAutocompleteFile`/`dockerCompletionSource`, `isGoTemplateFile`/`goTemplateCompletionSource`).
- Keep browser LSP language IDs, server options, path special cases, completion translation, hover rendering, and request cancellation centralized in `ui/src/autocomplete/lsp.js`. Its language/server tables correspond to backend `src/lsp.rs`.
- Maintain terminal binary message codes consistently with `src/ws.rs`; `TermTab.svelte` sends input/resize bytes and receives output frames.

### Representative JavaScript helper style

Pure helpers are exported, documented with JSDoc, keep their state local, and return simple data structures suitable for component composition.

```js
export function fuzzyFilter(paths, query, limit = 50) {
  if (!query) {
    return paths.slice(0, limit).map((path) => ({ path, score: 0, positions: [] }));
  }
  const scored = [];
  for (const path of paths) {
    const r = fuzzyScore(path, query);
    if (r) scored.push({ path, score: r.score, positions: r.positions });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return scored.slice(0, limit);
}
```

## CSS

All tracked product styling is centralized in `ui/src/global.css`, except small component-local host/layout styles in `CodeEditor.svelte` and `TermTab.svelte`. Keep global styles organized by feature section headings and use feature-prefixed class families: `fm-*` (file manager), `cmdp-*` (command palette), `csb-*` (custom search bar), `lsp-*` (LSP hover), and `tab-*`/`workspace-*`.

The UI is a tokenized Atom One Dark theme. Define/reuse semantic custom properties in `:root` (`--bg-*`, `--text-*`, `--accent-*`, `--border-*`, `--status-*`, `--file-*-bg`, scrollbar/shadow tokens) rather than embedding new colors throughout feature rules. CodeMirror and xterm setup read the same tokens through CSS or `getComputedStyle`.

```css
:root {
  --bg-primary: #282c34;
  --text-primary: #abb2bf;
  --accent: #61afef;
  --status-disconnected: #e06c75;
}
.fm-node.is-drop-target {
  background: var(--bg-surface-hover);
  box-shadow: inset 2px 0 0 var(--accent);
}
```

Use flex/grid layouts, `min-width: 0`/`min-height: 0` for nested panes, visual states via `:hover`, `.active`, and Svelte `class:` directives, and accessible color/status variants. The established responsive rule is `@media (max-width: 760px)`: split panes stack vertically and resize affordances switch to row-resize. Overlay z-indices are explicit by feature (tab UI, popovers, menus, modal/settings, command palette).

## HTML and PWA assets

`ui/index.html` is a minimal Vite shell: lowercase HTML5 doctype, compact head metadata, static paths under `/static/`, and a module entrypoint. It does not own application markup.

`ui/public/manifest.json` contains the PWA identity and icon metadata. `ui/public/sw.js` is intentionally minimal: install skips waiting and activate claims clients. Keep public paths compatible with the static asset mount (`/static/`) and avoid introducing a second client-side routing layer.

## YAML: OpenAPI, Task, and GitHub Actions

YAML uses two-space indentation, quoted numeric-looking HTTP response keys, lower-case OpenAPI/Task keys, and descriptive multiline blocks with `|`. Keep API endpoints grouped by route and tagged by concern; use `$ref` for shared schemas/responses and inline examples adjacent to their operation/schema.

```yaml
/api/files/read:
  get:
    summary: Read file content
    tags:
      - terminal
    responses:
      '200':
        description: File read result
```

`openapi.yaml` is OpenAPI 3.0.3 and is the checked-in REST/MCP documentation contract. Its components use UpperCamelCase schema names (`ConfigResponse`, `ToolCallRequest`) and camelCase wire properties where that is the API’s established shape.

`Taskfile.yml` is Task v3 automation. Tasks use a short key/value definition, imperative lower-case names (`ui`, `build`, `dev`, `clean`), human-readable `desc`, `cmds`, and explicit `sources`/`generates`; dependent builds use `deps`. The UI task executes in `ui/` and the binary build explicitly depends on it.

GitHub Actions uses a release-triggered workflow, descriptive step names, a two-target Linux matrix, and the same Task build entry point used locally. Cross target image selection is documented in `Cross.toml` because of its GCC compatibility constraint.

## TOML: Cargo and Cross

`Cargo.toml` uses conventional Cargo tables, aligned package/dependency fields where readability benefits, comments to explain non-obvious dependency features, and explicit feature lists. The crate is edition 2021. Dependencies are grouped roughly by server/runtime, serialization/config, CLI/platform, observability, and assets/protocol support rather than alphabetically.

```toml
axum        = { version = "0.8",  features = ["ws"] }
tokio       = { version = "1",    features = ["rt", "macros", "net", "sync", "time", "io-util", "io-std", "fs", "signal", "process"] }
```

The release profile is intentionally size-oriented (`opt-level = "z"`, LTO, one codegen unit, aborting panics, stripping). `Cross.toml` contains one target table per release target and documents why edge images are needed.

## JSON: runtime configuration and frontend tooling

JSON files are indented with two spaces. Runtime `config.json` is intentionally a small partial `AppConfig` example using browser-facing camelCase keys when applicable (`theme`) and leaves defaults to Rust. Do not place secrets in browser-returned config; only `ConfigResponse` defines that boundary.

`ui/package.json` is private, ESM, and separates build/lint tooling in `devDependencies` from browser runtime/editor libraries in `dependencies`. pnpm configuration explicitly allows only `esbuild` build scripts (`ui/.npmrc`, `ui/pnpm-workspace.yaml`). Vite, Svelte, ESLint, and jsconfig files use JavaScript/JSON configuration directly; the frontend has `checkJs: true` through `ui/jsconfig.json`.

## Markdown documentation

Root `README.md` is product-facing documentation: it uses an HTML-centered hero/header, feature sections, tables, collapsible examples, shell/JSON/Docker code fences, and route/API tables. Keep operational assertions aligned with the actual API/tool list and build behavior.

`docs/superpowers/specs/` and `docs/superpowers/plans/` record dated design decisions and implementation plans. Their existing style uses a title, date/status, goals, scoped decisions, concrete file references, code blocks, and checklists. These historical documents can describe a feature-specific workflow, but they are not a replacement for this repository-wide style guide.

## Generated and ignored artifacts

Do not treat `target/`, `ui/dist/`, `ui/node_modules/`, `.task/`, `.codegraph/`, `.understand-anything/`, or `.pi-subagents/` as source conventions. `.gitignore` and `ui/.gitignore` intentionally exclude build output, dependency directories, caches, logs, editor artifacts, and local environment files; source changes belong in tracked inputs instead.
