#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/CODEOWNERS" <<'EOF'
# comment
*                 @org/default
/api/**           @org/api
/api/internal/    @org/api-internal
docs/*.md         @org/docs @alice
README.md         @org/readme
EOF
printf '%s\n' api/x.go api/internal/y.go docs/a.md other/z.txt \
    api/sub/x.go api/internal/deep/y.go api/internal/a/b/c.go sub/dir/README.md > "$tmp/files"
ruby "$HERE/../scripts/codeowners.rb" "$tmp/CODEOWNERS" < "$tmp/files" > "$tmp/owners.json"
own() { jq -r --arg p "$1" '.paths[$p].owners | join(",")' "$tmp/owners.json"; }
[ "$(own api/x.go)" = "@org/api" ]                      || { echo "api: got $(own api/x.go)"; exit 1; }
[ "$(own api/internal/y.go)" = "@org/api-internal" ]    || { echo "internal: last rule must win"; exit 1; }
[ "$(own docs/a.md)" = "@org/docs,@alice" ]              || { echo "docs: got $(own docs/a.md)"; exit 1; }
[ "$(own other/z.txt)" = "@org/default" ]                || { echo "default: got $(own other/z.txt)"; exit 1; }
# GitHub matches a rule at any depth below it; nested files must not fall through to an earlier rule.
[ "$(own api/sub/x.go)" = "@org/api" ]                  || { echo "depth2: got $(own api/sub/x.go)"; exit 1; }
[ "$(own api/internal/deep/y.go)" = "@org/api-internal" ] || { echo "dir depth2: got $(own api/internal/deep/y.go)"; exit 1; }
[ "$(own api/internal/a/b/c.go)" = "@org/api-internal" ]  || { echo "dir depth4: got $(own api/internal/a/b/c.go)"; exit 1; }
[ "$(own sub/dir/README.md)" = "@org/readme" ]           || { echo "bare name any depth: got $(own sub/dir/README.md)"; exit 1; }
jq -e '.source == "'"$tmp"'/CODEOWNERS"' "$tmp/owners.json" >/dev/null || { echo "source missing"; exit 1; }
jq -e '.teams | index("@org/api")' "$tmp/owners.json" >/dev/null || { echo "teams rollup missing"; exit 1; }
