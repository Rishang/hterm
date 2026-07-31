<script>
  import { fileIcon } from "./fileIcon.js";
  import {
    runSearch, groupByFile, MAX_RESULT_LINES, MAX_SEARCH_HITS,
    replaceHitsInText, replacementPreview, readFileText, writeFileText,
  } from "./globalSearch.js";

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");
  const ROOT_STORAGE_KEY = "hterm:file-manager-root";
  /**
   * Searches run only when the user presses Enter. Every run spawns a real
   * ripgrep process across the whole tree, which is far too costly to fire on
   * each keystroke.
   */

  /** @type {{ open?: boolean, focusTrigger?: number, replaceTrigger?: number, root?: string, openFileAt: (path: string, line: number, column: number, length: number, focus?: boolean) => void, bufferContent?: (path: string) => string | null, setBufferContent?: (path: string, next: string) => boolean, onClose?: () => void }} */
  let {
    open = false, focusTrigger = 0, replaceTrigger = 0, root = "/", openFileAt,
    bufferContent = () => null, setBufferContent = () => false,
    onClose = () => {},
  } = $props();

  let query = $state("");
  let replaceValue = $state("");
  let replaceVisible = $state(false);
  let replacing = $state(false);
  /** Set while a global Replace All waits for confirmation. */
  let pendingReplaceAll = $state(false);
  /** Outcome banner after an apply, e.g. "Replaced 12 occurrences in 4 files". */
  let replaceNotice = $state("");
  /**
   * Files that could not be written. Kept apart from `error` because the
   * refresh that follows a replace clears `error`, which would swallow this.
   */
  let replaceError = $state("");
  let include = $state("");
  let exclude = $state("");
  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let regexp = $state(false);
  let globsVisible = $state(true);
  let searching = $state(false);
  let error = $state("");
  let truncated = $state(false);
  /** @type {import("./globalSearch.js").SearchHit[]} */
  let hits = $state([]);
  let selected = $state(-1);
  let searchedRoot = $state("");
  /** @type {HTMLInputElement | null} */
  let input = $state(null);
  /** @type {HTMLElement | null} */
  let listEl = $state(null);

  /** Guards against a slow earlier search overwriting a newer one's results. */
  let requestId = 0;
  /** Query or filters edited since the last run — Enter is needed to apply them. */
  let unapplied = $state(false);

  const groups = $derived(groupByFile(hits, searchedRoot));
  const countText = $derived(
    unapplied && query.trim()
      ? "Press Enter"
      : hits.length === 0
        ? (query.trim() && !searching ? "No results" : "")
        : `${selected + 1}/${hits.length}`
  );

  /**
   * The explorer's root is the search scope. It stays "/" until the sidebar has
   * been opened at least once, so fall back to the persisted root and then the
   * server's cwd rather than searching the whole filesystem.
   */
  async function effectiveRoot() {
    if (root && root !== "/") return root;
    try {
      const saved = localStorage.getItem(ROOT_STORAGE_KEY);
      if (saved) return saved;
    } catch { /* storage unavailable — fall through */ }
    try {
      const res = await fetch(`${basePath}/api/config`);
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.cwd) return cfg.cwd;
      }
    } catch { /* fall back to whatever we have */ }
    return root || "/";
  }

  function clearResults() {
    hits = [];
    selected = -1;
    truncated = false;
    error = "";
  }

  async function search() {
    const term = query.trim();
    if (!term) {
      clearResults();
      searching = false;
      return;
    }
    const id = ++requestId;
    searching = true;
    error = "";
    try {
      const scope = await effectiveRoot();
      const result = await runSearch(basePath, term, scope, { caseSensitive, wholeWord, regexp, include, exclude });
      if (id !== requestId) return;
      searchedRoot = scope;
      hits = result.hits;
      truncated = result.truncated;
      selected = hits.length ? 0 : -1;
    } catch (e) {
      if (id !== requestId) return;
      clearResults();
      error = String(e instanceof Error ? e.message : e);
    } finally {
      if (id === requestId) searching = false;
    }
    unapplied = false;
  }

  /**
   * Typing does not search — it only marks the query as needing a run. Emptying
   * the box clears the results, which costs nothing.
   */
  function onQueryInput() {
    if (!query.trim()) {
      requestId++; // drop any in-flight run
      clearResults();
      searching = false;
      unapplied = false;
      return;
    }
    unapplied = true;
  }

  /** Filters only take effect on the next run. */
  function onFilterInput() {
    if (query.trim()) unapplied = true;
  }

  function runNow() {
    void search();
  }

  /** Select a result without leaving the Search tab. @param {number} index */
  function select(index) {
    if (!hits.length) return;
    const next = ((index % hits.length) + hits.length) % hits.length;
    selected = next;
    queueMicrotask(() => {
      listEl?.querySelector(`[data-idx="${next}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  /** Open the selected match in a normal editor tab. */
  function openSelected() {
    if (selected < 0 || !hits[selected]) return;
    const hit = hits[selected];
    openFileAt(hit.path, hit.line, hit.column, Math.max(0, hit.end - hit.start), true);
  }

  /** What one hit will look like after replacement, for the inline preview. */
  function previewFor(hit) {
    return replacementPreview(hit, query.trim(), { caseSensitive, wholeWord, regexp }, replaceValue);
  }

  /**
   * Rewrite a set of hits.
   *
   * A file that is open in a tab is rewritten in its buffer, exactly as VS Code
   * edits open editors in place; anything else is read and written on disk.
   * Hits whose text no longer matches (the file changed since the search) are
   * refused by the core rather than guessed at, and reported as skipped.
   * @param {import("./globalSearch.js").SearchHit[]} targets
   */
  async function applyReplace(targets) {
    if (replacing || !targets.length) return;
    const term = query.trim();
    if (!term) return;

    replacing = true;
    replaceNotice = "";
    replaceError = "";
    const opts = { caseSensitive, wholeWord, regexp };

    let occurrences = 0;
    let fileCount = 0;
    let stale = 0;
    let editedBuffer = false;
    const failures = [];

    for (const group of groupByFile(targets, "")) {
      const { path } = group;
      const fileHits = group.hits.map(({ hit }) => hit);
      try {
        const buffered = bufferContent(path);
        const original = buffered !== null ? buffered : await readFileText(basePath, path);
        if (original === null) continue; // binary — nothing to replace
        const { text, applied, skipped } = replaceHitsInText(original, fileHits, term, opts, replaceValue);
        stale += skipped;
        if (!applied || text === original) continue;
        if (buffered !== null) {
          setBufferContent(path, text);
          editedBuffer = true;
        } else {
          await writeFileText(basePath, path, text);
        }
        occurrences += applied;
        fileCount++;
      } catch (e) {
        failures.push(`${path.split("/").pop()}: ${e instanceof Error ? e.message : e}`);
      }
    }

    replacing = false;
    const parts = [];
    if (occurrences) parts.push(`Replaced ${occurrences} occurrence${occurrences === 1 ? "" : "s"} in ${fileCount} file${fileCount === 1 ? "" : "s"}`);
    if (stale) parts.push(`${stale} skipped (file changed since the search)`);
    if (!occurrences && !stale && !failures.length) parts.push("Nothing to replace");
    replaceNotice = parts.join(" · ");
    if (failures.length) replaceError = failures.join("; ");

    // Disk search cannot see unsaved editor buffers. Clear those stale results
    // until the user explicitly searches again; otherwise refresh disk results.
    if (editedBuffer) {
      clearResults();
      unapplied = true;
    } else {
      await search();
    }
  }

  function replaceAllConfirmed() {
    pendingReplaceAll = false;
    void applyReplace(hits);
  }

  function requestReplaceAll() {
    if (!hits.length || replacing) return;
    pendingReplaceAll = true;
  }

  function close() {
    pendingReplaceAll = false;
    replaceNotice = "";
    replaceError = "";
    requestId++;
    searching = false;
    onClose();
  }

  function onSearchKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter is the search trigger. Once the results match what is typed, it
      // falls through to opening the highlighted match.
      if (unapplied || !hits.length) runNow();
      else openSelected();
      return;
    }
    if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); select(selected + 1); }
    if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); select(selected - 1); }
  }

  // Focus the input on open, and again when the shortcut fires while it is
  // already open (focusTrigger changes even though `open` does not).
  $effect(() => {
    void focusTrigger;
    if (!open) return;
    queueMicrotask(() => { input?.focus(); input?.select(); });
  });

  // Ctrl/Cmd+Shift+H asks for the replace field, even if it was collapsed.
  $effect(() => {
    if (replaceTrigger > 0) replaceVisible = true;
  });

  /** Split a result line into highlighted / plain segments for one hit. */
  function segments(hit) {
    if (hit.end <= hit.start) return [{ text: hit.text, hit: false }];
    return [
      { text: hit.text.slice(0, hit.start), hit: false },
      { text: hit.text.slice(hit.start, hit.end), hit: true },
      { text: hit.text.slice(hit.end), hit: false },
    ].filter(s => s.text.length > 0);
  }

  // Nothing is scheduled in the background any more; a run in flight is
  // invalidated by bumping `requestId` in close().
</script>

{#snippet replaceIcon()}
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 4.75h6.25a2.75 2.75 0 0 1 0 5.5H5.5"/>
    <polyline points="7.25,8 5,10.25 7.25,12.5"/>
  </svg>
{/snippet}

{#if open}
  <div class="gs-panel" role="search" aria-label="Search in files">
    <div class="gs-bar">
      <button
        class="csb-expand gs-expand"
        class:csb-expanded={replaceVisible}
        type="button"
        title="Toggle Replace"
        aria-label="Toggle Replace"
        aria-expanded={replaceVisible}
        onclick={() => { replaceVisible = !replaceVisible; }}>›</button>
      <div class="gs-fields">
        <div class="csb-row gs-query-row">
          <input
            bind:this={input}
            bind:value={query}
            class="csb-input gs-input"
            placeholder="Search in files — press Enter"
            aria-label="Search in files"
            oninput={onQueryInput}
            onkeydown={onSearchKeydown}
          />
          <button class="csb-toggle" class:csb-on={caseSensitive} type="button" title="Match Case"
            onclick={() => { caseSensitive = !caseSensitive; runNow(); }}>Aa</button>
          <button class="csb-toggle" class:csb-on={wholeWord} type="button" title="Match Whole Word"
            onclick={() => { wholeWord = !wholeWord; runNow(); }}>ab̲</button>
          <button class="csb-toggle" class:csb-on={regexp} type="button" title="Use Regular Expression"
            onclick={() => { regexp = !regexp; runNow(); }}>.*</button>
        </div>
        {#if replaceVisible}
          <div class="csb-row gs-replace-row">
            <input
              bind:value={replaceValue}
              class="csb-input gs-input"
              placeholder="Replace"
              aria-label="Replace with"
              onkeydown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); close(); }
                if (e.key === "Enter") { e.preventDefault(); requestReplaceAll(); }
              }}
            />
            <button
              class="csb-btn gs-replace-all"
              type="button"
              title="Replace All"
              aria-label="Replace All"
              disabled={!hits.length || replacing}
              onclick={requestReplaceAll}>Replace All</button>
          </div>
        {/if}
        {#if globsVisible}
          <div class="csb-row gs-glob-row">
            <input
              bind:value={include}
              class="csb-input gs-glob-input"
              placeholder="Include: e.g. src/**/*.rs"
              aria-label="Files to include"
              oninput={onFilterInput}
              onkeydown={onSearchKeydown}
            />
            <input
              bind:value={exclude}
              class="csb-input gs-glob-input"
              placeholder="Exclude: e.g. vendor/*, *.lock"
              aria-label="Files to exclude"
              oninput={onFilterInput}
              onkeydown={onSearchKeydown}
            />
          </div>
        {/if}
      </div>

      <div class="gs-actions">
        <button class="csb-toggle" class:csb-on={globsVisible} type="button"
          title="Toggle include/exclude filters" aria-expanded={globsVisible}
          onclick={() => { globsVisible = !globsVisible; }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <line x1="2" y1="4.5" x2="14" y2="4.5"/><line x1="2" y1="11.5" x2="14" y2="11.5"/>
            <circle cx="6" cy="4.5" r="1.8" fill="var(--bg-surface-active)"/>
            <circle cx="10.5" cy="11.5" r="1.8" fill="var(--bg-surface-active)"/>
          </svg>
        </button>
        <button class="csb-btn" type="button" title="Previous Match" onclick={() => select(selected - 1)}>‹</button>
        <button class="csb-btn" type="button" title="Next Match" onclick={() => select(selected + 1)}>›</button>
        <span class="csb-count gs-count">{searching ? "Searching…" : countText}</span>
        <button class="csb-close" type="button" title="Close" onclick={close}>×</button>
      </div>
    </div>

    {#if pendingReplaceAll}
      <div class="gs-confirm" role="alertdialog" aria-label="Confirm replace all">
        <span class="gs-confirm-text">
          Replace {hits.length} occurrence{hits.length === 1 ? "" : "s"} across
          {groups.length} file{groups.length === 1 ? "" : "s"}?
          {#if !replaceValue}<strong>The matched text will be deleted.</strong>{/if}
        </span>
        <button class="csb-btn gs-confirm-go" type="button" onclick={replaceAllConfirmed}>Replace All</button>
        <button class="csb-btn" type="button" onclick={() => { pendingReplaceAll = false; }}>Cancel</button>
      </div>
    {/if}

    {#if replaceNotice}
      <div class="gs-notice">{replaceNotice}</div>
    {/if}
    {#if replaceError}
      <div class="gs-replace-error">Could not write — {replaceError}</div>
    {/if}

    {#if error}
      <div class="gs-error">{error}</div>
    {:else if hits.length}
      <div class="gs-summary">
        {hits.length} result{hits.length === 1 ? "" : "s"} in
        {groups.length} file{groups.length === 1 ? "" : "s"}
      </div>
      <div class="gs-results" bind:this={listEl}>
        {#each groups as group (group.path)}
          {@const icon = fileIcon(group.name)}
          <div class="gs-file">
            {#if icon}
              <span class="gs-file-badge" style:background={icon.bg} style:color={icon.color}>{icon.label}</span>
            {/if}
            <span class="gs-file-name">{group.name}</span>
            <span class="gs-file-dir">{group.relative}</span>
            <span class="gs-file-count">{group.hits.length}</span>
            {#if replaceVisible}
              <button
                class="gs-row-action"
                type="button"
                title="Replace all in this file"
                aria-label="Replace all in {group.name}"
                disabled={replacing}
                onclick={() => applyReplace(group.hits.map(e => e.hit))}>{@render replaceIcon()}</button>
            {/if}
          </div>
          {#each group.hits as entry (entry.index)}
            {@const showPreview = replaceVisible && replaceValue.length > 0}
            <div class="gs-hit-row">
              <button
                class="gs-hit"
                class:is-selected={entry.index === selected}
                type="button"
                data-idx={entry.index}
                onclick={() => { select(entry.index); openSelected(); }}>
                <span class="gs-hit-line">{entry.hit.line}</span>
                <span class="gs-hit-text">{#each segments(entry.hit) as seg, i (i)}{#if seg.hit}{#if showPreview}<del class="gs-del">{seg.text}</del><ins class="gs-ins">{previewFor(entry.hit)}</ins>{:else}<mark class="gs-mark">{seg.text}</mark>{/if}{:else}{seg.text}{/if}{/each}</span>
              </button>
              {#if replaceVisible}
                <button
                  class="gs-row-action"
                  type="button"
                  title="Replace this match"
                  aria-label="Replace match on line {entry.hit.line}"
                  disabled={replacing}
                  onclick={() => applyReplace([entry.hit])}>{@render replaceIcon()}</button>
              {/if}
            </div>
          {/each}
        {/each}
        {#if truncated}
          <div class="gs-truncated">Showing at most {MAX_RESULT_LINES} matching lines or {MAX_SEARCH_HITS} occurrences — narrow the query or add an include filter.</div>
        {/if}
      </div>
    {:else if searching}
      <div class="gs-hint">Searching…</div>
    {:else if unapplied && query.trim()}
      <div class="gs-hint">
        Press <kbd class="gs-kbd">Enter</kbd> to search for “{query.trim()}”.
      </div>
    {:else if query.trim()}
      <div class="gs-hint">No results for “{query.trim()}”</div>
    {:else}
      <div class="gs-hint">
        Search across every file in the workspace.
        <span class="gs-hint-dim">Type a query and press <kbd class="gs-kbd">Enter</kbd> to run it.</span>
      </div>
    {/if}
  </div>
{/if}
