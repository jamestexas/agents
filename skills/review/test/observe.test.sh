#!/usr/bin/env bash
# observe.sh and go-overlay-test.sh on a scratch run: a recording carries the
# command, exit, output hash and commit; ids are write-once; --cwd must stay in
# the worktree; an overlay test observes a package's behavior without
# changing the worktree, and two of them can run against one package at once.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
O="$HERE/../scripts/observe.sh"; G="$HERE/../scripts/go-overlay-test.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
wt="$tmp/wt"; run="$tmp/run"; mkdir -p "$wt/mod/p" "$run/evidence"
jq -n --arg wt "$wt" '{worktree: $wt, head: "abc123"}' > "$run/evidence/target.json"

bash "$O" "$run" echo-1 -- sh -c 'echo hello; echo oops >&2; exit 3' 2>/dev/null && { echo "exit status must pass through"; exit 1; } || true
rec="$run/work/observe/echo-1.json"
jq -e '.exit == 3 and .at == "abc123" and .cwd == "." and .cmd == ["sh","-c","echo hello; echo oops >&2; exit 3"]' "$rec" >/dev/null || { echo "recording fields: $(cat "$rec")"; exit 1; }
[ "$(cat "$run/work/observe/echo-1.out")" = hello ] && [ "$(cat "$run/work/observe/echo-1.err")" = oops ] || { echo "out/err not captured"; exit 1; }
[ "$(jq -r .out_sha256 "$rec")" = "$(shasum -a 256 < "$run/work/observe/echo-1.out" | cut -d' ' -f1)" ] || { echo "out hash wrong"; exit 1; }

if bash "$O" "$run" echo-1 -- true 2>/dev/null; then echo "reusing an id must fail"; exit 1; fi
if bash "$O" "$run" outside --cwd "$tmp" -- true 2>/dev/null; then echo "--cwd outside the worktree must fail"; exit 1; fi

if ! command -v go >/dev/null; then echo "   (go not on PATH: overlay checks skipped)"; exit 0; fi
printf 'module example.com/m\n\ngo 1.22\n' > "$wt/mod/go.mod"
printf 'package p\n\n// Find returns ok=false for a missing key.\nfunc Find(m map[string]int, k string) (int, bool) { v, ok := m[k]; return v, ok }\n' > "$wt/mod/p/p.go"
(cd "$wt" && git init -q && git add -A && git -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -qm base)
cat > "$tmp/a_test.go" <<'EOF'
package p
import "testing"
func TestObserveMissing(t *testing.T) { if _, ok := Find(map[string]int{}, "x"); ok { t.Fatal("missing key reported present") }; t.Log("missing key: ok=false") }
EOF
cat > "$tmp/b_test.go" <<'EOF'
package p
import "testing"
func TestObservePresent(t *testing.T) { if v, ok := Find(map[string]int{"x": 2}, "x"); !ok || v != 2 { t.Fatalf("got %d %v", v, ok) } }
EOF
bash "$G" "$run" miss mod/p "$tmp/a_test.go" -run TestObserveMissing -v 2>/dev/null &
bash "$G" "$run" pres mod/p "$tmp/b_test.go" -run TestObservePresent 2>/dev/null &
wait
jq -e '.exit == 0 and .cwd == "mod"' "$run/work/observe/miss.json" >/dev/null || { echo "overlay run a failed: $(cat "$run/work/observe/miss.json") $(cat "$run/work/observe/miss.err")"; exit 1; }
jq -e '.exit == 0' "$run/work/observe/pres.json" >/dev/null || { echo "overlay run b failed: $(cat "$run/work/observe/pres.err")"; exit 1; }
grep -q 'missing key: ok=false' "$run/work/observe/miss.out" || { echo "the observed behavior must be in the output"; exit 1; }
[ -f "$run/work/observe/miss.test.go" ] || { echo "the scratch test must be kept beside its recording"; exit 1; }
[ -z "$(cd "$wt" && git status --porcelain)" ] || { echo "the worktree must be unchanged: $(cd "$wt" && git status --porcelain)"; exit 1; }
