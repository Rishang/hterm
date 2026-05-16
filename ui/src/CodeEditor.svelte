<script>
  import { onMount, onDestroy } from "svelte";
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter } from "@codemirror/language";
  import { search, searchKeymap, findNext, findPrevious, selectMatches, getSearchQuery, setSearchQuery, SearchQuery, closeSearchPanel, replaceNext, replaceAll } from "@codemirror/search";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { showMinimap } from "@replit/codemirror-minimap";

  const langMap = {
    js:     () => import("@codemirror/lang-javascript").then(m => m.javascript()),
    mjs:    () => import("@codemirror/lang-javascript").then(m => m.javascript()),
    jsx:    () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true })),
    ts:     () => import("@codemirror/lang-javascript").then(m => m.javascript({ typescript: true })),
    tsx:    () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true, typescript: true })),
    html:   () => import("@codemirror/lang-html").then(m => m.html()),
    svelte: () => import("@codemirror/lang-html").then(m => m.html()),
    css:    () => import("@codemirror/lang-css").then(m => m.css()),
    scss:   () => import("@codemirror/lang-css").then(m => m.css()),
    json:   () => import("@codemirror/lang-json").then(m => m.json()),
    py:     () => import("@codemirror/lang-python").then(m => m.python()),
    rs:     () => import("@codemirror/lang-rust").then(m => m.rust()),
    cpp:    () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    c:      () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    h:      () => import("@codemirror/lang-cpp").then(m => m.cpp()),
    md:     () => import("@codemirror/lang-markdown").then(m => m.markdown()),
    xml:    () => import("@codemirror/lang-xml").then(m => m.xml()),
    sql:    () => import("@codemirror/lang-sql").then(m => m.sql()),
    yaml:   () => import("@codemirror/lang-yaml").then(m => m.yaml()),
    yml:    () => import("@codemirror/lang-yaml").then(m => m.yaml()),
    go:     () => import("@codemirror/lang-go").then(m => m.go()),
    toml:   () => Promise.all([
                import("@codemirror/legacy-modes/mode/toml"),
                import("@codemirror/language"),
              ]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.toml)),
    sh:     () => Promise.all([
                import("@codemirror/legacy-modes/mode/shell"),
                import("@codemirror/language"),
              ]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.shell)),
    bash:   () => Promise.all([
                import("@codemirror/legacy-modes/mode/shell"),
                import("@codemirror/language"),
              ]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.shell)),
    zsh:    () => Promise.all([
                import("@codemirror/legacy-modes/mode/shell"),
                import("@codemirror/language"),
              ]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.shell)),
    fish:   () => Promise.all([
                import("@codemirror/legacy-modes/mode/shell"),
                import("@codemirror/language"),
              ]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.shell)),
    dockerfile: () => Promise.all([
                import("@codemirror/legacy-modes/mode/dockerfile"),
                import("@codemirror/language"),
              ]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.dockerFile)),
  };

  /** @type {{ path: string, value: string, readonly?: boolean, onchange?: (v: string) => void, onsave?: () => void }} */
  let { path, value, readonly = false, onchange, onsave } = $props();

  /** @type {HTMLElement} */
  let container;
  /** @type {EditorView | null} */
  let view = null;

  /** @param {import("@codemirror/view").EditorView} v */
  function createSearchPanel(v) {
    const dom = document.createElement("div");
    dom.className = "csb";
    dom.setAttribute("onkeydown", ""); // prevent CM from stealing

    // ── expand toggle (›) ──────────────────────────────────────────────────
    const expandBtn = document.createElement("button");
    expandBtn.className = "csb-expand"; expandBtn.textContent = "›"; expandBtn.title = "Toggle Replace";
    let replaceVisible = false;

    // ── find row ───────────────────────────────────────────────────────────
    const findRow = document.createElement("div"); findRow.className = "csb-row";
    const findInput = document.createElement("input");
    findInput.placeholder = "Find"; findInput.className = "csb-input";
    findInput.setAttribute("main-field", "true");

    const matchCount = document.createElement("span"); matchCount.className = "csb-count";

    const btnCase = mkToggle("Aa", "Match Case");
    const btnWord = mkToggle("ab̲", "Whole Word");
    const btnRe   = mkToggle(".*", "Use Regexp");
    const btnPrev = mkIconBtn("↑", "Previous Match", () => findPrevious(v));
    const btnNext = mkIconBtn("↓", "Next Match",     () => findNext(v));
    const btnAll  = mkIconBtn("≡", "Select All",     () => selectMatches(v));
    const btnClose= mkIconBtn("×", "Close",          () => closeSearchPanel(v));
    btnClose.className = "csb-close";

    findRow.append(findInput, matchCount, btnCase, btnWord, btnRe, btnPrev, btnNext, btnAll, btnClose);

    // ── replace row ────────────────────────────────────────────────────────
    const replaceRow = document.createElement("div"); replaceRow.className = "csb-row csb-replace-row";
    replaceRow.style.display = "none";
    const replaceInput = document.createElement("input");
    replaceInput.placeholder = "Replace"; replaceInput.className = "csb-input";
    const btnReplace    = mkIconBtn("AB→", "Replace",     () => replaceNext(v));
    const btnReplaceAll = mkIconBtn("AB→→", "Replace All", () => replaceAll(v));
    replaceRow.append(replaceInput, btnReplace, btnReplaceAll);

    expandBtn.addEventListener("click", () => {
      replaceVisible = !replaceVisible;
      replaceRow.style.display = replaceVisible ? "flex" : "none";
      expandBtn.style.transform = replaceVisible ? "rotate(90deg)" : "";
    });

    dom.append(expandBtn, Object.assign(document.createElement("div"), {
      className: "csb-main",
      append: function(...args) { this.append(...args); return this; }
    }));
    // simpler: just append directly
    dom.innerHTML = ""; // reset
    const inner = document.createElement("div"); inner.className = "csb-inner";
    inner.append(findRow, replaceRow);
    dom.append(expandBtn, inner);

    function sync() {
      const q = new SearchQuery({
        search: findInput.value,
        replace: replaceInput.value,
        caseSensitive: btnCase.dataset.on === "1",
        wholeWord: btnWord.dataset.on === "1",
        regexp: btnRe.dataset.on === "1",
      });
      v.dispatch({ effects: setSearchQuery.of(q) });
    }

    findInput.addEventListener("input", sync);
    replaceInput.addEventListener("input", sync);
    findInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.shiftKey ? findPrevious(v) : findNext(v); e.preventDefault(); }
      if (e.key === "Escape") { closeSearchPanel(v); }
    });
    [btnCase, btnWord, btnRe].forEach(t => t.addEventListener("click", () => {
      t.dataset.on = t.dataset.on === "1" ? "0" : "1";
      t.classList.toggle("csb-on", t.dataset.on === "1");
      sync();
    }));

    return {
      dom,
      top: false,
      mount() { findInput.focus(); findInput.select(); },
      update(update) {
        // sync match count from search state
        const q = getSearchQuery(update.state);
        if (q.search !== findInput.value) findInput.value = q.search;
      },
    };
  }

  function mkToggle(label, title) {
    const b = document.createElement("button");
    b.textContent = label; b.title = title;
    b.className = "csb-toggle"; b.dataset.on = "0";
    return b;
  }
  function mkIconBtn(label, title, fn) {
    const b = document.createElement("button");
    b.textContent = label; b.title = title; b.className = "csb-btn";
    b.addEventListener("click", fn); return b;
  }

  onMount(async () => {
    const fname = path.split("/").pop()?.toLowerCase() ?? "";
    const SHELL_NAMES = new Set(['.bashrc','.bash_profile','.bash_aliases','.zshrc','.zprofile','.profile','.fishrc','bashrc','zshrc','profile']);
    const isDockerfile = fname === 'dockerfile' || fname.startsWith('dockerfile.');
    const ext = isDockerfile ? "dockerfile" : SHELL_NAMES.has(fname) ? "sh" : (path.split(".").pop()?.toLowerCase() ?? "");
    const langExt = langMap[ext] ? await langMap[ext]() : [];

    const extensions = [
      oneDark,
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      foldGutter(),
      EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ...(readonly
        ? [EditorState.readOnly.of(true)]
        : [
            history(),
            indentOnInput(),
            bracketMatching(),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab,
              { key: "Mod-s", run: () => { onsave?.(); return true; } },
            ]),
          ]
      ),
      search({ top: false, createPanel: createSearchPanel }),
      showMinimap.of({
        create() { const dom = document.createElement("div"); return { dom }; },
        displayText: "blocks",
        showOverlay: "mouse-over",
      }),
      EditorView.updateListener.of((u) => {
        if (!readonly && u.docChanged && onchange) onchange(u.state.doc.toString());
      }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": {
          fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
          overflow: "auto",
          scrollbarColor: "var(--border) transparent",
          scrollbarWidth: "thin",
        },
        ".cm-scroller::-webkit-scrollbar": { width: "3px", height: "3px" },
        ".cm-scroller::-webkit-scrollbar-track": { background: "transparent" },
        ".cm-scroller::-webkit-scrollbar-thumb": { background: "var(--border)", borderRadius: "2px" },
        ".cm-content": { padding: "8px 0" },
      }),
      langExt,
    ].flat();

    view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: container,
    });
  });

  onDestroy(() => { view?.destroy(); });
</script>

<div class="cm-wrap" bind:this={container}></div>

<style>
  .cm-wrap {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .cm-wrap :global(.cm-editor) {
    flex: 1;
    height: 100%;
    position: relative;
  }
</style>
