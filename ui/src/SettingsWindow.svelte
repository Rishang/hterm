<script>
  import LspSettings from "./LspSettings.svelte";

  /** @type {{ servers?: Record<string, string>, onchange?: (language: string, server: string) => void, autosave?: { enabled: boolean, delay: number }, onautosavechange?: (settings: { enabled: boolean, delay: number }) => void, explorer?: { autoCd: boolean }, onexplorerchange?: (settings: { autoCd: boolean }) => void }} */
  let { servers = {}, onchange, autosave = { enabled: true, delay: 1000 }, onautosavechange, explorer = { autoCd: true }, onexplorerchange } = $props();
  let open = $state(false);
  let section = $state("lsp");

  function close() { open = false; }
  function onKeydown(event) {
    if (event.key === "Escape") close();
  }
  function onBackdropClick(event) {
    if (event.target === event.currentTarget) close();
  }
</script>

<div class="tab-bar-actions">
  <button
    class="tab-info-btn"
    class:active={open}
    type="button"
    title="Settings"
    aria-label="Open settings"
    aria-expanded={open}
    onclick={() => { open = true; }}>
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="8" r="2.2"/>
      <path d="M13.2 9.1a5.6 5.6 0 0 0 .04-2.2l1.25-.95-1.4-2.42-1.5.6a5.5 5.5 0 0 0-1.9-1.1L9.45 1.5h-2.8l-.2 1.53a5.5 5.5 0 0 0-1.9 1.1l-1.5-.6-1.4 2.42 1.25.95a5.6 5.6 0 0 0 .04 2.2l-1.25.95 1.4 2.42 1.5-.6a5.5 5.5 0 0 0 1.9 1.1l.2 1.53h2.8l.2-1.53a5.5 5.5 0 0 0 1.9-1.1l1.5.6 1.4-2.42-1.25-.95Z"/>
    </svg>
  </button>
</div>

{#if open}
  <div class="settings-backdrop" role="presentation" onclick={onBackdropClick} onkeydown={onKeydown}>
    <div class="settings-window" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1">
      <header class="settings-header">
        <h2>Settings</h2>
        <button type="button" class="settings-close" aria-label="Close settings" onclick={close}>×</button>
      </header>
      <div class="settings-body">
        <nav class="settings-nav" aria-label="Settings sections">
          <button type="button" class:active={section === "lsp"} onclick={() => { section = "lsp"; }}>Language Servers</button>
          <button type="button" class:active={section === "autosave"} onclick={() => { section = "autosave"; }}>Autosave</button>
          <button type="button" class:active={section === "explorer"} onclick={() => { section = "explorer"; }}>File Explorer</button>
        </nav>
        <main class="settings-content">
          {#if section === "lsp"}
            <h3>Language Servers</h3>
            <LspSettings {servers} {onchange} />
          {:else if section === "autosave"}
            <h3>Autosave</h3>
            <p class="settings-description">Save files after editing. Changes made during an active save are queued automatically.</p>
            <label class="settings-check">
              <input type="checkbox" checked={autosave.enabled} onchange={(event) => onautosavechange?.({ ...autosave, enabled: event.currentTarget.checked })} />
              <span>Save automatically after edits</span>
            </label>
            <label class="settings-field">
              <span>Delay</span>
              <input type="number" min="250" max="60000" step="250" value={autosave.delay} disabled={!autosave.enabled} onchange={(event) => onautosavechange?.({ ...autosave, delay: event.currentTarget.value })} />
              <span>ms</span>
            </label>
          {:else if section === "explorer"}
            <h3>File Explorer</h3>
            <p class="settings-description">The explorer reflects changes made outside the browser, such as commands run in a terminal session, without needing a refresh.</p>
            <label class="settings-check">
              <input type="checkbox" checked={explorer.autoCd} onchange={(event) => onexplorerchange?.({ ...explorer, autoCd: event.currentTarget.checked })} />
              <span>Follow the active terminal's directory</span>
            </label>
            <p class="settings-description">When enabled, the tree points at the working directory of whichever terminal tab is on screen and follows it as you <code>cd</code>. Switching terminal tabs re-points the tree. Your manually pinned path is remembered and restored when this is turned off.</p>
          {/if}
        </main>
      </div>
    </div>
  </div>
{/if}
