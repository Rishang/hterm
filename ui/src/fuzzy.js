/**
 * Score a path against a query using subsequence matching.
 * Returns { score, positions } where positions are matched char indices into `path`,
 * or null if not every query char can be matched in order.
 * Higher score = better match.
 *
 * @param {string} path
 * @param {string} query  caller passes the trimmed query (may be any case)
 * @returns {{ score: number, positions: number[] } | null}
 */
export function fuzzyScore(path, query) {
  if (!query) return { score: 0, positions: [] };
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  const slashIdx = path.lastIndexOf("/");
  const positions = [];
  let pi = 0;
  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  while (pi < p.length && qi < q.length) {
    if (p[pi] === q[qi]) {
      let s = 1;
      if (pi === prevMatch + 1) s += 5;                  // consecutive run
      const prevCh = pi > 0 ? p[pi - 1] : "/";
      if (/[/_\-. ]/.test(prevCh)) s += 8;               // start of a path/word segment
      if (pi > slashIdx) s += 3;                         // inside the basename
      score += s;
      positions.push(pi);
      prevMatch = pi;
      qi++;
    }
    pi++;
  }
  if (qi < q.length) return null;                        // query not fully matched
  score -= path.length * 0.05;                           // mild preference for shorter paths
  return { score, positions };
}

/**
 * Filter and rank `paths` against `query`.
 * @param {string[]} paths
 * @param {string} query  trimmed query; empty returns the head of the list unranked
 * @param {number} [limit]
 * @returns {{ path: string, score: number, positions: number[] }[]}
 */
export function fuzzyFilter(paths, query, limit = 50) {
  if (!query) {
    return paths.slice(0, limit).map((path) => ({ path, score: 0, positions: [] }));
  }
  const scored = [];
  for (const path of paths) {
    const r = fuzzyScore(path, query);
    if (r) scored.push({ path, score: r.score, positions: r.positions });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return scored.slice(0, limit);
}
