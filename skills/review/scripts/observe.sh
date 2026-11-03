#!/usr/bin/env bash
# observe.sh <run> <id> [--cwd DIR] -- <cmd> [args...]
#
# Run one command at the commit under review and record what it did, so a
# reader's RAN claim points at an observation instead of a memory of one.
# Writes <run>/work/observe/<id>.out, .err and .json; the JSON holds the
# command, the directory it ran in (relative to the worktree), the commit it
# ran at, its exit status, and the sha256 of its stdout. A claim cites
# `work/observe/<id>.json` as its source; check.mjs refuses a RAN claim whose
# recording is missing.
#
# DIR defaults to the worktree named in <run>/evidence/target.json, and must
# be inside it. Ids are written once: reusing one is an error, so a recording
# is never silently replaced by a different run. Exits with the command's
# status (the recording is written either way).
set -uo pipefail
die() { echo "observe: $*" >&2; exit 2; }
[ $# -ge 3 ] || die "usage: observe.sh <run> <id> [--cwd DIR] -- <cmd> [args...]"
run="$1" id="$2"; shift 2
cwd=""
while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    case "$1" in
        --cwd) cwd="$2"; shift 2 ;;
        *) die "unknown option $1" ;;
    esac
done
[ "${1:-}" = "--" ] || die "missing -- before the command"
shift
[ $# -gt 0 ] || die "no command"
[[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || die "id must be letters, digits, '.', '_' or '-': $id"

target="$run/evidence/target.json"
[ -f "$target" ] || die "no $target"
wt="$(jq -r '.worktree // empty' "$target")"
at="$(jq -r '.head // empty' "$target")"
[ -d "$wt" ] || die "worktree $wt not found"
wt="$(cd "$wt" && pwd -P)"
cwd="${cwd:-$wt}"
cwd="$(cd "$cwd" 2>/dev/null && pwd -P)" || die "no such directory: $cwd"
case "$cwd/" in "$wt"/*) ;; *) die "--cwd must be inside the worktree ($wt)" ;; esac

dir="$run/work/observe"; mkdir -p "$dir"
rec="$dir/$id.json"
[ -e "$rec" ] && die "id $id already recorded at $rec; pick a new id"

started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
(cd "$cwd" && "$@") > "$dir/$id.out" 2> "$dir/$id.err"
status=$?
ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sum="$(shasum -a 256 < "$dir/$id.out" | cut -d' ' -f1)"
rel="${cwd#"$wt"}"; rel="${rel#/}"; rel="${rel:-.}"

# argv goes in NUL-separated, not as jq positional args: jq would read an
# argument like "-c" as one of its own options.
argv="$(printf '%s\0' "$@" | jq -Rs 'split("\u0000") | .[:-1]')"
jq -n --arg id "$id" --arg at "$at" --arg cwd "$rel" --arg started "$started" --arg ended "$ended" \
      --arg sum "$sum" --argjson exit "$status" --argjson cmd "$argv" '{id: $id, at: $at, cwd: $cwd, cmd: $cmd,
       exit: $exit, out_sha256: $sum, started: $started, ended: $ended}' > "$rec"
echo "observe: $id exit=$status → work/observe/$id.json" >&2
exit "$status"
