<script>
  import { fileIcon } from './fileIcon.js';

  /** @type {{ fileTabs: any[], activeTab: string, openFileTab: Function, visible?: boolean }} */
  let { fileTabs, activeTab, openFileTab, visible = true } = $props();

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");
  const SIDEBAR_ROOT_STORAGE_KEY = "hterm:file-manager-root";

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
  /** @type {Map<string, Promise<TreeNode[]>>} */
  const dirLoadPromises = new Map();

  /** @param {TreeNode} a @param {TreeNode} b */
  function sortTreeNodes(a, b) {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  }

  /** @param {string} path @returns {Promise<TreeNode[]>} */
  async function fetchDir(path) {
    const res = await fetch(`${basePath}/api/files?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(await res.text());
    const raw = await res.json();
    return raw
      .map(e => ({ ...e, children: [], loaded: false, open: false }))
      .sort(sortTreeNodes);
  }

  /** @param {string} path @param {boolean} force @returns {Promise<TreeNode[]>} */
  function loadDir(path, force = false) {
    if (force) dirLoadPromises.delete(path);
    const pending = dirLoadPromises.get(path);
    if (pending) return pending;
    const promise = fetchDir(path).finally(() => {
      if (dirLoadPromises.get(path) === promise) dirLoadPromises.delete(path);
    });
    dirLoadPromises.set(path, promise);
    return promise;
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

  /** @param {string} path @param {TreeNode[]} nodes */
  function findNode(path, nodes = tree) {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children?.length) {
        const found = findNode(path, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  async function loadRoot(force = false) {
    const requestedRoot = root;
    error = "";
    try {
      const fresh = await loadDir(requestedRoot, force);
      if (root !== requestedRoot) return;
      tree = mergeTree(fresh, tree);
    } catch (e) {
      if (root === requestedRoot) error = String(e);
    }
  }

  async function refreshDir(path, force = false) {
    if (path === root) {
      await loadRoot(force);
      return;
    }
    const node = findNode(path);
    if (!node?.is_dir || !node.loaded) return;
    const fresh = await loadDir(path, force);
    node.children = mergeTree(fresh, node.children);
    node.loaded = true;
    tree = tree;
  }

  async function refreshDirs(paths, force = false) {
    await Promise.all([...new Set(paths)].map(path => refreshDir(path, force)));
  }

  /** @param {TreeNode} node */
  async function toggleDir(node) {
    if (node.open) { node.open = false; tree = tree; return; }
    if (!node.loaded) {
      try { node.children = await loadDir(node.path); node.loaded = true; }
      catch { node.children = []; node.loaded = true; }
    }
    node.open = true;
    tree = tree;
  }

  /** @param {TreeNode} node */
  async function handleClick(node) {
    if (node.is_dir) { toggleDir(node); return; }
    if (fileTabs.find(t => t.id === node.path)) { openFileTab(node.path, "", false, ""); return; }

    openFileTab(node.path, "", false, "", true);
    try {
      const res = await fetch(`${basePath}/api/files/read?path=${encodeURIComponent(node.path)}`);
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      const tab = fileTabs.find(t => t.id === node.path);
      if (!tab) return;
      tab.content = result.content ?? "";
      tab.editContent = tab.content;
      tab.isBinary = !!result.is_binary;
      tab.error = "";
      tab.loading = false;
      fileTabs = fileTabs;
    } catch (e) {
      const tab = fileTabs.find(t => t.id === node.path);
      if (!tab) return;
      tab.content = "";
      tab.editContent = "";
      tab.isBinary = false;
      tab.error = String(e);
      tab.loading = false;
      fileTabs = fileTabs;
    }
  }

  // ── Path editing ──────────────────────────────────────────────────────────
  let editingPath = $state(false);
  let pathInput = $state("");
  let committing = false;

  function saveRootPath(path) {
    try { localStorage.setItem(SIDEBAR_ROOT_STORAGE_KEY, path); } catch {}
  }

  function savedRootPath() {
    try { return localStorage.getItem(SIDEBAR_ROOT_STORAGE_KEY) || ""; } catch { return ""; }
  }

  function commitPath() {
    committing = true;
    root = pathInput.trim() || "/";
    saveRootPath(root);
    editingPath = false;
    loadRoot();
    Promise.resolve().then(() => { committing = false; });
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  /** @type {{ x: number, y: number, node: TreeNode|null }|null} */
  let ctxMenu = $state(null);
  /** @type {{ parentPath: string|null, type: 'file'|'folder', name: string }|null} */
  let creating = $state(null);
  /** @type {{ node: TreeNode, name: string }|null} */
  let renaming = $state(null);
  /** @type {TreeNode|null} */
  let deleting = $state(null);
  let crudError = $state("");
  /** @type {{ action: 'cut'|'copy', path: string, name: string }|null} */
  let clipboard = $state(null);
  let initialized = false;

  // isCommittingRef pattern — prevents onblur from cancelling when Enter fires
  let isCommitting = false;

  /** @param {HTMLElement} el */
  function focusInput(el) { el.focus(); el.select(); }

  function fileActionUrl(path) {
    const tail = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    return `${basePath}/api/files/${tail}`;
  }

  function closeCtx() { ctxMenu = null; }

  function parentPath(path) {
    const idx = path.lastIndexOf('/');
    return idx <= 0 ? "/" : path.substring(0, idx);
  }

  function joinPath(dir, name) {
    return `${dir.replace(/\/+$/, '')}/${name}`.replace(/^\/?/, '/');
  }

  function isDescendantPath(path, maybeParent) {
    const parent = maybeParent.replace(/\/+$/, '');
    return path === parent || path.startsWith(`${parent}/`);
  }

  /** @param {MouseEvent} e @param {TreeNode|null} node */
  function onContextMenu(e, node) {
    e.preventDefault(); e.stopPropagation();
    ctxMenu = { x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 240), node };
  }

  async function crudCreate() {
    if (!creating || !creating.name.trim()) { creating = null; return; }
    isCommitting = true;
    const name = creating.name.trim();
    const parent = creating.parentPath || root;
    const path = joinPath(parent, name);
    try {
      const res = await fetch(`${basePath}/api/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, type: creating.type }),
      });
      if (!res.ok) throw new Error(await res.text());
      creating = null;
      await refreshDir(parent, true);
    } catch(e) { crudError = String(e); creating = null; }
    finally { isCommitting = false; }
  }

  async function crudRename() {
    if (!renaming || !renaming.name.trim()) { renaming = null; return; }
    isCommitting = true;
    const oldPath = renaming.node.path;
    const dir = parentPath(oldPath);
    const newPath = joinPath(dir, renaming.name.trim());
    try {
      const res = await fetch(fileActionUrl(oldPath), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath }),
      });
      if (!res.ok) throw new Error(await res.text());
      renaming = null;
      await refreshDir(dir, true);
    } catch(e) { crudError = String(e); renaming = null; }
    finally { isCommitting = false; }
  }

  async function crudDelete() {
    if (!deleting) return;
    const dir = parentPath(deleting.path);
    try {
      const res = await fetch(fileActionUrl(deleting.path), { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      deleting = null;
      await refreshDir(dir, true);
    } catch(e) { crudError = String(e); deleting = null; }
  }

  async function crudPaste(targetNode) {
    if (!clipboard) return;
    const destDir = targetNode?.is_dir ? targetNode.path : (targetNode ? parentPath(targetNode.path) : root);
    const destPath = joinPath(destDir, clipboard.name);
    const sourceDir = parentPath(clipboard.path);
    const wasCut = clipboard.action === 'cut';
    try {
      if (wasCut) {
        const res = await fetch(fileActionUrl(clipboard.path), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPath: destPath }),
        });
        if (!res.ok) throw new Error(await res.text());
        clipboard = null;
      } else {
        // copy via dedicated endpoint
        const res = await fetch(`${basePath}/api/files/copy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ src: clipboard.path, dst: destPath }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      await refreshDirs(wasCut ? [sourceDir, destDir] : [destDir], true);
    } catch(e) { crudError = String(e); }
    closeCtx();
  }

  // ── Drag move ─────────────────────────────────────────────────────────────
  /** @type {TreeNode|null} */
  let draggingNode = $state(null);
  /** @type {string|null} */
  let dragTargetPath = $state(null);
  /** @type {ReturnType<typeof setTimeout>|null} */
  let dragOpenTimer = null;

  function clearDragOpenTimer() {
    if (dragOpenTimer) clearTimeout(dragOpenTimer);
    dragOpenTimer = null;
  }

  function dropDirFor(targetNode) {
    return targetNode?.is_dir ? targetNode.path : (targetNode ? parentPath(targetNode.path) : root);
  }

  function canMoveTo(sourceNode, targetNode) {
    if (!sourceNode) return false;
    const destDir = dropDirFor(targetNode);
    const destPath = joinPath(destDir, sourceNode.name);
    if (destPath === sourceNode.path) return false;
    if (sourceNode.is_dir && isDescendantPath(destDir, sourceNode.path)) return false;
    return true;
  }

  async function moveNode(sourceNode, targetNode) {
    if (!sourceNode || !canMoveTo(sourceNode, targetNode)) return;
    const sourceDir = parentPath(sourceNode.path);
    const destDir = dropDirFor(targetNode);
    const destPath = joinPath(destDir, sourceNode.name);
    try {
      const res = await fetch(fileActionUrl(sourceNode.path), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath: destPath }),
      });
      if (!res.ok) throw new Error(await res.text());
      await refreshDirs([sourceDir, destDir], true);
    } catch (e) { crudError = String(e); }
  }

  function onNodeDragStart(e, node) {
    if (renaming?.node.path === node.path) { e.preventDefault(); return; }
    draggingNode = node;
    dragTargetPath = null;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.path);
  }

  function onNodeDragOver(e, node) {
    if (!draggingNode || draggingNode.path === node.path) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = canMoveTo(draggingNode, node) ? "move" : "none";
    if (dragTargetPath !== node.path) clearDragOpenTimer();
    dragTargetPath = node.path;
    if (node.is_dir && !node.open && canMoveTo(draggingNode, node) && !dragOpenTimer) {
      dragOpenTimer = setTimeout(async () => {
        dragOpenTimer = null;
        if (dragTargetPath === node.path && draggingNode) await toggleDir(node);
      }, 550);
    }
  }

  function onNodeDragLeave(node) {
    if (dragTargetPath === node.path) dragTargetPath = null;
    clearDragOpenTimer();
  }

  async function onNodeDrop(e, node) {
    e.preventDefault();
    e.stopPropagation();
    const source = draggingNode;
    draggingNode = null;
    dragTargetPath = null;
    clearDragOpenTimer();
    await moveNode(source, node);
  }

  function onTreeDragOver(e) {
    if (!draggingNode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canMoveTo(draggingNode, null) ? "move" : "none";
    dragTargetPath = "__root__";
  }

  async function onTreeDrop(e) {
    if (!draggingNode) return;
    e.preventDefault();
    const source = draggingNode;
    draggingNode = null;
    dragTargetPath = null;
    clearDragOpenTimer();
    await moveNode(source, null);
  }

  function onNodeDragEnd() {
    draggingNode = null;
    dragTargetPath = null;
    clearDragOpenTimer();
  }

  function onDocClick() { if (ctxMenu) closeCtx(); }

  async function initializeRoot() {
    try {
      const savedRoot = savedRootPath();
      if (savedRoot) {
        root = savedRoot;
      } else {
        const res = await fetch(`${basePath}/api/config`);
        if (res.ok) { const cfg = await res.json(); if (cfg.cwd) root = cfg.cwd; }
      }
    } catch {}
    loadRoot();
  }

  $effect(() => {
    if (!visible || initialized) return;
    initialized = true;
    initializeRoot();
  });
</script>

<svelte:document onclick={onDocClick} />

<div class="fm-sidebar">
  <!-- Header -->
  <div class="fm-sidebar-header">
    {#if editingPath}
      <input class="fm-path-input" bind:value={pathInput}
        onkeydown={(e) => { if (e.key === "Enter") commitPath(); if (e.key === "Escape") editingPath = false; }}
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
    <button class="fm-icon-btn" title="New File" onclick={(e) => { e.stopPropagation(); creating = { parentPath: null, type: 'file', name: '' }; }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M9.5 1.5v3h3L9.5 1.5zM3 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6h-4V2H3zm5 6.5a.5.5 0 0 1 .5.5v1.5H10a.5.5 0 0 1 0 1H8.5V13a.5.5 0 0 1-1 0v-1.5H6a.5.5 0 0 1 0-1h1.5V9a.5.5 0 0 1 .5-.5z"/></svg>
    </button>
    <button class="fm-icon-btn" title="New Folder" onclick={(e) => { e.stopPropagation(); creating = { parentPath: null, type: 'folder', name: '' }; }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zm7.5 5a.5.5 0 0 0-1 0V10H6a.5.5 0 0 0 0 1h1.5v1.5a.5.5 0 0 0 1 0V11H10a.5.5 0 0 0 0-1H8.5V8.5z"/></svg>
    </button>
    <button class="fm-icon-btn" onclick={loadRoot} title="Refresh">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/>
      </svg>
    </button>
  </div>

  {#if crudError}
    <div class="fm-error" role="button" tabindex="-1" onclick={() => crudError = ""} onkeydown={(e) => e.key === 'Enter' && (crudError = "")}>{crudError}</div>
  {:else if error}
    <div class="fm-error">{error}</div>
  {/if}

  <div
    class="fm-tree-body"
    class:is-drop-target={dragTargetPath === "__root__"}
    role="tree"
    tabindex="0"
    oncontextmenu={(e) => onContextMenu(e, null)}
    ondragover={onTreeDragOver}
    ondragleave={() => { if (dragTargetPath === "__root__") dragTargetPath = null; }}
    ondrop={onTreeDrop}
  >
    {#each tree as node (node.path)}
      {@render NodeRow({ node, depth: 0 })}
    {/each}
    {#if creating && creating.parentPath === null}
      <div class="fm-node" style:padding-left="4px">
        <span class="fm-chevron-spacer"></span>
        <input class="fm-inline-input" placeholder={creating.type === 'file' ? 'filename' : 'foldername'}
          bind:value={creating.name}
          use:focusInput
          onkeydown={(e) => { if (e.key === 'Enter') { isCommitting = true; crudCreate(); } if (e.key === 'Escape') creating = null; }}
          onblur={() => { if (!isCommitting) creating = null; }}
        />
      </div>
    {/if}
  </div>
</div>

<!-- Context menu -->
{#if ctxMenu}
  <div class="fm-ctx" style:left="{ctxMenu.x}px" style:top="{ctxMenu.y}px" role="menu" tabindex="-1"
    onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && closeCtx()}>
    <button class="fm-ctx-item" role="menuitem"
      onclick={() => { creating = { parentPath: ctxMenu.node?.is_dir ? ctxMenu.node.path : null, type: 'file', name: '' }; closeCtx(); }}>
      New File
    </button>
    <button class="fm-ctx-item" role="menuitem"
      onclick={() => { creating = { parentPath: ctxMenu.node?.is_dir ? ctxMenu.node.path : null, type: 'folder', name: '' }; closeCtx(); }}>
      New Folder
    </button>
    {#if ctxMenu.node}
      <div class="fm-ctx-sep"></div>
      <button class="fm-ctx-item" role="menuitem"
        onclick={() => { renaming = { node: ctxMenu.node, name: ctxMenu.node.name }; closeCtx(); }}>
        Rename
      </button>
      <button class="fm-ctx-item fm-ctx-danger" role="menuitem"
        onclick={() => { deleting = ctxMenu.node; closeCtx(); }}>
        Delete
      </button>
      <div class="fm-ctx-sep"></div>
      <button class="fm-ctx-item" role="menuitem"
        onclick={() => { clipboard = { action: 'cut', path: ctxMenu.node.path, name: ctxMenu.node.name }; closeCtx(); }}>
        Cut
      </button>
      <button class="fm-ctx-item" role="menuitem"
        onclick={() => { clipboard = { action: 'copy', path: ctxMenu.node.path, name: ctxMenu.node.name }; closeCtx(); }}>
        Copy
      </button>
      <div class="fm-ctx-sep"></div>
      <button class="fm-ctx-item" role="menuitem"
        onclick={() => { navigator.clipboard.writeText(ctxMenu.node.path); closeCtx(); }}>
        Copy Path
      </button>
      <div class="fm-ctx-sep"></div>
    {/if}
    <button class="fm-ctx-item" class:fm-ctx-disabled={!clipboard} role="menuitem"
      onclick={() => { if (clipboard) crudPaste(ctxMenu.node); }}>
      Paste
    </button>
  </div>
{/if}

<!-- Delete confirm -->
{#if deleting}
  <div class="fm-modal-backdrop" role="button" tabindex="-1" onclick={() => deleting = null} onkeydown={(e) => e.key === 'Escape' && (deleting = null)}>
    <div class="fm-modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <div class="fm-modal-title">Delete "{deleting.name}"?</div>
      <div class="fm-modal-body">This cannot be undone.</div>
      <div class="fm-modal-actions">
        <button class="fm-btn" onclick={() => deleting = null}>Cancel</button>
        <button class="fm-btn fm-btn-danger" onclick={crudDelete}>Delete</button>
      </div>
    </div>
  </div>
{/if}

{#snippet NodeRow({ node, depth })}
  {@const icon = node.is_dir ? null : fileIcon(node.name)}
  {@const isActive = activeTab === node.path}
  {@const isCtxSelected = ctxMenu?.node?.path === node.path}
  {@const isRenaming = renaming?.node.path === node.path}
  {@const isCut = clipboard?.action === 'cut' && clipboard.path === node.path}
  {@const isHidden = node.name.startsWith('.')}
  {@const isDragging = draggingNode?.path === node.path}
  {@const isDropTarget = dragTargetPath === node.path && draggingNode?.path !== node.path}
  {@const isInvalidDrop = isDropTarget && draggingNode && !canMoveTo(draggingNode, node)}
  <div
    class="fm-node"
    class:is-active={isActive}
    class:is-ctx={isCtxSelected && !isActive}
    class:is-dragging={isDragging}
    class:is-hidden={isHidden}
    class:is-drop-target={isDropTarget && !isInvalidDrop}
    class:is-drop-invalid={isInvalidDrop}
    style:padding-left="{depth * 16 + 4}px"
    style:opacity={isCut ? 0.4 : 1}
    role="button"
    tabindex="0"
    draggable={!isRenaming}
    onclick={() => handleClick(node)}
    oncontextmenu={(e) => onContextMenu(e, node)}
    onkeydown={(e) => e.key === "Enter" && handleClick(node)}
    ondragstart={(e) => onNodeDragStart(e, node)}
    ondragover={(e) => onNodeDragOver(e, node)}
    ondragleave={() => onNodeDragLeave(node)}
    ondrop={(e) => onNodeDrop(e, node)}
    ondragend={onNodeDragEnd}
  >
    <!-- Active file left border -->
    {#if isActive}
      <span class="fm-active-border"></span>
    {:else if isCtxSelected}
      <span class="fm-ctx-border"></span>
    {/if}

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
            <path d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 1.5H13.5C14.33 3.5 15 4.17 15 5v6.5C15 12.33 14.33 13 13.5 13h-11C1.67 13 1 12.33 1 11.5V3.5z" fill="var(--accent-yellow)"/>
            <path d="M1 6.5h14" stroke="var(--accent-yellow-strong)" stroke-width="0.7" opacity="0.6"/>
          </svg>
        {:else}
          <svg width="15" height="13" viewBox="0 0 16 14" fill="none">
            <path d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 1.5H13.5C14.33 3.5 15 4.17 15 5v6.5C15 12.33 14.33 13 13.5 13h-11C1.67 13 1 12.33 1 11.5V3.5z" fill="var(--accent)" opacity="0.85"/>
          </svg>
        {/if}
      </span>
    {:else}
      <span class="fm-chevron-spacer"></span>
      {#if icon}
        <span class="fm-ext-badge" style:background={icon.bg} style:color={icon.color}>{icon.label}</span>
      {:else}
        <svg class="fm-file-icon-svg" width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M4 2h5.5L12 4.5V14H4V2z" stroke="var(--text-subtle)" stroke-width="1.3" stroke-linejoin="round"/>
          <polyline points="9,2 9,5 12,5" stroke="var(--text-subtle)" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
        </svg>
      {/if}
    {/if}

    <span class="fm-node-name" class:fm-node-name-active={isActive}>
      {#if isRenaming}
        <input class="fm-inline-input" bind:value={renaming.name}
          use:focusInput
          onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { isCommitting = true; crudRename(); } if (e.key === 'Escape') renaming = null; }}
          onblur={() => { if (!isCommitting) renaming = null; }}
          onclick={(e) => e.stopPropagation()}
        />
      {:else}
        {node.name}
      {/if}
    </span>
  </div>

  {#if node.is_dir && node.open}
    {#if node.children?.length}
      {#each node.children as child (child.path)}
        {@render NodeRow({ node: child, depth: depth + 1 })}
      {/each}
    {:else if node.loaded}
      <div class="fm-empty-folder" style:padding-left="{(depth + 1) * 16 + 20}px">Empty folder</div>
    {/if}
    {#if creating && creating.parentPath === node.path}
      <div class="fm-node" style:padding-left="{(depth + 1) * 16 + 4}px">
        <span class="fm-chevron-spacer"></span>
        <input class="fm-inline-input" placeholder={creating.type === 'file' ? 'filename' : 'foldername'}
          bind:value={creating.name}
          use:focusInput
          onkeydown={(e) => { if (e.key === 'Enter') { isCommitting = true; crudCreate(); } if (e.key === 'Escape') creating = null; }}
          onblur={() => { if (!isCommitting) creating = null; }}
        />
      </div>
    {/if}
  {/if}
{/snippet}
