<script module>
  const langMap = {};

  function add(names, loader) {
    for (const name of names) langMap[name] = loader;
  }

  function language(importer, name, options) {
    return () => importer().then(module => module[name](options));
  }

  function legacy(importer, name) {
    return () => Promise.all([importer(), import("@codemirror/language")])
      .then(([module, { StreamLanguage }]) => StreamLanguage.define(module[name]));
  }

  add(["js", "mjs"], language(() => import("@codemirror/lang-javascript"), "javascript"));
  add(["jsx"], language(() => import("@codemirror/lang-javascript"), "javascript", { jsx: true }));
  add(["ts"], language(() => import("@codemirror/lang-javascript"), "javascript", { typescript: true }));
  add(["tsx"], language(() => import("@codemirror/lang-javascript"), "javascript", { jsx: true, typescript: true }));
  add(["html", "htm", "tpl", "svelte"], language(() => import("@codemirror/lang-html"), "html"));
  add(["vue"], language(() => import("@codemirror/lang-vue"), "vue"));
  add(["angular"], language(() => import("@codemirror/lang-angular"), "angular"));
  add(["css", "scss"], language(() => import("@codemirror/lang-css"), "css"));
  add(["json"], language(() => import("@codemirror/lang-json"), "json"));
  add(["php", "phtml"], language(() => import("@codemirror/lang-php"), "php"));
  add(["py"], language(() => import("@codemirror/lang-python"), "python"));
  add(["rs"], language(() => import("@codemirror/lang-rust"), "rust"));
  add(["cpp", "c", "h"], language(() => import("@codemirror/lang-cpp"), "cpp"));
  add(["md"], language(() => import("@codemirror/lang-markdown"), "markdown"));
  add(["xml"], language(() => import("@codemirror/lang-xml"), "xml"));
  add(["sql"], language(() => import("@codemirror/lang-sql"), "sql"));
  add(["yaml", "yml", "helm", "kubernetes", "k8s"], language(() => import("@codemirror/lang-yaml"), "yaml"));
  add(["go"], language(() => import("@codemirror/lang-go"), "go"));
  add(["lezer", "grammar"], language(() => import("@codemirror/lang-lezer"), "lezer"));
  add(["wast", "wat"], language(() => import("@codemirror/lang-wast"), "wast"));

  add(["toml"], legacy(() => import("@codemirror/legacy-modes/mode/toml"), "toml"));
  add(["sh", "bash", "zsh", "fish"], legacy(() => import("@codemirror/legacy-modes/mode/shell"), "shell"));
  add(["dockerfile"], legacy(() => import("@codemirror/legacy-modes/mode/dockerfile"), "dockerFile"));
  add(["config", "properties", "ini"], legacy(() => import("@codemirror/legacy-modes/mode/properties"), "properties"));
  add(["lua"], legacy(() => import("@codemirror/legacy-modes/mode/lua"), "lua"));
  add(["rb", "ruby"], legacy(() => import("@codemirror/legacy-modes/mode/ruby"), "ruby"));
  add(["pl", "pm", "perl"], legacy(() => import("@codemirror/legacy-modes/mode/perl"), "perl"));
  add(["r", "R"], legacy(() => import("@codemirror/legacy-modes/mode/r"), "r"));
  add(["swift"], legacy(() => import("@codemirror/legacy-modes/mode/swift"), "swift"));
  add(["kt", "kotlin"], legacy(() => import("@codemirror/legacy-modes/mode/clike"), "kotlin"));
  add(["java"], legacy(() => import("@codemirror/legacy-modes/mode/clike"), "java"));
  add(["cs", "csharp"], legacy(() => import("@codemirror/legacy-modes/mode/clike"), "csharp"));
  add(["scala"], legacy(() => import("@codemirror/legacy-modes/mode/clike"), "scala"));
  add(["dart"], legacy(() => import("@codemirror/legacy-modes/mode/clike"), "dart"));
  add(["groovy"], legacy(() => import("@codemirror/legacy-modes/mode/groovy"), "groovy"));
  add(["jl", "julia"], legacy(() => import("@codemirror/legacy-modes/mode/julia"), "julia"));
  add(["hs", "haskell"], legacy(() => import("@codemirror/legacy-modes/mode/haskell"), "haskell"));
  add(["clj", "cljs"], legacy(() => import("@codemirror/legacy-modes/mode/clojure"), "clojure"));
  add(["erl", "ex", "exs"], legacy(() => import("@codemirror/legacy-modes/mode/erlang"), "erlang"));
  add(["elm"], legacy(() => import("@codemirror/legacy-modes/mode/elm"), "elm"));
  add(["ml", "mli"], legacy(() => import("@codemirror/legacy-modes/mode/mllike"), "oCaml"));
  add(["fs", "fsx"], legacy(() => import("@codemirror/legacy-modes/mode/mllike"), "fSharp"));
  add(["sml"], legacy(() => import("@codemirror/legacy-modes/mode/mllike"), "sml"));
  add(["coffee"], legacy(() => import("@codemirror/legacy-modes/mode/coffeescript"), "coffeeScript"));
  add(["cr"], legacy(() => import("@codemirror/legacy-modes/mode/crystal"), "crystal"));
  add(["d"], legacy(() => import("@codemirror/legacy-modes/mode/d"), "d"));
  add(["f", "f90"], legacy(() => import("@codemirror/legacy-modes/mode/fortran"), "fortran"));
  add(["pas"], legacy(() => import("@codemirror/legacy-modes/mode/pascal"), "pascal"));
  add(["scm"], legacy(() => import("@codemirror/legacy-modes/mode/scheme"), "scheme"));
  add(["lisp", "cl"], legacy(() => import("@codemirror/legacy-modes/mode/commonlisp"), "commonLisp"));
  add(["tcl"], legacy(() => import("@codemirror/legacy-modes/mode/tcl"), "tcl"));
  add(["m"], legacy(() => import("@codemirror/legacy-modes/mode/octave"), "octave"));
  add(["vb"], legacy(() => import("@codemirror/legacy-modes/mode/vb"), "vb"));
  add(["vbs"], legacy(() => import("@codemirror/legacy-modes/mode/vbscript"), "vbScript"));
  add(["ps1", "psm1"], legacy(() => import("@codemirror/legacy-modes/mode/powershell"), "powerShell"));
  add(["v", "sv"], legacy(() => import("@codemirror/legacy-modes/mode/verilog"), "verilog"));
  add(["vhd", "vhdl"], legacy(() => import("@codemirror/legacy-modes/mode/vhdl"), "vhdl"));
  add(["diff", "patch"], legacy(() => import("@codemirror/legacy-modes/mode/diff"), "diff"));
  add(["proto"], legacy(() => import("@codemirror/legacy-modes/mode/protobuf"), "protobuf"));
  add(["cmake"], legacy(() => import("@codemirror/legacy-modes/mode/cmake"), "cmake"));
  add(["nginx"], legacy(() => import("@codemirror/legacy-modes/mode/nginx"), "nginx"));
  add(["pug", "jade"], legacy(() => import("@codemirror/legacy-modes/mode/pug"), "pug"));
  add(["styl"], legacy(() => import("@codemirror/legacy-modes/mode/stylus"), "stylus"));
  add(["sass"], legacy(() => import("@codemirror/legacy-modes/mode/sass"), "sass"));
  add(["tex", "latex"], legacy(() => import("@codemirror/legacy-modes/mode/stex"), "stex"));
  add(["textile"], legacy(() => import("@codemirror/legacy-modes/mode/textile"), "textile"));
  add(["sparql"], legacy(() => import("@codemirror/legacy-modes/mode/sparql"), "sparql"));
  add(["ttl"], legacy(() => import("@codemirror/legacy-modes/mode/turtle"), "turtle"));
  add(["hx"], legacy(() => import("@codemirror/legacy-modes/mode/haxe"), "haxe"));
  add(["nsi", "nsis"], legacy(() => import("@codemirror/legacy-modes/mode/nsis"), "nsis"));
  add(["feature"], legacy(() => import("@codemirror/legacy-modes/mode/gherkin"), "gherkin"));
  add(["pp"], legacy(() => import("@codemirror/legacy-modes/mode/puppet"), "puppet"));
  add(["q"], legacy(() => import("@codemirror/legacy-modes/mode/q"), "q"));
  add(["apl"], legacy(() => import("@codemirror/legacy-modes/mode/apl"), "apl"));
  add(["bf"], legacy(() => import("@codemirror/legacy-modes/mode/brainfuck"), "brainfuck"));
  add(["forth"], legacy(() => import("@codemirror/legacy-modes/mode/forth"), "forth"));
  add(["factor"], legacy(() => import("@codemirror/legacy-modes/mode/factor"), "factor"));
  add(["oz"], legacy(() => import("@codemirror/legacy-modes/mode/oz"), "oz"));
  add(["pig"], legacy(() => import("@codemirror/legacy-modes/mode/pig"), "pig"));
  add(["sas"], legacy(() => import("@codemirror/legacy-modes/mode/sas"), "sas"));
  add(["st"], legacy(() => import("@codemirror/legacy-modes/mode/smalltalk"), "smalltalk"));
  add(["cob", "cobol"], legacy(() => import("@codemirror/legacy-modes/mode/cobol"), "cobol"));
  add(["ebnf"], legacy(() => import("@codemirror/legacy-modes/mode/ebnf"), "ebnf"));
  add(["dylan"], legacy(() => import("@codemirror/legacy-modes/mode/dylan"), "dylan"));
  add(["ls"], legacy(() => import("@codemirror/legacy-modes/mode/livescript"), "liveScript"));
  add(["mathematica", "wl"], legacy(() => import("@codemirror/legacy-modes/mode/mathematica"), "mathematica"));
  add(["tf", "tfvars", "hcl"], language(() => import("codemirror-lang-terraform"), "terraform"));

  export const supportedLangs = Object.keys(langMap).sort();
</script>
<script>
  import { onMount, onDestroy } from "svelte";
  import { mount, unmount } from "svelte";
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter } from "@codemirror/language";
  import { search, searchKeymap, findNext, findPrevious, selectMatches, getSearchQuery, setSearchQuery, SearchQuery, closeSearchPanel, replaceNext, replaceAll } from "@codemirror/search";
  import { autocompletion, completeAnyWord } from "@codemirror/autocomplete";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { showMinimap } from "@replit/codemirror-minimap";
  import FindBar from "./FindBar.svelte";
  import { dockerCompletionSource, isDockerAutocompleteFile } from "./autocomplete/docker.js";
  import { goTemplateCompletionSource, isGoTemplateFile } from "./autocomplete/gotemplate.js";
  import { lspCompletionSource, lspHoverTooltip, lspLanguageForPath, lspServerForLanguage } from "./autocomplete/lsp.js";

  const basePath = import.meta.env.DEV ? "" : window.location.pathname.replace(/\/$/, "");

  /** @type {{ path: string, value: string, readonly?: boolean, lang?: string, active?: boolean, reveal?: { path: string, line: number, column: number, length: number, focus: boolean, nonce: number } | null, externalEdit?: number, savedState?: import("@codemirror/state").EditorState | null, lspServers?: Record<string, string>, onlsenvironment?: (environment: { kind: string, name: string, path?: string }) => void, onchange?: (v: string) => void, onsave?: () => void, onsavedstate?: (s: import("@codemirror/state").EditorState) => void }} */
  let { path, value, readonly = false, lang = "", active = true, reveal = null, externalEdit = 0, savedState = null, lspServers = {}, onlsenvironment, onchange, onsave, onsavedstate } = $props();
  let disposed = false;

  /** @type {HTMLElement} */
  let container;
  /** @type {EditorView | null} */
  let view = null;
  /** Last applied `reveal.nonce`, so the same jump is never re-applied. */
  let appliedReveal = 0;
  /** Last applied `externalEdit` counter, so a buffer sync runs once. */
  let appliedExternalEdit = 0;
  /** A jump requested before the (async) editor finished mounting. */
  let pendingReveal = null;

  /** Select the matched text and scroll it into view. @param {{ line: number, column: number, length: number, focus?: boolean }} target */
  function applyReveal(target) {
    if (!view || !target) return;
    const doc = view.state.doc;
    const line = doc.line(Math.max(1, Math.min(target.line || 1, doc.lines)));
    const from = Math.min(line.to, line.from + Math.max(0, (target.column || 1) - 1));
    const to = Math.min(line.to, from + Math.max(0, target.length || 0));
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    // Only take focus when this pane is on screen AND the caller asked for it —
    // stepping through search results must leave focus in the search box.
    if (active && target.focus) view.focus();
  }

  /** @param {import("@codemirror/view").EditorView} v */
  function createSearchPanel(v) {
    const dom = document.createElement("div");
    dom.setAttribute("onkeydown", ""); // prevent CM from stealing

    let searchValue = "";
    let replaceValue = "";
    let caseSensitive = false;
    let wholeWord = false;
    let regexp = false;
    let replaceVisible = false;

    function sync() {
      const q = new SearchQuery({
        search: searchValue,
        replace: replaceValue,
        caseSensitive,
        wholeWord,
        regexp,
      });
      v.dispatch({ effects: setSearchQuery.of(q) });
    }

    function onSearchKeydown(e) {
      if (e.key === "Enter") { e.shiftKey ? findPrevious(v) : findNext(v); e.preventDefault(); }
      if (e.key === "Escape") { closeSearchPanel(v); }
    }

    const panel = mount(FindBar, {
      target: dom,
      props: {
        value: searchValue,
        replaceValue,
        caseSensitive,
        wholeWord,
        regexp,
        replaceVisible,
        readonly,
        showWord: true,
        showRegexp: true,
        showSelectAll: true,
        onSearchInput: (next) => { searchValue = next; sync(); },
        onReplaceInput: (next) => { replaceValue = next; sync(); },
        onKeydown: onSearchKeydown,
        onPrevious: () => findPrevious(v),
        onNext: () => findNext(v),
        onClose: () => closeSearchPanel(v),
        onOptionsChange: (options) => {
          caseSensitive = options.caseSensitive;
          wholeWord = options.wholeWord;
          regexp = options.regexp;
          replaceValue = options.replaceValue;
          sync();
        },
        onSelectAll: () => selectMatches(v),
        onReplace: () => replaceNext(v),
        onReplaceAll: () => replaceAll(v),
        onToggleReplace: (visible) => { replaceVisible = visible; },
      },
    });

    return {
      dom,
      top: true,
      mount() {
        // The panel's `bind:this` is attached asynchronously, so focusing on
        // this tick can silently no-op and leave the caret in the editor.
        // Defer, and fall back to the raw input if the export isn't ready.
        queueMicrotask(() => {
          if (panel?.focusSearch) {
            panel.focusSearch();
            return;
          }
          const field = /** @type {HTMLInputElement | null} */ (dom.querySelector("input"));
          field?.focus();
          field?.select();
        });
      },
      update(update) {
        // sync match count from search state
        const q = getSearchQuery(update.state);
        if (q.search !== searchValue) searchValue = q.search;
      },
      destroy() {
        unmount(panel);
      },
    };
  }

  onMount(() => {
    void (async () => {
    const fname = path.split("/").pop()?.toLowerCase() ?? "";
    const SHELL_NAMES = new Set(['.bashrc','.bash_profile','.bash_aliases','.zshrc','.zprofile','.profile','.fishrc','bashrc','zshrc','profile']);
    const isDockerfile = fname === 'dockerfile' || fname.startsWith('dockerfile.');
    const ext = lang || (isDockerfile ? "dockerfile" : SHELL_NAMES.has(fname) ? "sh" : (path.split(".").pop()?.toLowerCase() ?? ""));
    const langExt = langMap[ext] ? await langMap[ext]() : [];
    if (disposed) return;
    const lspLanguage = lspLanguageForPath(path, ext);
    const customCompletions = [
      isDockerAutocompleteFile(path, ext) ? dockerCompletionSource(path, ext) : null,
      isGoTemplateFile(path, ext) ? goTemplateCompletionSource : null,
      lspLanguage ? lspCompletionSource(path, lspLanguage, basePath, () => lspServerForLanguage(lspLanguage, lspServers), onlsenvironment) : null,
    ].filter(Boolean);
    const completionData = [
      ...customCompletions.map(source => ({ autocomplete: source })),
      { autocomplete: completeAnyWord },
    ];
    const lspHover = lspLanguage
      ? lspHoverTooltip(path, lspLanguage, basePath, () => lspServerForLanguage(lspLanguage, lspServers), onlsenvironment, langExt)
      : null;

    const extensions = [
      oneDark,
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      foldGutter(),
      EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorState.languageData.of(() => completionData),
      ...(lspHover ? [lspHover] : []),
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
      autocompletion({
        activateOnTyping: !readonly,
        activateOnTypingDelay: 250,
        maxRenderedOptions: 80,
      }),
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
        "&": { height: "100%", fontSize: "14px" },
        ".cm-scroller": {
          fontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          overflow: "auto",
          scrollbarColor: "var(--scrollbar-thumb) var(--transparent)",
          scrollbarWidth: "thin",
        },
        ".cm-scroller::-webkit-scrollbar": { width: "var(--scrollbar-size)", height: "var(--scrollbar-size)" },
        ".cm-scroller::-webkit-scrollbar-track": { background: "var(--transparent)" },
        ".cm-scroller::-webkit-scrollbar-thumb": {
          background: "var(--scrollbar-thumb)",
          border: "3px solid var(--transparent)",
          backgroundClip: "padding-box",
          borderRadius: "999px",
        },
        ".cm-content": { padding: "8px 0" },
        ".cm-gutters": { color: "#5a6173", fontSize: "12px" },
        ".cm-activeLineGutter": { color: "#c0cad8" },
      }),
      langExt,
    ].flat();

    view = new EditorView({
      state: savedState ?? EditorState.create({ doc: value, extensions }),
      parent: container,
    });
    // A buffer edit (search-and-replace) can land while this view is still
    // mounting, and a restored `savedState` carries its own older doc, so
    // reconcile against the current value before anything is shown.
    appliedExternalEdit = externalEdit;
    const mountedDoc = view.state.doc.toString();
    if (mountedDoc !== value) {
      view.dispatch({ changes: { from: 0, to: mountedDoc.length, insert: value } });
    }
    if (pendingReveal) {
      const target = pendingReveal;
      pendingReveal = null;
      applyReveal(target);
    }
    })();
  });

  // Jump to a search-in-files hit. The editor mounts asynchronously (language
  // modes are lazy-loaded), so a jump that lands early is queued for onMount.
  $effect(() => {
    const target = reveal;
    if (!target || target.path !== path || target.nonce === appliedReveal) return;
    appliedReveal = target.nonce;
    if (view) applyReveal(target);
    else pendingReveal = target;
  });

  // Pull in an edit made to the buffer from outside the editor (search-and-
  // replace). The doc is only read when the view is built, so without this the
  // view would keep showing stale text and the next keystroke would undo the
  // replacement. Before mount there is nothing to do — the initial state is
  // created from the already-updated `value`.
  $effect(() => {
    const nonce = externalEdit;
    if (nonce === appliedExternalEdit) return;
    appliedExternalEdit = nonce;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  });

  onDestroy(() => { disposed = true; onsavedstate?.(view?.state); view?.destroy(); });
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
  /* Float the search panel over the top-right corner instead of letting
     CodeMirror lay it out as a full-width bar (matches .term-find). */
  .cm-wrap :global(.cm-panels) {
    position: absolute;
    top: 0;
    right: 0;
    left: auto;
    width: auto;
    z-index: 30;
    background: var(--transparent);
    border: none;
    color: inherit;
  }
  .cm-wrap :global(.cm-panels-top) {
    border-bottom: none;
  }
  .cm-wrap :global(.cm-panel) {
    background: var(--transparent);
    padding: 0;
  }
</style>
