<script>
  import { onMount } from "svelte";
  import { fileIcon } from './fileIcon.js';

  /** @type {{ fileTabs: any[], activeTab: string, openFileTab: Function }} */
  let { fileTabs, activeTab, openFileTab } = $props();

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");

  /** @param {HTMLElement} node */
  function focus(node) { node.focus(); node.select(); }

  // ── Tree state ────────────────────────────────────────────────────────────
  /**
   * @typedef {{ name: string, path: string, is_dir: boolean, children: TreeNode[], loaded: boolean, open: boolean }} TreeNode
   */

  /** @type {TreeNode[]} */
  let tree = $state([]);
  let root = $state("/");
  let error = $state("");

  /** @param {string} path @returns {Promise<TreeNode[]>} */
  async function fetchDir(path) {
    const res = await fetch(`${basePath}/api/files?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(await res.text());
    const raw = await res.json();
    return raw.map(e => ({ ...e, children: [], loaded: false, open: false }));
  }

  /** @param {TreeNode[]} fresh @param {TreeNode[]} old @returns {TreeNode[]} */
  function mergeTree(fresh, old) {
    const oldMap = new Map(old.map(n => [n.path, n]));
    return fresh.map(n => {
      const prev = oldMap.get(n.path);
      if (prev?.is_dir && prev.open) return { ...n, open: true, loaded: prev.loaded, children: prev.children };
      return n;
    });
  }

  async function loadRoot() {
    error = "";
    try {
      const fresh = await fetchDir(root);
      tree = mergeTree(fresh, tree);
      await refreshOpenDirs(tree);
      tree = tree;
    } catch (e) { error = String(e); }
  }

  /** @param {TreeNode[]} nodes */
  async function refreshOpenDirs(nodes) {
    for (const node of nodes) {
      if (node.is_dir && node.open) {
        try { node.children = await fetchDir(node.path); } catch {}
        if (node.children?.length) await refreshOpenDirs(node.children);
      }
    }
  }

  /** @param {TreeNode} node */
  async function toggleDir(node) {
    if (node.open) { node.open = false; tree = tree; return; }
    if (!node.loaded) {
      try { node.children = await fetchDir(node.path); node.loaded = true; }
      catch { node.children = []; node.loaded = true; }
    }
    node.open = true;
    tree = tree;
  }

  /** @param {TreeNode} node */
  async function handleClick(node) {
    if (node.is_dir) { toggleDir(node); return; }
    if (fileTabs.find(t => t.id === node.path)) { openFileTab(node.path, "", false, ""); return; }

    let content = "", isBinary = false, err = "";
    try {
      const res = await fetch(`${basePath}/api/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "read_file", arguments: { path: node.path } }),
      });
      const result = await res.json();
      const text = result.content?.[0]?.text ?? result.text ?? "";
      const sample = text.slice(0, 4096);
      const nonPrintable = (sample.match(/[\x00-\x08\x0e-\x1f\x7f]/g) || []).length;
      isBinary = sample.includes("\x00") || nonPrintable / (sample.length || 1) > 0.1;
      content = isBinary ? "" : text;
    } catch (e) { err = String(e); }

    openFileTab(node.path, content, isBinary, err);
  }

  // ── Path editing ──────────────────────────────────────────────────────────
  let editingPath = $state(false);
  let pathInput = $state("");
  let committing = false; // prevent onblur from cancelling Enter

  function commitPath() {
    committing = true;
    root = pathInput.trim() || "/";
    editingPath = false;
    loadRoot();
    Promise.resolve().then(() => { committing = false; });
  }

  onMount(async () => {
    try {
      const res = await fetch(`${basePath}/api/config`);
      if (res.ok) { const cfg = await res.json(); if (cfg.cwd) root = cfg.cwd; }
    } catch {}
    loadRoot();
    const onFocus = () => loadRoot();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });
</script>

<div class="fm-sidebar">
  <!-- Header: root folder name -->
  <div class="fm-sidebar-header">
    {#if editingPath}
      <input
        class="fm-path-input"
        bind:value={pathInput}
        onkeydown={(e) => {
          if (e.key === "Enter") { commitPath(); }
          if (e.key === "Escape") { editingPath = false; }
        }}
        onblur={() => { if (!committing) editingPath = false; }}
        use:focus
      />
    {:else}
      <span class="fm-sidebar-title" role="button" tabindex="-1"
        onclick={() => { pathInput = root; editingPath = true; }}
        onkeydown={(e) => e.key === "Enter" && (pathInput = root, editingPath = true)}
        title="Click to change path">
        {root.split("/").filter(Boolean).pop() || "/"}
        <svg style="opacity:0.4;margin-left:4px;vertical-align:middle;flex-shrink:0" width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354zm.514 3.250-1.44-1.44-6.846 6.846-.22.77.77-.22z"/>
        </svg>
      </span>
    {/if}
    <button class="fm-icon-btn" onclick={loadRoot} title="Refresh">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <polyline points="10,2 13,5 10,8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>
    </button>
  </div>

  {#if error}
    <div class="fm-error">{error}</div>
  {:else}
    <div class="fm-tree-body">
      {#each tree as node}
        {@render NodeRow({ node, depth: 0 })}
      {/each}
    </div>
  {/if}
</div>

{#snippet NodeRow({ node, depth })}
  {@const icon = node.is_dir ? null : fileIcon(node.name)}
  {@const isActive = activeTab === node.path}
  <div
    class="fm-node"
    class:is-active={isActive}
    style:padding-left="{depth * 16 + 4}px"
    role="button"
    tabindex="0"
    onclick={() => handleClick(node)}
    onkeydown={(e) => e.key === "Enter" && handleClick(node)}
  >
    <!-- Indent guide lines -->
    {#each { length: depth } as _, i}
      <span class="fm-indent-guide" style:left="{i * 16 + 12}px"></span>
    {/each}

    {#if node.is_dir}
      <span class="fm-chevron">
        {#if node.open}
          <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="2,3.5 5,6.5 8,3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        {:else}
          <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="3.5,2 6.5,5 3.5,8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        {/if}
      </span>
      <span class="fm-folder-icon">
        {#if node.open}
          <svg width="15" height="13" viewBox="0 0 16 14" fill="none">
            <path d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 1.5H13.5C14.33 3.5 15 4.17 15 5v6.5C15 12.33 14.33 13 13.5 13h-11C1.67 13 1 12.33 1 11.5V3.5z" fill="#e5c07b"/>
            <path d="M1 6.5h14" stroke="#c9a84c" stroke-width="0.7" opacity="0.6"/>
          </svg>
        {:else}
          <svg width="15" height="13" viewBox="0 0 16 14" fill="none">
            <path d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 1.5H13.5C14.33 3.5 15 4.17 15 5v6.5C15 12.33 14.33 13 13.5 13h-11C1.67 13 1 12.33 1 11.5V3.5z" fill="#61afef" opacity="0.85"/>
          </svg>
        {/if}
      </span>
    {:else}
      <span class="fm-chevron-spacer"></span>
      {#if icon}
        <span class="fm-ext-badge" style:background={icon.bg} style:color={icon.color}>{icon.label}</span>
      {:else}
        <svg class="fm-file-icon-svg" width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M4 2h5.5L12 4.5V14H4V2z" stroke="#5c6370" stroke-width="1.3" stroke-linejoin="round"/>
          <polyline points="9,2 9,5 12,5" stroke="#5c6370" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
        </svg>
      {/if}
    {/if}

    <span class="fm-node-name" class:fm-node-name-active={isActive}>{node.name}</span>
  </div>

  {#if node.is_dir && node.open && node.children}
    {#each node.children as child}
      {@render NodeRow({ node: child, depth: depth + 1 })}
    {/each}
  {/if}
{/snippet}
