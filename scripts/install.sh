#!/usr/bin/env bash
# install.sh — symlink this repo's agents, skills, and commands into place.
#
# Idempotent. Reports stale symlinks (point to a missing path) and skipped
# entries (different target already in place).
#
# Three destinations, because the three things are used differently:
#   agents/     → ~/.claude/agents     (read by Claude Code)
#   skills/     → ~/.claude/skills     (read by Claude Code)
#   scripts/*   → a directory on PATH  (RUN by a skill, from any repo)
#
# The third exists because a skill body that says `bash scripts/pr-context.sh`
# resolves that relative path against whatever repo the skill is running in —
# which is never this one. The script was therefore absent in the common case
# and the step silently degraded. Putting the commands on PATH is what makes
# the documented invocation true from anywhere.
#
# Usage:
#   scripts/install.sh           # dry-run, report what would change
#   scripts/install.sh --apply   # actually create/replace symlinks
#   scripts/install.sh --doctor  # report stale symlinks only, no changes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_SRC="$REPO_ROOT/agents"
SKILLS_SRC="$REPO_ROOT/skills"
AGENTS_DST="$HOME/.claude/agents"
SKILLS_DST="$HOME/.claude/skills"

# Where the runnable commands go. Same resolution order the HUD's `link` verb
# uses: an explicit override, else $XDG_BIN_HOME, else ~/.local/bin — which is
# convention rather than spec, so nothing here invents an XDG variable for it.
BIN_DST="${AGENTS_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"

# Explicit allowlist, not `scripts/*.sh`. These are the scripts a SKILL invokes
# by name; build.sh and install.sh are this repo's own machinery and have no
# business in a user's PATH. Adding a name here is a deliberate act.
BIN_SCRIPTS="pr-context.sh pr-suggest.sh which-applies.sh"

mode="dry-run"
case "${1:-}" in
    --apply)  mode="apply" ;;
    --doctor) mode="doctor" ;;
    "")       mode="dry-run" ;;
    *)        echo "Usage: $0 [--apply|--doctor]"; exit 2 ;;
esac

mkdir -p "$AGENTS_DST" "$SKILLS_DST" "$BIN_DST"

count_link=0 count_skip=0 count_stale=0

link_one() {
    local src="$1" dst="$2"
    local name
    name="$(basename "$src")"

    # Resolve symlink chains so a target reached via two different paths that
    # symlink to the same real directory doesn't read as drift.
    local src_real
    src_real="$(cd "$(dirname "$src")" 2>/dev/null && pwd -P)/$(basename "$src")"

    if [ -L "$dst" ]; then
        local current current_real
        current="$(readlink "$dst")"
        current_real="$(cd "$(dirname "$dst")" 2>/dev/null && cd "$(dirname "$current")" 2>/dev/null && pwd -P)/$(basename "$current")"
        if [ "$current" = "$src" ] || [ "$current_real" = "$src_real" ]; then
            return 0   # already correct (literal match or same real path)
        fi
        if [ ! -e "$dst" ]; then
            echo "  🪦 stale: $dst -> $current (target does not exist)"
            count_stale=$((count_stale+1))
            if [ "$mode" = "apply" ]; then
                rm "$dst" && ln -s "$src" "$dst"
                echo "     ↪ replaced with $src"
            fi
            return 0
        fi
        echo "  ⏭  skip:  $dst already points to $current"
        count_skip=$((count_skip+1))
        return 0
    fi

    if [ -e "$dst" ]; then
        echo "  ⏭  skip:  $dst exists as a regular file/dir (not a symlink)"
        count_skip=$((count_skip+1))
        return 0
    fi

    echo "  + link: $dst -> $src"
    count_link=$((count_link+1))
    if [ "$mode" = "apply" ]; then
        ln -s "$src" "$dst"
    fi
}

echo "Agents → $AGENTS_DST"
for f in "$AGENTS_SRC"/*.md; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "TODO.md" ] && continue
    link_one "$f" "$AGENTS_DST/$(basename "$f")"
done

echo ""
echo "Skills → $SKILLS_DST"
for d in "$SKILLS_SRC"/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    link_one "${d%/}" "$SKILLS_DST/$name"
done

echo ""
echo "Commands → $BIN_DST"
for name in $BIN_SCRIPTS; do
    [ -f "$SCRIPT_DIR/$name" ] || { echo "  ⚠️  missing: scripts/$name"; continue; }
    link_one "$SCRIPT_DIR/$name" "$BIN_DST/$name"
done

# A link into a directory PATH does not search is a link that does nothing, and
# the failure it produces later ("command not found" inside a skill) points
# nowhere near here. Say it now. This is a warning, not a failure: the link is
# correct, the shell just cannot see it yet.
case ":${PATH}:" in
    *":$BIN_DST:"*) ;;
    *) echo "  ⚠️  $BIN_DST is not on your PATH — add it, or set AGENTS_BIN_DIR to a directory that is." ;;
esac

echo ""
echo "Doctor: scanning for broken symlinks…"
for dst in "$AGENTS_DST" "$SKILLS_DST"; do
    for l in "$dst"/*; do
        [ -L "$l" ] || continue
        if [ ! -e "$l" ]; then
            target="$(readlink "$l")"
            echo "  🪦 broken: $l -> $target"
            count_stale=$((count_stale+1))
            if [ "$mode" = "apply" ]; then
                rm "$l"
                echo "     ↪ removed"
            fi
        fi
    done
done

# $BIN_DST is swept by NAME, not by globbing the directory. ~/.claude/agents and
# ~/.claude/skills belong to this installer; ~/.local/bin belongs to the user and
# to every other tool that links into it. Sweeping it wholesale would delete some
# other tool's broken link as a side effect of running our doctor.
for name in $BIN_SCRIPTS; do
    l="$BIN_DST/$name"
    [ -L "$l" ] || continue
    if [ ! -e "$l" ]; then
        target="$(readlink "$l")"
        echo "  🪦 broken: $l -> $target"
        count_stale=$((count_stale+1))
        if [ "$mode" = "apply" ]; then
            rm "$l"
            echo "     ↪ removed"
        fi
    fi
done

echo ""
case "$mode" in
    dry-run) echo "Plan: $count_link to link, $count_skip to skip, $count_stale stale. Re-run with --apply to execute." ;;
    apply)   echo "Done: $count_link linked, $count_skip skipped, $count_stale stale handled." ;;
    doctor)  echo "Report: $count_stale stale symlink(s). $count_link target(s) would be linked. $count_skip already-present file(s)." ;;
esac
