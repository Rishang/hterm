import { Decoration, EditorView, hoverTooltip } from "@codemirror/view";
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { marked } from "marked";

const LANGUAGE_IDS = {
  rs: "rust", rust: "rust", go: "go", py: "python", python: "python",
  js: "typescript", mjs: "typescript", cjs: "typescript", jsx: "typescript", javascript: "typescript",
  ts: "typescript", tsx: "typescript", typescript: "typescript",
  c: "cpp", h: "cpp", cc: "cpp", cp: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp",
  json: "json", html: "html", htm: "html", vue: "html", svelte: "html",
  css: "css", scss: "css", sass: "css", less: "css", yaml: "yaml", yml: "yaml",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", fish: "shellscript", shell: "shellscript",
  lua: "lua", tf: "terraform", tfvars: "terraform", hcl: "terraform", terraform: "terraform",
  dockerfile: "dockerfile", docker: "dockerfile", helm: "helm", kubernetes: "kubernetes", k8s: "kubernetes", toml: "toml",
};

export const LSP_SERVER_OPTIONS = [
  { language: "Rust", id: "rust", options: [["rust-analyzer", "rust-analyzer"]] },
  { language: "Go", id: "go", options: [["gopls", "gopls"]] },
  { language: "Python", id: "python", options: [["ty", "ty (default)"], ["pyright-langserver", "Pyright"], ["pylsp", "python-lsp-server"]] },
  { language: "JavaScript / TypeScript", id: "typescript", options: [["typescript-language-server", "typescript-language-server"]] },
  { language: "C / C++", id: "cpp", options: [["clangd", "clangd"]] },
  { language: "JSON", id: "json", options: [["vscode-json-language-server", "vscode-json-language-server"]] },
  { language: "HTML", id: "html", options: [["vscode-html-language-server", "vscode-html-language-server"]] },
  { language: "CSS", id: "css", options: [["vscode-css-language-server", "vscode-css-language-server"]] },
  { language: "YAML", id: "yaml", options: [["yaml-language-server", "yaml-language-server"]] },
  { language: "Kubernetes", id: "kubernetes", options: [["yaml-language-server", "yaml-language-server"]] },
  { language: "Dockerfile", id: "dockerfile", options: [["docker-langserver", "docker-langserver"]] },
  { language: "Helm", id: "helm", options: [["helm_ls", "helm-ls"]] },
  { language: "TOML", id: "toml", options: [["taplo", "Taplo"]] },
  { language: "Shell", id: "shellscript", options: [["bash-language-server", "bash-language-server"]] },
  { language: "Lua", id: "lua", options: [["lua-language-server", "lua-language-server"]] },
  { language: "Terraform", id: "terraform", options: [["terraform-ls", "terraform-ls"]] },
];

const DEFAULT_LSP_SERVERS = Object.fromEntries(LSP_SERVER_OPTIONS.map(({ id, options }) => [id, options[0][0]]));

export function lspLanguage(language) {
  return LANGUAGE_IDS[language.toLowerCase()];
}

/** Infer configuration-specific servers while preserving normal YAML editing. */
export function lspLanguageForPath(path, language = "") {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  const lowerPath = path.toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "chart.yaml" || name === "values.yaml" || name === "values.yml" || /\/templates\/.*\.ya?ml$/.test(lowerPath)) return "helm";
  if (/\/(?:k8s|kubernetes|manifests)\/.*\.ya?ml$/.test(lowerPath)) return "kubernetes";
  return lspLanguage(language) ?? null;
}

export function lspServerForLanguage(language, servers = {}) {
  const id = lspLanguage(language);
  if (!id || servers[id] === "disabled") return null;
  return servers[id] ?? DEFAULT_LSP_SERVERS[id];
}

const COMPLETION_TYPES = [
  "text", "method", "function", "constructor", "field", "variable", "class", "interface", "module", "property",
  "unit", "value", "enum", "keyword", "snippet", "color", "file", "reference", "folder", "constant", "type",
];

export function supportsLsp(language) {
  return !!lspLanguage(language);
}

function documentation(item) {
  return typeof item.documentation === "string" ? item.documentation : item.documentation?.value;
}

function completionOption(item) {
  const textEdit = item.textEdit?.newText;
  return {
    label: String(item.label ?? ""),
    detail: item.detail ?? item.labelDetails?.detail,
    info: documentation(item),
    type: COMPLETION_TYPES[item.kind - 1] ?? "text",
    boost: 100,
    apply: textEdit ?? item.insertText ?? item.label,
  };
}

function codeAndDocumentation(value) {
  const divider = /-{3,}\s*/.exec(value);
  if (!divider) return [{ code: value }];
  const code = value.slice(0, divider.index).trim();
  const documentation = value.slice(divider.index + divider[0].length).trim();
  return [{ code }, { text: documentation }].filter((part) => part.code || part.text);
}

function isSignature(value) {
  return /^(?:bound (?:method|function)|(?:async )?(?:def |class )|[\w.]+\s*\()/.test(value.trim());
}

function hoverParts(result) {
  const contents = result?.contents ?? result;
  const entries = Array.isArray(contents) ? contents : [contents];
  return entries.flatMap((entry) => {
    if (entry?.language && entry.value) return codeAndDocumentation(entry.value);
    const value = typeof entry === "string" ? entry : entry?.value;
    if (!value) return [];
    if (isSignature(value) || /-{3,}\s*/.test(value)) return codeAndDocumentation(value);
    const parts = [];
    let end = 0;
    for (const match of value.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
      if (match.index > end) parts.push({ text: value.slice(end, match.index).trim() });
      parts.push({ code: match[1] });
      end = match.index + match[0].length;
    }
    if (end < value.length) parts.push({ text: value.slice(end).trim() });
    return parts.filter((part) => part.text || part.code);
  });
}

const HOVER_CODE_TOKENS = [
  [/\b(?:as|async|await|bound|break|case|catch|class|const|continue|def|default|del|do|elif|else|except|export|finally|for|from|function|if|import|in|interface|let|match|method|new|pass|raise|return|static|switch|throw|try|var|while|with|yield)\b/g, "lsp-hover-keyword", 4],
  [/\b(?:None|True|False|null|true|false|undefined)\b/g, "lsp-hover-literal", 5],
  [/(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\\n])*`)/g, "lsp-hover-string", 4],
  [/\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+\b/g, "lsp-hover-symbol", 3],
  [/\b(?:[A-Z][A-Za-z0-9_]*|str|int|float|bool|bytes|dict|list|set|tuple|object|Any|Sequence|Mapping|Iterable|Callable)\b/g, "lsp-hover-type", 1],
];

function signatureDecorations(doc) {
  const tokens = [];
  const text = doc.toString();
  for (const [pattern, className, priority] of HOVER_CODE_TOKENS) {
    for (const match of text.matchAll(pattern)) {
      tokens.push({ from: match.index, to: match.index + match[0].length, className, priority });
    }
  }
  tokens.sort((a, b) => a.from - b.from || b.priority - a.priority || b.to - a.to);

  const builder = new RangeSetBuilder();
  let end = 0;
  for (const token of tokens) {
    if (token.from < end) continue;
    builder.add(token.from, token.to, Decoration.mark({ class: token.className }));
    end = token.to;
  }
  return builder.finish();
}

const lspHoverSignatureHighlight = StateField.define({
  create: (state) => signatureDecorations(state.doc),
  update: (value, transaction) => transaction.docChanged ? signatureDecorations(transaction.state.doc) : value,
  provide: (field) => EditorView.decorations.from(field),
});

const lspHoverSignatureTheme = EditorView.theme({
  ".lsp-hover-keyword": { color: "#c678dd" },
  ".lsp-hover-literal": { color: "#d19a66" },
  ".lsp-hover-string": { color: "#98c379" },
  ".lsp-hover-symbol": { color: "#61afef" },
  ".lsp-hover-type": { color: "#e5c07b" },
});

const MARKDOWN_TAGS = new Set(["A", "BLOCKQUOTE", "BR", "CODE", "DEL", "EM", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "LI", "OL", "P", "PRE", "STRONG", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL"]);
const REMOVE_MARKDOWN_TAGS = new Set(["IFRAME", "OBJECT", "SCRIPT", "STYLE", "SVG", "TEMPLATE"]);

function safeLinkHref(value) {
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function markdownDom(markdown) {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(markdown);
  for (const element of [...template.content.querySelectorAll("*")]) {
    if (REMOVE_MARKDOWN_TAGS.has(element.tagName)) {
      element.remove();
      continue;
    }
    if (!MARKDOWN_TAGS.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (element.tagName === "A" && attribute.name === "href") {
        const href = safeLinkHref(attribute.value);
        if (href) element.href = href;
        else element.removeAttribute("href");
      } else {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return template.content;
}

function highlightCode(code) {
  const tokens = [];
  const text = code.textContent;
  for (const [pattern, className, priority] of HOVER_CODE_TOKENS) {
    for (const match of text.matchAll(pattern)) {
      tokens.push({ from: match.index, to: match.index + match[0].length, className, priority });
    }
  }
  tokens.sort((a, b) => a.from - b.from || b.priority - a.priority || b.to - a.to);

  const fragment = document.createDocumentFragment();
  let end = 0;
  for (const token of tokens) {
    if (token.from < end) continue;
    fragment.append(text.slice(end, token.from));
    const span = document.createElement("span");
    span.className = token.className;
    span.textContent = text.slice(token.from, token.to);
    fragment.append(span);
    end = token.to;
  }
  fragment.append(text.slice(end));
  code.replaceChildren(fragment);
}

function markdownWithHighlightedCode(markdown) {
  const fragment = markdownDom(markdown);
  for (const code of fragment.querySelectorAll("pre > code")) highlightCode(code);
  return fragment;
}

const HOVER_FRAME_STYLE = {
  boxSizing: "border-box",
  width: "640px",
  maxWidth: "calc(100vw - 24px)",
  maxHeight: "min(70vh, 560px)",
  overflow: "hidden",
  background: "#21252b",
  border: "1px solid #454c55",
  borderRadius: "8px",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
};

const HOVER_CONTENT_STYLE = {
  boxSizing: "border-box",
  width: "100%",
  maxWidth: "100%",
  maxHeight: "calc(min(70vh, 560px) - 2px)",
  overflowX: "hidden",
  overflowY: "auto",
  scrollbarWidth: "none",
};

function hoverDom(parts, languageExtension) {
  const dom = document.createElement("div");
  dom.className = "lsp-hover-tooltip";
  Object.assign(dom.style, HOVER_FRAME_STYLE);
  const content = document.createElement("div");
  content.className = "lsp-hover-content";
  Object.assign(content.style, HOVER_CONTENT_STYLE);
  const editors = [];

  for (const [index, part] of parts.entries()) {
    const section = document.createElement("div");
    Object.assign(section.style, {
      minWidth: "0",
      padding: part.code ? "0" : "10px 12px",
      lineHeight: "1.5",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      ...(index ? { borderTop: "1px solid #454c55" } : {}),
    });
    if (part.code) {
      const editor = new EditorView({
        state: EditorState.create({
          doc: part.code,
          extensions: [oneDark, lspHoverSignatureTheme, lspHoverSignatureHighlight, EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping, languageExtension],
        }),
        parent: section,
      });
      Object.assign(editor.dom.style, { boxSizing: "border-box", minWidth: "0", width: "100%", fontSize: "13px" });
      Object.assign(editor.scrollDOM.style, { minWidth: "0", overflow: "hidden" });
      Object.assign(editor.contentDOM.style, { minWidth: "0", padding: "10px 12px" });
      editors.push(editor);
    } else {
      section.className = "lsp-hover-markdown";
      section.replaceChildren(markdownWithHighlightedCode(part.text));
    }
    content.append(section);
  }
  dom.append(content);

  return { dom, destroy: () => editors.forEach((editor) => editor.destroy()) };
}

/** Return a CodeMirror tooltip extension backed by LSP hover information. */
export function lspHoverTooltip(path, language, basePath, server, onEnvironment, languageExtension = []) {
  let controller;
  return hoverTooltip(async (view, pos) => {
    const selectedServer = typeof server === "function" ? server() : server;
    if (!selectedServer) return null;
    controller?.abort();
    const request = controller = new AbortController();
    const line = view.state.doc.lineAt(pos);
    try {
      const response = await fetch(`${basePath}/api/lsp/hover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          path,
          language,
          server: selectedServer,
          content: view.state.doc.toString(),
          position: { line: line.number - 1, character: pos - line.from },
        }),
      });
      if (!response.ok || request.signal.aborted || (typeof server === "function" && server() !== selectedServer)) return null;
      const result = await response.json();
      if (request.signal.aborted || (typeof server === "function" && server() !== selectedServer)) return null;
      if (result?.environment) onEnvironment?.(result.environment);
      const parts = hoverParts(result?.result);
      if (!parts.length) return null;
      return { pos, above: false, create: () => hoverDom(parts, languageExtension) };
    } catch {
      return null;
    }
  }, { hoverTime: 350 });
}

/** Return a CodeMirror completion source backed by the server's LSP bridge. */
export function lspCompletionSource(path, language, basePath, server, onEnvironment) {
  let controller;
  return async (context) => {
    const selectedServer = typeof server === "function" ? server() : server;
    if (!selectedServer) return null;
    const word = context.matchBefore(/[\w$]*/);
    if (!context.explicit && (!word || word.from === word.to)) return null;

    controller?.abort();
    const request = controller = new AbortController();
    context.addEventListener("abort", () => request.abort(), { onDocChange: true });
    const line = context.state.doc.lineAt(context.pos);
    try {
      const response = await fetch(`${basePath}/api/lsp/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          path,
          language,
          server: selectedServer,
          content: context.state.doc.toString(),
          position: { line: line.number - 1, character: context.pos - line.from },
        }),
      });
      if (!response.ok || context.aborted || request.signal.aborted || (typeof server === "function" && server() !== selectedServer)) return null;
      const result = await response.json();
      if (context.aborted || request.signal.aborted || (typeof server === "function" && server() !== selectedServer)) return null;
      if (result?.environment) onEnvironment?.(result.environment);
      const items = Array.isArray(result) ? result : result?.items;
      if (!Array.isArray(items)) return null;
      return {
        from: word?.from ?? context.pos,
        options: items.filter(item => item?.label).slice(0, 200).map(completionOption),
        validFor: /[\w$]*/,
      };
    } catch {
      return null;
    }
  };
}
