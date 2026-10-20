#!/usr/bin/env bash
# Mechanical checks for the vendored ghostty-web (ui/vendor/ghostty-web).
# Usage: scan.sh [--rebuild]   (run from the repo root)
#   --rebuild  also run `task ghostty-web` and require byte-identical output
#              (needs Zig 0.15.2 on PATH; takes a few minutes)
# Prints findings and leaves the fork-vs-upstream diff for manual review in $OUT.
set -euo pipefail

VENDOR=ui/vendor/ghostty-web
UPSTREAM=https://github.com/coder/ghostty-web
GHOSTTY=ghostty-org/ghostty
REPO=$(sed -n 's/^REPO=//p' "$VENDOR/build.sh")
REV=$(sed -n 's/^REV=\([0-9a-f]*\).*/\1/p' "$VENDOR/build.sh")
OUT=$(mktemp -d -t ghostty-audit-XXXX)
echo "fork: $REPO @ $REV"
echo "work: $OUT"

echo; echo "== 1. Risky APIs in shipped JS (every hit needs a reason) =="
for p in 'fetch\(' 'XMLHttpRequest' 'WebSocket' 'EventSource' 'sendBeacon' '\beval\(' 'new Function' \
         'document\.cookie' 'localStorage' 'sessionStorage' 'indexedDB' 'postMessage' 'importScripts' \
         'innerHTML' 'outerHTML' 'insertAdjacentHTML' 'window\.open' 'location\.(href|assign|replace)' \
         'navigator\.clipboard' 'String\.fromCharCode\(\s*\d' 'https?://' 'atob\(' '[A-Za-z0-9+/]{200,}'; do
  hits=$(rg -n -o ".{0,60}$p.{0,60}" "$VENDOR"/*.js 2>/dev/null || true)
  [ -n "$hits" ] && { echo "-- $p"; echo "$hits" | cut -c1-220; }
done

echo; echo "== 2. WASM host imports (expected: env.log only) =="
node -e 'const m=new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));
  console.log(JSON.stringify(WebAssembly.Module.imports(m)))' "$VENDOR/ghostty-vt.wasm"

echo; echo "== 3. Fork checkout, Ghostty submodule provenance =="
git clone -q "$REPO" "$OUT/fork"
git -C "$OUT/fork" checkout -q "$REV"
sub=$(git -C "$OUT/fork" ls-tree HEAD ghostty | awk '{print $3}')
echo "ghostty submodule: $sub ($(git -C "$OUT/fork" config -f .gitmodules submodule.ghostty.url))"
gh api "repos/$GHOSTTY/compare/$sub...main" --jq '"vs '"$GHOSTTY"' main: status=\(.status) behind_by=\(.behind_by) (behind_by must be 0)"' 2>/dev/null \
  || echo "WARN: could not verify ancestry with gh; check $sub is on $GHOSTTY main manually"

echo; echo "== 4. Local patches apply in order on a clean $REV =="
for p in "$VENDOR"/patches/*.patch; do git -C "$OUT/fork" apply "$PWD/$p" && echo "ok $(basename "$p")"; done
git -C "$OUT/fork" checkout -q -- .

echo; echo "== 5. Fork vs upstream diff of shipped code (read this in full) =="
git -C "$OUT/fork" remote add upstream "$UPSTREAM"
git -C "$OUT/fork" fetch -q upstream main
base=$(git -C "$OUT/fork" merge-base "$REV" upstream/main)
echo "merge base: $base; fork commits since: $(git -C "$OUT/fork" rev-list --count "$base..$REV")"
git -C "$OUT/fork" diff "$base" "$REV" -- lib ':!lib/**/*.test.ts' ':!lib/*.test.ts' patches \
  vite.config.js package.json scripts .gitmodules ghostty > "$OUT/shipped.diff"
git -C "$OUT/fork" diff --stat "$base" "$REV" -- lib ':!lib/**/*.test.ts' ':!lib/*.test.ts' patches \
  vite.config.js package.json scripts .gitmodules ghostty | tail -1
git -C "$OUT/fork" log --oneline "$base..$REV" > "$OUT/commits.txt"
echo "diff: $OUT/shipped.diff   commits: $OUT/commits.txt"
echo "lib/ imports of demo/bench/test code:"
rg -n "from ['\"](\.\./(demo|bench)|\./test-helpers)" "$OUT/fork/lib" -g '!*.test.ts' -g '!test-helpers.ts' || echo "  none"

if [ "${1:-}" = "--rebuild" ]; then
  echo; echo "== 6. Reproducible rebuild (vendored files must not change) =="
  [ "$(zig version)" = 0.15.2 ] || { echo "FAIL: Zig 0.15.2 required"; exit 1; }
  before=$(cd "$VENDOR" && sha256sum *.js *.d.ts ghostty-vt.wasm)
  task ghostty-web >/dev/null
  after=$(cd "$VENDOR" && sha256sum *.js *.d.ts ghostty-vt.wasm)
  [ "$before" = "$after" ] && echo "ok: rebuild is byte-identical" \
    || { echo "CHANGED (vendored output differs from a clean rebuild):"; diff <(echo "$before") <(echo "$after") || true; }
fi
