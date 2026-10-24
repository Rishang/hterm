<script>
  import { onDestroy } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { fileIcon, hasImageIcon } from "./fileIcon.js";
  import { placeContextMenu } from "./contextMenu.js";

  /** @type {{ activeTab: string, openFileByPath: Function, visible?: boolean, autoCd?: boolean, terminalCwd?: string, root?: string }} */
  let { activeTab, openFileByPath, visible = true, autoCd = true, terminalCwd = "", root = $bindable("/") } = $props();

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
  let error = $state("");
  /** @type {Map<string, Promise<TreeNode[]>>} */
  const dirLoadPromises = new SvelteMap();

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
    const results = await Promise.allSettled([...new Set(paths)].map(path => refreshDir(path, force)));
    const failed = results.find(result => result.status === "rejected");
    if (failed) error = String(failed.reason);
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
    openFileByPath(node.path);
  }

  // ── Multi-select ──────────────────────────────────────────────────────────
  // Ctrl/⌘+click toggles rows into a selection that Cut, Copy and Download act
  // on together; a plain click clears it and opens the row as usual.
  /** @type {TreeNode[]} */
  let selection = $state([]);

  /** @param {TreeNode} node */
  function isSelected(node) { return selection.some(n => n.path === node.path); }

  /** @param {MouseEvent} e @param {TreeNode} node */
  function onNodeClick(e, node) {
    if (e.ctrlKey || e.metaKey) {
      selection = isSelected(node) ? selection.filter(n => n.path !== node.path) : [...selection, node];
      return;
    }
    selection = [];
    handleClick(node);
  }

  /** Drops entries already inside another selected folder. @param {TreeNode[]} nodes */
  function topLevel(nodes) {
    return nodes.filter(n => !nodes.some(o => o !== n && o.is_dir && isDescendantPath(n.path, o.path)));
  }

  // ── Path editing ──────────────────────────────────────────────────────────
  let editingPath = $state(false);
  let pathInput = $state("");
  let committing = false;

  function saveRootPath(path) {
    try { localStorage.setItem(SIDEBAR_ROOT_STORAGE_KEY, path); } catch { /* storage unavailable */ }
  }

  function savedRootPath() {
    try { return localStorage.getItem(SIDEBAR_ROOT_STORAGE_KEY) || ""; } catch { return ""; }
  }

  // ── Auto-cd ────────────────────────────────────────────────────────────────
  // `terminalCwd` is the working directory of the terminal tab currently on
  // screen, pushed by the server only when that shell's directory changes.
  // Switching terminal tabs therefore re-points the tree at that shell.
  let autoCdApplied = false;
  let previousAutoCd = $state();

  $effect(() => {
    const wasAutoCd = previousAutoCd;
    previousAutoCd = autoCd;
    if (wasAutoCd && !autoCd) {
      const saved = savedRootPath();
      autoCdApplied = false;
      if (saved && saved !== root) {
        root = saved;
        loadRoot();
      }
    }
    if (!autoCd || !terminalCwd || terminalCwd === root) return;
    autoCdApplied = true;
    root = terminalCwd;
    loadRoot();
  });

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
  /** @type {TreeNode[]|null} */
  let downloading = $state(null);
  let crudError = $state("");
  /** @typedef {{ path: string, name: string, is_dir: boolean }} ClipItem */
  /** @type {{ action: 'cut'|'copy', items: ClipItem[] }|null} */
  let clipboard = $state(null);
  let initialized = false;

  // isCommittingRef pattern — prevents onblur from cancelling when Enter fires
  let isCommitting = false;

  /** @param {HTMLElement} el */
  function focusInput(el) { el.focus(); el.select(); }

  /** Focus a dialog's default button so Enter confirms and Escape reaches the backdrop. @param {HTMLElement} el */
  function focusButton(el) { el.focus(); }

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
    // Right-clicking outside the selection targets just that row, like a file manager.
    if (node && !isSelected(node)) selection = [];
    ctxMenu = { x: e.clientX, y: e.clientY, node };
  }

  /** Rows the open menu acts on: the whole selection when it was right-clicked. */
  let ctxTargets = $derived(
    !ctxMenu?.node ? [] : selection.length > 1 && isSelected(ctxMenu.node) ? topLevel(selection) : [ctxMenu.node]
  );

  /** @param {'cut'|'copy'} action */
  function setClipboard(action) {
    clipboard = { action, items: ctxTargets.map(n => ({ path: n.path, name: n.name, is_dir: n.is_dir })) };
    closeCtx();
  }

  /** @type {HTMLElement|undefined} */
  let ctxEl = $state();
  let ctxPos = $state({ x: 0, y: 0 });

  $effect(() => {
    if (ctxMenu && ctxEl) ctxPos = placeContextMenu(ctxMenu.x, ctxMenu.y, ctxEl);
  });

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

  // The browser streams the response straight to disk, so large files and
  // zipped folders are never held in page memory. A HEAD probe first surfaces
  // server errors here; otherwise the browser would save the error text as the file.
  // Several items arrive together as one selection.zip.
  async function downloadNodes() {
    if (!downloading) return;
    const nodes = downloading;
    downloading = null;
    const [first] = nodes;
    const query = nodes.length === 1
      ? `path=${encodeURIComponent(first.path)}`
      : `paths=${encodeURIComponent(JSON.stringify(nodes.map(n => n.path)))}`;
    const href = `${basePath}/api/files/download?${query}`;
    try {
      const res = await fetch(href, { method: "HEAD" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    } catch (e) { crudError = `Download failed for ${nodes.length === 1 ? first.name : `${nodes.length} items`}: ${e}`; return; }
    const link = document.createElement("a");
    link.href = href;
    link.download = nodes.length > 1 ? "selection.zip" : first.is_dir ? `${first.name}.zip` : first.name;
    link.click();
  }

  async function crudPaste(targetNode) {
    if (!clipboard) return;
    closeCtx();
    const { action, items } = clipboard;
    if (action === 'cut') clipboard = null;
    selection = [];
    await transferItems(items, action === 'cut', dropDirFor(targetNode), false);
  }

  /** `notes.txt` → `notes (copy).txt`, then `notes (copy 2).txt`, …
   * @param {{ name: string, is_dir: boolean }} item @param {number} n */
  function copyName(item, n) {
    const dot = item.is_dir ? -1 : item.name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [item.name.slice(0, dot), item.name.slice(dot)] : [item.name, ""];
    return `${stem} (copy${n > 1 ? ` ${n}` : ""})${ext}`;
  }

  /** @param {string} src @param {string} dst @param {boolean} move @param {boolean} overwrite */
  function transferRequest(src, dst, move, overwrite) {
    const [url, method, body] = move
      ? [fileActionUrl(src), "PATCH", { newPath: dst, overwrite }]
      : [`${basePath}/api/files/copy`, "POST", { src, dst, overwrite }];
    return fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  /**
   * Move or copy items into `destDir`. The server answers 409 instead of
   * replacing an existing destination, so those are collected and offered in
   * the overwrite dialog. A copy into its own folder gets a "(copy)" name.
   * @param {ClipItem[]} items @param {boolean} move @param {string} destDir @param {boolean} overwrite
   */
  async function transferItems(items, move, destDir, overwrite) {
    const dirs = [destDir];
    /** @type {ClipItem[]} */
    const clashes = [];
    const failures = [];
    const names = [];
    for (const item of items) {
      const destPath = joinPath(destDir, item.name);
      // Moving onto itself or into its own subtree is a no-op, not an error.
      if (move && (destPath === item.path || isDescendantPath(destDir, item.path))) continue;
      // Two items with one name would land on the same path and replace each other.
      if (names.includes(item.name)) { failures.push(`${item.name}: another item with this name is already going there`); continue; }
      names.push(item.name);
      try {
        let res;
        if (!move && destPath === item.path) {
          for (let n = 1; n <= 100 && (!res || res.status === 409); n++) {
            res = await transferRequest(item.path, joinPath(destDir, copyName(item, n)), false, false);
          }
        } else {
          res = await transferRequest(item.path, destPath, move, overwrite);
        }
        if (res.status === 409) clashes.push(item);
        else if (!res.ok) throw new Error(await res.text());
        else if (move) dirs.push(parentPath(item.path));
      } catch (e) { failures.push(`${item.name}: ${e}`); }
    }
    if (failures.length) crudError = failures.length === 1 ? failures[0] : `${move ? "Move" : "Copy"} failed for ${failures.length} items — ${failures[0]}`;
    if (clashes.length) {
      conflicts = {
        names: clashes.map(i => i.name),
        what: move ? "moved" : "copied",
        overwrite: () => transferItems(clashes, move, destDir, true),
      };
    }
    await refreshDirs(dirs, true).catch(() => {});
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  // Each picked file is streamed in its own PUT; folder picks carry
  // `webkitRelativePath`, so the server recreates the folder structure.
  /** @typedef {{ path: string, file: File }} UploadItem */
  /** @type {HTMLInputElement|undefined} */
  let uploadFilesInput = $state();
  /** @type {HTMLInputElement|undefined} */
  let uploadFolderInput = $state();
  let uploadStatus = $state("");
  /** Items the server refused to replace, offered for overwrite.
   * @type {{ names: string[], what: string, overwrite: () => Promise<void> }|null} */
  let conflicts = $state(null);

  /** Uploads land in the tree root. @param {HTMLInputElement|undefined} input */
  function pickUpload(input) {
    closeCtx();
    if (!input || uploadStatus) return;
    input.value = "";
    input.click();
  }

  /** @param {Event & { currentTarget: HTMLInputElement }} e */
  function onUploadPicked(e) {
    const items = [...(e.currentTarget.files ?? [])]
      .map(file => ({ path: joinPath(root, file.webkitRelativePath || file.name), file }));
    if (items.length) void uploadItems(items, false);
  }

  /** @param {UploadItem[]} items @param {boolean} overwrite */
  async function uploadItems(items, overwrite) {
    /** @type {UploadItem[]} */
    const clashes = [];
    const failures = [];
    for (const [i, item] of items.entries()) {
      uploadStatus = `Uploading ${i + 1}/${items.length}: ${item.file.name}`;
      const query = `path=${encodeURIComponent(item.path)}${overwrite ? "&overwrite=true" : ""}`;
      try {
        const res = await fetch(`${basePath}/api/files/upload?${query}`, { method: "PUT", body: item.file });
        if (res.status === 409) clashes.push(item);
        else if (!res.ok) failures.push(`${item.file.name}: ${await res.text()}`);
      } catch (err) { failures.push(`${item.file.name}: ${err}`); }
    }
    uploadStatus = "";
    if (failures.length) crudError = `Upload failed for ${failures.length} file(s) — ${failures[0]}`;
    if (clashes.length) {
      conflicts = {
        names: clashes.map(i => i.file.webkitRelativePath || i.file.name),
        what: "uploaded",
        overwrite: () => uploadItems(clashes, true),
      };
    }
    await refreshDir(root, true).catch(() => {});
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
    await transferItems([sourceNode], true, dropDirFor(targetNode), false);
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
  /** @param {KeyboardEvent} e */
  function onDocKeydown(e) {
    if (e.key !== "Escape") return;
    if (ctxMenu) closeCtx();
    else selection = [];
  }

  // ── External change watching ───────────────────────────────────────────────
  // The server watches these directories with inotify and pushes the paths that
  // changed, so edits made outside this pane — `rm`/`mv`/`touch` in a terminal
  // tab, a build, a git checkout — show up without the tree ever polling.
  const WATCH_SYNC_DEBOUNCE_MS = 200;

  /** @type {EventSource|null} */
  let watchSource = null;
  /** POST target for the watched-directory set; supplied by the stream's `endpoint` event. */
  let watchEndpoint = "";
  let sentWatchDirs = "";
  /** @type {ReturnType<typeof setTimeout>|null} */
  let watchSyncTimer = null;

  /**
   * Directories whose contents are on screen: the root plus every expanded,
   * loaded folder. Collapsed subtrees are omitted so the server holds one kernel
   * watch per visible directory instead of one per directory in the project.
   * @param {TreeNode[]} nodes @param {string[]} acc @returns {string[]}
   */
  function visibleDirs(nodes = tree, acc = [root]) {
    for (const node of nodes) {
      if (node.is_dir && node.open && node.loaded) {
        acc.push(node.path);
        visibleDirs(node.children, acc);
      }
    }
    return acc;
  }

  async function syncWatchedDirs() {
    if (!watchEndpoint) return;
    const body = JSON.stringify({ paths: [...new Set(visibleDirs())] });
    if (body === sentWatchDirs) return;
    sentWatchDirs = body;
    try {
      const res = await fetch(watchEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      // A stale session (server restart) needs a resend once the stream reopens.
      if (!res.ok) { sentWatchDirs = ""; watchEndpoint = ""; }
    } catch { sentWatchDirs = ""; }
  }

  function stopWatching() {
    if (watchSyncTimer) clearTimeout(watchSyncTimer);
    watchSyncTimer = null;
    watchSource?.close();
    watchSource = null;
    watchEndpoint = "";
    sentWatchDirs = "";
  }

  function startWatching() {
    if (!visible || watchSource) return;
    const source = new EventSource(`${basePath}/api/files/watch`);
    watchSource = source;
    source.addEventListener("endpoint", (e) => {
      if (watchSource !== source || !visible) return;
      // Browsers reconnect a dropped stream on their own, which yields a fresh
      // session id — the watch set has to be re-declared against it.
      watchEndpoint = e.data;
      sentWatchDirs = "";
      void syncWatchedDirs();
    });
    source.addEventListener("change", (e) => {
      try {
        const { dirs } = JSON.parse(e.data);
        if (Array.isArray(dirs) && dirs.length) void refreshDirs(dirs, true);
      } catch { /* malformed payload — nothing to refresh */ }
    });
    source.addEventListener("error", () => { watchEndpoint = ""; });
  }

  // Re-declare the watch set when folders open or close, or the root changes.
  $effect(() => {
    visibleDirs();
    if (!visible) {
      stopWatching();
      return;
    }
    if (initialized) startWatching();
    if (watchSyncTimer) clearTimeout(watchSyncTimer);
    watchSyncTimer = setTimeout(syncWatchedDirs, WATCH_SYNC_DEBOUNCE_MS);
  });

  onDestroy(stopWatching);

  async function initializeRoot() {
    let initialRoot = savedRootPath();
    if (!initialRoot) {
      try {
        const res = await fetch(`${basePath}/api/config`);
        if (res.ok) { const cfg = await res.json(); if (cfg.cwd) initialRoot = cfg.cwd; }
      } catch { /* fall back to the current root */ }
    }
    // A terminal may have reported its directory while the config request was in
    // flight; a live shell outranks the remembered root.
    if (!autoCdApplied) {
      if (initialRoot) root = initialRoot;
      loadRoot();
    }
    if (visible) startWatching();
  }

  $effect(() => {
    if (!visible || initialized) return;
    initialized = true;
    void initializeRoot();
  });
</script>

<!-- Any right-click dismisses the open menu, in the capture phase so it runs
     before handlers that stop the event (the terminal's own menu); a tree row
     then reopens the menu for itself. -->
<svelte:document onclick={onDocClick} onkeydown={onDocKeydown} oncontextmenucapture={onDocClick} />

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

  {#if uploadStatus}
    <div class="fm-status">{uploadStatus}</div>
  {/if}
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
  <div class="ctx-menu" bind:this={ctxEl} style:left="{ctxPos.x}px" style:top="{ctxPos.y}px" role="menu" tabindex="-1"
    onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && closeCtx()}>
    {#if ctxTargets.length > 1}
      <!-- A multi-selection offers only the actions that apply to every row. -->
      <button class="ctx-menu-item" role="menuitem" onclick={() => setClipboard('cut')}>Cut {ctxTargets.length} items</button>
      <button class="ctx-menu-item" role="menuitem" onclick={() => setClipboard('copy')}>Copy {ctxTargets.length} items</button>
      <div class="ctx-menu-sep"></div>
      <button class="ctx-menu-item" role="menuitem" onclick={() => { downloading = ctxTargets; closeCtx(); }}>
        Download {ctxTargets.length} items
      </button>
    {:else}
    <button class="ctx-menu-item" role="menuitem"
      onclick={() => { creating = { parentPath: ctxMenu.node?.is_dir ? ctxMenu.node.path : null, type: 'file', name: '' }; closeCtx(); }}>
      New File
    </button>
    <button class="ctx-menu-item" role="menuitem"
      onclick={() => { creating = { parentPath: ctxMenu.node?.is_dir ? ctxMenu.node.path : null, type: 'folder', name: '' }; closeCtx(); }}>
      New Folder
    </button>
    {#if ctxMenu.node}
      <div class="ctx-menu-sep"></div>
      <button class="ctx-menu-item" role="menuitem"
        onclick={() => { renaming = { node: ctxMenu.node, name: ctxMenu.node.name }; closeCtx(); }}>
        Rename
      </button>
      <button class="ctx-menu-item ctx-menu-danger" role="menuitem"
        onclick={() => { deleting = ctxMenu.node; closeCtx(); }}>
        Delete
      </button>
      <div class="ctx-menu-sep"></div>
      <button class="ctx-menu-item" role="menuitem" onclick={() => setClipboard('cut')}>Cut</button>
      <button class="ctx-menu-item" role="menuitem" onclick={() => setClipboard('copy')}>Copy</button>
      <div class="ctx-menu-sep"></div>
      <button class="ctx-menu-item" role="menuitem"
        onclick={() => { navigator.clipboard.writeText(ctxMenu.node.path); closeCtx(); }}>
        Copy Path
      </button>
      <div class="ctx-menu-sep"></div>
    {/if}
    <button class="ctx-menu-item" class:ctx-menu-disabled={!clipboard} role="menuitem"
      onclick={() => { if (clipboard) crudPaste(ctxMenu.node); }}>
      Paste
    </button>
    {#if ctxMenu.node}
      <div class="ctx-menu-sep"></div>
      <button class="ctx-menu-item" role="menuitem"
        onclick={() => { downloading = ctxTargets; closeCtx(); }}>
        Download
      </button>
    {:else}
      <!-- Uploads target the root; offered only from the empty-area menu. -->
      <div class="ctx-menu-sep"></div>
      <button class="ctx-menu-item" class:ctx-menu-disabled={!!uploadStatus} role="menuitem"
        onclick={() => pickUpload(uploadFilesInput)}>
        Upload Files…
      </button>
      <button class="ctx-menu-item" class:ctx-menu-disabled={!!uploadStatus} role="menuitem"
        onclick={() => pickUpload(uploadFolderInput)}>
        Upload Folder…
      </button>
    {/if}
    {/if}
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

<input hidden type="file" multiple bind:this={uploadFilesInput} onchange={onUploadPicked} />
<input hidden type="file" webkitdirectory bind:this={uploadFolderInput} onchange={onUploadPicked} />

<!-- Overwrite confirm (upload, paste, move) -->
{#if conflicts}
  <div class="fm-modal-backdrop" role="button" tabindex="-1" onclick={() => conflicts = null} onkeydown={(e) => e.key === 'Escape' && (conflicts = null)}>
    <div class="fm-modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <div class="fm-modal-title">
        {conflicts.names.length === 1 ? `"${conflicts.names[0]}" already exists` : `${conflicts.names.length} items already exist`}
      </div>
      {#if conflicts.names.length > 1}
        <ul class="fm-modal-list">
          {#each conflicts.names.slice(0, 5) as name, i (i)}
            <li>{name}</li>
          {/each}
          {#if conflicts.names.length > 5}
            <li>…and {conflicts.names.length - 5} more</li>
          {/if}
        </ul>
      {/if}
      <div class="fm-modal-body">Replace with the {conflicts.what} {conflicts.names.length === 1 ? "item" : "items"}?</div>
      <div class="fm-modal-actions">
        <button class="fm-btn" use:focusButton onclick={() => conflicts = null}>Skip</button>
        <button class="fm-btn fm-btn-danger" onclick={() => { const { overwrite } = conflicts; conflicts = null; void overwrite(); }}>Replace</button>
      </div>
    </div>
  </div>
{/if}

<!-- Download confirm -->
{#if downloading}
  <div class="fm-modal-backdrop" role="button" tabindex="-1" onclick={() => downloading = null} onkeydown={(e) => e.key === 'Escape' && (downloading = null)}>
    <div class="fm-modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      {#if downloading.length === 1}
        <div class="fm-modal-title">Download "{downloading[0].name}"?</div>
        <div class="fm-modal-body">
          {downloading[0].is_dir ? `The folder will be downloaded as ${downloading[0].name}.zip.` : "The file will be saved by your browser."}
        </div>
      {:else}
        <div class="fm-modal-title">Download {downloading.length} items?</div>
        <ul class="fm-modal-list">
          {#each downloading.slice(0, 5) as node (node.path)}
            <li title={node.path}>{node.name}{node.is_dir ? "/" : ""}</li>
          {/each}
          {#if downloading.length > 5}
            <li>…and {downloading.length - 5} more</li>
          {/if}
        </ul>
        <div class="fm-modal-body">They will be downloaded together as selection.zip.</div>
      {/if}
      <div class="fm-modal-actions">
        <button class="fm-btn" onclick={() => downloading = null}>Cancel</button>
        <button class="fm-btn fm-btn-primary" use:focusButton onclick={downloadNodes}>Download</button>
      </div>
    </div>
  </div>
{/if}

{#snippet NodeRow({ node, depth })}
  {@const icon = node.is_dir ? null : fileIcon(node.name)}
  {@const isActive = activeTab === node.path}
  {@const isCtxSelected = ctxTargets.some(n => n.path === node.path)}
  {@const isRenaming = renaming?.node.path === node.path}
  {@const isCut = clipboard?.action === 'cut' && clipboard.items.some(i => i.path === node.path)}
  {@const isHidden = node.name.startsWith('.')}
  {@const isDragging = draggingNode?.path === node.path}
  {@const isDropTarget = dragTargetPath === node.path && draggingNode?.path !== node.path}
  {@const isInvalidDrop = isDropTarget && draggingNode && !canMoveTo(draggingNode, node)}
  <div
    class="fm-node"
    class:is-active={isActive}
    class:is-ctx={isCtxSelected}
    class:is-selected={isSelected(node)}
    class:is-dragging={isDragging}
    class:is-hidden={isHidden}
    class:is-drop-target={isDropTarget && !isInvalidDrop}
    class:is-drop-invalid={isInvalidDrop}
    style:padding-left="{depth * 16 + 4}px"
    style:opacity={isCut ? 0.4 : 1}
    role="button"
    tabindex="0"
    draggable={!isRenaming}
    onclick={(e) => onNodeClick(e, node)}
    oncontextmenu={(e) => onContextMenu(e, node)}
    onkeydown={(e) => e.key === "Enter" && handleClick(node)}
    ondragstart={(e) => onNodeDragStart(e, node)}
    ondragover={(e) => onNodeDragOver(e, node)}
    ondragleave={() => onNodeDragLeave(node)}
    ondrop={(e) => onNodeDrop(e, node)}
    ondragend={onNodeDragEnd}
  >
    <!-- Active file left border -->
    {#if isCtxSelected}
      <span class="fm-ctx-border"></span>
    {:else if isActive}
      <span class="fm-active-border"></span>
    {/if}

    <!-- Indent guide lines -->
    {#each Array.from({ length: depth }, (_, i) => i) as i (i)}
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
      {:else if hasImageIcon(node.name)}
        <svg class="fm-file-icon-svg" width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="var(--accent-purple)" stroke-width="1.3"/>
          <circle cx="5.75" cy="6.25" r="1.1" fill="var(--accent-yellow)"/>
          <path d="M2.7 12l3.8-3.8 2.3 2.3 1.7-1.7 2.8 2.8" stroke="var(--accent-green)" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
        </svg>
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
