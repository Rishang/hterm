---
description: Bump the hterm version (Cargo.toml, Cargo.lock, openapi.yaml)
argument-hint: <X.Y.Z | major | minor | patch>
allowed-tools: Bash(rg:*), Bash(cargo update:*), Bash(cargo test:*), Bash(git diff:*), Read, Edit
---

Bump the hterm version to: $ARGUMENTS

1. Read the current version from the `version` line in the `[package]` table of `Cargo.toml`.
2. Work out the new version:
   - `X.Y.Z` (an optional leading `v` is dropped): use it as given. It must be plain SemVer with three numbers.
   - `major`, `minor` or `patch`: increment that part of the current version and reset the lower parts to 0.
   - Empty or anything else: stop and ask which version to use.
3. Set that version in exactly these places, and nowhere else:
   - `Cargo.toml`: the `version` line in `[package]`. Keep its column alignment.
   - `openapi.yaml`: `info.version`.
4. Run `cargo update --workspace --offline` so `Cargo.lock` records the new hterm version and no dependency changes.
5. Check that nothing still carries the old version: `rg -n --fixed-strings '<old>' Cargo.toml openapi.yaml README.md`. Only the old version itself counts as stale; leave version strings that belong to dependencies alone.
6. Run `cargo test`. The server logs `hterm v<version>` from `CARGO_PKG_VERSION`, so no source code needs changing.
7. Show `git diff --stat` and report old → new. Do not commit, tag or create a release unless asked. The release workflow runs when a GitHub release is published.

`ui/package.json` stays at `0.0.0`: it is the private Vite package, not the hterm version.
