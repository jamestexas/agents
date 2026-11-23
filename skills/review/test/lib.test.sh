#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../scripts/lib.sh
source "$HERE/../scripts/lib.sh"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
OUTDIR="$tmp/evidence"; mkdir -p "$OUTDIR/probes"
MANIFEST="$OUTDIR/manifest.json"; manifest_init

probe core ok      -- bash -c 'echo hello'
probe core broken  -- bash -c 'echo nope >&2; exit 3'
probe core missing --needs definitely-not-a-binary-xyz -- definitely-not-a-binary-xyz --version
probe core unset   -- bash -c 'echo "REVIEW_X unset" >&2; exit 127'
# a hung probe (with a child of its own) is killed at its limit and the run
# goes on to the next probe
t0=$SECONDS
probe core hung --timeout 1 -- bash -c 'echo partial; echo waiting >&2; sleep 60 & sleep 61'
probe core after   -- bash -c 'echo still here'

status() { jq -r --arg n "$1" '.probes[] | select(.name==$n) | .status' "$MANIFEST"; }
[ "$(status core/ok)" = RAN ]              || { echo "ok: want RAN got $(status core/ok)"; exit 1; }
[ "$(status core/broken)" = FAILED ]       || { echo "broken: want FAILED"; exit 1; }
[ "$(status core/missing)" = UNAVAILABLE ] || { echo "missing: want UNAVAILABLE"; exit 1; }
[ "$(cat "$OUTDIR/probes/core/ok.out")" = hello ] || { echo "stdout not captured"; exit 1; }
grep -q nope "$OUTDIR/probes/core/broken.err"      || { echo "stderr not captured"; exit 1; }
jq -e '.probes[] | select(.name=="core/ok") | .sha256 | length == 64' "$MANIFEST" >/dev/null || { echo "no sha256"; exit 1; }
jq -e '.probes[] | select(.name=="core/missing") | .reason | test("definitely-not-a-binary-xyz")' "$MANIFEST" >/dev/null || { echo "no reason on UNAVAILABLE"; exit 1; }
[ "$(status core/unset)" = UNAVAILABLE ]   || { echo "unset: exit 127 must be UNAVAILABLE, got $(status core/unset)"; exit 1; }
jq -e '.probes[] | select(.name=="core/unset") | .reason | test("REVIEW_X unset")' "$MANIFEST" >/dev/null || { echo "exit 127 reason must carry stderr"; exit 1; }
jq -e '.probes[] | select(.name=="core/broken") | .err == "probes/core/broken.err"' "$MANIFEST" >/dev/null || { echo "err path missing"; exit 1; }
jq -e '.probes[] | select(.name=="core/ok") | .cmd == "bash -c echo\\ hello "' "$MANIFEST" >/dev/null || { echo "cmd must be %q-quoted, got $(jq -r '.probes[] | select(.name=="core/ok") | .cmd' "$MANIFEST")"; exit 1; }
[ $((SECONDS - t0)) -lt 15 ] || { echo "hung probe was not killed at its limit"; exit 1; }
[ "$(status core/hung)" = UNAVAILABLE ]     || { echo "hung: want UNAVAILABLE got $(status core/hung)"; exit 1; }
jq -e '.probes[] | select(.name=="core/hung") | (.exit == 124) and (.reason | startswith("timeout: killed after 1s")) and (.reason | test("waiting"))' "$MANIFEST" >/dev/null \
    || { echo "hung: want exit 124 and a timeout reason with stderr, got $(jq -c '.probes[] | select(.name=="core/hung")' "$MANIFEST")"; exit 1; }
grep -q partial "$OUTDIR/probes/core/hung.out" || { echo "hung: output before the kill must be kept"; exit 1; }
[ "$(status core/after)" = RAN ]           || { echo "after: the probe after a timeout must still run"; exit 1; }
sleep 3  # past the watchdog's TERM-then-KILL window
! pgrep -f 'sleep 6[01]' >/dev/null || { echo "hung probe's children survived the kill"; exit 1; }
REVIEW_PROBE_TIMEOUT=1 probe core envlimit -- bash -c 'sleep 30'
[ "$(status core/envlimit)" = UNAVAILABLE ] || { echo "REVIEW_PROBE_TIMEOUT must set the default limit"; exit 1; }
jq -e '.probes | length == 7' "$MANIFEST" >/dev/null || { echo "manifest count"; exit 1; }
