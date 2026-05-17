<script>
  import { onMount } from "svelte";
  import FileManager from "./FileManager.svelte";
  import CodeEditor, { supportedLangs } from "./CodeEditor.svelte";
  import TermTab from "./TermTab.svelte";
  import { fileIcon } from "./fileIcon.js";
  import { marked } from "marked";

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");

  // ── Terminal tabs ─────────────────────────────────────────────────────────
  let termTabCounter = 1;
  /** @type {string[]} terminal tab ids */
  let termTabs = $state(["t1"]);
  /** @type {string[]} tab bar ids in display order */
  let tabOrder = $state(["t1"]);

  function newTermTab() {
    termTabCounter++;
    const id = `t${termTabCounter}`;
    termTabs.push(id);
    tabOrder.push(id);
    activeTab = id;
  }

  function closeTermTab(id) {
    if (termTabs.length === 1) return; // keep at least one
    const next = tabAfterClose(id);
    termTabs = termTabs.filter(t => t !== id);
    tabOrder = tabOrder.filter(t => t !== id);
    if (activeTab === id) {
      activeTab = next ?? termTabs[0];
    }
  }

  // ── File tabs ─────────────────────────────────────────────────────────────
  /**
   * @typedef {{ id: string, path: string, name: string, content: string, editContent: string, mode: 'view'|'edit', isBinary: boolean, error: string, saveStatus: string, loading?: boolean, skipRefreshOnActivate?: boolean }} FileTab
   */
  /** @type {FileTab[]} */
  let fileTabs = $state([]);

  /** @param {string} path @param {string} content @param {boolean} isBinary @param {string} error @param {boolean} loading */
  function openFileTab(path, content, isBinary, error, loading = false) {
    if (fileTabs.find(t => t.id === path)) { activeTab = path; return; }
    fileTabs.push({ id: path, path, name: path.split("/").pop() || path, content, editContent: content, mode: "edit", isBinary, error, saveStatus: "", langOverride: "", preview: false, loading, skipRefreshOnActivate: true });
    tabOrder.push(path);
    activeTab = path;
  }

  function closeFileTab(id) {
    const idx = fileTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const next = tabAfterClose(id);
    fileTabs.splice(idx, 1);
    tabOrder = tabOrder.filter(t => t !== id);
    if (activeTab === id) {
      activeTab = next ?? termTabs[0];
    }
  }

  /** @returns {FileTab|undefined} */
  function activeFileTab() { return fileTabs.find(t => t.id === activeTab); }
  /** @param {string} id @returns {FileTab|undefined} */
  function fileTabById(id) { return fileTabs.find(t => t.id === id); }

  // ── Active tab ────────────────────────────────────────────────────────────
  let activeTab = $state("t1");
  let showSidebar = $state(false);
  let sidebarWidth = $state(220);
  let searchTrigger = $state(0);

  function isTermTab(id) { return termTabs.includes(id); }
  function openActiveSearch() { searchTrigger++; }
  function switchTab(delta) {
    if (tabOrder.length <= 1) return;
    const idx = tabOrder.indexOf(activeTab);
    const nextIdx = idx === -1
      ? 0
      : (idx + delta + tabOrder.length) % tabOrder.length;
    activeTab = tabOrder[nextIdx];
  }
  function onGlobalKeydown(e) {
    const nextByPage = e.ctrlKey && !e.metaKey && !e.altKey && e.key === "PageDown";
    const prevByPage = e.ctrlKey && !e.metaKey && !e.altKey && e.key === "PageUp";
    const nextByAltPage = e.altKey && !e.ctrlKey && !e.metaKey && e.key === "PageDown";
    const prevByAltPage = e.altKey && !e.ctrlKey && !e.metaKey && e.key === "PageUp";
    const nextByBracket = e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "]";
    const prevByBracket = e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "[";

    if (nextByPage || nextByAltPage || nextByBracket) {
      e.preventDefault();
      e.stopPropagation();
      switchTab(1);
    } else if (prevByPage || prevByAltPage || prevByBracket) {
      e.preventDefault();
      e.stopPropagation();
      switchTab(-1);
    }
  }
  function tabAfterClose(id) {
    const remaining = tabOrder.filter(t => t !== id);
    const idx = tabOrder.indexOf(id);
    if (idx === -1) return remaining[0];
    return remaining[Math.min(idx, remaining.length - 1)] ?? remaining[idx - 1];
  }

  // ── Sidebar resize ────────────────────────────────────────────────────────
  function onResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    function onMove(e) {
      sidebarWidth = Math.min(600, Math.max(120, startW + e.clientX - startX));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── Tab drag-to-reorder ───────────────────────────────────────────────────
  let dragSrcId = null;
  let dragOverId = $state(null);
  function onTabBarMouseDown(e) {
    if (e.target.closest?.(".tab")) return;
    e.preventDefault();
  }
  function onDragStart(e, id) {
    dragSrcId = id;
    dragOverId = null;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }
  function onDragOver(e, id) {
    if (dragSrcId && dragSrcId !== id) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      dragOverId = id;
    }
  }
  function onDrop(e, id) {
    e.preventDefault();
    if (!dragSrcId || dragSrcId === id) {
      dragSrcId = null;
      dragOverId = null;
      return;
    }
    const from = tabOrder.indexOf(dragSrcId), to = tabOrder.indexOf(id);
    if (from === -1 || to === -1) return;
    const nextOrder = [...tabOrder];
    const [moved] = nextOrder.splice(from, 1);
    nextOrder.splice(to, 0, moved);
    tabOrder = nextOrder;
    activeTab = moved;
    dragSrcId = null;
    dragOverId = null;
  }
  function onDragEnd() { dragSrcId = null; dragOverId = null; }

  // Re-fetch file content when switching to a file tab (picks up external edits)
  // Only updates if the user has no unsaved changes
  let prevActiveTab = $state("t1");
  $effect(() => {
    const tab = activeTab;
    if (tab === prevActiveTab) return;
    prevActiveTab = tab;
    if (termTabs.includes(tab)) return;
    const ft = fileTabs.find(t => t.id === tab);
    if (!ft || ft.loading || ft.isBinary || ft.error) return;
    if (ft.skipRefreshOnActivate) {
      ft.skipRefreshOnActivate = false;
      return;
    }
    // Don't overwrite unsaved edits
    if (ft.editContent !== ft.content) return;
    fetch(`${basePath}/api/files/read?path=${encodeURIComponent(ft.path)}`).then(async r => {
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    }).then(result => {
      const text = result.content ?? "";
      // Re-check: still no unsaved edits before applying
      if (ft.editContent === ft.content) {
        ft.content = text;
        ft.editContent = text;
        ft.isBinary = !!result.is_binary;
      }
    }).catch(() => {});
  });

  onMount(() => {
    // Capture before xterm/CodeMirror can consume tab-switch shortcuts.
    window.addEventListener("keydown", onGlobalKeydown, { capture: true });
    return () => window.removeEventListener("keydown", onGlobalKeydown, { capture: true });
  });
</script>

<div id="app-root">
  <div id="tab-bar" role="toolbar" tabindex="-1" onmousedown={onTabBarMouseDown}>
    <!-- Sidebar toggle -->
    <div class="tab-sidebar-btn" class:active={showSidebar}
      role="button" tabindex="-1"
      onclick={() => { showSidebar = !showSidebar; }}
      onkeydown={(e) => e.key === "Enter" && (showSidebar = !showSidebar)}
      title="Toggle file explorer">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.5 7.5V6a2 2 0 0 1 2-2h4.2l2 2H18a2 2 0 0 1 2 2v1.5"/>
        <path d="M3 9.5h18l-1.2 8.2a2 2 0 0 1-2 1.8H6.2a2 2 0 0 1-2-1.8L3 9.5z"/>
        <path d="M7.5 13h5"/>
        <path d="M7.5 16h8"/>
      </svg>
    </div>

    <!-- Search active tab -->
    <button class="tab-search-btn" type="button" onclick={openActiveSearch} title="Find in active tab" aria-label="Find in active tab">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.6"/>
        <line x1="10.4" y1="10.4" x2="14" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </button>

    <!-- New terminal tab -->
    <div class="tab-new-btn" role="button" tabindex="-1" onclick={newTermTab} onkeydown={(e) => e.key === "Enter" && newTermTab()} title="New terminal">
      <svg width="14" height="14" viewBox="0 0 14 14"><line x1="7" y1="1.5" x2="7" y2="12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="1.5" y1="7" x2="12.5" y2="7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </div>

    <!-- Ordered tabs -->
    {#each tabOrder as tabId (tabId)}
      {#if isTermTab(tabId)}
        <div class="tab" class:active={activeTab === tabId} class:tab-drag-over={dragOverId === tabId}
          role="button" tabindex="-1"
          draggable="true"
          ondragstart={(e) => onDragStart(e, tabId)}
          ondragover={(e) => onDragOver(e, tabId)}
          ondragleave={() => { if (dragOverId === tabId) dragOverId = null; }}
          ondrop={(e) => onDrop(e, tabId)}
          ondragend={onDragEnd}
          onclick={() => { activeTab = tabId; }}
          onkeydown={(e) => e.key === "Enter" && (activeTab = tabId)}>
          <svg class="tab-icon-svg" width="13" height="13" viewBox="0 0 16 16" fill="none">
            <polyline points="2,5 7,8 2,11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <line x1="8.5" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span class="tab-name">Terminal {termTabs.length > 1 ? termTabs.indexOf(tabId) + 1 : ""}</span>
          {#if termTabs.length > 1}
            <span class="tab-close" role="button" tabindex="-1"
              onclick={(e) => { e.stopPropagation(); closeTermTab(tabId); }}
              onkeydown={(e) => e.key === "Enter" && (e.stopPropagation(), closeTermTab(tabId))}>
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </span>
          {/if}
        </div>
      {:else if fileTabById(tabId)}
        {@const tab = fileTabById(tabId)}
        {@const icon = fileIcon(tab.name)}
        <div class="tab" class:active={activeTab === tab.id} class:tab-drag-over={dragOverId === tab.id}
          role="button" tabindex="-1"
          draggable="true"
          ondragstart={(e) => onDragStart(e, tab.id)}
          ondragover={(e) => onDragOver(e, tab.id)}
          ondragleave={() => { if (dragOverId === tab.id) dragOverId = null; }}
          ondrop={(e) => onDrop(e, tab.id)}
          ondragend={onDragEnd}
          class:tab-modified={tab.mode === "edit" && tab.editContent !== tab.content}
          onclick={() => { activeTab = tab.id; }}
          onkeydown={(e) => e.key === "Enter" && (activeTab = tab.id)}>
          {#if icon}
            <span class="tab-file-badge" style:background={icon.bg} style:color={icon.color}>{icon.label}</span>
          {:else}
            <svg class="tab-icon-svg" width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M4 2h5.5L12 4.5V14H4V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
              <polyline points="9,2 9,5 12,5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
            </svg>
          {/if}
          <span class="tab-name">{tab.name}</span>
          {#if tab.saveStatus === "saving"}
            <span style="font-size:10px;opacity:0.5">↑</span>
          {:else if tab.saveStatus === "saved"}
            <span style="font-size:10px;color:#98c379">✓</span>
          {:else if tab.saveStatus === "error"}
            <span style="font-size:10px;color:#e06c75">!</span>
          {/if}
          <span class="tab-close" role="button" tabindex="-1"
            onclick={(e) => { e.stopPropagation(); closeFileTab(tab.id); }}
            onkeydown={(e) => e.key === "Enter" && (e.stopPropagation(), closeFileTab(tab.id))}>
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </span>
        </div>
      {/if}
    {/each}

  </div>

  <div id="app-body">
    <!-- Sidebar -->
    <div class="fm-sidebar-wrap" class:hidden={!showSidebar} style:width="{sidebarWidth}px">
      <FileManager bind:fileTabs {activeTab} {openFileTab} visible={showSidebar} />
    </div>
    <button class="fm-resize-handle" class:hidden={!showSidebar} type="button" aria-label="Resize file explorer"
      onmousedown={onResizeStart}></button>

    <!-- Terminal tabs (all mounted, hidden when inactive so state is preserved) -->
    {#each termTabs as tid (tid)}
      <div class="term-wrap" class:hidden={activeTab !== tid}>
        <TermTab active={activeTab === tid} findTrigger={searchTrigger} />
      </div>
    {/each}

    <!-- File content -->
    {#if !isTermTab(activeTab)}
      {@const tab = activeFileTab()}
      {#if tab}
        <div id="file-content">
          {#if tab.loading}
            <div class="fm-loading">Loading...</div>
          {:else if tab.error}
            <div class="fm-error fm-error-main">{tab.error}</div>
          {:else if tab.isBinary}
            <div class="fm-binary">
              <span class="fm-binary-icon">⬡</span>
              <span>Binary file — cannot display as text</span>
              <code class="fm-binary-path">{tab.path}</code>
            </div>
          {:else}
            {#if tab.preview}
              <div class="fm-md-preview">{@html marked(tab.editContent)}</div>
            {:else}
              {#key tab.id + tab.langOverride}
              <CodeEditor
                path={tab.path}
                value={tab.editContent}
                lang={tab.langOverride}
                searchTrigger={searchTrigger}
                onchange={(v) => { tab.editContent = v; }}
                onsave={async () => {
                  tab.saveStatus = "saving";
                  try {
                    await fetch(`${basePath}/api/tools/call`, {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: "write_file", arguments: { path: tab.path, content: tab.editContent } }),
                    });
                    tab.content = tab.editContent; tab.saveStatus = "saved";
                    setTimeout(() => { tab.saveStatus = ""; }, 2000);
                  } catch { tab.saveStatus = "error"; }
                }}
              />
              {/key}
            {/if}
          {/if}

          <div class="fm-breadcrumb">
            <span class="fm-bc-part">{tab.path}</span>
            <div class="fm-bc-tools">
              {#if tab.path.endsWith(".md")}
                <button class="fm-preview-btn" class:active={tab.preview} onclick={() => { tab.preview = !tab.preview; }}>
                  {tab.preview ? "✎ Edit" : "👁 Preview"}
                </button>
              {/if}
              <select id="lang-select" class="fm-lang-select" value={tab.langOverride} onchange={(e) => { tab.langOverride = e.target.value; }}>
                <option value="">Auto</option>
                {#each supportedLangs as l}
                  <option value={l}>{l}</option>
                {/each}
              </select>
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
