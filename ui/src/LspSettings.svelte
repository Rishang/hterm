<script>
  import { LSP_SERVER_OPTIONS } from "./autocomplete/lsp.js";

  /** @type {{ servers?: Record<string, string>, onchange?: (language: string, server: string) => void }} */
  let { servers = {}, onchange } = $props();
</script>

<p class="settings-description">Choose the server used for each language, or disable LSP for it. Servers must be installed on the hterm host.</p>
<div class="lsp-settings-list">
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
</div>
