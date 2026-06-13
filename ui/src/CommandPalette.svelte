<script>
  import { fuzzyFilter } from "./fuzzy.js";
  import { fetchFileList } from "./fileList.js";

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");

  /** @type {{ open: boolean, openFileByPath: (path: string) => void }} */
  let { open = $bindable(false), openFileByPath } = $props();

  /** Session cache of file paths (persists across opens). */
  let allFiles = $state([]);
  let loading = $state(false);
  let loadError = $state("");
  let query = $state("");
  let selected = $state(0);
  /** @type {HTMLInputElement | null} */
  let inputEl = null;
  /** @type {HTMLElement | null} */
  let listEl = null;

  const results = $derived(fuzzyFilter(allFiles, query.trim(), 50));

  async function refresh() {
    // Only block the UI with "Indexing…" on the very first load; otherwise refresh silently.
    loading = allFiles.length === 0;
    loadError = "";
    try {
      allFiles = await fetchFileList(basePath);
    } catch (e) {
      loadError = String(e instanceof Error ? e.message : e);
    } finally {
      loading = false;
    }
  }

  // On open: reset query/selection, focus the input, show cache + background refresh.
  $effect(() => {
    if (open) {
      query = "";
      selected = 0;
      queueMicrotask(() => { inputEl?.focus(); inputEl?.select(); });
      refresh();
    }
  });

  // Keep the selection in range as results change (guarded so it never writes an equal value).
  $effect(() => {
    const max = Math.max(0, results.length - 1);
    if (selected > max) selected = max;
  });

  function close() { open = false; }

  function choose(path) {
    if (!path) return;
    openFileByPath(path);
    close();
  }

  function scrollSelectedIntoView() {
    queueMicrotask(() => {
      listEl?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function onKeydown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = results.length ? (selected + 1) % results.length : 0;
      scrollSelectedIntoView();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = results.length ? (selected - 1 + results.length) % results.length : 0;
      scrollSelectedIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[selected]?.path);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  /** Break path[from,to) into {text, hit} runs, hit = matched char. */
  function segments(path, hitSet, from, to) {
    const out = [];
    let cur = "";
    let curHit = null;
    for (let i = from; i < to; i++) {
      const hit = hitSet.has(i);
      if (hit !== curHit) {
        if (cur) out.push({ text: cur, hit: curHit });
        cur = "";
        curHit = hit;
      }
      cur += path[i];
    }
    if (cur) out.push({ text: cur, hit: curHit });
    return out;
  }
</script>

{#if open}
  <div class="cmdp-backdrop" role="presentation" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="cmdp" role="dialog" aria-label="Open file" onclick={(e) => e.stopPropagation()}>
      <input
        bind:this={inputEl}
        bind:value={query}
        class="cmdp-input"
        type="text"
        placeholder="Search files by name…"
        aria-label="Search files by name"
        role="combobox"
        aria-expanded="true"
        aria-controls="cmdp-listbox"
        aria-activedescendant={results.length ? `cmdp-opt-${selected}` : undefined}
        autocomplete="off"
        spellcheck="false"
        onkeydown={onKeydown}
      />
      <div class="cmdp-list" bind:this={listEl} id="cmdp-listbox" role="listbox" tabindex="-1" aria-label="Files">
        {#if loading}
          <div class="cmdp-empty">Indexing files…</div>
        {:else if loadError}
          <div class="cmdp-empty cmdp-error">{loadError}</div>
        {:else if results.length === 0}
          <div class="cmdp-empty">No files found</div>
        {:else}
          {#each results as r, i (r.path)}
            {@const hitSet = new Set(r.positions)}
            {@const slash = r.path.lastIndexOf("/")}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div
              class="cmdp-row"
              class:selected={i === selected}
              data-idx={i}
              id={`cmdp-opt-${i}`}
              role="option"
              aria-selected={i === selected}
              onmouseenter={() => { selected = i; }}
              onclick={() => choose(r.path)}>
              {#if slash >= 0}
                <span class="cmdp-dir">
                  {#each segments(r.path, hitSet, 0, slash + 1) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}
                </span>
              {/if}
              <span class="cmdp-name">
                {#each segments(r.path, hitSet, slash + 1, r.path.length) as seg}{#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}
              </span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
