const GO_TEMPLATE_ACTIONS = [
  ["{{ . }}", "Current value"],
  ["{{ .Name }}", "Field lookup"],
  ["{{ if . }}\n{{ end }}", "Conditional block"],
  ["{{ else }}", "Else branch"],
  ["{{ else if . }}", "Else-if branch"],
  ["{{ range . }}\n{{ end }}", "Range block"],
  ["{{ with . }}\n{{ end }}", "With block"],
  ["{{ template \"name\" . }}", "Execute template"],
  ["{{ block \"name\" . }}\n{{ end }}", "Template block"],
  ["{{ define \"name\" }}\n{{ end }}", "Define template"],
  ["{{ $name := . }}", "Declare variable"],
  ["{{/* comment */}}", "Comment"],
];

const GO_TEMPLATE_FUNCS = [
  "and",
  "call",
  "html",
  "index",
  "slice",
  "js",
  "len",
  "not",
  "or",
  "print",
  "printf",
  "println",
  "urlquery",
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
];

export function isGoTemplateFile(path, ext) {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  return ext === "tpl" || ext === "gotmpl" || ext === "tmpl" || name.endsWith(".gotmpl");
}

function tokenRange(context) {
  return context.matchBefore(/[A-Za-z0-9_.$-]*/);
}

export function goTemplateCompletionSource(context) {
  const token = tokenRange(context);
  if (!token || (!context.explicit && token.from === token.to)) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const open = before.lastIndexOf("{{");
  const close = before.lastIndexOf("}}");
  const inAction = open > close;
  const options = inAction
    ? GO_TEMPLATE_FUNCS.map(label => ({ label, type: "function", detail: "Go template function" }))
    : GO_TEMPLATE_ACTIONS.map(([label, detail]) => ({ label, type: "keyword", detail }));
  return { from: token.from, options, validFor: /^[A-Za-z0-9_.$-]*$/ };
}
