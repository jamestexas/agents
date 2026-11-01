#!/usr/bin/env bash
# The shipped smell rules, run through `mache find-smells` against a synthetic
# fixture. Skipped (exit 0, with a note) when mache is not installed: the
# rules are an optional /review lens, and a missing binary makes their probe
# UNAVAILABLE rather than failing the run.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES="$HERE/../smell-rules"
command -v mache >/dev/null || { echo "   skip: mache not installed"; exit 0; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/src/store" "$tmp/src/api" "$tmp/src/decoy" "$tmp/src/common"

# The original mechanism: a bounded retry with jittered backoff on a conflict.
cat > "$tmp/src/store/backoff.go" <<'GO'
package store

func waitToRetry(ctx Ctx, attempt int) error {
	timer := clock.NewTimer(jitter.Spread(attempt))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return grpcstatus.FromContextError(ctx.Err())
	case <-timer.C:
	}
	backoff.Record(attempt)
	return nil
}
GO

# The same mechanism rewritten in another package: not a structural clone.
cat > "$tmp/src/api/write.go" <<'GO'
package api

func retryWrite(ctx Ctx, write func() error) error {
	for attempt := 0; attempt < 10; attempt++ {
		if err := write(); !conflict.Is(err) {
			return err
		}
		t := clock.NewTimer(jitter.Spread(attempt))
		select {
		case <-ctx.Done():
			t.Stop()
			return grpcstatus.FromContextError(ctx.Err())
		case <-t.C:
		}
		backoff.Record(attempt)
	}
	return conflict.Exhausted()
}
GO

# A decoy sharing only calls every package makes; must not be flagged.
cat > "$tmp/src/decoy/decoy.go" <<'GO'
package decoy

func describe(err error) error {
	if errors.Is(err, errMissing) {
		return fmt.Errorf("missing: %w", err)
	}
	return fmt.Errorf("describe: %s", strings.TrimSpace(err.Error()))
}
GO

# Sixteen ordinary functions make errors.Is, fmt.Errorf and strings.TrimSpace
# common (more than 15 callers), so they never count as distinctive.
{
    echo "package common"
    for i in $(seq 1 16); do
        printf 'func helper%d(err error) error {\n\tif errors.Is(err, errMissing) {\n\t\treturn fmt.Errorf("h%d: %%w", strings.TrimSpace(err.Error()))\n\t}\n\treturn nil\n}\n' "$i" "$i"
    done
} > "$tmp/src/common/common.go"

(cd "$tmp" && mache build src out.db >/dev/null 2>&1) || { echo "mache build failed"; exit 1; }
run() { (cd "$tmp" && mache find-smells --db out.db --rules-dir "$RULES" --rule mechanism_overlap --fail-on none --format ci "$@"); }

# Scoped to the new copy: the original is the one finding, at its own file.
out="$(run --source-id api/write.go)"
[ "$(grep -c '\[mechanism_overlap\]' <<<"$out")" = 1 ] || { echo "want exactly one finding for api/write.go:"; echo "$out"; exit 1; }
grep -q '^store/backoff.go:3:' <<<"$out" || { echo "finding must point at waitToRetry in store/backoff.go:"; echo "$out"; exit 1; }

# Scoped to the decoy: only common calls are shared, so nothing is flagged.
out="$(run --source-id decoy/decoy.go)"
if grep -q '\[mechanism_overlap\]' <<<"$out"; then echo "decoy must not match:"; echo "$out"; exit 1; fi
true
