#!/usr/bin/env bash
# refresh.sh — regenerate data/board.json from your live PRs, across two roles.
#
# Pulls three slices and folds each into the board:
#   • authored (role=author)         — your PRs; waiting_on = you, unless still
#                                       awaiting a reviewer (then "others").
#   • review-requested (role=reviewer)— PRs asking for YOUR review → needs_you.
#   • reviewed-by you  (role=reviewer)— PRs you've reviewed, still open →
#                                       monitoring (waiting_on = others).
#
# State ∈ opened|active|needs_you. waiting_on ∈ me|others. last_activity from
# updatedAt so the dial's staleness axis is real. Writes only data/board.json;
# pushes nothing.
#
# Usage: scripts/refresh.sh [OWNER/REPO]   (or export WORKBOARD_REPO=owner/repo)
# Requires: authenticated gh, jq.

set -euo pipefail
REPO="${1:-${WORKBOARD_REPO:-}}"
if [ -z "$REPO" ]; then
  echo "usage: scripts/refresh.sh OWNER/REPO   (or export WORKBOARD_REPO=owner/repo)" >&2
  exit 2
fi
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$DIR/data/board.json"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
since="$(date -u -v-3d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '3 days ago' +%Y-%m-%dT%H:%M:%SZ)"
FULL='number,title,url,reviewDecision,isDraft,updatedAt,mergeable,statusCheckRollup,author'
LEAN='number,title,url,isDraft,updatedAt,author'   # reviewer slices: state is fixed → skip the pricey statusCheckRollup

# resilient fetch → writes tagged JSON to $2 using field-set $3; retries once, falls back to [].
fetch(){ local tag="$1" outf="$2" flds="$3"; shift 3; local out
  for i in 1 2; do
    if out="$(gh pr list --repo "$REPO" --state open --limit 50 --json "$flds" "$@" 2>/dev/null)"; then
      printf '%s' "$out" | jq -c --arg r "$tag" 'map(.+{__r:$r})' > "$outf"; return 0
    fi
    sleep 1
  done
  echo >&2 "  warn: '$tag' slice failed after retries (transient API error) — skipping"
  echo '[]' > "$outf"
}
# run the three slices concurrently — wall-clock = slowest single query, not the sum
tA="$(mktemp)"; tB="$(mktemp)"; tC="$(mktemp)"
fetch author "$tA" "$FULL" --author "@me"                  &
fetch req    "$tB" "$LEAN" --search "user-review-requested:@me" &  # direct asks only, not team/CODEOWNERS fan-out
fetch done   "$tC" "$LEAN" --search "reviewed-by:@me"      &
wait
qA="$(cat "$tA")"; qB="$(cat "$tB")"; qC="$(cat "$tC")"; rm -f "$tA" "$tB" "$tC"

jq -n --argjson a "$qA" --argjson b "$qB" --argjson c "$qC" \
      --arg now "$now" --arg since "$since" --arg repo "$REPO" '
  def failing: [ (.statusCheckRollup // [])[]
     | select((.conclusion=="FAILURE") or (.state=="FAILURE") or (.state=="ERROR")) ] | length;
  def norm:
    . as $p | (failing) as $f | ($p.__r) as $r
    | ( if   $r=="author" then
             ( if $p.isDraft then "opened"
               elif ($p.reviewDecision=="APPROVED") or ($p.reviewDecision=="CHANGES_REQUESTED") then "needs_you"
               else "active" end )
        elif $r=="req"  then "needs_you"
        else "active" end ) as $state
    | ( if   $r=="author" then (if $state=="active" then "others" else "me" end)
        elif $r=="req"    then "me"
        else "others" end ) as $wait
    | ( ($r=="author") and ($p.reviewDecision=="APPROVED") and ($f==0) and ($p.mergeable=="MERGEABLE") ) as $ready
    | {
        kind:"pr", artifact_uri:("pr:"+$repo+"#"+($p.number|tostring)),
        repo:$repo, number:$p.number, title:$p.title, url:$p.url,
        state:$state, role:(if $r=="author" then "author" else "reviewer" end),
        waiting_on:$wait, is_draft:($p.isDraft // false),
        last_activity:$p.updatedAt, merge_ready:$ready,
        bot:( ($p.author.is_bot // false)
              or (($p.author.login // "") | test("\\[bot\\]$|^dependabot|^renovate|^mend";"i"))
              or ($p.title | test("^(chore|build|fix)\\(deps|^bump |^update .* (to|from) ";"i")) ),
        reason:( if   $p.isDraft then "draft"
                 elif $r=="req"  then "your review requested"
                 elif $r=="done" then "you reviewed · monitoring"
                 elif $ready then "approved · clean · merge it"
                 elif $state=="needs_you" and $p.reviewDecision=="APPROVED" and $f>0 then ("approved but "+($f|tostring)+" check(s) failing")
                 elif $p.reviewDecision=="CHANGES_REQUESTED" then "changes requested"
                 else "in review" end )
      };
  { generated_at:$now, tick_status:"live", window:{since:$since, until:$now},
    items: ( ($a + $c + $b) | map(norm)
             | reduce .[] as $x ({seen:{},out:[]};
                 if .seen[$x.url] then . else {seen:(.seen+{($x.url):true}), out:(.out+[$x])} end).out ) }
' > "$OUT"

echo "wrote $OUT — $(jq '.items|length' "$OUT") items ($(jq '[.items[]|select(.role=="author")]|length' "$OUT") mine, $(jq '[.items[]|select(.role=="reviewer")]|length' "$OUT") reviewing · $(jq '[.items[]|select(.waiting_on=="me")]|length' "$OUT") need you)"
