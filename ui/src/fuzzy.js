/**
 * fzf -e style exact matcher.
 *
 * The query is split on whitespace into terms (fzf extended-search AND syntax):
 *   - a plain term must appear as a contiguous, case-insensitive SUBSTRING.
 *   - a `!term` term is a negation — the path must NOT contain it.
 * All positive terms must match; any negation must not. Returns { score, positions }
 * (positions = matched char indices into `path`, for highlighting) or null on no match.
 *
 * @param {string} path
 * @param {string} query  the trimmed query (any case)
 * @returns {{ score: number, positions: number[] } | null}
 */
export function fuzzyScore(path, query) {
  if (!query) return { score: 0, positions: [] };
  const p = path.toLowerCase();
  const slashIdx = path.lastIndexOf("/");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const positions = [];
  let score = 0;
  let matchedAny = false;

  for (const term of terms) {
    if (term[0] === "!") {
      const neg = term.slice(1);
      if (neg && p.includes(neg)) return null; // excluded
      continue;
    }
    const idx = p.indexOf(term);
    if (idx === -1) return null; // a required term is missing
    matchedAny = true;
    for (let i = 0; i < term.length; i++) positions.push(idx + i);

    let s = 10;
    if (idx > slashIdx) s += 6;                       // match lands in the basename
    const prevCh = idx > 0 ? p[idx - 1] : "/";
    if (/[/_\-. ]/.test(prevCh)) s += 8;              // match starts at a segment boundary
    s -= idx * 0.1;                                    // earlier match is better
    score += s;
  }

  if (!matchedAny) return { score: 0, positions: [] }; // only negations → matches all
  score -= path.length * 0.05;                         // mild preference for shorter paths
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
