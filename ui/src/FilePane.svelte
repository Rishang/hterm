<script>
  import { onDestroy } from "svelte";
  import CodeEditor, { supportedLangs } from "./CodeEditor.svelte";
  import { callTool } from "./toolsApi.js";
  import { lspLanguageForPath, lspServerForLanguage } from "./autocomplete/lsp.js";
  import { marked } from "marked";

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
      {:else}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="fm-md-preview" bind:this={mdPreviewEl}>{@html marked(tab.editContent)}</div>
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
        {#if tab.path.endsWith(".md") || tab.path.endsWith(".html") || tab.path.endsWith(".htm")}
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
