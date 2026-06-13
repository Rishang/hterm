# Command Palette (Ctrl/Cmd+P) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyboard-driven overlay (`Ctrl/Cmd+P`) that fuzzy-finds and opens any project file.

**Architecture:** Two pure, node-testable JS modules — `fuzzy.js` (subsequence scorer) and `fileList.js` (parse + fetch the file list via the existing `bash` tool) — plus a `CommandPalette.svelte` overlay that composes them. `App.svelte` owns the open state and a shared `openFileByPath` helper that both the palette and the file-tree sidebar route through.

**Tech Stack:** Svelte 5 (runes), Vite, the hterm `bash` tool via `POST /api/tools/call`. No new backend code. No JS test harness exists, so pure logic is verified with `node --input-type=module` and UI is verified manually via `task dev`.

**Spec:** `docs/superpowers/specs/2026-06-13-command-palette-design.md`

**Conventions:**
- Build/run via the Taskfile only: `task ui`, `task dev`, `task build`. Never call `cargo`/`npm` directly.
- All work happens on the `feature/command-palette` branch (already created).
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 1: Fuzzy matcher module

**Files:**
- Create: `ui/src/fuzzy.js`

- [ ] **Step 1: Write the module**

Create `ui/src/fuzzy.js`:

```js
/**
 * Score a path against a query using subsequence matching.
 * Returns { score, positions } where positions are matched char indices into `path`,
 * or null if not every query char can be matched in order.
 * Higher score = better match.
 *
 * @param {string} path
 * @param {string} query  caller passes the trimmed query (may be any case)
 * @returns {{ score: number, positions: number[] } | null}
 */
export function fuzzyScore(path, query) {
  if (!query) return { score: 0, positions: [] };
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  const slashIdx = path.lastIndexOf("/");
  const positions = [];
  let pi = 0;
  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  while (pi < p.length && qi < q.length) {
    if (p[pi] === q[qi]) {
      let s = 1;
      if (pi === prevMatch + 1) s += 5;                  // consecutive run
      const prevCh = pi > 0 ? p[pi - 1] : "/";
      if (/[/_\-. ]/.test(prevCh)) s += 8;               // start of a path/word segment
      if (pi > slashIdx) s += 3;                         // inside the basename
      score += s;
      positions.push(pi);
      prevMatch = pi;
      qi++;
    }
    pi++;
  }
  if (qi < q.length) return null;                        // query not fully matched
  score -= path.length * 0.05;                           // mild preference for shorter paths
  return { score, positions };
}

/**
 * Filter and rank `paths` against `query`.
 * @param {string[]} paths
 * @param {string} query  trimmed query; empty returns the head of the list unranked
 * @param {number} [limit]
 * @returns {{ path: string, score: number, positions: number[] }[]}
 */
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

- [ ] **Step 2: Verify behavior with node**

Run from the repo root:

```bash
node --input-type=module -e "
import { fuzzyScore, fuzzyFilter } from './ui/src/fuzzy.js';
const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };

// Non-matching subsequence returns null.
assert(fuzzyScore('src/main.rs', 'xyz') === null, 'xyz should not match');

// Subsequence matches and records positions.
const r = fuzzyScore('src/main.rs', 'main');
assert(r && r.positions.length === 4, 'main should match 4 chars');

// Basename + boundary match outranks a scattered mid-word match.
const ranked = fuzzyFilter(['ui/src/CommandPalette.svelte', 'docs/cmd-notes.md'], 'cmd');
assert(ranked[0].path === 'docs/cmd-notes.md', 'boundary basename match should rank first, got ' + ranked[0].path);

// Empty query returns the head of the list unranked.
const head = fuzzyFilter(['a', 'b', 'c'], '', 2);
assert(head.length === 2 && head[0].path === 'a', 'empty query returns head');

console.log('OK');
"
```

Expected: prints `OK` and exits 0.

- [ ] **Step 3: Commit**

```bash
git add ui/src/fuzzy.js
git commit -m "Add fuzzy file-name matcher for command palette

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: File-list service

**Files:**
- Create: `ui/src/fileList.js`

- [ ] **Step 1: Write the module**

Create `ui/src/fileList.js`. Keep it free of `import.meta` so node can import it directly; `basePath` is passed in by the caller.

```js
/**
 * Parse the bash-tool response text into a clean list of file paths.
 * The bash tool prepends `set -x`, whose trace lands in stderr and is appended
 * after a "\n--- stderr ---\n" delimiter, so we keep only the part before it.
 * Strips a leading "./" (the `find` fallback emits it; rg/fd do not).
 * @param {string} text
 * @returns {string[]}
 */
export function parseFileList(text) {
  const stdout = text.split("\n--- stderr ---\n")[0];
  return stdout
    .split("\n")
    .map((s) => s.trim().replace(/^\.\//, ""))
    .filter((s) => s.length > 0);
}

/**
 * Fetch the project's file list via the bash tool.
 * rg/fd respect .gitignore (skipping node_modules/.git/target); find is the last resort.
 * @param {string} basePath
 * @returns {Promise<string[]>}
 */
export async function fetchFileList(basePath) {
  const command =
    "rg --files 2>/dev/null || fd -t f 2>/dev/null || find . -type f -not -path '*/.git/*'";
  const res = await fetch(`${basePath}/api/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "bash", arguments: { command } }),
  });
  if (!res.ok) throw new Error(`File list request failed: ${res.status}`);
  const data = await res.json();
  if (data?.isError) {
    const msg = data?.content?.[0]?.text || "file list command failed";
    throw new Error(msg);
  }
  const text = data?.content?.[0]?.text ?? "";
  return parseFileList(text);
}
```

- [ ] **Step 2: Verify the parser with node**

Run from the repo root:

```bash
node --input-type=module -e "
import { parseFileList } from './ui/src/fileList.js';
const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };

// Strips the set -x stderr trace appended after the delimiter.
const out = parseFileList('src/main.rs\nsrc/tools.rs\n--- stderr ---\n+ rg --files');
assert(out.length === 2 && out[0] === 'src/main.rs', 'should keep only stdout, got ' + JSON.stringify(out));

// Strips leading ./ from the find fallback and drops blank lines.
const out2 = parseFileList('./a.txt\n\n./dir/b.txt\n');
assert(out2.length === 2 && out2[0] === 'a.txt' && out2[1] === 'dir/b.txt', 'should normalize ./ and drop blanks, got ' + JSON.stringify(out2));

console.log('OK');
"
```

Expected: prints `OK` and exits 0.

- [ ] **Step 3: Commit**

```bash
git add ui/src/fileList.js
git commit -m "Add file-list service backed by the bash tool

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: CommandPalette component

**Files:**
- Create: `ui/src/CommandPalette.svelte`

- [ ] **Step 1: Write the component**

Create `ui/src/CommandPalette.svelte`. It composes `fuzzy.js` + `fileList.js`, caches the list for the session, and shows the cache instantly while refreshing in the background.

```svelte
<script>
  import { fuzzyFilter } from "./fuzzy.js";
  import { fetchFileList } from "./fileList.js";

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");

  /** @type {{ open: boolean, openFileByPath: (path: string) => void }} */
  let { open = $bindable(false), openFileByPath } = $props();

  /** Session cache of file paths (persists across opens). */
  let allFiles = $state([]);
  let loading = $state(false);
  let loadError = $state("");
  let query = $state("");
  let selected = $state(0);
  /** @type {HTMLInputElement | null} */
  let inputEl = $state(null);
  /** @type {HTMLElement | null} */
  let listEl = $state(null);

  const results = $derived(fuzzyFilter(allFiles, query.trim(), 50));

  async function refresh() {
    // Only block the UI with "Indexing…" on the very first load; otherwise refresh silently.
    loading = allFiles.length === 0;
    loadError = "";
    try {
      allFiles = await fetchFileList(basePath);
    } catch (e) {
      loadError = String(e instanceof Error ? e.message : e);
    } finally {
      loading = false;
    }
  }

  // On open: reset query/selection, focus the input, show cache + background refresh.
  $effect(() => {
    if (open) {
      query = "";
      selected = 0;
      queueMicrotask(() => { inputEl?.focus(); inputEl?.select(); });
      refresh();
    }
  });

  // Keep the selection in range as results change.
  $effect(() => {
    if (selected >= results.length) selected = Math.max(0, results.length - 1);
  });

  function close() { open = false; }

  function choose(path) {
    if (!path) return;
    openFileByPath(path);
    close();
  }

  function scrollSelectedIntoView() {
    queueMicrotask(() => {
      listEl?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function onKeydown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = results.length ? (selected + 1) % results.length : 0;
      scrollSelectedIntoView();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = results.length ? (selected - 1 + results.length) % results.length : 0;
      scrollSelectedIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[selected]?.path);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  /** Break path[from,to) into {text, hit} runs, hit = matched char. */
  function segments(path, hitSet, from, to) {
    const out = [];
    let cur = "";
    let curHit = null;
    for (let i = from; i < to; i++) {
      const hit = hitSet.has(i);
      if (hit !== curHit) {
        if (cur) out.push({ text: cur, hit: curHit });
        cur = "";
        curHit = hit;
      }
      cur += path[i];
    }
    if (cur) out.push({ text: cur, hit: curHit });
    return out;
  }
</script>

{#if open}
  <div class="cmdp-backdrop" role="presentation" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="cmdp" role="dialog" aria-label="Open file" onclick={(e) => e.stopPropagation()}>
      <input
        bind:this={inputEl}
        bind:value={query}
        class="cmdp-input"
        type="text"
        placeholder="Search files by name…"
        aria-label="Search files by name"
        autocomplete="off"
        spellcheck="false"
        onkeydown={onKeydown}
      />
      <div class="cmdp-list" bind:this={listEl} role="listbox" tabindex="-1" aria-label="Files">
        {#if loading}
          <div class="cmdp-empty">Indexing files…</div>
        {:else if loadError}
          <div class="cmdp-empty cmdp-error">{loadError}</div>
        {:else if results.length === 0}
          <div class="cmdp-empty">No files found</div>
        {:else}
          {#each results as r, i (r.path)}
            {@const hitSet = new Set(r.positions)}
            {@const slash = r.path.lastIndexOf("/")}
            <button
              type="button"
              class="cmdp-row"
              class:selected={i === selected}
              data-idx={i}
              role="option"
              aria-selected={i === selected}
              onmousemove={() => { if (selected !== i) selected = i; }}
              onclick={() => choose(r.path)}>
              {#if slash >= 0}
                <span class="cmdp-dir">
                  {#each segments(r.path, hitSet, 0, slash + 1) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}
                </span>
              {/if}
              <span class="cmdp-name">
                {#each segments(r.path, hitSet, slash + 1, r.path.length) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/CommandPalette.svelte
git commit -m "Add CommandPalette overlay component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: this component is not yet imported anywhere, so Vite will not build it until Task 4. Its first real compile check is `task ui` in Task 4 Step 5 — if it has a syntax error, that build will catch it.

---

### Task 4: Wire the palette into App.svelte

**Files:**
- Modify: `ui/src/App.svelte` (import + `openFileByPath` near line 47, `paletteOpen` state, `onGlobalKeydown` at line 139, render near line 442)

- [ ] **Step 1: Import the component**

In `ui/src/App.svelte`, add the import after the existing `ShortcutInfo` import (line 6):

```js
  import ShortcutInfo from "./ShortcutInfo.svelte";
  import CommandPalette from "./CommandPalette.svelte";
```

- [ ] **Step 2: Add the shared `openFileByPath` helper and palette state**

Immediately after the `openFileTab` function (ends at line 57), add:

```js
  let paletteOpen = $state(false);

  /**
   * Open a file by path: focus an existing tab, or open a loading tab and
   * fetch its content. Shared by the file sidebar and the command palette.
   * @param {string} path
   */
  async function openFileByPath(path) {
    if (fileTabs.find(t => t.id === path)) {
      openFileTab(path, "", false, "");
      return;
    }
    openFileTab(path, "", false, "", true);
    try {
      const res = await fetch(`${basePath}/api/files/read?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      const tab = fileTabs.find(t => t.id === path);
      if (!tab) return;
      tab.content = result.content ?? "";
      tab.editContent = tab.content;
      tab.isBinary = !!result.is_binary;
      tab.error = "";
      tab.loading = false;
      fileTabs = fileTabs;
    } catch (e) {
      const tab = fileTabs.find(t => t.id === path);
      if (!tab) return;
      tab.content = "";
      tab.editContent = "";
      tab.isBinary = false;
      tab.error = String(e);
      tab.loading = false;
      fileTabs = fileTabs;
    }
  }
```

- [ ] **Step 3: Handle Ctrl/Cmd+P in the global keydown handler**

In `onGlobalKeydown` (starts line 139), add a binding alongside the existing ones (after the `prevByBracket` line, line 146):

```js
    const prevByBracket = e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "[";
    const openPalette = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "p" || e.key === "P");
```

Then add this as the FIRST branch of the `if` chain (before `if (switchType) {`, line 148) so it always wins:

```js
    if (openPalette) {
      e.preventDefault();
      e.stopPropagation();
      paletteOpen = !paletteOpen;
    } else if (switchType) {
```

- [ ] **Step 4: Render the palette**

In the markup, add the component just inside `#app-root`, right before the closing `</div>` at line 490:

```svelte
    </div>
  </div>
  <CommandPalette bind:open={paletteOpen} {openFileByPath} />
</div>
```

(The existing structure is `<div id="app-root"> … <div id="app-body"> … </div> </div>`; the palette goes after `#app-body`'s closing `</div>` and before `#app-root`'s closing `</div>`.)

- [ ] **Step 5: Build and verify in the browser**

```bash
task ui && task dev
```

Then in the browser:
1. Press `Ctrl+P` (or `Cmd+P` on macOS). Expected: the overlay appears, the input is focused, the browser's print dialog does NOT appear.
2. The list shows files (briefly "Indexing files…" on first open).
3. Type part of a filename — the list narrows and re-ranks, matched chars highlighted.
4. `↑`/`↓` move the highlighted row and scroll it into view; `Enter` opens the selected file as a tab; the palette closes.
5. Click a row — it opens that file and closes the palette.
6. `Ctrl+P` again then `Esc` — the palette closes.

- [ ] **Step 6: Commit**

```bash
git add ui/src/App.svelte
git commit -m "Wire command palette into App with Ctrl/Cmd+P and shared openFileByPath

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Route FileManager through the shared helper

**Files:**
- Modify: `ui/src/FileManager.svelte` (props at line 5, `handleClick` at lines 116-144, render usage)
- Modify: `ui/src/App.svelte` (the `<FileManager … />` tag at line 445)

- [ ] **Step 1: Accept `openFileByPath` as a prop**

In `ui/src/FileManager.svelte`, update the props (line 4-5):

```js
  /** @type {{ fileTabs: any[], activeTab: string, openFileTab: Function, openFileByPath: Function, visible?: boolean }} */
  let { fileTabs, activeTab, openFileTab, openFileByPath, visible = true } = $props();
```

- [ ] **Step 2: Simplify `handleClick` to delegate file opening**

Replace the entire `handleClick` function (lines 116-144) with:

```js
  async function handleClick(node) {
    if (node.is_dir) { toggleDir(node); return; }
    openFileByPath(node.path);
  }
```

- [ ] **Step 3: Pass the prop from App**

In `ui/src/App.svelte`, update the `<FileManager … />` tag (line 445):

```svelte
      <FileManager bind:fileTabs {activeTab} {openFileTab} {openFileByPath} visible={showSidebar} />
```

- [ ] **Step 4: Build and verify the sidebar still opens files**

```bash
task ui && task dev
```

In the browser:
1. Click a file in the sidebar tree — it opens as a tab with content (same as before).
2. Click a directory — it still expands/collapses (unchanged).
3. Click a file that is already open — it focuses the existing tab without refetching.

- [ ] **Step 5: Commit**

```bash
git add ui/src/FileManager.svelte ui/src/App.svelte
git commit -m "Route FileManager file-open through shared openFileByPath

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Palette styles

**Files:**
- Modify: `ui/src/global.css` (append a new block)

- [ ] **Step 1: Add the styles**

Append to `ui/src/global.css`:

```css
/* ── Command palette ─────────────────────────────────────────────────────── */
.cmdp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.35);
}
.cmdp {
  width: min(640px, 92vw);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border-muted);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.cmdp-input {
  flex: 0 0 auto;
  padding: 12px 14px;
  font-size: 14px;
  color: var(--text-bright);
  background: var(--bg-surface-strong);
  border: none;
  border-bottom: 1px solid var(--border);
  outline: none;
}
.cmdp-input::placeholder { color: var(--text-muted); }
.cmdp-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 4px 0;
}
.cmdp-empty {
  padding: 14px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}
.cmdp-error { color: var(--status-disconnected); }
.cmdp-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 6px 14px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
}
.cmdp-row.selected { background: var(--accent-dim-strong); }
.cmdp-name { color: var(--text-bright); font-weight: 600; }
.cmdp-dir { color: var(--text-muted); font-size: 12px; }
.cmdp-row mark {
  background: transparent;
  color: var(--accent);
  font-weight: 700;
}
```

- [ ] **Step 2: Build and verify appearance**

```bash
task ui && task dev
```

Expected (browser): the palette is a centered card near the top, dimmed backdrop behind it, selected row tinted, matched characters shown in the accent color, directory path dimmed and smaller than the bold filename.

- [ ] **Step 3: Commit**

```bash
git add ui/src/global.css
git commit -m "Add command palette styles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Document the shortcut

**Files:**
- Modify: `ui/src/ShortcutInfo.svelte` (both arrays, lines 8-28)

- [ ] **Step 1: Add the Ctrl/Cmd+P entry**

In `ui/src/ShortcutInfo.svelte`, add a row to the macOS array (after line 8 `const shortcutHints = isMacOS ? [`):

```js
  const shortcutHints = isMacOS ? [
    ["Cmd + P", "Open file (command palette)"],
    ["Ctrl + `", "Switch between terminal and file tabs"],
```

And to the non-macOS array (the `] : [` branch, after line 18):

```js
  ] : [
    ["Ctrl + P", "Open file (command palette)"],
    ["Ctrl + `", "Switch between terminal and file tabs"],
```

- [ ] **Step 2: Build and verify**

```bash
task ui && task dev
```

Expected: clicking the shortcuts info button (the `(i)` icon in the tab bar) shows the popover with `Ctrl/Cmd + P — Open file (command palette)` at the top.

- [ ] **Step 3: Commit**

```bash
git add ui/src/ShortcutInfo.svelte
git commit -m "Document Ctrl/Cmd+P in the shortcuts popover

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Build a release bundle and run**

```bash
task ui && task dev
```

- [ ] **Step 2: Run the spec's manual checklist in the browser**

1. `Ctrl+P` opens the palette; `Esc` closes it; the browser print dialog never appears.
2. Typing a partial name fuzzy-ranks sensibly (basename matches rank above scattered matches).
3. `↑`/`↓` move selection and auto-scroll; `Enter` and mouse click both open the file.
4. Opening an already-open file focuses its existing tab (no duplicate tab, no refetch flicker).
5. Create a new file via the sidebar, reopen the palette — the new file appears (background refresh).
6. In an empty directory / with a query that matches nothing → "No files found".
7. Simulate missing `rg`: in a terminal tab run `PATH=/usr/bin command -v rg` to confirm fallback reasoning, or temporarily rename `rg`; reopen the palette and confirm files still list via `fd`/`find`.

- [ ] **Step 3: Confirm no regressions to existing shortcuts**

`Ctrl+\`` (switch tab type), `Cmd/Ctrl+F` (find in active tab), tab next/prev, and `Cmd/Ctrl+S` (save) all still work — the new palette branch in `onGlobalKeydown` only triggers on `p`.

- [ ] **Step 4: Final review**

Run `git log --oneline feature/command-palette` and confirm one commit per task. The feature branch is ready for a PR (do not push or open the PR unless the user asks).
```

