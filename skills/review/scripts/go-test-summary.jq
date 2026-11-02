# go-test-summary.jq — reduce `go test -json` (stdout and stderr merged) to
# what a review reader needs: one result line per package, every test that
# skipped or failed with its last log lines (the skip reason or the failure),
# and anything that is not JSON (build errors) verbatim. Passing tests and
# their logs are dropped: a chatty package would otherwise bury the one SKIP
# that says a test never ran here.
#
# Run as: jq -nrR -f go-test-summary.jq
reduce (inputs | . as $raw | (fromjson? // {Raw: $raw})) as $e (
  {buf: {}, out: []};
  if $e.Raw != null then
    if ($e.Raw | length) > 0 then .out += [$e.Raw] else . end
  elif $e.Action == "build-output" then
    # newer toolchains report compile errors as events, not stderr text
    .out += [$e.Output | rtrimstr("\n")]
  elif $e.Action == "output" and $e.Test != null then
    .buf[$e.Package + " " + $e.Test] += [$e.Output | rtrimstr("\n")]
  elif ($e.Action == "skip" or $e.Action == "fail") and $e.Test != null then
    .out += ["--- \($e.Action | ascii_upcase): \($e.Test) (\($e.Package))"]
      + ((.buf[$e.Package + " " + $e.Test] // [])
         | map(select(test("_test\\.go:[0-9]+:|panic:|Error")) | "    " + ltrimstr("    "))
         | .[-5:])
  elif $e.Test == null and $e.Action == "pass" then
    .out += ["ok   \($e.Package)\(if $e.Elapsed then " \($e.Elapsed)s" else "" end)"]
  elif $e.Test == null and $e.Action == "fail" then
    .out += ["FAIL \($e.Package)"]
  elif $e.Test == null and $e.Action == "skip" then
    .out += ["?    \($e.Package) [no test files]"]
  # the package's own "ok"/"FAIL" text lines are skipped: the pass/fail
  # events above already carry them, once
  elif $e.Test == null and $e.Action == "output" and ($e.Output | test("^(panic:|# )")) then
    .out += [$e.Output | rtrimstr("\n")]
  else . end
) | .out[]
