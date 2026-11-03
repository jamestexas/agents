#!/usr/bin/env bash
# git-fetch-retry.sh against a fake `git`: a busy ref lock is retried until the
# fetch goes through; any other error fails at once with git's own message;
# a lock that never clears gives up after the attempt budget.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$HERE/../scripts/git-fetch-retry.sh"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
# The fake reads its script from $FAKE_PLAN: one line per call, "ok" or an
# error message, and records how many times it was called.
cat > "$tmp/bin/git" <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat "$FAKE_COUNT" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE_COUNT"
line="$(sed -n "${n}p" "$FAKE_PLAN")"; [ -n "$line" ] || line="$(tail -1 "$FAKE_PLAN")"
[ "$line" = ok ] && exit 0
echo "$line" >&2; exit 1
EOF
chmod +x "$tmp/bin/git"
run() { printf '%s\n' "$@" > "$tmp/plan"; rm -f "$tmp/count"
    PATH="$tmp/bin:$PATH" FAKE_PLAN="$tmp/plan" FAKE_COUNT="$tmp/count" GIT_FETCH_RETRY_SLEEP=0 \
        GIT_FETCH_RETRY_ATTEMPTS=4 bash "$S" /repo upstream refs/pull/1/head:refs/review/1 main 2>"$tmp/err"; }
calls() { cat "$tmp/count"; }

lock="error: cannot lock ref 'refs/remotes/upstream/main': is at aaa but expected bbb"
run "$lock" "$lock" ok || { echo "busy lock then ok must succeed"; cat "$tmp/err"; exit 1; }
[ "$(calls)" = 3 ] || { echo "want 3 calls, got $(calls)"; exit 1; }
grep -q 'ref lock busy (attempt 2 of 4)' "$tmp/err" || { echo "retries must be reported"; exit 1; }

if run "fatal: couldn't find remote ref refs/pull/1/head" ok; then echo "a real error must fail"; exit 1; fi
[ "$(calls)" = 1 ] || { echo "a real error must not be retried, got $(calls) calls"; exit 1; }
grep -q "couldn't find remote ref" "$tmp/err" || { echo "git's error must be passed through"; exit 1; }

if run "$lock"; then echo "a lock that never clears must fail"; exit 1; fi
[ "$(calls)" = 4 ] || { echo "want the 4-attempt budget, got $(calls)"; exit 1; }
grep -q 'cannot lock ref' "$tmp/err" || { echo "the final lock error must be shown"; exit 1; }
