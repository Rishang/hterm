import { callTool } from "./toolsApi.js";

/**
 * Project-wide content search.
 *
 * Runs through the existing `bash` tool rather than a dedicated endpoint — the
 * same trick `fileList.js` uses for the command palette. `rg` does the heavy
 * lifting (it honours .gitignore, skips binaries, and is orders of magnitude
 * faster than walking the tree in JS); `grep -r` is the fallback when ripgrep
 * isn't installed. The shell prints a mode marker first so the parser knows
 * which output format to expect.
 */

/** Hard caps keep broad queries from flooding the UI. */
export const MAX_RESULT_LINES = 2000;
export const MAX_SEARCH_HITS = 10000;
const MAX_MATCHES_PER_LINE = 200;

const EXCLUDED_DIRS = [
  ".git", "node_modules", "bower_components", ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache",
  ".venv", "venv", "env", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", ".nox", ".hypothesis", ".eggs", "__pypackages__",
  "target", "dist", "build", "out", "coverage", ".gradle", ".dart_tool", ".build", "bin", "obj",
  "vendor", ".bundle", "Pods", ".terraform", ".cache",
];

/** @param {string} s */
function shq(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

/** Split a comma/space separated glob list into individual patterns. */
function globList(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map(g => g.trim())
    .filter(Boolean);
}

/**
 * @typedef {{ caseSensitive?: boolean, wholeWord?: boolean, regexp?: boolean, include?: string, exclude?: string }} SearchOptions
 */

/**
 * Build the shell command for one search.
 * @param {string} query @param {string} root @param {SearchOptions} opts
 */
export function buildSearchCommand(query, root, opts = {}) {
  const { caseSensitive = false, wholeWord = false, regexp = false, include = "", exclude = "" } = opts;
  const includes = globList(include);
  const excludes = globList(exclude);

  const rg = ["rg", "--line-number", "--column", "--no-heading", "--color", "never", "--hidden"];
  for (const dir of EXCLUDED_DIRS) rg.push("--glob", shq(`!**/${dir}/**`));
  rg.push(caseSensitive ? "--case-sensitive" : "--ignore-case");
  if (wholeWord) rg.push("--word-regexp");
  if (!regexp) rg.push("--fixed-strings");
  for (const g of includes) rg.push("--glob", shq(g));
  for (const g of excludes) rg.push("--glob", shq(`!${g}`));
  rg.push("--regexp", shq(query), shq(root));

  // grep can't report columns, so the parser falls back to column 1 for it.
  const grep = ["grep", "-rnI", "--binary-files=without-match"];
  for (const dir of EXCLUDED_DIRS) grep.push(`--exclude-dir=${shq(dir)}`);
  if (!caseSensitive) grep.push("-i"); // grep is case-sensitive by default
  if (wholeWord) grep.push("-w");
  grep.push(regexp ? "-E" : "-F");
  for (const g of includes) grep.push(`--include=${shq(g)}`);
  for (const g of excludes) grep.push(`--exclude=${shq(g)}`);
  grep.push("-e", shq(query), shq(root));

  return (
    `if command -v rg >/dev/null 2>&1; then echo __RG__; ${rg.join(" ")}; ` +
    // +2 = the mode marker line, plus one extra result line that exists purely
    // so the parser can tell "exactly at the cap" from "more than the cap".
    `else echo __GREP__; ${grep.join(" ")}; fi 2>/dev/null | head -n ${MAX_RESULT_LINES + 2}`
  );
}

/**
 * The regex the whole module matches with. Literal queries are escaped so they
 * behave as plain text; `wholeWord` wraps in word boundaries.
 * @param {string} query @param {SearchOptions} opts
 * @param {string} [flags] extra flags ("g" to scan, "" for a single check)
 * @returns {RegExp | null} null when the user's regex does not compile
 */
export function buildMatchRegex(query, opts = {}, flags = "g") {
  const { caseSensitive = false, wholeWord = false, regexp = false } = opts;
  const source = regexp ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(pattern, caseSensitive ? flags : `${flags}i`);
  } catch {
    return null;
  }
}

/**
 * In literal mode `$` must not act as a capture reference, so double it.
 * In regex mode the user gets the usual `$1` / `$&` expansion.
 * @param {string} replacement @param {boolean} regexp
 */
function replacementFor(replacement, regexp) {
  return regexp ? replacement : String(replacement).replace(/\$/g, "$$$$");
}

/**
 * Every occurrence of the query inside one line, so the UI can highlight each
 * hit and the counter can match what an editor would report.
 * @param {string} text @param {string} query @param {SearchOptions} opts
 * @returns {{ start: number, end: number }[]}
 */
export function lineMatches(text, query, opts = {}) {
  const re = buildMatchRegex(query, opts, "g");
  if (!re) return [];
  const found = [];
  for (const m of text.matchAll(re)) {
    // Zero-width matches (e.g. `a*`) would loop forever in the UI — skip them.
    if (!m[0]) continue;
    found.push({ start: m.index, end: m.index + m[0].length });
    // Keep one extra only to tell the caller that this line was truncated.
    if (found.length > MAX_MATCHES_PER_LINE) break;
  }
  return found;
}

/**
 * @typedef {{ path: string, line: number, column: number, text: string, start: number, end: number }} SearchHit
 */

/**
 * Parse tool output into a flat list of hits (one entry per occurrence).
 * @param {string} raw @param {string} query @param {SearchOptions} opts
 * @returns {{ hits: SearchHit[], truncated: boolean }}
 */
export function parseSearchOutput(raw, query, opts = {}) {
  const stdout = String(raw || "").split("\n--- stderr ---\n")[0];
  const lines = stdout.split("\n");
  const modeIdx = lines.findIndex(l => l.trim() === "__RG__" || l.trim() === "__GREP__");
  const hasColumn = modeIdx !== -1 && lines[modeIdx].trim() === "__RG__";
  const body = lines.slice(modeIdx + 1);
  let truncated = body.filter(l => l.length > 0).length > MAX_RESULT_LINES;

  const shape = hasColumn ? /^(.*?):(\d+):(\d+):(.*)$/ : /^(.*?):(\d+):(.*)$/;
  /** @type {SearchHit[]} */
  const hits = [];
  lines: for (const line of body.slice(0, MAX_RESULT_LINES)) {
    if (!line) continue;
    const m = shape.exec(line);
    if (!m) continue;
    const path = m[1];
    const lineNo = Number(m[2]);
    const column = hasColumn ? Number(m[3]) : 1;
    const text = hasColumn ? m[4] : m[3];
    if (!path || !Number.isFinite(lineNo)) continue;
    const lineRanges = lineMatches(text, query, opts);
    if (lineRanges.length > MAX_MATCHES_PER_LINE) truncated = true;
    const ranges = lineRanges.slice(0, MAX_MATCHES_PER_LINE);
    if (ranges.length === 0) {
      // Regex flavours differ between rg and JS; trust the tool and show the line.
      hits.push({ path, line: lineNo, column, text, start: column - 1, end: column - 1 });
    } else {
      for (const r of ranges) {
        hits.push({ path, line: lineNo, column: r.start + 1, text, start: r.start, end: r.end });
        if (hits.length >= MAX_SEARCH_HITS) {
          truncated = true;
          break lines;
        }
      }
    }
    if (hits.length >= MAX_SEARCH_HITS) {
      truncated = true;
      break;
    }
  }
  return { hits, truncated };
}

/**
 * Run one project-wide search.
 * @param {string} basePath @param {string} query @param {string} root @param {SearchOptions} opts
 * @returns {Promise<{ hits: SearchHit[], truncated: boolean }>}
 */
export async function runSearch(basePath, query, root, opts = {}) {
  if (opts.regexp && !buildMatchRegex(query, opts, "")) {
    throw new Error("Invalid regular expression");
  }
  // Exit 1 means no match; 141 means `head` reached the result cap and closed
  // the pipe. Both still yield usable search results.
  const command = `${buildSearchCommand(query, root, opts)}; status=\${PIPESTATUS[0]}; test "$status" -le 1 -o "$status" -eq 141`;
  const text = await callTool(basePath, "bash", { command });
  return parseSearchOutput(text, query, opts);
}

/**
 * Read a file's text. Returns null for anything not editable as text.
 * @param {string} basePath @param {string} path
 * @returns {Promise<string | null>}
 */
export async function readFileText(basePath, path) {
  const res = await fetch(`${basePath}/api/files/read?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`Could not read ${path}`);
  const data = await res.json();
  if (data?.is_binary) return null;
  return data?.content ?? "";
}

/**
 * Overwrite a file through the `write_file` tool — the same path the editor
 * saves through, so a read-only server reports the same error here.
 * @param {string} basePath @param {string} path @param {string} content
 */
export async function writeFileText(basePath, path, content) {
  await callTool(basePath, "write_file", { path, content });
}

/**
 * What one match turns into, for the inline `old → new` preview.
 * @param {SearchHit} hit @param {string} query @param {SearchOptions} opts @param {string} replacement
 * @returns {string}
 */
export function replacementPreview(hit, query, opts = {}, replacement = "") {
  const slice = hit.text.slice(hit.start, hit.end);
  if (!slice) return "";
  const re = buildMatchRegex(query, opts, "");
  if (!re) return "";
  return slice.replace(re, replacementFor(replacement, !!opts.regexp));
}

/** Absolute offset where 1-based `lineNo` starts, or -1 if the file is shorter. */
function lineStartOffset(text, lineNo) {
  let idx = 0;
  for (let i = 1; i < lineNo; i++) {
    const nl = text.indexOf("\n", idx);
    if (nl === -1) return -1;
    idx = nl + 1;
  }
  return idx <= text.length ? idx : -1;
}

/**
 * Replace one specific occurrence, located by line + column offsets.
 *
 * Works on absolute offsets rather than splitting into lines, so mixed CRLF/LF
 * files are never silently normalised. Returns null when the text at that spot
 * is not the match we searched for — i.e. the file changed since the search —
 * so a stale hit can be skipped instead of corrupting the file.
 *
 * @param {string} text @param {SearchHit} hit @param {string} query
 * @param {SearchOptions} opts @param {string} replacement
 * @returns {string | null}
 */
export function replaceHitInText(text, hit, query, opts = {}, replacement = "") {
  if (!hit || hit.end <= hit.start) return null;
  const lineStart = lineStartOffset(text, hit.line);
  if (lineStart < 0) return null;
  const start = lineStart + hit.start;
  const end = lineStart + hit.end;
  if (end > text.length) return null;

  const slice = text.slice(start, end);
  const re = buildMatchRegex(query, opts, "");
  if (!re) return null;
  const m = re.exec(slice);
  if (!m || m[0] !== slice) return null; // stale hit — refuse rather than guess

  return text.slice(0, start) + slice.replace(re, replacementFor(replacement, !!opts.regexp)) + text.slice(end);
}

/**
 * Replace a chosen subset of hits within one file's text.
 * Applies back-to-front so earlier offsets stay valid as the text shifts.
 * @param {string} text @param {SearchHit[]} fileHits @param {string} query
 * @param {SearchOptions} opts @param {string} replacement
 * @returns {{ text: string, applied: number, skipped: number }}
 */
export function replaceHitsInText(text, fileHits, query, opts = {}, replacement = "") {
  const ordered = [...fileHits].sort((a, b) => b.line - a.line || b.start - a.start);
  let next = text;
  let applied = 0;
  let skipped = 0;
  for (const hit of ordered) {
    const updated = replaceHitInText(next, hit, query, opts, replacement);
    if (updated === null) skipped++;
    else { next = updated; applied++; }
  }
  return { text: next, applied, skipped };
}

/**
 * Group hits by file, preserving first-seen file order.
 * @param {SearchHit[]} hits @param {string} root
 * @returns {{ path: string, relative: string, name: string, hits: { hit: SearchHit, index: number }[] }[]}
 */
export function groupByFile(hits, root) {
  const prefix = root && root !== "/" ? `${root.replace(/\/$/, "")}/` : "";
  /** @type {Map<string, { path: string, relative: string, name: string, hits: { hit: SearchHit, index: number }[] }>} */
  const groups = new Map();
  hits.forEach((hit, index) => {
    let group = groups.get(hit.path);
    if (!group) {
      group = {
        path: hit.path,
        relative: prefix && hit.path.startsWith(prefix) ? hit.path.slice(prefix.length) : hit.path,
        name: hit.path.split("/").pop() || hit.path,
        hits: [],
      };
      groups.set(hit.path, group);
    }
    group.hits.push({ hit, index });
  });
  return [...groups.values()];
}
