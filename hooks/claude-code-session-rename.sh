#!/usr/bin/env bash
# Suggest a Claude Code session name based on active beads.
#
# NOTE: as of CC 2.1.223, there is no CLI verb to rename an already-running
# session from an external process (`claude --help` has no `sessions`
# subcommand; `-n/--name` only sets the name at launch). So this does NOT
# call a rename API — it writes the suggested title to a state file that a
# statusline script can read and display, mirroring the pattern already
# proven by ~/.claude/statusline-rosary.sh (session-keyed cache under a TTL).
# If/when a real rename verb ships, swap the write below for that call.
#
# Wire into ~/.claude/settings.json:
#   "Notification": [{
#     "matcher": "*",
#     "hooks": [{
#       "type": "command",
#       "command": "bash ~/github/jamestexas/agents/hooks/claude-code-session-rename.sh"
#     }]
#   }]
#
# Caveat: the Notification hook fires when Claude Code notifies the user
# (permission prompts, idle nudges) — not on every tool completion. Treat
# the suggested name as "current as of the last notification," not live.

input=$(cat)
SID=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(printf '%s' "$input" | jq -r '.workspace.current_dir // empty' 2>/dev/null)
[ -n "$SID" ] || exit 0
[ -n "$CWD" ] || CWD=$PWD

XDG_BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
RSRY="${XDG_BIN_HOME}/rsry"
[ -x "$RSRY" ] || exit 0

STATE_DIR="${XDG_STATE_HOME}/claude-code/session-names"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# --- current repo ---
root=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
[ -n "$root" ] || exit 0

# --- pick a title: in-progress first, then ready, else no suggestion ---
in_progress=$("$RSRY" bead --repo "$root" list --status in_progress --json 2>/dev/null) || in_progress='{"beads":[]}'
title=$(printf '%s' "$in_progress" | jq -r '.beads[0].title // empty' 2>/dev/null)

if [ -z "$title" ]; then
    ready=$("$RSRY" bead --repo "$root" list --ready --json 2>/dev/null) || ready='{"beads":[]}'
    title=$(printf '%s' "$ready" | jq -r '.beads[0].title // empty' 2>/dev/null)
fi

[ -n "$title" ] || exit 0

# Truncate to ~50 chars for statusline readability.
title=$(printf '%.50s' "$title")
printf '%s' "$title" > "${STATE_DIR}/${SID}" 2>/dev/null || true
