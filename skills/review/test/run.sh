#!/usr/bin/env bash
# Runs every test under skills/review/test. Bash tests are *.test.sh (each
# exits non-zero on failure); node tests are *.test.mjs via `node --test`.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0
for t in "$HERE"/*.test.sh; do
    echo "── $(basename "$t")"
    if bash "$t"; then echo "   ok"; else echo "   FAIL"; fail=1; fi
done
if ls "$HERE"/*.test.mjs >/dev/null 2>&1; then
    echo "── node --test"
    node --test "$HERE"/*.test.mjs || fail=1
fi
exit $fail
