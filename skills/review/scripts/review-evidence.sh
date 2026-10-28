#!/usr/bin/env bash
# review-evidence.sh — phase 1 of /review. Bash, no model. Produces the
# evidence directory every later phase reads, and nothing else.
#
# Usage:
#   review-evidence.sh --pr <owner/repo#N | N> [--repo-dir DIR] --out RUN
#   review-evidence.sh --path REPO_DIR --base REF --head REF --out RUN
#   review-evidence.sh --cleanup RUN
#
# Layout under RUN/evidence (see SKILL.md): manifest.json target.json
# pr/ git/ owners.json packs.json probes/ replay.txt
#
# Rules: never posts; never writes outside RUN and its own worktree; a probe
# that cannot run is UNAVAILABLE in the manifest, not absent. PR context comes
# from scripts/pr-context.sh (one probe), head/base/merge shas from one
# GraphQL query — never from grepping git log for the PR number.
set -euo pipefail
# Physical location, not the invoked path: the skill is normally installed as
# a symlink (~/.claude/skills/review -> <repo>/skills/review), and a logical
# `cd ..` from there climbs the symlink's parent, not the repo, so
# AGENTS_ROOT/scripts/pr-context.sh would not exist. macOS has no
# `readlink -f`, hence the loop.
SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
    SELF_DIR="$(cd -P "$(dirname "$SELF")" && pwd -P)"
    SELF="$(readlink "$SELF")"
    [[ "$SELF" == /* ]] || SELF="$SELF_DIR/$SELF"
done
HERE="$(cd -P "$(dirname "$SELF")" && pwd -P)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib.sh
source "$HERE/lib.sh"
SKILL_DIR="$(cd -P "$HERE/.." && pwd -P)"
AGENTS_ROOT="$(cd -P "$SKILL_DIR/../.." && pwd -P)"
PR_CONTEXT="$AGENTS_ROOT/scripts/pr-context.sh"

usage() {
    awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
    exit "${1:-0}"
}

status_of()   { jq -r --arg n "$1" '.probes[]|select(.name==$n)|.status' "$MANIFEST"; }
require_ran() { [ "$(status_of "$1")" = RAN ] || die "probe $1 is $(status_of "$1"), cannot continue; see $MANIFEST"; }

cleanup() {
    local run="$1" ev="$1/evidence" kind prn wt="" rd=""
    # Only a PR run owns its worktree. In path mode the "worktree" is the
    # user's own repo dir, which must never be removed.
    kind="$(jq -r '.kind // ""' "$ev/target.json" 2>/dev/null || true)"
    prn="$(jq -r '.pr // ""' "$ev/target.json" 2>/dev/null || true)"
    [ -f "$ev/git/worktree-path" ] && wt="$(cat "$ev/git/worktree-path")"
    [ -f "$ev/git/repo-dir" ] && rd="$(cat "$ev/git/repo-dir")"
    if [ "$kind" = pr ] && [ -n "$wt" ] && [ "$wt" != "$rd" ] && [ -d "$wt" ]; then
        git -C "$rd" worktree remove --force "$wt" || die "could not remove worktree $wt"
        note "removed worktree $wt"
    else
        note "no worktree to remove for $run (kind=${kind:-?}, worktree=${wt:-none})"
    fi
    # the fetch refspec parked the PR head under refs/review/<N>; drop it too
    if [ "$kind" = pr ] && [ -n "$prn" ] && [ -n "$rd" ] && git -C "$rd" show-ref --quiet "refs/review/$prn"; then
        git -C "$rd" update-ref -d "refs/review/$prn" && note "deleted refs/review/$prn in $rd"
    fi
    exit 0
}

MODE="" PR="" REPO="" REPO_DIR="" BASE="" HEAD="" RUN=""
ARGS=("$@")
while [ $# -gt 0 ]; do
    case "$1" in
        --pr)       MODE="pr";   PR="$2"; shift 2 ;;
        --repo-dir) REPO_DIR="$2"; shift 2 ;;
        --path)     MODE="path"; REPO_DIR="$2"; shift 2 ;;
        --base)     BASE="$2"; shift 2 ;;
        --head)     HEAD="$2"; shift 2 ;;
        --out)      RUN="$2"; shift 2 ;;
        --cleanup)  cleanup "$2" ;;
        -h|--help)  usage 0 ;;
        *) die "unknown arg $1" ;;
    esac
done

[ -n "$MODE" ] && [ -n "$RUN" ] || die "need --pr or --path, and --out"
# absolute from here on: pack probes cd into the worktree and get these as env
mkdir -p "$RUN"; RUN="$(cd "$RUN" && pwd)"
REPO_DIR="${REPO_DIR:-$PWD}"; REPO_DIR="$(cd "$REPO_DIR" && pwd)" || die "no such directory: $REPO_DIR"

OUTDIR="$RUN/evidence"; MANIFEST="$OUTDIR/manifest.json"
mkdir -p "$OUTDIR/pr" "$OUTDIR/git" "$OUTDIR/probes" "$RUN/work"
manifest_init
printf '%q ' "$(basename "$0")" "${ARGS[@]}" > "$OUTDIR/replay.txt"; echo >> "$OUTDIR/replay.txt"

# ---- resolve the target ---------------------------------------------------
if [ "$MODE" = pr ]; then
    if [[ "$PR" == */*#* ]]; then REPO="${PR%%#*}"; PR="${PR##*#}"; fi
    if [ -z "$REPO" ]; then
        REPO="$(git -C "$REPO_DIR" remote get-url upstream 2>/dev/null || git -C "$REPO_DIR" remote get-url origin 2>/dev/null)" \
            || die "no origin/upstream remote in $REPO_DIR"
        REPO="$(echo "$REPO" | sed -E 's#\.git$##; s#.*[:/]([^/]+/[^/]+)$#\1#')"
    fi
    # one GraphQL query for the shas; REST is the fallback nobody wants at rate-limit time
    # shellcheck disable=SC2016  # $o/$r/$n are GraphQL variables, not shell ones
    probe core pr-shas --needs gh -- gh api graphql \
        -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){number title state isDraft author{login} headRefOid baseRefOid baseRefName headRefName mergedAt mergeCommit{oid} reviewDecision changedFiles}}}' \
        -F o="${REPO%%/*}" -F r="${REPO##*/}" -F n="$PR"
    if [ "$(jq -r '.probes[]|select(.name=="core/pr-shas")|.status' "$MANIFEST")" = RAN ]; then
        HEAD="$(jq -r '.data.repository.pullRequest.headRefOid' "$OUTDIR/probes/core/pr-shas.out")"
        BASE_BRANCH="$(jq -r '.data.repository.pullRequest.baseRefName' "$OUTDIR/probes/core/pr-shas.out")"
        # the remote whose URL names this repo; in a fork setup that is usually `upstream`
        REMOTE="$(git -C "$REPO_DIR" remote -v | awk -v r="$REPO" '$3=="(fetch)" {
            u=$2; sub(/\.git$/, "", u); n=length(r)
            if (length(u) > n && substr(u, length(u)-n+1) == r && substr(u, length(u)-n, 1) ~ /[:\/]/) { print $1; exit } }')"
        [ -n "$REMOTE" ] || die "no remote in $REPO_DIR points at $REPO"
        probe core fetch -- git -C "$REPO_DIR" fetch -q "$REMOTE" "refs/pull/$PR/head:refs/review/$PR" "$BASE_BRANCH"
        require_ran core/fetch
        BASE="$REMOTE/$BASE_BRANCH"
        TMP="${TMPDIR:-/tmp}"; WT="${REVIEW_WORKTREE_ROOT:-${TMP%/}/review-worktrees}/${REPO//\//-}-$PR"
        if [ ! -d "$WT" ]; then
            probe core worktree -- git -C "$REPO_DIR" worktree add -q --detach "$WT" "$HEAD"
        else
            # a worktree left by an earlier run may sit on an older push; re-point it
            probe core worktree -- git -C "$WT" checkout -q --detach "$HEAD"
        fi
        require_ran core/worktree
        echo "$WT" > "$OUTDIR/git/worktree-path"
    else
        die "cannot resolve PR $REPO#$PR without gh; see manifest"
    fi
    probe core pr-context --needs gh -- "$PR_CONTEXT" --pr "$REPO#$PR" --similar 3
    if [ "$(status_of core/pr-context)" = RAN ]; then cp "$OUTDIR/probes/core/pr-context.out" "$OUTDIR/pr/context.json"; fi
    probe core pr-checks  --needs gh -- gh pr checks "$PR" --repo "$REPO" --json name,state,link,workflow
else
    [ -n "$BASE" ] && [ -n "$HEAD" ] || die "--path needs --base and --head"
    REPO="$(basename "$REPO_DIR")"; PR=""
    WT="$REPO_DIR"
    echo "$WT" > "$OUTDIR/git/worktree-path"
    # no PR in path mode; recorded as UNAVAILABLE with a reason, not skipped.
    # The script is still located first, so a broken install surfaces here
    # instead of only on the next PR run. The path travels by --env, not as an
    # argument, so the recorded cmd (and the manifest hash) stays install-free.
    # shellcheck disable=SC2016  # $PR_CONTEXT expands inside the probe's bash, by design
    probe core pr-context --env "PR_CONTEXT=$PR_CONTEXT" -- bash -c \
        '[ -f "$PR_CONTEXT" ] || { echo "pr-context.sh not found at $PR_CONTEXT" >&2; exit 127; }; echo "no PR in path mode" >&2; exit 127'
fi
echo "$REPO_DIR" > "$OUTDIR/git/repo-dir"
jq -n --arg kind "$MODE" --arg repo "$REPO" --arg pr "$PR" --arg base "$BASE" --arg head "$HEAD" --arg worktree "$WT" --arg repo_dir "$REPO_DIR" \
   '{kind:$kind, repo:$repo, pr:$pr, base:$base, head:$head, worktree:$worktree, repo_dir:$repo_dir}' > "$OUTDIR/target.json"

# ---- git facts ------------------------------------------------------------
probe core merge-base  -- git -C "$REPO_DIR" merge-base "$BASE" "$HEAD"
require_ran core/merge-base
cp "$OUTDIR/probes/core/merge-base.out" "$OUTDIR/git/merge-base"
MB="$(cat "$OUTDIR/git/merge-base")"
probe core diff        -- git -C "$REPO_DIR" diff "$MB" "$HEAD"
cp "$OUTDIR/probes/core/diff.out" "$OUTDIR/git/diff.patch"
probe core files       -- git -C "$REPO_DIR" diff --name-only "$MB" "$HEAD"
cp "$OUTDIR/probes/core/files.out" "$OUTDIR/git/files"
probe core staleness   -- git -C "$REPO_DIR" rev-list --count "$MB..$BASE"
cp "$OUTDIR/probes/core/staleness.out" "$OUTDIR/git/behind-base"
probe core commits     -- git -C "$REPO_DIR" log --format='%H %cI %s' "$MB..$HEAD"
# nearest go.mod above each changed file, deduped: the unit `go build` works in
while read -r f; do
    d="$(dirname "$f")"
    while [ "$d" != "." ] && [ ! -f "$WT/$d/go.mod" ]; do d="$(dirname "$d")"; done
    # an if, not `&&`: a bare test as the loop's last command would make the
    # pipeline fail under pipefail when the last file is outside any module
    if [ -f "$WT/$d/go.mod" ]; then echo "$d"; fi
done < "$OUTDIR/git/files" | sort -u > "$OUTDIR/git/modules"

# ---- owners ---------------------------------------------------------------
# CODEOWNERS is read at the BASE ref of the reviewer's checkout, never from the
# PR worktree: GitHub resolves reviewers from the base branch, and a PR must
# not be able to rewrite its own ownership evidence.
CO_LOC=""
for c in .github/CODEOWNERS CODEOWNERS docs/CODEOWNERS; do
    if git -C "$REPO_DIR" show "$BASE:$c" > "$OUTDIR/CODEOWNERS" 2>/dev/null; then CO_LOC="$c"; break; fi
done
if [ -n "$CO_LOC" ]; then
    # Not a direct `ruby codeowners.rb "$OUTDIR/CODEOWNERS"` call: run inside
    # OUTDIR with relative paths so neither the recorded command nor the output
    # names the run directory, and the manifest hash stays equal across run
    # dirs of the same target. Positional args, not a quoted command string.
    # shellcheck disable=SC2016  # $OUTDIR and $1 expand inside the probe's bash, by design
    probe core owners --env "OUTDIR=$OUTDIR" -- bash -c 'cd "$OUTDIR" && ruby "$1" CODEOWNERS < git/files' _ "$HERE/codeowners.rb"
    if [ "$(status_of core/owners)" = RAN ]; then
        jq --arg ref "$BASE" --arg loc "$CO_LOC" '. + {ref: $ref, location: $loc}' "$OUTDIR/probes/core/owners.out" > "$OUTDIR/owners.json"
    fi
else
    rm -f "$OUTDIR/CODEOWNERS"
    # shellcheck disable=SC2016  # $BASE expands inside the probe's bash, by design
    probe core owners --env "BASE=$BASE" -- bash -c 'echo "no CODEOWNERS file at $BASE" >&2; exit 127'
fi

# ---- packs ----------------------------------------------------------------
PACK_FILES=("$SKILL_DIR/packs.yaml")
HUD="${HUD_ROOT:-$HOME/hud}"
[ -f "$HUD/review-packs.yaml" ] && PACK_FILES+=("$HUD/review-packs.yaml")
# Repo-local packs come from the reviewer's trusted checkout at the BASE ref, never
# from the PR worktree: the PR author controls the worktree and probes run with
# the reviewer's credentials. A PR cannot add or change the packs that review it.
if git -C "$REPO_DIR" show "$BASE:.claude/review-packs.yaml" > "$OUTDIR/repo-review-packs.yaml" 2>/dev/null; then
    PACK_FILES+=("$OUTDIR/repo-review-packs.yaml")
else
    rm -f "$OUTDIR/repo-review-packs.yaml"
fi
ruby "$HERE/packs-match.rb" "${PACK_FILES[@]}" < "$OUTDIR/git/files" > "$OUTDIR/packs.json"

jq -c '.matched[]' "$OUTDIR/packs.json" | while read -r pack; do
    name="$(jq -r .name <<<"$pack")"
    needs=(); while read -r b; do [ -n "$b" ] && needs+=(--needs "$b"); done < <(jq -r '.needs[]?' <<<"$pack")
    # @json keeps a block-scalar command on one line; a pack may carry only a question
    jq -r '(.probes // {}) | to_entries[] | "\(.key)\t\(.value|@json)"' <<<"$pack" | while IFS=$'\t' read -r pname cmd; do
        cmd="$(jq -r . <<<"$cmd")"
        # stdin is the probe list; a command that read it would eat the next probe
        probe "$name" "$pname" "${needs[@]+"${needs[@]}"}" \
            --env "WORKTREE=$WT" --env "REPO_DIR=$REPO_DIR" --env "OUTDIR=$OUTDIR" \
            --env "FILES=$OUTDIR/git/files" --env "MODULES=$OUTDIR/git/modules" \
            --env "BASE=$BASE" --env "HEAD=$HEAD" --env "PR=$PR" --env "REPO=$REPO" \
            -- bash -c "$cmd" < /dev/null
    done
done

# manifest hash: the replay check compares this across runs, so timestamps
# are left out and keys are sorted
jq -S 'del(.probes[].started, .probes[].ended)' "$MANIFEST" | shasum -a 256 | cut -d' ' -f1 > "$OUTDIR/manifest.sha256"
note "evidence written to $OUTDIR ($(jq '.probes|length' "$MANIFEST") probes; $(jq '[.probes[]|select(.status=="UNAVAILABLE")]|length' "$MANIFEST") unavailable)"
