#!/usr/bin/env bash
# review-evidence.sh — phase 1 of /review. Bash, no model. Produces the
# evidence directory every later phase reads, and nothing else.
#
# Usage:
#   review-evidence.sh --pr <owner/repo#N | N> [--repo-dir DIR] [--core-only] [--since SHA] --out RUN
#   review-evidence.sh --path REPO_DIR --base REF --head REF --out RUN
#   review-evidence.sh --cleanup RUN
#
# --core-only stops after the target, PR context, checks and git facts: no
# worktree, no owners, no packs. It is the phase-7 recheck, which compares
# head, checks and activity and has no use for a checkout or a second round of
# builds and tests. (It used to check the PR out again, after phase 6's
# cleanup had removed the worktree, and nothing removed it a second time.)
#
# --since SHA is the head an earlier review of this PR saw (a re-review under
# --engage). core/since-last-review then lists the commits from SHA to the
# head and the files they changed, which is what says whether a prior
# finding was fixed in code or only answered in a thread.
#
# --cleanup RUN removes RUN's worktree and that of RUN/recheck, if any.
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

# is_worktree_of <repo> <dir>: <dir> is registered as one of <repo>'s worktrees
is_worktree_of() {
    local want; want="$(cd -P "$2" && pwd -P)"
    git -C "$1" worktree list --porcelain | while read -r k p; do
        [ "$k" = worktree ] && [ -d "$p" ] && [ "$(cd -P "$p" && pwd -P)" = "$want" ] && { echo yes; break; }
    done | grep -q yes
}

status_of()   { jq -r --arg n "$1" '.probes[]|select(.name==$n)|.status' "$MANIFEST"; }
require_ran() { [ "$(status_of "$1")" = RAN ] || die "probe $1 is $(status_of "$1"), cannot continue; see $MANIFEST"; }

remove_worktree() {  # <run>: remove the worktree that run created, if it owns one
    local run="$1" ev="$1/evidence" kind wt="" rd=""
    # Only a PR run owns its worktree. In path mode the "worktree" is the
    # user's own repo dir, which must never be removed.
    kind="$(jq -r '.kind // ""' "$ev/target.json" 2>/dev/null || true)"
    [ -f "$ev/git/worktree-path" ] && wt="$(cat "$ev/git/worktree-path")"
    [ -f "$ev/git/repo-dir" ] && rd="$(cat "$ev/git/repo-dir")"
    if [ "$kind" = pr ] && [ -n "$wt" ] && [ "$wt" != "$rd" ] && [ -d "$wt" ]; then
        git -C "$rd" worktree remove --force "$wt" || die "could not remove worktree $wt"
        note "removed worktree $wt"
    else
        note "no worktree to remove for $run (kind=${kind:-?}, worktree=${wt:-none})"
    fi
    # refs/review/<N> is left in place: the next run's fetch force-updates it,
    # so keeping it costs nothing, and deleting it only made the ref's
    # existence depend on which run cleaned up last.
}

cleanup() {
    remove_worktree "$1"
    # a recheck run from before --core-only stopped checking the PR out
    # recreated the worktree after the main run's cleanup
    [ -d "$1/recheck/evidence" ] && remove_worktree "$1/recheck"
    exit 0
}

MODE="" PR="" REPO="" REPO_DIR="" BASE="" BASE_LABEL="" HEAD="" RUN="" CORE_ONLY="" SINCE=""
ARGS=("$@")
while [ $# -gt 0 ]; do
    case "$1" in
        --pr)       MODE="pr";   PR="$2"; shift 2 ;;
        --core-only) CORE_ONLY=1; shift ;;
        --since)    SINCE="$2"; shift 2 ;;
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
# work/decisions, claims, refute exist before any reader runs: a reader that
# has to mkdir its own output dir is one more thing it can get wrong.
mkdir -p "$OUTDIR/pr" "$OUTDIR/git" "$OUTDIR/probes" "$RUN/work"/{decisions,claims,refute}
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
        # `+`: a force-pushed PR head is not a fast-forward of the one an
        # earlier run parked under refs/review/<N>, and without it the re-run
        # is refused.
        #
        # The base is fetched into this PR's own ref, refs/review-base/<N>,
        # never into the shared remote-tracking ref (the helper passes
        # --refmap= so git's opportunistic update of <remote>/<branch> is off).
        # Reviews of several PRs run at once against one clone; with a shared
        # base ref they contended for its lock, and a run's later probes read
        # whatever base the last fetch left there rather than the one its
        # merge-base was computed against.
        #
        # Retried only on a busy ref lock: reviews running at once against one
        # clone can still meet on a lock (packed-refs). The helper's path travels by --env, so the recorded
        # command (and the manifest hash) does not depend on the install path.
        # shellcheck disable=SC2016  # $FETCH_RETRY expands inside the probe's bash, by design
        probe core fetch --env "FETCH_RETRY=$HERE/git-fetch-retry.sh" -- bash -c '"$FETCH_RETRY" "$@"' _ \
            "$REPO_DIR" "$REMOTE" "+refs/pull/$PR/head:refs/review/$PR" "+refs/heads/$BASE_BRANCH:refs/review-base/$PR"
        require_ran core/fetch
        BASE="refs/review-base/$PR" BASE_LABEL="$REMOTE/$BASE_BRANCH"
        TMP="${TMPDIR:-/tmp}"; WT="${REVIEW_WORKTREE_ROOT:-${TMP%/}/review-worktrees}/${REPO//\//-}-$PR"
        if [ -n "$CORE_ONLY" ]; then
            WT=""
        else
            # Re-runs must work whatever an earlier run left: prune forgets a
            # registered worktree whose directory is gone (`add` would refuse
            # the path), and a directory that is a dead worktree (its .git file
            # points at metadata that no longer exists) is removed. Anything
            # else at that path is not ours and stops the run.
            git -C "$REPO_DIR" worktree prune
            if [ -d "$WT" ] && ! is_worktree_of "$REPO_DIR" "$WT"; then
                if [ -f "$WT/.git" ] || [ -z "$(ls -A "$WT")" ]; then
                    rm -rf "$WT"; note "removed dead worktree dir $WT"
                else
                    die "$WT exists and is not a worktree of $REPO_DIR; refusing to touch it"
                fi
            fi
            if [ ! -d "$WT" ]; then
                probe core worktree -- git -C "$REPO_DIR" worktree add -q --detach "$WT" "$HEAD"
            else
                # a worktree left by an earlier run may sit on an older push;
                # re-point it, discarding anything a probe wrote into it
                probe core worktree -- git -C "$WT" checkout -q -f --detach "$HEAD"
            fi
        fi
        if [ -z "$CORE_ONLY" ]; then
            require_ran core/worktree
            echo "$WT" > "$OUTDIR/git/worktree-path"
        fi
    else
        die "cannot resolve PR $REPO#$PR without gh; see manifest"
    fi
    probe core pr-context --needs gh -- "$PR_CONTEXT" --pr "$REPO#$PR" --similar 3
    if [ "$(status_of core/pr-context)" = RAN ]; then cp "$OUTDIR/probes/core/pr-context.out" "$OUTDIR/pr/context.json"; fi
    probe core pr-checks  --needs gh -- gh pr checks "$PR" --repo "$REPO" --json name,state,link,workflow
else
    [ -n "$BASE" ] && [ -n "$HEAD" ] || die "--path needs --base and --head"
    BASE_LABEL="$BASE"
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
# `base` is the name a person reads (upstream/main); `base_ref` is what every
# git command here uses, and `base_sha` where it pointed when the run began.
BASE_SHA="$(git -C "$REPO_DIR" rev-parse --verify -q "$BASE^{commit}" || true)"
jq -n --arg kind "$MODE" --arg repo "$REPO" --arg pr "$PR" --arg base "$BASE_LABEL" --arg base_ref "$BASE" --arg base_sha "$BASE_SHA" \
      --arg head "$HEAD" --arg worktree "$WT" --arg repo_dir "$REPO_DIR" \
   '{kind:$kind, repo:$repo, pr:$pr, base:$base, base_ref:$base_ref, base_sha:$base_sha, head:$head, worktree:$worktree, repo_dir:$repo_dir}' > "$OUTDIR/target.json"

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
if [ -n "$SINCE" ]; then
    # A force-push can leave the earlier head unreachable; it is still in the
    # clone until gc prunes it, and when it is gone the probe says so.
    # shellcheck disable=SC2016  # the variables expand inside the probe's bash, by design
    probe core since-last-review --env "REPO_DIR=$REPO_DIR" --env "SINCE=$SINCE" --env "HEAD=$HEAD" -- bash -c '
        git -C "$REPO_DIR" cat-file -e "$SINCE^{commit}" 2>/dev/null || { echo "earlier head $SINCE is not in the clone (force-pushed and pruned?)" >&2; exit 127; }
        if [ "$(git -C "$REPO_DIR" rev-parse "$SINCE^{commit}")" = "$(git -C "$REPO_DIR" rev-parse "$HEAD^{commit}")" ]; then echo "none: the head has not moved since the last review"; exit 0; fi
        if git -C "$REPO_DIR" merge-base --is-ancestor "$SINCE" "$HEAD"; then echo "## commits since the last review ($SINCE..$HEAD)"; git -C "$REPO_DIR" log --format="%h %cI %s" "$SINCE..$HEAD"
        else echo "## history rewritten: $SINCE is not an ancestor of $HEAD (force-push); diff below is head against the earlier head"; fi
        echo; echo "## files changed since the last review"; git -C "$REPO_DIR" diff --stat "$SINCE" "$HEAD"'
fi
# Base commits since the merge-base that touch a file this change touches. The
# staleness count says how far the base moved; this says whether it moved under
# the change, which is what a merge-ref CI run or a rebase will meet.
# shellcheck disable=SC2016  # the variables expand inside the probe's bash, by design
probe core base-drift --env "REPO_DIR=$REPO_DIR" --env "MB=$MB" --env "BASE=$BASE" --env "FILES=$OUTDIR/git/files" -- bash -c \
    'n="$(git -C "$REPO_DIR" rev-list --count "$MB..$BASE")"; out="$(xargs git -C "$REPO_DIR" log --format="%h %cI %s" "$MB..$BASE" -- < "$FILES")"; if [ -n "$out" ]; then echo "$out"; else echo "none: $n base commit(s) since the merge-base, none touch a changed file"; fi'
if [ -n "$CORE_ONLY" ]; then
    jq -S 'del(.probes[].started, .probes[].ended)' "$MANIFEST" | shasum -a 256 | cut -d' ' -f1 > "$OUTDIR/manifest.sha256"
    note "core evidence written to $OUTDIR ($(jq '.probes|length' "$MANIFEST") probes; worktree, modules, owners and packs skipped)"
    exit 0
fi

# ---- sibling PRs ----------------------------------------------------------
# The author's other open PRs that touch a file this one touches. Two PRs by
# one author editing the same lines is where a stack or a parallel branch
# goes inconsistent (one assumes the other's state, or both change a value
# two ways), and neither PR's own review sees it. Each overlapping sibling's
# diff, cut to the shared files, is kept so a reader can settle the question
# without a fetch. At most five siblings.
if [ "$MODE" = pr ]; then
    AUTHOR="$(jq -r '.data.repository.pullRequest.author.login // empty' "$OUTDIR/probes/core/pr-shas.out" 2>/dev/null || true)"
    # shellcheck disable=SC2016  # the variables expand inside the probe's bash, by design
    probe core sibling-prs --needs gh --env "REPO=$REPO" --env "PR=$PR" --env "AUTHOR=$AUTHOR" --env "FILES=$OUTDIR/git/files" -- bash -c '
        [ -n "$AUTHOR" ] || { echo "PR author unknown (core/pr-shas)" >&2; exit 127; }
        list="$(gh pr list --repo "$REPO" --author "$AUTHOR" --state open --limit 50 --json number,title,headRefOid,baseRefName,files)" || exit 1
        mine="$(jq -R -s "split(\"\n\") | map(select(length > 0))" < "$FILES")"
        sib="$(jq --argjson mine "$mine" --argjson pr "$PR" -c "[.[] | select(.number != \$pr)
            | {number, title, head: .headRefOid, base: .baseRefName, shared: ([.files[]?.path] - ([.files[]?.path] - \$mine))}
            | select(.shared | length > 0)] | .[:5]" <<<"$list")"
        n="$(jq length <<<"$sib")"
        if [ "$n" = 0 ]; then echo "none: no other open PR by $AUTHOR touches a file this PR touches"; exit 0; fi
        jq -c ".[]" <<<"$sib" | while read -r s; do
            m="$(jq -r .number <<<"$s")"
            echo "## #$m $(jq -r .title <<<"$s") (head $(jq -r .head <<<"$s" | cut -c1-12), base $(jq -r .base <<<"$s"))"
            echo "shared: $(jq -r ".shared | join(\", \")" <<<"$s")"
            gh pr diff "$m" --repo "$REPO" | awk -v files="$(jq -r ".shared | join(\"\n\")" <<<"$s")" "
                BEGIN { n = split(files, f, \"\n\"); for (i = 1; i <= n; i++) want[\"a/\" f[i]] = 1 }
                /^diff --git / { keep = (\$3 in want) }
                keep" || echo "(diff unavailable)"
            echo
        done'
fi

# Nearest go.mod above each changed file, deduped: the unit `go build` works
# in. git/go-packages pairs each module with the package dirs (relative to it)
# holding a changed .go file that still exists, so a test or lint probe can
# scope to what changed instead of the whole module.
gp="$OUTDIR/git/go-packages"; : > "$gp.unsorted"
while read -r f; do
    d="$(dirname "$f")"
    m="$d"
    while [ "$m" != "." ] && [ ! -f "$WT/$m/go.mod" ]; do m="$(dirname "$m")"; done
    # an if, not `&&`: a bare test as the loop's last command would make the
    # pipeline fail under pipefail when the last file is outside any module
    if [ -f "$WT/$m/go.mod" ]; then
        echo "$m"
        if [[ "$f" == *.go ]] && [ -e "$WT/$f" ]; then
            if [ "$d" = "$m" ]; then rel=.; elif [ "$m" = . ]; then rel="./$d"; else rel="./${d#"$m"/}"; fi
            echo "$m $rel" >> "$gp.unsorted"
        fi
    fi
done < "$OUTDIR/git/files" | sort -u > "$OUTDIR/git/modules"
sort -u "$gp.unsorted" > "$gp"; rm -f "$gp.unsorted"

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
        jq --arg ref "$BASE_LABEL" --arg sha "$BASE_SHA" --arg loc "$CO_LOC" '. + {ref: $ref, ref_sha: $sha, location: $loc}' "$OUTDIR/probes/core/owners.out" > "$OUTDIR/owners.json"
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
    # a pack may raise (or lower) the per-probe time limit: `timeout: <seconds>`
    ptimeout=(); pt="$(jq -r '.timeout // empty' <<<"$pack")"; [ -n "$pt" ] && ptimeout=(--timeout "$pt")
    # @json keeps a block-scalar command on one line; a pack may carry only a question
    jq -r '(.probes // {}) | to_entries[] | "\(.key)\t\(.value|@json)"' <<<"$pack" | while IFS=$'\t' read -r pname cmd; do
        cmd="$(jq -r . <<<"$cmd")"
        # stdin is the probe list; a command that read it would eat the next probe
        probe "$name" "$pname" "${needs[@]+"${needs[@]}"}" "${ptimeout[@]+"${ptimeout[@]}"}" \
            --env "WORKTREE=$WT" --env "REPO_DIR=$REPO_DIR" --env "OUTDIR=$OUTDIR" \
            --env "FILES=$OUTDIR/git/files" --env "MODULES=$OUTDIR/git/modules" \
            --env "GO_PACKAGES=$OUTDIR/git/go-packages" --env "MERGE_BASE=$MB" \
            --env "BASE=$BASE" --env "HEAD=$HEAD" --env "PR=$PR" --env "REPO=$REPO" \
            --env "SKILL_DIR=$SKILL_DIR" \
            -- bash -c "$cmd" < /dev/null
    done
done

# manifest hash: the replay check compares this across runs, so timestamps
# are left out and keys are sorted
jq -S 'del(.probes[].started, .probes[].ended)' "$MANIFEST" | shasum -a 256 | cut -d' ' -f1 > "$OUTDIR/manifest.sha256"
note "evidence written to $OUTDIR ($(jq '.probes|length' "$MANIFEST") probes; $(jq '[.probes[]|select(.status=="UNAVAILABLE")]|length' "$MANIFEST") unavailable)"
