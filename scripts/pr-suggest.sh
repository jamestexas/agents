#!/usr/bin/env bash
# pr-suggest.sh — post a GitHub review comment as an applyable `suggestion`,
# with the mechanical gate enforced so an unappliable "Commit suggestion" button
# is impossible to post.
#
# It owns the MECHANICS only (anchor validation → payload → post → verify). The
# JUDGMENT — whether a finding *should* be a suggestion, the replacement text,
# and whether to APPROVE — stays with the human/skill (see skills/pr-suggestion).
#
# The anchor must be a RIGHT-side CHANGED line in the PR head diff; the script
# refuses (nonzero exit) if the target line is unchanged context, which is the
# single most common way a suggestion ends up broken.
#
# Dry-run by DEFAULT: it validates + prints the payload and posts nothing. Pass
# --post to actually submit.
#
# Usage:
#   scripts/pr-suggest.sh --pr <owner/repo#N|N> --file F --line L \
#       --replacement <file> [--start S] [--note <file>] \
#       [--repo owner/repo] [--event COMMENT|APPROVE|REQUEST_CHANGES] \
#       [--review-body <file>] [--post]
#
#   # Preview a one-line suggestion (posts nothing):
#   scripts/pr-suggest.sh --pr owner/repo#123 --file api/x.go --line 42 \
#       --replacement /tmp/fix.txt --note /tmp/why.md
#
#   # Actually post it as a COMMENT review:
#   ... --post
#
#   --line         RIGHT-side line the suggestion replaces (end line for a range)
#   --start        start line for a multi-line range (replaces START..LINE)
#   --replacement  file whose contents become the literal replacement text
#   --note         optional prose prepended above the suggestion block
#   --event        review event (default COMMENT; APPROVE is never inferred)
#   --review-body  optional top-level review body file
#   --dry-run      validate + print the payload, post nothing (the default)
#   --post         actually submit
#   --help

set -euo pipefail

# Print the contiguous comment header after the shebang. Deriving the range from
# the file itself keeps --help correct when the header grows or shrinks; a fixed
# `sed -n '2,Np'` silently starts printing code the moment the header moves.
usage() {
    awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
    exit "${1:-0}"
}

PR="" REPO="" FILE="" LINE="" START="" REPL="" NOTE="" EVENT="COMMENT" REVIEW_BODY="" POST=0
while [ $# -gt 0 ]; do
    case "$1" in
        --pr) PR="$2"; shift 2 ;;
        --repo) REPO="$2"; shift 2 ;;
        --file) FILE="$2"; shift 2 ;;
        --line) LINE="$2"; shift 2 ;;
        --start) START="$2"; shift 2 ;;
        --replacement) REPL="$2"; shift 2 ;;
        --note) NOTE="$2"; shift 2 ;;
        --event) EVENT="$2"; shift 2 ;;
        --review-body) REVIEW_BODY="$2"; shift 2 ;;
        --dry-run) POST=0; shift ;;
        --post) POST=1; shift ;;
        --help|-h) usage 0 ;;
        *) echo "unknown arg: $1" >&2; usage 1 ;;
    esac
done

die() { echo "pr-suggest: $*" >&2; exit 1; }
command -v gh >/dev/null || die "gh not found"
command -v jq >/dev/null || die "jq not found"
[ -n "$PR" ] || die "--pr is required"
[ -n "$FILE" ] || die "--file is required"
[ -n "$LINE" ] || die "--line is required"
[[ "$LINE" =~ ^[0-9]+$ ]] || die "--line must be a number, got '$LINE'"
[ -n "$REPL" ] || die "--replacement <file> is required"
[ -f "$REPL" ] || die "replacement file not found: $REPL"
[ -z "$NOTE" ] || [ -f "$NOTE" ] || die "note file not found: $NOTE"
[ -z "$REVIEW_BODY" ] || [ -f "$REVIEW_BODY" ] || die "review body file not found: $REVIEW_BODY"
case "$EVENT" in COMMENT|APPROVE|REQUEST_CHANGES) ;; *) die "invalid --event: $EVENT" ;; esac

# Resolve owner/repo + number from --pr ("owner/repo#N" or "N" with --repo/default).
if [[ "$PR" == *"#"* ]]; then
    REPO="${PR%%#*}"; N="${PR##*#}"
else
    N="$PR"
fi
if [ -z "$REPO" ]; then
    REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" || die "cannot resolve repo; pass --repo or owner/repo#N"
fi
[[ "$N" =~ ^[0-9]+$ ]] || die "could not parse PR number from --pr '$PR'"

# Collect the RIGHT-side CHANGED line numbers for FILE from the PR head diff.
changed="$(gh pr diff "$N" --repo "$REPO" --patch 2>/dev/null | awk -v want="$FILE" '
    /^diff --git/ { f=$3; sub(/^a\//,"",f); infile=(f==want); next }
    !infile { next }
    /^@@/ { match($0,/\+[0-9]+/); rl=substr($0,RSTART+1,RLENGTH-1)+0; next }
    /^\+\+\+/ { next }
    /^\+/ { print rl; rl++; next }
    /^-/  { next }
    /^ /  { rl++; next }
')" || die "gh pr diff failed for $REPO#$N"

[ -n "$changed" ] || die "file '$FILE' has no changed (RIGHT-side) lines in $REPO#$N — not suggestable here"

in_diff() { grep -qxF "$1" <<<"$changed"; }
in_diff "$LINE" || die "line $LINE of '$FILE' is not a changed line in the diff (likely unchanged context) — a suggestion there cannot be applied. Pick a RIGHT-side changed line."
if [ -n "$START" ]; then
    [[ "$START" =~ ^[0-9]+$ ]] || die "--start must be a number"
    [ "$START" -le "$LINE" ] || die "--start ($START) must be <= --line ($LINE)"
    in_diff "$START" || die "start line $START is not a changed line in the diff"
fi

# Build the comment body: optional note, then the suggestion fence.
BODY_FILE="$(mktemp)"; trap 'rm -f "$BODY_FILE"' EXIT
{
    if [ -n "$NOTE" ]; then printf '%s\n\n' "$(cat "$NOTE")"; fi
    printf '```suggestion\n'
    cat "$REPL"
    # Close the fence on its own line whether or not the replacement file ends
    # in a newline. Written as an `if` rather than `test && printf` so a
    # newline-terminated file (the common case) cannot leave a nonzero status
    # behind for `set -e` to trip over.
    if [ -n "$(tail -c1 "$REPL")" ]; then printf '\n'; fi
    printf '```\n'
} > "$BODY_FILE"

# Assemble the review payload.
comment="$(jq -n --arg path "$FILE" --argjson line "$LINE" --rawfile body "$BODY_FILE" \
    '{path:$path, line:($line|tonumber), side:"RIGHT", body:$body}')"
if [ -n "$START" ]; then
    comment="$(jq --argjson start "$START" '. + {start_line:($start|tonumber), start_side:"RIGHT"}' <<<"$comment")"
fi
payload="$(jq -n --arg event "$EVENT" --argjson c "$comment" \
    --rawfile rb "${REVIEW_BODY:-/dev/null}" \
    '{event:$event, comments:[$c]} + (if $rb=="" then {} else {body:$rb} end)')"

echo "pr-suggest: $REPO#$N  $FILE:${START:+$START-}$LINE  event=$EVENT" >&2
if [ "$POST" -ne 1 ]; then
    echo "--- DRY RUN (pass --post to submit) ---" >&2
    jq . <<<"$payload"
    exit 0
fi

echo "$payload" | gh api "repos/$REPO/pulls/$N/reviews" --input - >/dev/null \
    && echo "posted. verifying…" >&2
me="$(gh api user --jq .login)"
gh api "repos/$REPO/pulls/$N/comments" \
    --jq ".[] | select(.user.login==\"$me\" and .path==\"$FILE\" and .line==$LINE) | \"landed: \(.path):\(.line)  \(.html_url)\"" \
    | tail -1
