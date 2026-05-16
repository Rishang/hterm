<script>
  import { onMount, onDestroy } from "svelte";
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter } from "@codemirror/language";
  import { oneDark } from "@codemirror/theme-one-dark";

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
  };

  /** @type {{ path: string, value: string, readonly?: boolean, onchange?: (v: string) => void, onsave?: () => void }} */
  let { path, value, readonly = false, onchange, onsave } = $props();

  /** @type {HTMLElement} */
  let container;
  /** @type {EditorView | null} */
  let view = null;

  onMount(async () => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
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
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab,
              { key: "Mod-s", run: () => { onsave?.(); return true; } },
            ]),
          ]
      ),
      EditorView.updateListener.of((u) => {
        if (!readonly && u.docChanged && onchange) onchange(u.state.doc.toString());
      }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": { fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace", overflow: "auto" },
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
  }
</style>
