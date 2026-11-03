#!/usr/bin/env bash
# go-overlay-test.sh <run> <id> <pkg-dir> <test-file> [go test args...]
#
# Observe a Go behavior with a scratch test, without touching the worktree.
# <test-file> (anywhere, typically under $TMPDIR) is mapped into <pkg-dir>
# (relative to the worktree) through `go test -overlay`, so it compiles as
# part of that package at the commit under review. Readers working at the
# same time each map their own file, and none of them edits the tree or
# breaks another's build. The run is recorded through observe.sh as <id>.
#
#   go-overlay-test.sh $RUN missing-row api/core /tmp/x_test.go -run TestScratch -v
set -euo pipefail
here="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
[ $# -ge 4 ] || { echo "usage: go-overlay-test.sh <run> <id> <pkg-dir> <test-file> [go test args...]" >&2; exit 2; }
run="$1" id="$2" pkg="$3" src="$4"; shift 4
wt="$(jq -r '.worktree' "$run/evidence/target.json")"
wt="$(cd "$wt" && pwd -P)"
[ -d "$wt/$pkg" ] || { echo "go-overlay-test: no package dir $pkg in the worktree" >&2; exit 2; }
[ -f "$src" ] || { echo "go-overlay-test: no test file $src" >&2; exit 2; }
case "$src" in *_test.go) ;; *) echo "go-overlay-test: $src must end in _test.go" >&2; exit 2 ;; esac

# go resolves the package through its own module: run from the nearest go.mod.
mod="$pkg"
while [ "$mod" != "." ] && [ ! -f "$wt/$mod/go.mod" ]; do mod="$(dirname "$mod")"; done
[ -f "$wt/$mod/go.mod" ] || { echo "go-overlay-test: no go.mod above $pkg" >&2; exit 2; }
if [ "$pkg" = "$mod" ]; then rel=.; else rel="./${pkg#"$mod"/}"; fi

mkdir -p "$run/work/observe"
overlay="$run/work/observe/$id.overlay.json"
srcabs="$(cd "$(dirname "$src")" && pwd -P)/$(basename "$src")"
jq -n --arg k "$wt/$pkg/zz_observe_${id//[^A-Za-z0-9]/_}_test.go" --arg v "$srcabs" '{Replace: {($k): $v}}' > "$overlay"
cp "$srcabs" "$run/work/observe/$id.test.go"
exec "$here/observe.sh" "$run" "$id" --cwd "$wt/$mod" -- go test -count=1 -overlay "$overlay" "$@" "$rel"
