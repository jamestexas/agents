#!/usr/bin/env bash
# lib.sh — the probe runner behind review-evidence.sh.
#
# A probe is one command whose output becomes evidence. Every probe lands in
# the manifest with exactly one status, so a later reader can tell "we
# looked and found nothing" from "we could not look":
#   RAN          exit 0; stdout captured
#   FAILED       ran, non-zero exit; stderr kept, exit code recorded
#   UNAVAILABLE  a binary named in --needs is missing, or the command exited
#                127 (the convention probes use for "credential, server or
#                operator variable absent"); `reason` says which.
#                A probe still running after its time limit is killed (its
#                whole process group) and recorded UNAVAILABLE, exit 124,
#                reason "timeout: ...": the review could not look, which is
#                not the same as the change failing the probe.
# Nothing is skipped silently.
#
# The time limit is --timeout N on the probe, else REVIEW_PROBE_TIMEOUT, else
# 300 seconds. It exists so one hung probe (a network call that never
# returns) cannot eat the whole run's budget and take every later probe, and
# its manifest row, down with it.
#
# Globals the caller sets before using probe(): OUTDIR, MANIFEST.

note() { echo "review-evidence: $*" >&2; }
die()  { note "$*"; exit 1; }

manifest_init() {
    jq -n '{version: 1, probes: []}' > "$MANIFEST"
}

_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# sha256 of stdin as bare hex. macOS ships shasum, Linux coreutils sha256sum;
# either may be the only one present.
sha256_stdin() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1
}
_sha() { sha256_stdin < "$1"; }

_manifest_add() {  # name status file err sha reason exit cmd started ended
    local tmp; tmp="$(mktemp "$MANIFEST.XXXXXX")"
    jq --arg name "$1" --arg status "$2" --arg file "$3" --arg err "$4" --arg sha "$5" \
       --arg reason "$6" --argjson exit "${7:-null}" --arg cmd "$8" \
       --arg started "$9" --arg ended "${10}" \
       '.probes += [{name:$name, status:$status, file:$file, err:$err, sha256:$sha,
                     reason:$reason, exit:$exit, cmd:$cmd, started:$started, ended:$ended}]' \
       "$MANIFEST" > "$tmp" && mv "$tmp" "$MANIFEST"
}

# probe <pack> <name> [--needs bin ...] [--env K=V ...] [--timeout SECS] -- <cmd> [args...]
probe() {
    local pack="$1" name="$2"; shift 2
    local needs=() envs=() limit="${REVIEW_PROBE_TIMEOUT:-300}"
    while [ $# -gt 0 ] && [ "$1" != "--" ]; do
        case "$1" in
            --needs) needs+=("${2?--needs requires a binary name}"); shift 2 ;;
            --env)   envs+=("${2?--env requires K=V}");  shift 2 ;;
            --timeout) limit="${2?--timeout requires seconds}"; shift 2 ;;
            *) die "probe $pack/$name: unexpected arg $1" ;;
        esac
    done
    [ "${1:-}" = "--" ] && shift
    local full="$pack/$name" dir="$OUTDIR/probes/$pack"
    mkdir -p "$dir"
    local out="$dir/$name.out" err="$dir/$name.err"
    local relout="probes/$pack/$name.out" relerr="probes/$pack/$name.err"
    local cmdstr; cmdstr="$(printf '%q ' "$@")"
    local started; started="$(_now)"
    for b in "${needs[@]+"${needs[@]}"}"; do
        if ! command -v "$b" >/dev/null 2>&1; then
            : > "$out"; echo "missing binary: $b" > "$err"
            _manifest_add "$full" UNAVAILABLE "$relout" "$relerr" "$(_sha "$out")" \
                "missing binary: $b" null "$cmdstr" "$started" "$(_now)"
            note "UNAVAILABLE $full (missing $b)"
            return 0
        fi
    done
    [[ "$limit" =~ ^[1-9][0-9]*$ ]] || die "probe $full: timeout must be a positive integer, got '$limit'"
    local rc=0 flag
    flag="$(mktemp "${TMPDIR:-/tmp}/review-probe-timeout.XXXXXX")"; rm -f "$flag"
    # Job control puts the probe and the watchdog each in their own process
    # group, so a kill reaches the probe's children (go test, curl), not just
    # the subshell. Only these two launches run with it on.
    set -m
    ( for kv in "${envs[@]+"${envs[@]}"}"; do export "${kv?}"; done; "$@" ) >"$out" 2>"$err" &
    local pid=$!
    ( sleep "$limit"; : > "$flag"; kill -TERM -- "-$pid"; sleep 2; kill -KILL -- "-$pid" ) >/dev/null 2>&1 &
    local wd=$!
    set +m
    wait "$pid" || rc=$?
    kill -- "-$wd" 2>/dev/null || true
    wait "$wd" 2>/dev/null || true
    local reason; reason="$(head -c 400 "$err" | tr '\n' ' ')"
    if [ -e "$flag" ]; then
        rm -f "$flag"
        _manifest_add "$full" UNAVAILABLE "$relout" "$relerr" "$(_sha "$out")" \
            "timeout: killed after ${limit}s${reason:+; stderr: $reason}" 124 "$cmdstr" "$started" "$(_now)"
        note "UNAVAILABLE $full (timeout after ${limit}s)"
    elif [ $rc -eq 0 ]; then
        _manifest_add "$full" RAN "$relout" "$relerr" "$(_sha "$out")" "" 0 "$cmdstr" "$started" "$(_now)"
        note "RAN $full"
    elif [ $rc -eq 127 ]; then
        _manifest_add "$full" UNAVAILABLE "$relout" "$relerr" "$(_sha "$out")" \
            "${reason:-exit 127 with no stderr}" 127 "$cmdstr" "$started" "$(_now)"
        note "UNAVAILABLE $full ($reason)"
    else
        _manifest_add "$full" FAILED "$relout" "$relerr" "$(_sha "$out")" \
            "$reason" "$rc" "$cmdstr" "$started" "$(_now)"
        note "FAILED $full (exit $rc)"
    fi
}
