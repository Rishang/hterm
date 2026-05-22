<script module>
  const langMap = {
    js:     () => import("@codemirror/lang-javascript").then(m => m.javascript()),
    mjs:    () => import("@codemirror/lang-javascript").then(m => m.javascript()),
    jsx:    () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true })),
    ts:     () => import("@codemirror/lang-javascript").then(m => m.javascript({ typescript: true })),
    tsx:    () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true, typescript: true })),
    html:   () => import("@codemirror/lang-html").then(m => m.html()),
    htm:    () => import("@codemirror/lang-html").then(m => m.html()),
    tpl:    () => import("@codemirror/lang-html").then(m => m.html()),
    svelte: () => import("@codemirror/lang-html").then(m => m.html()),
    vue:    () => import("@codemirror/lang-vue").then(m => m.vue()),
    angular:() => import("@codemirror/lang-angular").then(m => m.angular()),
    css:    () => import("@codemirror/lang-css").then(m => m.css()),
    scss:   () => import("@codemirror/lang-css").then(m => m.css()),
    json:   () => import("@codemirror/lang-json").then(m => m.json()),
    php:    () => import("@codemirror/lang-php").then(m => m.php()),
    phtml:  () => import("@codemirror/lang-php").then(m => m.php()),
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
    lezer:  () => import("@codemirror/lang-lezer").then(m => m.lezer()),
    grammar:() => import("@codemirror/lang-lezer").then(m => m.lezer()),
    wast:   () => import("@codemirror/lang-wast").then(m => m.wast()),
    wat:    () => import("@codemirror/lang-wast").then(m => m.wast()),
    toml:   () => Promise.all([import("@codemirror/legacy-modes/mode/toml"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.toml)),
    sh:     () => Promise.all([import("@codemirror/legacy-modes/mode/shell"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.shell)),
    bash:   () => Promise.all([import("@codemirror/legacy-modes/mode/shell"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.shell)),
    zsh:    () => Promise.all([import("@codemirror/legacy-modes/mode/shell"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.shell)),
    fish:   () => Promise.all([import("@codemirror/legacy-modes/mode/shell"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.shell)),
    dockerfile: () => Promise.all([import("@codemirror/legacy-modes/mode/dockerfile"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.dockerFile)),
    config:     () => Promise.all([import("@codemirror/legacy-modes/mode/properties"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.properties)),
    properties: () => Promise.all([import("@codemirror/legacy-modes/mode/properties"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.properties)),
    ini:        () => Promise.all([import("@codemirror/legacy-modes/mode/properties"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.properties)),
    lua:    () => Promise.all([import("@codemirror/legacy-modes/mode/lua"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.lua)),
    rb:     () => Promise.all([import("@codemirror/legacy-modes/mode/ruby"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.ruby)),
    ruby:   () => Promise.all([import("@codemirror/legacy-modes/mode/ruby"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.ruby)),
    pl:     () => Promise.all([import("@codemirror/legacy-modes/mode/perl"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.perl)),
    pm:     () => Promise.all([import("@codemirror/legacy-modes/mode/perl"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.perl)),
    perl:   () => Promise.all([import("@codemirror/legacy-modes/mode/perl"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.perl)),
    r:      () => Promise.all([import("@codemirror/legacy-modes/mode/r"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.r)),
    R:      () => Promise.all([import("@codemirror/legacy-modes/mode/r"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.r)),
    swift:  () => Promise.all([import("@codemirror/legacy-modes/mode/swift"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.swift)),
    kt:     () => Promise.all([import("@codemirror/legacy-modes/mode/clike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.kotlin)),
    kotlin: () => Promise.all([import("@codemirror/legacy-modes/mode/clike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.kotlin)),
    java:   () => Promise.all([import("@codemirror/legacy-modes/mode/clike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.java)),
    cs:     () => Promise.all([import("@codemirror/legacy-modes/mode/clike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.csharp)),
    csharp: () => Promise.all([import("@codemirror/legacy-modes/mode/clike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.csharp)),
    scala:  () => Promise.all([import("@codemirror/legacy-modes/mode/clike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.scala)),
    dart:   () => Promise.all([import("@codemirror/legacy-modes/mode/clike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.dart)),
    groovy: () => Promise.all([import("@codemirror/legacy-modes/mode/groovy"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.groovy)),
    jl:     () => Promise.all([import("@codemirror/legacy-modes/mode/julia"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.julia)),
    julia:  () => Promise.all([import("@codemirror/legacy-modes/mode/julia"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.julia)),
    hs:     () => Promise.all([import("@codemirror/legacy-modes/mode/haskell"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.haskell)),
    haskell:() => Promise.all([import("@codemirror/legacy-modes/mode/haskell"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.haskell)),
    clj:    () => Promise.all([import("@codemirror/legacy-modes/mode/clojure"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.clojure)),
    cljs:   () => Promise.all([import("@codemirror/legacy-modes/mode/clojure"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.clojure)),
    erl:    () => Promise.all([import("@codemirror/legacy-modes/mode/erlang"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.erlang)),
    elm:    () => Promise.all([import("@codemirror/legacy-modes/mode/elm"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.elm)),
    ex:     () => Promise.all([import("@codemirror/legacy-modes/mode/erlang"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.erlang)),
    exs:    () => Promise.all([import("@codemirror/legacy-modes/mode/erlang"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.erlang)),
    ml:     () => Promise.all([import("@codemirror/legacy-modes/mode/mllike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.oCaml)),
    mli:    () => Promise.all([import("@codemirror/legacy-modes/mode/mllike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.oCaml)),
    fs:     () => Promise.all([import("@codemirror/legacy-modes/mode/mllike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.fSharp)),
    fsx:    () => Promise.all([import("@codemirror/legacy-modes/mode/mllike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.fSharp)),
    sml:    () => Promise.all([import("@codemirror/legacy-modes/mode/mllike"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.sml)),
    coffee: () => Promise.all([import("@codemirror/legacy-modes/mode/coffeescript"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.coffeeScript)),
    cr:     () => Promise.all([import("@codemirror/legacy-modes/mode/crystal"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.crystal)),
    d:      () => Promise.all([import("@codemirror/legacy-modes/mode/d"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.d)),
    f:      () => Promise.all([import("@codemirror/legacy-modes/mode/fortran"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.fortran)),
    f90:    () => Promise.all([import("@codemirror/legacy-modes/mode/fortran"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.fortran)),
    pas:    () => Promise.all([import("@codemirror/legacy-modes/mode/pascal"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.pascal)),
    scm:    () => Promise.all([import("@codemirror/legacy-modes/mode/scheme"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.scheme)),
    lisp:   () => Promise.all([import("@codemirror/legacy-modes/mode/commonlisp"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.commonLisp)),
    cl:     () => Promise.all([import("@codemirror/legacy-modes/mode/commonlisp"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.commonLisp)),
    tcl:    () => Promise.all([import("@codemirror/legacy-modes/mode/tcl"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.tcl)),
    m:      () => Promise.all([import("@codemirror/legacy-modes/mode/octave"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.octave)),
    vb:     () => Promise.all([import("@codemirror/legacy-modes/mode/vb"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.vb)),
    vbs:    () => Promise.all([import("@codemirror/legacy-modes/mode/vbscript"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.vbScript)),
    ps1:    () => Promise.all([import("@codemirror/legacy-modes/mode/powershell"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.powerShell)),
    psm1:   () => Promise.all([import("@codemirror/legacy-modes/mode/powershell"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.powerShell)),
    v:      () => Promise.all([import("@codemirror/legacy-modes/mode/verilog"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.verilog)),
    sv:     () => Promise.all([import("@codemirror/legacy-modes/mode/verilog"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.verilog)),
    vhd:    () => Promise.all([import("@codemirror/legacy-modes/mode/vhdl"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.vhdl)),
    vhdl:   () => Promise.all([import("@codemirror/legacy-modes/mode/vhdl"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.vhdl)),
    diff:   () => Promise.all([import("@codemirror/legacy-modes/mode/diff"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.diff)),
    patch:  () => Promise.all([import("@codemirror/legacy-modes/mode/diff"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.diff)),
    proto:  () => Promise.all([import("@codemirror/legacy-modes/mode/protobuf"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.protobuf)),
    cmake:  () => Promise.all([import("@codemirror/legacy-modes/mode/cmake"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.cmake)),
    nginx:  () => Promise.all([import("@codemirror/legacy-modes/mode/nginx"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.nginx)),
    pug:    () => Promise.all([import("@codemirror/legacy-modes/mode/pug"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.pug)),
    jade:   () => Promise.all([import("@codemirror/legacy-modes/mode/pug"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.pug)),
    styl:   () => Promise.all([import("@codemirror/legacy-modes/mode/stylus"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.stylus)),
    sass:   () => Promise.all([import("@codemirror/legacy-modes/mode/sass"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.sass)),
    tex:    () => Promise.all([import("@codemirror/legacy-modes/mode/stex"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.stex)),
    latex:  () => Promise.all([import("@codemirror/legacy-modes/mode/stex"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.stex)),
    textile:() => Promise.all([import("@codemirror/legacy-modes/mode/textile"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.textile)),
    sparql: () => Promise.all([import("@codemirror/legacy-modes/mode/sparql"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.sparql)),
    ttl:    () => Promise.all([import("@codemirror/legacy-modes/mode/turtle"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.turtle)),
    hx:     () => Promise.all([import("@codemirror/legacy-modes/mode/haxe"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.haxe)),
    nsi:    () => Promise.all([import("@codemirror/legacy-modes/mode/nsis"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.nsis)),
    nsis:   () => Promise.all([import("@codemirror/legacy-modes/mode/nsis"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.nsis)),
    feature:() => Promise.all([import("@codemirror/legacy-modes/mode/gherkin"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.gherkin)),
    pp:     () => Promise.all([import("@codemirror/legacy-modes/mode/puppet"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.puppet)),
    q:      () => Promise.all([import("@codemirror/legacy-modes/mode/q"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.q)),
    apl:    () => Promise.all([import("@codemirror/legacy-modes/mode/apl"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.apl)),
    bf:     () => Promise.all([import("@codemirror/legacy-modes/mode/brainfuck"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.brainfuck)),
    forth:  () => Promise.all([import("@codemirror/legacy-modes/mode/forth"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.forth)),
    factor: () => Promise.all([import("@codemirror/legacy-modes/mode/factor"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.factor)),
    oz:     () => Promise.all([import("@codemirror/legacy-modes/mode/oz"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.oz)),
    pig:    () => Promise.all([import("@codemirror/legacy-modes/mode/pig"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.pig)),
    sas:    () => Promise.all([import("@codemirror/legacy-modes/mode/sas"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.sas)),
    st:     () => Promise.all([import("@codemirror/legacy-modes/mode/smalltalk"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.smalltalk)),
    cob:    () => Promise.all([import("@codemirror/legacy-modes/mode/cobol"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.cobol)),
    cobol:  () => Promise.all([import("@codemirror/legacy-modes/mode/cobol"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.cobol)),
    ebnf:   () => Promise.all([import("@codemirror/legacy-modes/mode/ebnf"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.ebnf)),
    dylan:  () => Promise.all([import("@codemirror/legacy-modes/mode/dylan"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.dylan)),
    ls:     () => Promise.all([import("@codemirror/legacy-modes/mode/livescript"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.liveScript)),
    mathematica: () => Promise.all([import("@codemirror/legacy-modes/mode/mathematica"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.mathematica)),
    wl:     () => Promise.all([import("@codemirror/legacy-modes/mode/mathematica"), import("@codemirror/language")]).then(([m, { StreamLanguage }]) => StreamLanguage.define(m.mathematica)),
    tf:     () => import("codemirror-lang-terraform").then(m => m.terraform()),
    tfvars: () => import("codemirror-lang-terraform").then(m => m.terraform()),
    hcl:    () => import("codemirror-lang-terraform").then(m => m.terraform()),
  };

  export const supportedLangs = Object.keys(langMap).sort();
</script>
<script>
  import { onMount, onDestroy } from "svelte";
  import { mount, unmount } from "svelte";
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter } from "@codemirror/language";
  import { search, searchKeymap, findNext, findPrevious, selectMatches, getSearchQuery, setSearchQuery, SearchQuery, closeSearchPanel, openSearchPanel, replaceNext, replaceAll } from "@codemirror/search";
  import { autocompletion, completeAnyWord } from "@codemirror/autocomplete";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { showMinimap } from "@replit/codemirror-minimap";
  import FindBar from "./FindBar.svelte";
  import { dockerCompletionSource, isDockerAutocompleteFile } from "./autocomplete/docker.js";
  import { goTemplateCompletionSource, isGoTemplateFile } from "./autocomplete/gotemplate.js";

  /** @type {{ path: string, value: string, readonly?: boolean, lang?: string, searchTrigger?: number, savedState?: import("@codemirror/state").EditorState | null, onchange?: (v: string) => void, onsave?: () => void, onsavedstate?: (s: import("@codemirror/state").EditorState) => void }} */
  let { path, value, readonly = false, lang = "", searchTrigger = 0, savedState = null, onchange, onsave, onsavedstate } = $props();

  /** @type {HTMLElement} */
  let container;
  /** @type {EditorView | null} */
  let view = null;
  let seenSearchTrigger = $state(0);
  let searchTriggerReady = $state(false);

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
      top: false,
      mount() { panel.focusSearch?.(); },
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

  onMount(async () => {
    const fname = path.split("/").pop()?.toLowerCase() ?? "";
    const SHELL_NAMES = new Set(['.bashrc','.bash_profile','.bash_aliases','.zshrc','.zprofile','.profile','.fishrc','bashrc','zshrc','profile']);
    const isDockerfile = fname === 'dockerfile' || fname.startsWith('dockerfile.');
    const ext = lang || (isDockerfile ? "dockerfile" : SHELL_NAMES.has(fname) ? "sh" : (path.split(".").pop()?.toLowerCase() ?? ""));
    const langExt = langMap[ext] ? await langMap[ext]() : [];
    const customCompletions = [
      isDockerAutocompleteFile(path, ext) ? dockerCompletionSource(path, ext) : null,
      isGoTemplateFile(path, ext) ? goTemplateCompletionSource : null,
    ].filter(Boolean);
    const completionData = [
      ...customCompletions.map(source => ({ autocomplete: source })),
      { autocomplete: completeAnyWord },
    ];

    const extensions = [
      oneDark,
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      foldGutter(),
      EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorState.languageData.of(() => completionData),
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
  });

  $effect(() => {
    const trigger = searchTrigger;
    if (!searchTriggerReady) {
      seenSearchTrigger = trigger;
      searchTriggerReady = true;
      return;
    }
    if (trigger === seenSearchTrigger) return;
    seenSearchTrigger = trigger;
    if (view) openSearchPanel(view);
  });

  onDestroy(() => { onsavedstate?.(view?.state); view?.destroy(); });
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
