#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/site.yaml" <<'EOF'
packs:
  deploy:
    question: "Is the PR's base already deployed to staging and prod?"
    match: ["env/**", ".github/workflows/**"]
    needs: [gh]
    probes:
      staging-runs: 'gh run list -w "$REVIEW_STAGING_WORKFLOW" -s completed --json headSha,createdAt,conclusion -L 5'
  go-graph:
    question: "overridden by site"
    match: ["**/*.go"]
    probes:
      extra: 'echo site-extra'
EOF
match() { ruby "$HERE/../scripts/packs-match.rb" "$@"; }

# generic only: a Go change matches go-graph, not docs-only
printf '%s\n' api/x.go api/x_test.go | match "$HERE/../packs.yaml" > "$tmp/a.json"
jq -e '.matched | map(.name) | index("go-graph")' "$tmp/a.json" >/dev/null || { echo "go-graph should match"; cat "$tmp/a.json"; exit 1; }
jq -e '.matched | map(.name) | index("docs-only") | not' "$tmp/a.json" >/dev/null || { echo "docs-only must not match a .go change"; exit 1; }
jq -e '.matched[] | select(.name=="go-graph") | .by[0] | .glob == "**/*.go" and .file == "api/x.go"' "$tmp/a.json" >/dev/null || { echo "must record which glob hit which file"; exit 1; }

# docs-only matches only when every file is markdown
printf '%s\n' README.md docs/a.md | match "$HERE/../packs.yaml" > "$tmp/b.json"
jq -e '.matched | map(.name) == ["docs-only"]' "$tmp/b.json" >/dev/null || { echo "docs-only should be the only match"; cat "$tmp/b.json"; exit 1; }

# only: a mixed change is not docs-only, even though one file is markdown
printf '%s\n' README.md api/x.go | match "$HERE/../packs.yaml" > "$tmp/d.json"
jq -e '.matched | map(.name) | index("docs-only") | not' "$tmp/d.json" >/dev/null || { echo "docs-only must not match a mixed change"; cat "$tmp/d.json"; exit 1; }
jq -e '.matched | map(.name) | index("go-graph")' "$tmp/d.json" >/dev/null || { echo "go-graph should still match the mixed change"; exit 1; }

# a pack body that is not a map is refused, not silently treated as empty
printf 'packs:\n  broken: "just a string"\n' > "$tmp/bad.yaml"
if printf 'x.go\n' | match "$tmp/bad.yaml" >/dev/null 2>"$tmp/bad.err"; then echo "non-map pack must abort"; exit 1; fi
grep -q "pack broken is not a map" "$tmp/bad.err" || { echo "abort message missing: $(cat "$tmp/bad.err")"; exit 1; }

# site file adds a pack and overrides a probe map by name; later file wins per pack
printf '%s\n' env/prod/main.tf api/x.go | match "$HERE/../packs.yaml" "$tmp/site.yaml" > "$tmp/c.json"
jq -e '.matched | map(.name) | index("deploy")' "$tmp/c.json" >/dev/null || { echo "site pack should load"; exit 1; }
jq -e '.matched[] | select(.name=="go-graph") | .probes.extra == "echo site-extra"' "$tmp/c.json" >/dev/null || { echo "site override should replace go-graph"; exit 1; }
jq -e '.matched[] | select(.name=="deploy") | .source | endswith("site.yaml")' "$tmp/c.json" >/dev/null || { echo "source file must be recorded"; exit 1; }

# every shipped pack states its question (lint rule from the spec)
jq -e '[.all[] | select((.question // "") == "")] | length == 0' "$tmp/a.json" >/dev/null || { echo "a pack without a question"; exit 1; }
