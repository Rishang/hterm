<script>
  import { onDestroy } from "svelte";
  import CodeEditor, { supportedLangs } from "./CodeEditor.svelte";
  import { callTool } from "./toolsApi.js";
  import { lspLanguageForPath, lspServerForLanguage } from "./autocomplete/lsp.js";
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import { isImage } from "./fileIcon.js";

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");

  /** @type {{ tab: import("./App.svelte").FileTab | null | undefined, active?: boolean, reveal?: { path: string, line: number, column: number, length: number, focus: boolean, nonce: number } | null, lspServers?: Record<string, string>, autosave?: { enabled: boolean, delay: number }, editorStateFor?: (path: string, language: string) => import("@codemirror/state").EditorState | null, onEditorState?: (state: import("@codemirror/state").EditorState | undefined, path: string, language: string) => void, onFocus?: () => void, onOpenSidebar?: () => void }} */
  let { tab, active = true, reveal = null, lspServers = {}, autosave = { enabled: true, delay: 1000 }, editorStateFor = () => null, onEditorState = () => {}, onFocus, onOpenSidebar } = $props();
  let lspEnvironment = $state(null);
  let environmentRequest = 0;
  let autosaveTimer = null;
  let saving = false;
  let saveQueued = false;
  let mdPreviewEl = $state(null);
  let mermaidSeq = 0;

  const isSvg = (path) => /\.svg$/i.test(path);
  // Rendered through <img>, which never runs scripts embedded in the SVG.
  const svgDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  // Previewed markdown is untrusted (any cloned README) and renders same-origin
  // with the user's credentials, so marked's raw-HTML passthrough must not run
  // scripts: DOMPurify strips handlers and javascript: URLs. <style>, <form> and
  // style attributes are dropped too so a document cannot restyle the app or
  // cover it with a full-screen link. <input> stays for GFM task-list checkboxes.
  const renderMarkdown = (source) =>
    DOMPurify.sanitize(marked.parse(source), { FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["style"] });
  const rawUrl = (path) => `${basePath}/api/files/download?path=${encodeURIComponent(path)}`;

  // Relative image paths in markdown point at files beside the .md, not at the
  // hterm page. SVG is text, so load it through the file API as a data URL;
  // raster images load their raw bytes.
  $effect(() => {
    const source = tab?.preview ? tab.editContent : null;
    if (!mdPreviewEl || source == null) return;
    const dir = tab.path.slice(0, tab.path.lastIndexOf("/") + 1);
    let cancelled = false;
    for (const img of mdPreviewEl.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src");
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
      const path = decodeURIComponent(new URL(src, `file://${dir}`).pathname);
      if (isImage(path)) { img.src = rawUrl(path); continue; }
      if (!isSvg(path)) continue;
      fetch(`${basePath}/api/files/read?path=${encodeURIComponent(path)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((file) => { if (!cancelled && file && !file.is_binary) img.src = svgDataUrl(file.content); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  });

  // ponytail: render mermaid blocks in place after marked() paints; no markdown-it plugin pipeline
  $effect(() => {
    const source = tab?.preview ? tab.editContent : null;
    if (!mdPreviewEl || source == null) return;
    const blocks = [...mdPreviewEl.querySelectorAll("pre > code.language-mermaid")];
    if (!blocks.length) return;
    let cancelled = false;
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: "dark", suppressErrorRendering: true });
      for (const block of blocks) {
        try {
          const { svg } = await mermaid.render(`mermaid-${++mermaidSeq}`, block.textContent);
          if (cancelled) return;
          const host = document.createElement("div");
          host.className = "fm-mermaid";
          host.innerHTML = svg;
          block.parentElement.replaceWith(host);
        } catch {
          // leave the code block as-is when the diagram doesn't parse
        }
      }
    });
    return () => { cancelled = true; };
  });

  function fileLanguage(current) {
    const fname = current.path.split("/").pop()?.toLowerCase() ?? "";
    const shellNames = new Set([".bashrc", ".bash_profile", ".bash_aliases", ".zshrc", ".zprofile", ".profile", ".fishrc", "bashrc", "zshrc", "profile"]);
    if (current.langOverride) return current.langOverride;
    if (fname === "dockerfile" || fname.startsWith("dockerfile.")) return "dockerfile";
    if (fname === ".env" || fname.startsWith(".env.")) return "env";
    if (shellNames.has(fname)) return "sh";
    return current.path.split(".").pop()?.toLowerCase() ?? "";
  }

  async function refreshLspEnvironment(current) {
    const request = ++environmentRequest;
    const language = lspLanguageForPath(current.path, fileLanguage(current));
    if (!language || !lspServerForLanguage(language, lspServers)) {
      lspEnvironment = null;
      return;
    }
    if (language !== "python") {
      lspEnvironment = { kind: "global", name: "Global" };
      return;
    }
    try {
      const response = await fetch(`${basePath}/api/lsp/environment?path=${encodeURIComponent(current.path)}&language=${encodeURIComponent(language)}`);
      if (response.ok && request === environmentRequest) lspEnvironment = await response.json();
    } catch {
      if (request === environmentRequest) lspEnvironment = null;
    }
  }

  $effect(() => {
    const current = tab;
    if (!current || current.loading || current.isBinary || current.error) {
      lspEnvironment = null;
      return;
    }
    void refreshLspEnvironment(current);
  });

  function scheduleAutosave() {
    if (!autosave.enabled || !tab || tab.editContent === tab.content) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void saveTab();
    }, autosave.delay);
  }

  function onEditorChange(value) {
    if (!tab) return;
    tab.editContent = value;
    scheduleAutosave();
  }

  async function saveTab() {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    const current = tab;
    if (!current || current.editContent === current.content) return;
    if (saving) {
      saveQueued = true;
      return;
    }

    saving = true;
    const content = current.editContent;
    current.saveStatus = "saving";
    try {
      await callTool(basePath, "write_file", { path: current.path, content });
      current.content = content;
      current.saveStatus = "saved";
      setTimeout(() => {
        if (current.saveStatus === "saved") current.saveStatus = "";
      }, 2000);
    } catch {
      current.saveStatus = "error";
    } finally {
      saving = false;
      if (saveQueued || (autosave.enabled && current.editContent !== current.content)) {
        saveQueued = false;
        scheduleAutosave();
      }
    }
  }

  $effect(() => {
    if (!autosave.enabled) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
  });

  onDestroy(() => clearTimeout(autosaveTimer));
</script>

<div id="file-content" role="region" aria-label="File editor" onpointerdown={onFocus}>
  {#if !tab}
    <div class="fm-empty fm-empty-pane">
      <button class="fm-empty-action" type="button" onclick={onOpenSidebar}>Open a file</button>
    </div>
  {:else if tab.loading}
    <div class="fm-loading">Loading...</div>
  {:else if tab.error}
    <div class="fm-error fm-error-main">{tab.error}</div>
  {:else if tab.isBinary && isImage(tab.path)}
    <div class="fm-svg-preview fm-raster-preview"><img alt={tab.name} src={rawUrl(tab.path)} /></div>
  {:else if tab.isBinary}
    <div class="fm-binary">
      <span class="fm-binary-icon">⬡</span>
      <span>Binary file - cannot display as text</span>
      <code class="fm-binary-path">{tab.path}</code>
    </div>
  {:else}
    {#if tab.preview}
      {#if tab.path.endsWith(".html") || tab.path.endsWith(".htm")}
        <iframe class="fm-html-preview" title="HTML Preview" sandbox="" srcdoc={tab.editContent}></iframe>
      {:else if isSvg(tab.path)}
        <div class="fm-svg-preview"><img alt={tab.name} src={svgDataUrl(tab.editContent)} /></div>
      {:else}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="fm-md-preview" bind:this={mdPreviewEl}>{@html renderMarkdown(tab.editContent)}</div>
      {/if}
    {:else}
      {#key tab.id + tab.langOverride}
        <CodeEditor
          path={tab.path}
          value={tab.editContent}
          lang={tab.langOverride}
          savedState={editorStateFor(tab.path, tab.langOverride)}
          {lspServers}
          onlsenvironment={(environment) => { lspEnvironment = environment; }}
          {active}
          {reveal}
          externalEdit={tab.externalEdit ?? 0}
          onchange={onEditorChange}
          onsavedstate={onEditorState}
          onsave={saveTab}
        />
      {/key}
    {/if}

    <div class="fm-breadcrumb">
      <span class="fm-bc-part">{tab.path}</span>
      {#if lspEnvironment}
        <span class="fm-lsp-environment" title={lspEnvironment.path ?? "System language environment"}>LSP: {lspEnvironment.kind === "venv" ? `venv (${lspEnvironment.name})` : "global"}</span>
      {/if}
      <div class="fm-bc-tools">
        {#if tab.path.endsWith(".md") || tab.path.endsWith(".html") || tab.path.endsWith(".htm") || isSvg(tab.path)}
          <button class="fm-preview-btn" class:active={tab.preview} onclick={() => { tab.preview = !tab.preview; }}>
            {tab.preview ? "Edit" : "Preview"}
          </button>
        {/if}
        <select id="lang-select" class="fm-lang-select" value={tab.langOverride} onchange={(e) => { tab.langOverride = e.target.value; }}>
          <option value="">Auto</option>
          {#each supportedLangs as l (l)}
            <option value={l}>{l}</option>
          {/each}
        </select>
      </div>
    </div>
  {/if}
</div>
