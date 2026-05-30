<script>
  import CodeEditor, { supportedLangs } from "./CodeEditor.svelte";
  import { marked } from "marked";

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");

  /** @type {{ tab: import("./App.svelte").FileTab | null | undefined, active?: boolean, searchTrigger?: number, onFocus?: () => void, onOpenSidebar?: () => void }} */
  let { tab, active = true, searchTrigger = 0, onFocus, onOpenSidebar } = $props();

  async function saveTab() {
    if (!tab) return;
    tab.saveStatus = "saving";
    try {
      await fetch(`${basePath}/api/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "write_file", arguments: { path: tab.path, content: tab.editContent } }),
      });
      tab.content = tab.editContent;
      tab.saveStatus = "saved";
      setTimeout(() => {
        if (tab?.saveStatus === "saved") tab.saveStatus = "";
      }, 2000);
    } catch {
      tab.saveStatus = "error";
    }
  }
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
        <div class="fm-md-preview">{@html marked(tab.editContent)}</div>
      {/if}
    {:else}
      {#key tab.id + tab.langOverride}
        <CodeEditor
          path={tab.path}
          value={tab.editContent}
          lang={tab.langOverride}
          savedState={tab.editorState}
          {active}
          {searchTrigger}
          onchange={(v) => { tab.editContent = v; }}
          onsavedstate={(s) => { tab.editorState = s; }}
          onsave={saveTab}
        />
      {/key}
    {/if}

    <div class="fm-breadcrumb">
      <span class="fm-bc-part">{tab.path}</span>
      <div class="fm-bc-tools">
        {#if tab.path.endsWith(".md") || tab.path.endsWith(".html") || tab.path.endsWith(".htm")}
          <button class="fm-preview-btn" class:active={tab.preview} onclick={() => { tab.preview = !tab.preview; }}>
            {tab.preview ? "Edit" : "Preview"}
          </button>
        {/if}
        <select id="lang-select" class="fm-lang-select" value={tab.langOverride} onchange={(e) => { tab.editorState = null; tab.langOverride = e.target.value; }}>
          <option value="">Auto</option>
          {#each supportedLangs as l (l)}
            <option value={l}>{l}</option>
          {/each}
        </select>
      </div>
    </div>
  {/if}
</div>
