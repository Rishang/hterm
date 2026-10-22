/**
 * Fetch the project's file list: absolute paths of every file under the
 * server's working directory, one per line. The server uses rg/fd (which honour
 * .gitignore) and falls back to find without heavy dirs.
 * @param {string} basePath
 * @returns {Promise<string[]>}
 */
export async function fetchFileList(basePath) {
  const res = await fetch(`${basePath}/api/files/find`);
  if (!res.ok) throw new Error(`File list failed: ${res.status}`);
  return (await res.text()).split("\n").map((s) => s.trim()).filter(Boolean);
}
