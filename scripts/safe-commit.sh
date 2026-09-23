#!/usr/bin/env bash
# safe-commit.sh — commit without the pre-commit stash eating uncommitted work.
#
# THE HAZARD, observed twice in one session.
#
# `.beads/beads.jsonl` is a tracked, shared artifact (see `.beads/.gitignore`,
# which un-ignores it deliberately), and the rsry pre-commit hook REWRITES it
# on every commit by exporting the bead database. Meanwhile the pre-commit
# framework stashes unstaged changes before running hooks and restores them
# afterwards. Put those together and the failure is silent and expensive:
#
#   1. beads.jsonl has unstaged changes (any bead created since the last
#      commit does this), so it goes into the stash along with your real work.
#   2. The rsry hook rewrites beads.jsonl on disk.
#   3. The restore cannot apply — the file it is patching has moved underneath
#      it — so pre-commit rolls back, and EVERY file in that stash loses its
#      changes, not just beads.jsonl.
#   4. The commit fails. The tree looks like the work was never done.
#
# It cost a full refactor once. The changes are recoverable from the patch
# pre-commit leaves in ~/.cache/pre-commit/, but only if you notice — and the
# tell is subtle: modified files quietly vanish from `git status`.
#
# THE FIX. A file that is already staged is not stashed, so the hook is free
# to rewrite it and the restore has nothing to collide with. Staging
# beads.jsonl first is sufficient; this script does that and nothing else
# clever, then hands every argument through to `git commit` untouched.
#
# The real fix belongs upstream — the hook should stage the artifact it
# generates — which is why this is a guard rather than a workaround pretending
# to be a solution.
#
#   scripts/safe-commit.sh -m "message"
#   scripts/safe-commit.sh -F - <<'MSG' ... MSG
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BEADS=".beads/beads.jsonl"

# Only act when the file is tracked AND has unstaged changes. Anything else is
# already safe, and saying so beats staging things nobody asked to stage.
if git ls-files --error-unmatch "$BEADS" >/dev/null 2>&1; then
    if ! git diff --quiet -- "$BEADS"; then
        # -f is required, and the reason is worth knowing: a global gitignore
        # (`~/.gitignore_global`) excludes the whole `.beads/` DIRECTORY, which
        # is sensible for every other repo since bead databases are local
        # runtime state. This repo's `.beads/.gitignore` tries to bring the one
        # shared artifact back with `!beads.jsonl`, but that cannot work — git
        # does not descend into an excluded directory, so a negation inside it
        # is never consulted. The file is tracked, so it commits and shows up
        # in `git status`, yet `git add <path>` on it refuses without -f.
        git add -f -- "$BEADS"
        printf 'safe-commit: staged %s so the pre-commit stash cannot drop it.\n' "$BEADS" >&2
    fi
fi

# Warn about the residual risk rather than pretending it is gone: any OTHER
# tracked file that a hook rewrites while unstaged can hit the same path.
if ! git diff --quiet; then
    printf 'safe-commit: note — unstaged changes remain in:\n' >&2
    git diff --name-only | sed 's/^/  /' >&2
    printf 'safe-commit: these are stashed during hooks. If a hook rewrites one,\n' >&2
    printf '             the restore can fail. Stage them too if a commit misbehaves.\n' >&2
fi

exec git commit "$@"
