<script>
  /** @type {{ open: boolean }} */
  let { open = $bindable(false) } = $props();

  const isMacOS = typeof navigator !== "undefined"
    && /Mac|iPhone|iPad|iPod/.test(navigator.userAgentData?.platform || navigator.platform || "");

  const shortcutHints = isMacOS ? [
    ["Cmd + P", "Open file (command palette)"],
    ["Ctrl + `", "Switch between terminal and file tabs"],
    ["Cmd + Shift + [", "Previous tab"],
    ["Cmd + Shift + ]", "Next tab"],
    ["Cmd + F", "Find in the active tab"],
    ["Enter / Shift + Enter", "Next or previous find result"],
    ["Esc", "Close the find bar"],
    ["Cmd + S", "Save the active file tab"],
    ["Ctrl + Shift + C", "Copy terminal selection"],
    ["Ctrl + Shift + V", "Paste into terminal"],
  ] : [
    ["Ctrl + P", "Open file (command palette)"],
    ["Ctrl + `", "Switch between terminal and file tabs"],
    ["Ctrl/Alt + PageUp", "Previous tab"],
    ["Ctrl/Alt + PageDown", "Next tab"],
    ["Ctrl + F", "Find in the active tab"],
    ["Enter / Shift + Enter", "Next or previous find result"],
    ["Esc", "Close the find bar"],
    ["Ctrl + S", "Save the active file tab"],
    ["Ctrl + Shift + C", "Copy terminal selection"],
    ["Ctrl + Shift + V", "Paste into terminal"],
  ];
</script>

<div class="tab-bar-actions">
  <button
    class="tab-info-btn"
    class:active={open}
    type="button"
    title="Terminal shortcuts"
    aria-label="Show terminal shortcuts"
    aria-expanded={open}
    onclick={(e) => { e.stopPropagation(); open = !open; }}>
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.1" stroke="currentColor" stroke-width="1.45"/>
      <line x1="8" y1="7" x2="8" y2="11" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
      <circle cx="8" cy="4.8" r="0.8" fill="currentColor"/>
    </svg>
  </button>
  {#if open}
    <div class="shortcut-popover" role="dialog" aria-label="Terminal shortcuts" tabindex="-1">
      <div class="shortcut-title">Terminal shortcuts</div>
      <div class="shortcut-grid">
        {#each shortcutHints as [keys, action]}
          <kbd>{keys}</kbd>
          <span>{action}</span>
        {/each}
      </div>
    </div>
  {/if}
</div>
