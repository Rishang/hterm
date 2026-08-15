import { callTool } from "./toolsApi.js";

/**
 * Parse the bash-tool response text into a clean list of file paths.
 * The bash tool prepends `set -x`, whose trace lands in stderr and is appended
 * after a "\n--- stderr ---\n" delimiter, so we keep only the part before it.
 * Strips a leading "./" (the `find` fallback emits it; rg/fd do not).
 * @param {string} text
 * @returns {string[]}
 */
export function parseFileList(text) {
  const stdout = text.split("\n--- stderr ---\n")[0];
  return stdout
    .split("\n")
    .map((s) => s.trim().replace(/^\.\//, ""))
    .filter((s) => s.length > 0);
}

/**
 * Fetch the project's file list via the bash tool.
 * Searches under the bash tool's working directory ($(pwd)) and emits ABSOLUTE
 * paths — the /api/files/read endpoint rejects non-absolute paths. rg/fd respect
 * .gitignore (skipping node_modules/.git/target); find is the last resort and
 * excludes the common heavy dirs explicitly since it ignores .gitignore.
 * @param {string} basePath
 * @returns {Promise<string[]>}
 */
export async function fetchFileList(basePath) {
  const command =
    "root=\"$(pwd)\"; rg --files \"$root\" 2>/dev/null || fd -t f . \"$root\" 2>/dev/null || " +
    "find \"$root\" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/target/*'";
  return parseFileList(await callTool(basePath, "bash", { command }));
}
