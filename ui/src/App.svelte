<script>
  import { onMount } from "svelte";
  import FileManager from "./FileManager.svelte";
  import FilePane from "./FilePane.svelte";
  import TermTab from "./TermTab.svelte";
  import ShortcutInfo from "./ShortcutInfo.svelte";
  import { fileIcon } from "./fileIcon.js";

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
    if (lastActiveTerminalTab === id) {
      lastActiveTerminalTab = termTabs[0];
    }
    if (activeTab === id) {
      activeTab = next ?? termTabs[0];
    }
  }

  // ── File tabs ─────────────────────────────────────────────────────────────
  /**
   * @typedef {{ id: string, path: string, name: string, content: string, editContent: string, mode: 'view'|'edit', isBinary: boolean, error: string, saveStatus: string, loading?: boolean, skipRefreshOnActivate?: boolean, editorState?: import("@codemirror/state").EditorState | null }} FileTab
   */
  /** @type {FileTab[]} */
  let fileTabs = $state([]);

  /** @param {string} path @param {string} content @param {boolean} isBinary @param {string} error @param {boolean} loading */
  function openFileTab(path, content, isBinary, error, loading = false) {
    if (fileTabs.find(t => t.id === path)) {
      lastActiveFileTab = path;
      activeTab = path;
      return;
    }
    fileTabs.push({ id: path, path, name: path.split("/").pop() || path, content, editContent: content, mode: "edit", isBinary, error, saveStatus: "", langOverride: "", preview: false, loading, skipRefreshOnActivate: true, editorState: null });
    tabOrder.push(path);
    lastActiveFileTab = path;
    activeTab = path;
  }

  function closeFileTab(id) {
    const idx = fileTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const next = tabAfterClose(id);
    fileTabs.splice(idx, 1);
    tabOrder = tabOrder.filter(t => t !== id);
    if (lastActiveFileTab === id) {
      lastActiveFileTab = fileTabs[idx]?.id ?? fileTabs[idx - 1]?.id ?? fileTabs[0]?.id ?? null;
    }
    if (activeTab === id) {
      activeTab = next ?? termTabs[0];
    }
  }

  /** @param {string} id @returns {FileTab|undefined} */
  function fileTabById(id) { return fileTabs.find(t => t.id === id); }

  // ── Active tab ────────────────────────────────────────────────────────────
  let activeTab = $state("t1");
  let showSidebar = $state(false);
  let sidebarWidth = $state(220);
  let searchTrigger = $state(0);
  let lastActiveTerminalTab = $state("t1");
  let lastActiveFileTab = $state(null);
  let showShortcutHints = $state(false);
  let layoutMode = $state("single");
  let splitOrientation = $state("right");
  let splitMenuOpen = $state(false);
  let splitRatio = $state(0.5);

  function isTermTab(id) { return termTabs.includes(id); }
  function isFileTab(id) { return !!fileTabById(id); }
  function openActiveSearch() { searchTrigger++; }
  function visibleTerminalTab() {
    return isTermTab(activeTab) ? activeTab : (isTermTab(lastActiveTerminalTab) ? lastActiveTerminalTab : termTabs[0]);
  }
  function visibleFileTab() {
    const id = isFileTab(activeTab) ? activeTab : (isFileTab(lastActiveFileTab) ? lastActiveFileTab : fileTabs[0]?.id);
    return id ? fileTabById(id) : null;
  }
  function splitWorkspace(orientation = "down") {
    layoutMode = "split";
    splitOrientation = orientation;
    splitMenuOpen = false;
    if (!visibleFileTab()) showSidebar = true;
  }
  function closeSplit() {
    layoutMode = "single";
    splitMenuOpen = false;
  }
  function toggleSplitWorkspace() {
    if (layoutMode === "split") closeSplit();
    else splitWorkspace("down");
  }
  function focusTerminalPane() {
    const tid = visibleTerminalTab();
    if (tid) activeTab = tid;
  }
  function focusFilePane() {
    const file = visibleFileTab();
    if (file) activeTab = file.id;
  }
  function switchTab(delta) {
    if (tabOrder.length <= 1) return;
    const idx = tabOrder.indexOf(activeTab);
    const nextIdx = idx === -1
      ? 0
      : (idx + delta + tabOrder.length) % tabOrder.length;
    activeTab = tabOrder[nextIdx];
  }
  function tabTypeSwitchTarget() {
    if (isTermTab(activeTab)) {
      return isFileTab(lastActiveFileTab) ? lastActiveFileTab : null;
    }
    return isTermTab(lastActiveTerminalTab) ? lastActiveTerminalTab : termTabs[0];
  }
  function switchTabType() {
    const target = tabTypeSwitchTarget();
    if (target && target !== activeTab) activeTab = target;
  }
  function onGlobalKeydown(e) {
    const switchType = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "`" || e.code === "Backquote");
    const nextByPage = e.ctrlKey && !e.metaKey && !e.altKey && e.key === "PageDown";
    const prevByPage = e.ctrlKey && !e.metaKey && !e.altKey && e.key === "PageUp";
    const nextByAltPage = e.altKey && !e.ctrlKey && !e.metaKey && e.key === "PageDown";
    const prevByAltPage = e.altKey && !e.ctrlKey && !e.metaKey && e.key === "PageUp";
    const nextByBracket = e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "]";
    const prevByBracket = e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "[";

    if (switchType) {
      e.preventDefault();
      e.stopPropagation();
      switchTabType();
    } else if (showShortcutHints && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      showShortcutHints = false;
    } else if (splitMenuOpen && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      splitMenuOpen = false;
    } else if (nextByPage || nextByAltPage || nextByBracket) {
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

  function onSplitResizeStart(e) {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    const rect = container?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    const stacked = splitOrientation === "down" || window.matchMedia("(max-width: 760px)").matches;
    function onMove(e) {
      const rawRatio = stacked
        ? (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width;
      splitRatio = Math.min(0.8, Math.max(0.2, rawRatio));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = stacked ? "row-resize" : "col-resize";
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
    if (termTabs.includes(prevActiveTab)) {
      lastActiveTerminalTab = prevActiveTab;
    } else if (fileTabById(prevActiveTab)) {
      lastActiveFileTab = prevActiveTab;
    }
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
    <div class="tab-strip">
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
              <span style="font-size:10px;color:var(--status-connected)">✓</span>
            {:else if tab.saveStatus === "error"}
              <span style="font-size:10px;color:var(--status-disconnected)">!</span>
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

    <div class="split-control" class:active={layoutMode === "split"} role="group" aria-label="Split editor">
      <button class="split-action-btn" type="button" title={layoutMode === "split" ? "Single view" : "Split down"} aria-label={layoutMode === "split" ? "Single view" : "Split down"} onclick={toggleSplitWorkspace}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <rect x="2.5" y="3" width="11" height="10" rx="1.4" stroke="currentColor" stroke-width="1.35"/>
          <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1.35"/>
        </svg>
      </button>
      <button class="split-menu-btn" type="button" title="Split options" aria-label="Split options" aria-expanded={splitMenuOpen} onclick={(e) => { e.stopPropagation(); splitMenuOpen = !splitMenuOpen; }}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2.2 3.8 5 6.2l2.8-2.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if splitMenuOpen}
        <div class="split-menu" role="menu">
          <button type="button" role="menuitem" onclick={() => splitWorkspace("right")}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <rect x="2.5" y="3" width="11" height="10" rx="1.4" stroke="currentColor" stroke-width="1.35"/>
              <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1.35"/>
            </svg>
            <span>Split right</span>
          </button>
          <button type="button" role="menuitem" onclick={() => splitWorkspace("down")}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <rect x="2.5" y="3" width="11" height="10" rx="1.4" stroke="currentColor" stroke-width="1.35"/>
              <line x1="2.5" y1="8" x2="13.5" y2="8" stroke="currentColor" stroke-width="1.35"/>
            </svg>
            <span>Split down</span>
          </button>
          {#if layoutMode === "split"}
            <button type="button" role="menuitem" onclick={closeSplit}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="2.5" y="3" width="11" height="10" rx="1.4" stroke="currentColor" stroke-width="1.35"/>
              </svg>
              <span>Single view</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <ShortcutInfo bind:open={showShortcutHints} />

  </div>

  <div id="app-body">
    <!-- Sidebar -->
    <div class="fm-sidebar-wrap" class:hidden={!showSidebar} style:width="{sidebarWidth}px">
      <FileManager bind:fileTabs {activeTab} {openFileTab} visible={showSidebar} />
    </div>
    <button class="fm-resize-handle" class:hidden={!showSidebar} type="button" aria-label="Resize file explorer"
      onmousedown={onResizeStart}></button>

    <div class="workspace-layout" class:is-split={layoutMode === "split"} class:is-split-down={layoutMode === "split" && splitOrientation === "down"}>
      {#if layoutMode === "split"}
        {@const terminalId = visibleTerminalTab()}
        {@const fileTab = visibleFileTab()}
        {#if splitOrientation === "down"}
          <section class="workspace-pane workspace-pane-file" class:focused={fileTab && activeTab === fileTab.id} style:flex-basis={`${splitRatio * 100}%`} aria-label="File pane" onpointerdown={focusFilePane}>
            <FilePane tab={fileTab} active={fileTab && activeTab === fileTab.id} searchTrigger={searchTrigger} onFocus={focusFilePane} onOpenSidebar={() => { showSidebar = true; }} />
          </section>
          <button class="split-resize-handle" type="button" aria-label="Resize file and terminal panes" onmousedown={onSplitResizeStart}></button>
          <section class="workspace-pane workspace-pane-terminal" class:focused={activeTab === terminalId} aria-label="Terminal pane" onpointerdown={focusTerminalPane}>
            {#each termTabs as tid (tid)}
              <div class="term-wrap" class:hidden={tid !== terminalId}>
                <TermTab active={tid === terminalId} searchActive={activeTab === tid} findTrigger={searchTrigger} />
              </div>
            {/each}
          </section>
        {:else}
          <section class="workspace-pane workspace-pane-terminal" class:focused={activeTab === terminalId} style:flex-basis={`${splitRatio * 100}%`} aria-label="Terminal pane" onpointerdown={focusTerminalPane}>
            {#each termTabs as tid (tid)}
              <div class="term-wrap" class:hidden={tid !== terminalId}>
                <TermTab active={tid === terminalId} searchActive={activeTab === tid} findTrigger={searchTrigger} />
              </div>
            {/each}
          </section>
          <button class="split-resize-handle" type="button" aria-label="Resize terminal and file panes" onmousedown={onSplitResizeStart}></button>
          <section class="workspace-pane workspace-pane-file" class:focused={fileTab && activeTab === fileTab.id} aria-label="File pane" onpointerdown={focusFilePane}>
            <FilePane tab={fileTab} active={fileTab && activeTab === fileTab.id} searchTrigger={searchTrigger} onFocus={focusFilePane} onOpenSidebar={() => { showSidebar = true; }} />
          </section>
        {/if}
      {:else if isFileTab(activeTab)}
        <FilePane tab={visibleFileTab()} active={true} searchTrigger={searchTrigger} onFocus={focusFilePane} onOpenSidebar={() => { showSidebar = true; }} />
      {:else}
        {#each termTabs as tid (tid)}
          <div class="term-wrap" class:hidden={tid !== activeTab}>
            <TermTab active={tid === activeTab} searchActive={activeTab === tid} findTrigger={searchTrigger} />
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
