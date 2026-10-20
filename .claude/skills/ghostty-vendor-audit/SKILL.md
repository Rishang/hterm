---
name: ghostty-vendor-audit
description: Security audit of the vendored ghostty-web in ui/vendor/ghostty-web (third-party fork + local patches that run with full access to terminal I/O). Use before bumping REV in build.sh, adding or changing a patch in ui/vendor/ghostty-web/patches, or when asked to audit/review the ghostty vendor, fork, or terminal library supply chain.
---

# ghostty-web vendor audit

`ui/vendor/ghostty-web` is a source build of a community fork of coder/ghostty-web
(repo + pinned `REV` in `build.sh`), plus hterm's patches in `patches/`. It runs in the
hterm page: it sees every keystroke and all shell output, can write to the PTY via
`onData`, and shares the origin that can call `/api/exec` and `/api/files`. Treat any
change to it as a supply-chain change.

## 1. Mechanical checks

From the repo root:

```bash
.claude/skills/ghostty-vendor-audit/scan.sh            # quick checks + diff for review
.claude/skills/ghostty-vendor-audit/scan.sh --rebuild  # also prove the vendored build is reproducible
```

`--rebuild` needs Zig 0.15.2 on PATH (the system zig may differ; a ziglang.org tarball works).

Expected results; anything else is a finding:

| Check | Expected |
|---|---|
| Risky APIs in shipped JS | Only: `fetch(` in the wasm loader; `window.open` in the two link providers (Ctrl/Cmd-click, OSC 8 restricted to http/https/mailto by patch 0004); `navigator.clipboard` writes in the selection/copy path; `https?://` in comments (pako license, PNG spec). No eval/Function, storage, cookies, postMessage, HTML injection, or long encoded blobs. |
| WASM imports | `[{"module":"env","name":"log",...}]` only |
| Ghostty submodule | URL is ghostty-org/ghostty and `behind_by=0` against its main (a fork-only commit can be served through the upstream URL) |
| Patches | every `patches/*.patch` applies in order on a clean `REV` |
| Rebuild | byte-identical |

## 2. Read the shipped diff

Read `$OUT/shipped.diff` in full; grep alone misses intent. Delegate to a subagent if
it is large. Look for:

- **Exfiltration/remote code:** network calls, `import()` of URLs, script/img injection,
  build scripts that download and execute code, new runtime deps (check the lockfile
  integrity hashes against the real maintainers).
- **Input path:** keystrokes sent anywhere except `onData`; keys emitted to the PTY
  without user intent. Known example: the fork sent `\x16` on Ctrl+V, which breaks
  bracketed-paste protection (patch 0003 removes it).
- **Terminal → page:** escape sequences that reach the DOM or browser (OSC 8 link
  schemes, OSC 22 cursor CSS, titles, OSC 133). Note which only run on string writes:
  hterm writes `Uint8Array`.
- **Terminal → PTY auto-replies:** `emitTerminalResponses` is on by default. Allowed:
  DA, DSR, DECRQM, size reports, title report. Must stay ignored: OSC 52 clipboard reads,
  color queries that echo attacker-controlled data.
- **Resource limits:** kitty graphics storage (patch 0005 sets 16 MB), PNG decode cost.
- **`patches/ghostty-wasm-api.patch`:** must only expose C APIs; no new host imports,
  no file/shm media on wasm.
- **`write_pty_trampoline`:** the inline wasm bytes must match the `.wat`.

Also confirm hterm's own patches still say what they claim (`git diff` the patch files).

## 3. Report

Verdict first (no malicious code found / concerns found). Then a table of findings:
fork `file:line`, severity (malicious / risky, affects hterm / risky, dormant / benign),
whether it comes from upstream or the fork, and the fix (usually a new
`patches/000N-*.patch`). List which risky features hterm's `TermTab.svelte` setup leaves
on by default. Keep evidence to one or two quoted lines per finding.

To fix a finding: edit a clean checkout of `REV` with the existing patches applied
(`git add` them so `git diff` only captures the new change), write
`patches/000N-name.patch`, check all patches apply in order, then `task ghostty-web`
and `task build`.
