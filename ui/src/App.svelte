<script>
  import FileManager from "./FileManager.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import TermTab from "./TermTab.svelte";
  import { fileIcon } from "./fileIcon.js";

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");

  // ── Terminal tabs ─────────────────────────────────────────────────────────
  let termTabCounter = 1;
  /** @type {string[]} terminal tab ids */
  let termTabs = $state(["t1"]);

  function newTermTab() {
    termTabCounter++;
    const id = `t${termTabCounter}`;
    termTabs.push(id);
    activeTab = id;
  }

  function closeTermTab(id) {
    if (termTabs.length === 1) return; // keep at least one
    const idx = termTabs.indexOf(id);
    termTabs = termTabs.filter(t => t !== id);
    if (activeTab === id) {
      activeTab = termTabs[Math.min(idx, termTabs.length - 1)];
    }
  }

  // ── File tabs ─────────────────────────────────────────────────────────────
  /**
   * @typedef {{ id: string, path: string, name: string, content: string, editContent: string, mode: 'view'|'edit', isBinary: boolean, error: string, saveStatus: string }} FileTab
   */
  /** @type {FileTab[]} */
  let fileTabs = $state([]);

  /** @param {string} path @param {string} content @param {boolean} isBinary @param {string} error */
  function openFileTab(path, content, isBinary, error) {
    if (fileTabs.find(t => t.id === path)) { activeTab = path; return; }
    fileTabs.push({ id: path, path, name: path.split("/").pop() || path, content, editContent: content, mode: "edit", isBinary, error, saveStatus: "" });
    activeTab = path;
  }

  function closeFileTab(id) {
    const idx = fileTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    fileTabs.splice(idx, 1);
    if (activeTab === id) {
      // fileTabs[idx] is now the next tab (or undefined), fileTabs[idx-1] is the previous
      activeTab = fileTabs[idx]?.id ?? fileTabs[idx - 1]?.id ?? termTabs[0];
    }
  }

  /** @returns {FileTab|undefined} */
  function activeFileTab() { return fileTabs.find(t => t.id === activeTab); }

  // ── Active tab ────────────────────────────────────────────────────────────
  let activeTab = $state("t1");
  let showSidebar = $state(false);

  function isTermTab(id) { return termTabs.includes(id); }

  // Re-fetch file content when switching to a file tab (picks up external edits)
  // Only updates if the user has no unsaved changes
  let prevActiveTab = $state("t1");
  $effect(() => {
    const tab = activeTab;
    if (tab === prevActiveTab) return;
    prevActiveTab = tab;
    if (termTabs.includes(tab)) return;
    const ft = fileTabs.find(t => t.id === tab);
    if (!ft || ft.isBinary || ft.error) return;
    // Don't overwrite unsaved edits
    if (ft.editContent !== ft.content) return;
    fetch(`${basePath}/api/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "read_file", arguments: { path: ft.path } }),
    }).then(r => r.json()).then(result => {
      const text = result.content?.[0]?.text ?? result.text ?? "";
      // Re-check: still no unsaved edits before applying
      if (ft.editContent === ft.content) {
        ft.content = text;
        ft.editContent = text;
      }
    }).catch(() => {});
  });
</script>

<div id="app-root">
  <div id="tab-bar" role="toolbar" tabindex="-1" onmousedown={(e) => e.preventDefault()}>
    <!-- Sidebar toggle -->
    <div class="tab-sidebar-btn" class:active={showSidebar}
      role="button" tabindex="-1"
      onclick={() => { showSidebar = !showSidebar; }}
      onkeydown={(e) => e.key === "Enter" && (showSidebar = !showSidebar)}
      title="Toggle file explorer">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3.5" width="12" height="1.2" rx="0.6" fill="currentColor"/>
        <rect x="2" y="7.4" width="12" height="1.2" rx="0.6" fill="currentColor"/>
        <rect x="2" y="11.3" width="12" height="1.2" rx="0.6" fill="currentColor"/>
      </svg>
    </div>

    <!-- Terminal tabs -->
    {#each termTabs as tid (tid)}
      <div class="tab" class:active={activeTab === tid}
        role="button" tabindex="-1"
        onclick={() => { activeTab = tid; }}
        onkeydown={(e) => e.key === "Enter" && (activeTab = tid)}>
        <svg class="tab-icon-svg" width="13" height="13" viewBox="0 0 16 16" fill="none">
          <polyline points="2,5 7,8 2,11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <line x1="8.5" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        <span class="tab-name">Terminal {termTabs.length > 1 ? termTabs.indexOf(tid) + 1 : ""}</span>
        {#if termTabs.length > 1}
          <span class="tab-close" role="button" tabindex="-1"
            onclick={(e) => { e.stopPropagation(); closeTermTab(tid); }}
            onkeydown={(e) => e.key === "Enter" && (e.stopPropagation(), closeTermTab(tid))}>
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </span>
        {/if}
      </div>
    {/each}

    <!-- File tabs -->
    {#each fileTabs as tab (tab.id)}
      {@const icon = fileIcon(tab.name)}
      <div class="tab" class:active={activeTab === tab.id}
        role="button" tabindex="-1"
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
        <span class="tab-close" role="button" tabindex="-1"
          onclick={(e) => { e.stopPropagation(); closeFileTab(tab.id); }}
          onkeydown={(e) => e.key === "Enter" && (e.stopPropagation(), closeFileTab(tab.id))}>
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </span>
      </div>
    {/each}

    <!-- New terminal tab -->
    <div class="tab-new-btn" role="button" tabindex="-1" onclick={newTermTab} onkeydown={(e) => e.key === "Enter" && newTermTab()} title="New terminal">
      <svg width="14" height="14" viewBox="0 0 14 14"><line x1="7" y1="1.5" x2="7" y2="12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><line x1="1.5" y1="7" x2="12.5" y2="7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </div>
  </div>

  <div id="app-body">
    <!-- Sidebar -->
    {#if showSidebar}
      <FileManager bind:fileTabs {activeTab} {openFileTab} />
    {/if}

    <!-- Terminal tabs (all mounted, hidden when inactive so state is preserved) -->
    {#each termTabs as tid (tid)}
      <div class="term-wrap" class:hidden={activeTab !== tid}>
        <TermTab active={activeTab === tid} />
      </div>
    {/each}

    <!-- File content -->
    {#if !isTermTab(activeTab)}
      {@const tab = activeFileTab()}
      {#if tab}
        <div id="file-content">
          <div class="fc-topbar">
            <span class="fc-filepath">{tab.path}</span>
            {#if !tab.isBinary && !tab.error}
              {#if tab.saveStatus === "saving"}
                <span class="fm-saved" style="opacity:0.6">Saving…</span>
              {:else if tab.saveStatus === "saved"}
                <span class="fm-saved">✓ Saved</span>
              {:else if tab.saveStatus === "error"}
                <span class="fm-save-err">Save failed</span>
              {/if}
            {/if}
          </div>

          {#if tab.error}
            <div class="fm-error fm-error-main">{tab.error}</div>
          {:else if tab.isBinary}
            <div class="fm-binary">
              <span class="fm-binary-icon">⬡</span>
              <span>Binary file — cannot display as text</span>
              <code class="fm-binary-path">{tab.path}</code>
            </div>
          {:else}
            {#key tab.id}
            <CodeEditor
              path={tab.path}
              value={tab.editContent}
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

          <div class="fm-breadcrumb">
            {#each tab.path.split("/").filter(Boolean) as part, i}
              {#if i > 0}<span class="fm-bc-sep">›</span>{/if}
              <span class="fm-bc-part">{part}</span>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
