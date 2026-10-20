#!/usr/bin/env bash
# Rebuilds the vendored ghostty-web package in this directory from source.
#
# Source is the diegosouzapw fork of coder/ghostty-web, which carries the fixes
# hterm needs over upstream 0.4.0: viewport corruption across pages (#139) and
# scrollback measured in bytes (#140), zero-initialized WASM pages, native
# synchronized output (DEC 2026), on-demand rendering, and Ghostty >= 1.3,
# whose bounded page growth fixes the OSC 8 hyperlink hang (#186).
# Local fixes go in ./patches/*.patch and are applied on top of REV.
#
# Needs git, pnpm, and Zig 0.15.2 on PATH (pinned by Ghostty's build.zig).
set -euo pipefail

REPO=https://github.com/diegosouzapw/ghostty-web
REV=faf6fbd055f5768923b3df659f3968c2abbab4a1 # tag v0.4.1

[ "$(zig version)" = 0.15.2 ] || { echo "Zig 0.15.2 required, found $(zig version)" >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git clone -q "$REPO" "$work/src"
cd "$work/src"
git checkout -q "$REV"
git submodule update --init --depth 1
for patch in "$here"/patches/*.patch; do
  if [ -e "$patch" ]; then git apply "$patch"; fi
done

# JS before WASM: in lib mode Vite inlines ghostty-vt.wasm as base64 when it
# exists, adding ~830 KB of dead weight since hterm passes the wasm URL itself.
# The fork ships only bun.lock, so build tooling is pinned by our own lockfile.
cp "$here/pnpm-lock.yaml" .
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vite build
./scripts/build-wasm.sh

# Only the browser ES build is shipped; no dist/ directory because dist is gitignored.
rm -f "$here"/*.js "$here"/*.d.ts "$here"/ghostty-vt.wasm
cp dist/ghostty-web.es.js dist/ghostty-web.d.ts dist/terminal-core-*.js dist/__vite-browser-external-*.js \
  ghostty-vt.wasm LICENSE "$here/"
echo "Vendored ghostty-web $REV into $here"
