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

status() { jq -r --arg n "$1" '.probes[] | select(.name==$n) | .status' "$MANIFEST"; }
[ "$(status core/ok)" = RAN ]              || { echo "ok: want RAN got $(status core/ok)"; exit 1; }
[ "$(status core/broken)" = FAILED ]       || { echo "broken: want FAILED"; exit 1; }
[ "$(status core/missing)" = UNAVAILABLE ] || { echo "missing: want UNAVAILABLE"; exit 1; }
[ "$(cat "$OUTDIR/probes/core/ok.out")" = hello ] || { echo "stdout not captured"; exit 1; }
grep -q nope "$OUTDIR/probes/core/broken.err"      || { echo "stderr not captured"; exit 1; }
jq -e '.probes[] | select(.name=="core/ok") | .sha256 | length == 64' "$MANIFEST" >/dev/null || { echo "no sha256"; exit 1; }
jq -e '.probes[] | select(.name=="core/missing") | .reason | test("definitely-not-a-binary-xyz")' "$MANIFEST" >/dev/null || { echo "no reason on UNAVAILABLE"; exit 1; }
jq -e '.probes | length == 3' "$MANIFEST" >/dev/null || { echo "manifest count"; exit 1; }
