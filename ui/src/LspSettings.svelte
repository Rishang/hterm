<script>
  // lsp.js is imported lazily below: a static import would pull CodeMirror and
  // marked into the startup bundle the terminal waits on.

  /** @type {{ servers?: Record<string, string>, onchange?: (language: string, server: string) => void }} */
  let { servers = {}, onchange } = $props();
</script>

<p class="settings-description">Choose the server used for each language, or disable LSP for it. Servers must be installed on the hterm host.</p>
<div class="lsp-settings-list">
  {#await import("./autocomplete/lsp.js") then { LSP_SERVER_OPTIONS }}
  {#each LSP_SERVER_OPTIONS as { language, id, options } (id)}
    <label>
      <span>{language}</span>
      <select value={servers[id] ?? options[0][0]} aria-label={`${language} language server`} onchange={(e) => onchange?.(id, e.currentTarget.value)}>
        <option value="disabled">Disabled</option>
        {#each options as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
  {/each}
  {:catch}
  <p class="load-error" role="alert">Failed to load the language server list. Reopen settings or reload the page.</p>
  {/await}
</div>
