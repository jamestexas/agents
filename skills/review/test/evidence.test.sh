#!/usr/bin/env bash
# Offline: builds a fixture repo with a base branch and a feature branch, runs
# review-evidence.sh in path mode, and checks the layout and statuses. gh is
# masked from PATH so every network probe must come back UNAVAILABLE, never
# silently absent.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"; mkdir -p "$repo"; cd "$repo"
git init -q -b main; git config user.email t@t; git config user.name t
# a global commit.gpgsign would make these fixture commits reach for gitsign/rekor
git config commit.gpgsign false
mkdir -p .github mod/a && printf '*\t@org/all\n/mod/\t@org/mod\n' > .github/CODEOWNERS
printf 'module example.com/a\n\ngo 1.22\n' > mod/a/go.mod
printf 'package a\n\nfunc A() int { return 1 }\n' > mod/a/a.go
echo "# readme" > README.md
git add -A && git commit -qm base
git checkout -qb feature
printf 'package a\n\nfunc A() int { return 2 }\n' > mod/a/a.go
# zz.md sorts after mod/a/a.go and has no go.mod above it: the modules loop
# must not abort the run when the last changed file is outside a Go module.
echo zz > zz.md; git add zz.md
git commit -qam change
git checkout -q main && echo more >> README.md && git commit -qam "main moved"
git checkout -q feature

bin="$tmp/bin"; mkdir -p "$bin"   # a PATH with no gh, no go, no modmap (uname: macOS system ruby runs it at startup)
for t in git jq ruby uname shasum date mktemp head tr cut mkdir cat grep sort uniq xargs dirname basename wc sed awk tee rm mv cp realpath bash sh env; do
    p="$(command -v $t || true)"; [ -n "$p" ] && ln -sf "$p" "$bin/$t"
done

out="$tmp/run"
PATH="$bin" bash "$HERE/../scripts/review-evidence.sh" --path "$repo" --base main --head feature --out "$out"

m="$out/evidence/manifest.json"
[ -f "$m" ] || { echo "no manifest"; exit 1; }
st() { jq -r --arg n "$1" '.probes[] | select(.name==$n) | .status' "$m"; }
[ "$(st core/diff)" = RAN ]          || { echo "diff: $(st core/diff)"; exit 1; }
[ "$(st core/merge-base)" = RAN ]    || { echo "merge-base"; exit 1; }
[ "$(st core/staleness)" = RAN ]     || { echo "staleness"; exit 1; }
[ "$(st core/owners)" = RAN ]        || { echo "owners"; exit 1; }
[ "$(st core/pr-context)" = UNAVAILABLE ] || { echo "pr-context must be UNAVAILABLE without gh, got $(st core/pr-context)"; exit 1; }
[ "$(st go-graph/build)" = UNAVAILABLE ]  || { echo "go-graph/build must be UNAVAILABLE without go, got $(st go-graph/build)"; exit 1; }
grep -q 'return 2' "$out/evidence/git/diff.patch"                 || { echo "diff content"; exit 1; }
[ "$(cat "$out/evidence/git/behind-base")" = 1 ]                   || { echo "staleness count want 1 got $(cat "$out/evidence/git/behind-base")"; exit 1; }
jq -e '.paths["mod/a/a.go"].owners == ["@org/mod"]' "$out/evidence/owners.json" >/dev/null || { echo "owners resolution"; exit 1; }
jq -e '.matched | map(.name) | index("go-graph")' "$out/evidence/packs.json" >/dev/null || { echo "go-graph pack should match"; exit 1; }
jq -e '.kind == "path" and .base == "main" and .head == "feature"' "$out/evidence/target.json" >/dev/null || { echo "target.json"; exit 1; }
[ "$(cat "$out/evidence/git/modules")" = 'mod/a' ]                 || { echo "modules list want exactly mod/a, got: $(cat "$out/evidence/git/modules")"; exit 1; }
for f in owners.json packs.json manifest.sha256; do [ -f "$out/evidence/$f" ] || { echo "missing $f: run aborted early"; exit 1; }; done
jq -e '.matched | map(.name) | index("docs-only") | not' "$out/evidence/packs.json" >/dev/null || { echo "docs-only must not match a mixed change"; exit 1; }
# every probe has exactly one status from the allowed set
jq -e '[.probes[].status] | all(. == "RAN" or . == "FAILED" or . == "UNAVAILABLE")' "$m" >/dev/null || { echo "bad status"; exit 1; }
# replay line present
grep -q 'review-evidence.sh --path' "$out/evidence/replay.txt"     || { echo "replay"; exit 1; }

# relative --out and --path . from inside the repo must still record absolute
# paths; a relative WORKTREE would make pack probes RAN with empty output
cd "$repo"
PATH="$bin" bash "$HERE/../scripts/review-evidence.sh" --path . --base main --head feature --out rel/run 2>/dev/null
jq -e '(.repo_dir|startswith("/")) and (.worktree|startswith("/"))' "$repo/rel/run/evidence/target.json" >/dev/null || { echo "relative args must resolve to absolute paths: $(jq -c . "$repo/rel/run/evidence/target.json")"; exit 1; }
[ "$(jq -r '.probes[]|select(.name=="go-graph/build")|.status' "$repo/rel/run/evidence/manifest.json")" = UNAVAILABLE ] || { echo "relative run: go-graph/build must be UNAVAILABLE"; exit 1; }
