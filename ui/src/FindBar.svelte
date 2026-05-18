<script>
  /** @type {{
   * value: string,
   * replaceValue?: string,
   * countText?: string,
   * caseSensitive?: boolean,
   * wholeWord?: boolean,
   * regexp?: boolean,
   * replaceVisible?: boolean,
   * readonly?: boolean,
   * showCase?: boolean,
   * showWord?: boolean,
   * showRegexp?: boolean,
   * showSelectAll?: boolean,
   * onSearchInput?: (value: string) => void,
   * onReplaceInput?: (value: string) => void,
   * onKeydown?: (event: KeyboardEvent) => void,
   * onPrevious?: () => void,
   * onNext?: () => void,
   * onClose?: () => void,
   * onOptionsChange?: (options: { caseSensitive: boolean, wholeWord: boolean, regexp: boolean, replaceValue: string }) => void,
   * onSelectAll?: () => void,
   * onReplace?: () => void,
   * onReplaceAll?: () => void,
   * onToggleReplace?: (visible: boolean) => void,
   * ariaLabel?: string,
   * className?: string
   * }} */
  let {
    value = $bindable(""),
    replaceValue = $bindable(""),
    countText = "",
    caseSensitive = $bindable(false),
    wholeWord = $bindable(false),
    regexp = $bindable(false),
    replaceVisible = $bindable(false),
    readonly = true,
    showCase = true,
    showWord = false,
    showRegexp = false,
    showSelectAll = false,
    onSearchInput,
    onReplaceInput,
    onKeydown,
    onPrevious,
    onNext,
    onClose,
    onOptionsChange,
    onSelectAll,
    onReplace,
    onReplaceAll,
    onToggleReplace,
    ariaLabel = "Find",
    className = "",
  } = $props();

  /** @type {HTMLInputElement | null} */
  let input = $state(null);

  export function focusSearch() {
    input?.focus();
    input?.select();
  }

  function notifyOptions() {
    onOptionsChange?.({ caseSensitive, wholeWord, regexp, replaceValue });
  }

  function toggleReplace() {
    replaceVisible = !replaceVisible;
    onToggleReplace?.(replaceVisible);
  }
</script>

<div class={`csb ${className}`} role="search" aria-label={ariaLabel}>
  {#if !readonly}
    <button
      class="csb-expand"
      class:csb-expanded={replaceVisible}
      type="button"
      title="Toggle Replace"
      aria-label="Toggle Replace"
      aria-expanded={replaceVisible}
      onclick={toggleReplace}>›</button>
  {/if}
  <div class="csb-inner">
    <div class="csb-row">
      <input
        bind:this={input}
        bind:value
        class="csb-input"
        placeholder="Find"
        aria-label="Find"
        oninput={() => onSearchInput?.(value)}
        onkeydown={onKeydown}
      />
      <span class="csb-count">{countText}</span>
      {#if showCase}
        <button
          class:csb-on={caseSensitive}
          class="csb-toggle"
          type="button"
          title="Match Case"
          onclick={() => { caseSensitive = !caseSensitive; notifyOptions(); }}>Aa</button>
      {/if}
      {#if showWord}
        <button
          class:csb-on={wholeWord}
          class="csb-toggle"
          type="button"
          title="Whole Word"
          onclick={() => { wholeWord = !wholeWord; notifyOptions(); }}>ab̲</button>
      {/if}
      {#if showRegexp}
        <button
          class:csb-on={regexp}
          class="csb-toggle"
          type="button"
          title="Use Regexp"
          onclick={() => { regexp = !regexp; notifyOptions(); }}>.*</button>
      {/if}
      <button class="csb-btn" type="button" title="Previous Match" onclick={onPrevious}>↑</button>
      <button class="csb-btn" type="button" title="Next Match" onclick={onNext}>↓</button>
      {#if showSelectAll}
        <button class="csb-btn" type="button" title="Select All" onclick={onSelectAll}>≡</button>
      {/if}
      <button class="csb-close" type="button" title="Close" onclick={onClose}>×</button>
    </div>
    {#if !readonly && replaceVisible}
      <div class="csb-row csb-replace-row">
        <input
          bind:value={replaceValue}
          class="csb-input"
          placeholder="Replace"
          aria-label="Replace"
          oninput={() => { onReplaceInput?.(replaceValue); notifyOptions(); }}
        />
        <button class="csb-btn" type="button" title="Replace" onclick={onReplace}>AB→</button>
        <button class="csb-btn" type="button" title="Replace All" onclick={onReplaceAll}>AB→→</button>
      </div>
    {/if}
  </div>
</div>
