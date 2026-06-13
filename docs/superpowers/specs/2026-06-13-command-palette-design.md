# Command Palette (Ctrl/Cmd+P) — Design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)

## Goal

Add a keyboard-driven overlay that fuzzy-finds and opens any project file,
mirroring VS Code's `Ctrl+P`. Version 1 is **files-only**.

## Decisions (from brainstorming)

- **Scope:** files-only fuzzy open. No command/action mode, no in-file grep in v1.
- **File source:** the existing `bash` tool via `POST /api/tools/call` — no new
  backend endpoint, UI-only change. (`rg --files` with `fd`/`find` fallback.)

## Components & Changes

### 1. New `ui/src/CommandPalette.svelte`

A centered overlay modal, mirroring the existing `FindBar.svelte` pattern and
reusing the established CSS tokens.

- Text input at top; ranked results list below.
- Each result row: **bold basename** + dimmed parent directory path.
- Keyboard: `↑`/`↓` move selection, `Enter` opens the selected file, `Esc`
  closes, mouse click opens. The selected row auto-scrolls into view.
- **Fuzzy scorer:** self-contained, no new dependency. Subsequence match with
  bonuses for consecutive characters, word / path-separator boundaries, and
  basename matches. Non-matching entries are filtered out; results are capped at
  ~50 and matched characters are highlighted.

### 2. File-list sourcing (via the `bash` tool)

On open, POST to `${basePath}/api/tools/call`:

```json
{ "name": "bash", "arguments": { "command": "rg --files 2>/dev/null || fd -t f 2>/dev/null || find . -type f -not -path '*/.git/*'" } }
```

- `rg`/`fd` respect `.gitignore`, so `node_modules`/`.git`/`target` are skipped.
  The `find` fallback adds a basic `.git` exclude.
- Parse the response `content[0].text`: take everything **before** the
  `\n--- stderr ---\n` delimiter (the bash tool prepends `set -x`, whose trace
  goes to stderr and is appended after that delimiter), then split on newlines
  and drop blanks.

**Caching:** hold the parsed list for the session. On each open, show the cached
list instantly and kick a background refresh so newly-created files appear. The
first-ever open shows a brief "Indexing…" state until the list arrives.

### 3. `ui/src/App.svelte`

- Add `paletteOpen` `$state`.
- In `onGlobalKeydown` (already registered on `window`, capture phase):
  `(e.ctrlKey || e.metaKey) && e.key === "p"` with no other modifier →
  `e.preventDefault()` / `e.stopPropagation()` (suppresses the browser print
  dialog) → toggle `paletteOpen`.
- Render `<CommandPalette bind:open={paletteOpen} {openFileByPath} />`.
- **Extract `openFileByPath(path)`** — the open-then-fetch-`/api/files/read`
  logic currently inlined in `FileManager.handleClick` — into App so both the
  sidebar and the palette share one code path. Behavior: if a tab for `path`
  already exists, focus it; otherwise open a loading tab, fetch
  `/api/files/read?path=`, and populate content / `is_binary` / error.

### 4. `ui/src/FileManager.svelte`

Refactor `handleClick` to delegate the file-open case to the shared
`openFileByPath` (removes the duplicated fetch/error block). Directory toggling
stays in `FileManager`.

### 5. `ui/src/ShortcutInfo.svelte` + `ui/src/global.css`

- Add the `Ctrl/Cmd+P — Open file (command palette)` entry to the shortcuts list.
- Add `.command-palette*` overlay styles using the existing
  `--bg-*` / `--border-*` / `--accent` tokens.

## Data Flow

`Ctrl+P` → `paletteOpen = true` → show cached list (or "Indexing…") + background
`rg --files` → keystroke → fuzzy-rank client-side → `Enter` / click →
`openFileByPath(path)` → file tab opens → palette closes.

## Error Handling

- Tool call fails / response `isError` / empty stdout → results area shows
  "No files found" (or the returned error text).
- Missing `rg` is covered by the `rg → fd → find` fallback chain.
- Selecting an already-open file focuses its existing tab (no refetch).

## Testing

The repo has **no JS test harness** (no `test` script, no vitest/jest/playwright),
so verification is manual via `task dev`:

1. `Ctrl+P` opens the palette; `Esc` closes it; the browser print dialog never appears.
2. Typing a partial name fuzzy-ranks sensibly (basename matches rank high).
3. `↑`/`↓` move selection and auto-scroll; `Enter` and mouse click both open.
4. Opening an already-open file focuses its existing tab.
5. Newly-created file (via sidebar) appears after reopening the palette.
6. Empty project / no matches → "No files found".
7. Simulated missing `rg` → `fd`/`find` fallback still lists files.

## Out of Scope (v1)

- Command / action mode (`Ctrl+Shift+P`).
- In-file content search (grep).
- Recent-files (MRU) ordering.
- A dedicated backend file-list endpoint.

## Build / Run

Use the Taskfile, not `cargo`/`npm` directly: `task ui` (build Svelte UI),
`task dev` (dev server), `task build` (release binary).
