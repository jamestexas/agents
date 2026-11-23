#!/usr/bin/env bash
# Offline PR mode: a local bare repo stands in for GitHub (refs/pull/N/head
# included) and a fake `gh` answers the one GraphQL query for the PR's shas.
# Covers what path mode cannot: the worktree a PR run owns, its cleanup, the
# phase-7 recheck, and a re-run after the PR was force-pushed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EV="$HERE/../scripts/review-evidence.sh"
tmp="$(mktemp -d)"
cleanup_tmp() {
    git -C "$tmp/clone" worktree prune 2>/dev/null || true
    rm -rf "$tmp"
}
trap cleanup_tmp EXIT

# ---- the "GitHub" side: acme/widget with main and two PR heads -------------
src="$tmp/src"; mkdir -p "$src"; cd "$src"
git init -q -b main; git config user.email t@t; git config user.name t; git config commit.gpgsign false
echo base > a.txt; git add a.txt; git commit -qm base
git checkout -qb pr1; echo one > a.txt; git commit -qam "pr1"
git checkout -q main; git checkout -qb pr2; echo two > b.txt; git add b.txt; git commit -qm "pr2"
git checkout -q main
remote="$tmp/gh/acme/widget"; mkdir -p "$(dirname "$remote")"
git clone -q --bare "$src" "$remote"
git -C "$remote" update-ref refs/pull/1/head "$(git -C "$src" rev-parse pr1)"
git -C "$remote" update-ref refs/pull/2/head "$(git -C "$src" rev-parse pr2)"

# ---- the reviewer's clone, with the repo as `upstream` ---------------------
clone="$tmp/clone"
git clone -q "$remote" "$clone"
git -C "$clone" remote rename origin upstream

# ---- fake gh: answers pr-shas from the bare repo, fails everything else ----
bin="$tmp/bin"; mkdir -p "$bin"
cat > "$bin/gh" <<'EOF'
#!/usr/bin/env bash
if [ "$1 $2" = "api graphql" ]; then
    n=""; for a in "$@"; do case "$a" in n=*) n="${a#n=}" ;; esac; done
    head="$(git -C "$FAKE_REMOTE" rev-parse "refs/pull/$n/head")"
    base="$(git -C "$FAKE_REMOTE" rev-parse main)"
    printf '{"data":{"repository":{"pullRequest":{"number":%s,"title":"t","state":"OPEN","headRefOid":"%s","baseRefOid":"%s","baseRefName":"main","headRefName":"pr%s"}}}}\n' "$n" "$head" "$base" "$n"
    exit 0
fi
[ "$1 $2" = "pr checks" ] && { echo '[]'; exit 0; }
echo "fake gh: $* not supported" >&2; exit 1
EOF
chmod +x "$bin/gh"
export PATH="$bin:$PATH" FAKE_REMOTE="$remote" REVIEW_WORKTREE_ROOT="$tmp/wt" HUD_ROOT="$tmp/nohud"

st() { jq -r --arg n "$2" '.probes[] | select(.name==$n) | .status' "$1/evidence/manifest.json"; }
registered() { git -C "$clone" worktree list --porcelain | grep -qx "worktree $(cd "$1" 2>/dev/null && pwd -P || echo "$1")"; }
wt1="$tmp/wt/acme-widget-1"

# 1. a PR run checks the PR out into its own worktree
run1="$tmp/run1"
bash "$EV" --pr acme/widget#1 --repo-dir "$clone" --out "$run1" 2>/dev/null
[ "$(st "$run1" core/fetch)" = RAN ] || { echo "fetch: $(st "$run1" core/fetch)"; exit 1; }
[ -d "$wt1" ] && registered "$wt1" || { echo "the PR worktree must exist and be registered"; exit 1; }
[ "$(cat "$wt1/a.txt")" = one ] || { echo "the worktree must sit on the PR head"; exit 1; }

# 2. cleanup removes it; the phase-7 recheck after it must not bring it back
bash "$EV" --cleanup "$run1" 2>/dev/null
[ ! -d "$wt1" ] || { echo "cleanup must remove the PR worktree"; exit 1; }
bash "$EV" --pr acme/widget#1 --repo-dir "$clone" --core-only --out "$run1/recheck" 2>/dev/null
[ ! -d "$wt1" ] || { echo "a --core-only recheck must not check the PR out again"; exit 1; }
jq -e '.worktree == ""' "$run1/recheck/evidence/target.json" >/dev/null || { echo "recheck target.json must name no worktree"; exit 1; }
[ "$(st "$run1/recheck" core/merge-base)" = RAN ] || { echo "recheck must still compute git facts"; exit 1; }

# 3. a recheck dir left by an older run (one that did check out) is cleaned too
bash "$EV" --pr acme/widget#1 --repo-dir "$clone" --out "$tmp/run1b" 2>/dev/null
mkdir -p "$run1/recheck/evidence/git"
cp "$tmp/run1b/evidence/target.json" "$run1/recheck/evidence/target.json"
cp "$tmp/run1b/evidence/git/worktree-path" "$tmp/run1b/evidence/git/repo-dir" "$run1/recheck/evidence/git/"
bash "$EV" --cleanup "$run1" 2>/dev/null
[ ! -d "$wt1" ] || { echo "cleanup must also remove a worktree a recheck run left"; exit 1; }

# 4. re-run after a force-push: refs/review/1 from the earlier run is not a
# fast-forward of the new head, and the fetch must still take it
git -C "$src" checkout -q pr1; git -C "$src" commit -q --amend -m "pr1 rewritten"
git -C "$remote" fetch -q "$src" "+pr1:refs/pull/1/head"
git -C "$clone" show-ref --quiet refs/review/1 || { echo "refs/review/1 should survive cleanup"; exit 1; }
run2="$tmp/run2"
bash "$EV" --pr acme/widget#1 --repo-dir "$clone" --out "$run2" 2>/dev/null || { echo "re-run after force-push failed: $(cat "$run2/evidence/probes/core/fetch.err")"; exit 1; }
[ "$(jq -r .head "$run2/evidence/target.json")" = "$(git -C "$src" rev-parse pr1)" ] || { echo "re-run must review the rewritten head"; exit 1; }
[ "$(git -C "$clone" rev-parse refs/review/1)" = "$(git -C "$src" rev-parse pr1)" ] || { echo "refs/review/1 must move to the rewritten head"; exit 1; }

# 5. a worktree dir whose registration was lost (dead .git file) is replaced
bash "$EV" --cleanup "$run2" 2>/dev/null
mkdir -p "$wt1"; echo "gitdir: $clone/.git/worktrees/gone" > "$wt1/.git"
bash "$EV" --pr acme/widget#1 --repo-dir "$clone" --out "$tmp/run3" 2>/dev/null || { echo "a dead worktree dir must not stop the run"; exit 1; }
registered "$wt1" || { echo "the replaced worktree must be registered"; exit 1; }

# 6. a registered worktree whose dir was deleted by hand is pruned and re-added
rm -rf "$wt1"
bash "$EV" --pr acme/widget#1 --repo-dir "$clone" --out "$tmp/run4" 2>/dev/null || { echo "a registered-but-missing worktree must not stop the run"; exit 1; }
[ -d "$wt1" ] || { echo "worktree must be re-added"; exit 1; }

# 7. a reused worktree that a probe dirtied is re-pointed anyway
echo scribble > "$wt1/a.txt"
bash "$EV" --pr acme/widget#1 --repo-dir "$clone" --out "$tmp/run5" 2>/dev/null || { echo "a dirty reused worktree must not stop the run"; exit 1; }
[ "$(cat "$wt1/a.txt")" = one ] || { echo "reused worktree must be reset to the PR head"; exit 1; }

# 8. a directory at the worktree path that is not a worktree is left alone
bash "$EV" --cleanup "$tmp/run5" 2>/dev/null
mkdir -p "$wt1"; echo mine > "$wt1/keep.txt"
if bash "$EV" --pr acme/widget#1 --repo-dir "$clone" --out "$tmp/run6" 2>/dev/null; then echo "a foreign dir at the worktree path must stop the run"; exit 1; fi
[ -f "$wt1/keep.txt" ] || { echo "a foreign dir must not be removed"; exit 1; }
rm -rf "$wt1"
