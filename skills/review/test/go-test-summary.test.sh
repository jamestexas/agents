#!/usr/bin/env bash
# go-test-summary.jq over canned `go test -json` output: no toolchain needed.
# A passing test's logs are dropped however many there are; a skip keeps its
# reason; a failure keeps its message; a build error (an event on newer
# toolchains, raw text on older ones) comes through verbatim; each package
# result appears once.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
J="$HERE/../scripts/go-test-summary.jq"
in="$(mktemp)"; trap 'rm -f "$in"' EXIT
{
    for i in $(seq 1 300); do
        printf '{"Action":"output","Package":"x","Test":"TestA","Output":"    x_test.go:3: noise %d\\n"}\n' "$i"
    done
    echo '{"Action":"pass","Package":"x","Test":"TestA"}'
    echo '{"Action":"output","Package":"x","Test":"TestB_DB","Output":"    x_test.go:4: database unavailable\n"}'
    echo '{"Action":"skip","Package":"x","Test":"TestB_DB"}'
    echo '{"Action":"output","Package":"x","Test":"TestC","Output":"    x_test.go:5: want 1 got 2\n"}'
    echo '{"Action":"fail","Package":"x","Test":"TestC"}'
    echo '{"Action":"output","Package":"x","Output":"FAIL\tx\t0.1s\n"}'
    echo '{"Action":"fail","Package":"x","Elapsed":0.1}'
    echo '{"ImportPath":"x/bad","Action":"build-output","Output":"bad/bad.go:2:12: undefined: thing\n"}'
    echo 'old-toolchain.go:1:1: raw stderr build error'
    echo '{"Action":"pass","Package":"x/ok","Elapsed":0.2}'
    echo '{"Action":"skip","Package":"x/empty"}'
} > "$in"
got="$(jq -nrR -f "$J" < "$in")"
want='--- SKIP: TestB_DB (x)
    x_test.go:4: database unavailable
--- FAIL: TestC (x)
    x_test.go:5: want 1 got 2
FAIL x
bad/bad.go:2:12: undefined: thing
old-toolchain.go:1:1: raw stderr build error
ok   x/ok 0.2s
?    x/empty [no test files]'
[ "$got" = "$want" ] || { printf 'summary mismatch\n--- got\n%s\n--- want\n%s\n' "$got" "$want"; exit 1; }
