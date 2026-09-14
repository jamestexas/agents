# Review dimensions — the completeness checklist

A sidecar to [SKILL.md](SKILL.md), consulted during the generation pass — after
`scripts/pr-context.sh` has gathered the raw material and before findings are
triaged for significance. It is not the review method; it is the sweep that
tells you whether the method covered the whole PR or only the interesting part.

The failure it exists to prevent is the confident partial review: three sharp
findings about the code you understood, and total silence about the migration,
the new dependency, and the log line that now prints a token. The reader of that
review cannot tell which it is — deliberate "this is fine" or accidental "I
never looked." Both render as nothing.

---

## The rule: name a result for every dimension

**A sweep must name a RESULT for each of the eight dimensions below, including an
explicit "nothing here." Silence is not coverage. An unnamed dimension is an
unswept one, and must be reported as unswept rather than omitted.**

Exactly four results are permitted:

| Result | Means | Requires |
|---|---|---|
| `FINDING` | Something is wrong or suspect. | The finding, at file:line. |
| `CLEAR` | Swept; nothing here. | One line of evidence — what you looked at, so a reader can check your sweep, not just your conclusion. |
| `N/A` | The dimension cannot apply to this diff. | Why. "No public surface changes" is a reason; "seemed irrelevant" is not. |
| `NOT ASSESSED` | You could not sweep it. | What blocked you — couldn't build, no access to the schema, diff too large, missing domain context. |

`NOT ASSESSED` is an honest, publishable answer and is strongly preferred over a
`CLEAR` you cannot defend. A reviewer who says "I could not evaluate the query
plan; someone who can should" has added more to the PR than one who quietly
skipped it.

`CLEAR` is a claim, and its evidence line is what makes the claim falsifiable. If
you cannot write the evidence line, the honest result is `NOT ASSESSED`.

---

## The eight dimensions

Probes are starting questions, not a script. Answer the ones the diff makes
live; a probe that doesn't apply is part of why a dimension is `N/A`.

### 1. Correctness

*Does the code do what the change says it does?* The claims inventory from
`pr-context.sh` (`.claims.items`) is the input here — each claim is a thing to
check, not a thing to believe.

- Take each condition the diff introduces or changes. Name an input that reaches
  each branch. A branch you cannot reach is either dead or the guard is wrong.
- Follow every new error path. Is the error returned, swallowed, logged-and-
  continued, or retried — and does the caller's code assume the one that actually
  happens?
- For every new loop, index, slice, range, or comparison: what is the value on
  the first iteration and on the last? Off-by-one lives at exactly those two.
- Pick the PR description's strongest claim and name the line of code that makes
  it true. If the claim is about behavior and the only support is a refactor,
  the claim is unsupported.

### 2. Security

*What does this change let someone do that they could not do before?*

- Where does untrusted input enter the diff, and what is the first thing that
  trusts it — a parse, a string interpolation into SQL or a shell, a path join, a
  deserializer, a template?
- Does any new log line, error message, metric label, or response body carry a
  secret, a token, an internal path, or another tenant's identifier? Error
  messages are the usual leak, because they are written while debugging.
- Does the change add, move, or remove an authorization check? If it moved, is
  there now a route to the protected resource that arrives after the old check
  site and before the new one?
- Does a new dependency, action, base image, or shell-out widen the trust
  boundary? Is it pinned by digest or by a tag someone else can move?

### 3. Performance

*What is the cost, at production scale rather than test scale?*

- Is there a query, allocation, lock acquisition, or network call inside a loop
  that was not there before? State what N is in production — not the N in the
  fixture.
- Does the change hold a lock, transaction, or pooled connection across an I/O
  boundary? That is how a latency blip becomes an outage.
- What is the largest input this path can now receive, and who bounds it? An
  unbounded read, an unpaginated list, or an unbounded retry is a DoS with a
  polite name.
- Did an operation change complexity class or move between layers — memory to
  disk, in-process to RPC, single-shot to N+1?

### 4. Code quality

*Will the next person read this correctly?* Not style — the linter owns style.

- Does the diff add a second way to do something the codebase already does one
  way? Name the existing one. If there is a reason for the second way, it belongs
  in a comment.
- Is anything now written but never read — a struct field, a config key, a
  returned value, a parameter? Dead state is a maintenance trap and usually
  marks an abandoned half of the change.
- Do the surrounding comments and names still describe the code, or do they
  describe the version before this diff? A comment that has gone stale is worse
  than no comment, because it is trusted.
- Does the change sit in the layer it belongs to, or does it reach across — a
  handler doing storage work, a model opening a socket, a test reaching into
  private state?

### 5. Testing

*Would these tests fail if the code were wrong in the way they claim to guard?*

- For each behavior the PR claims, name the test that fails if that behavior
  regresses. Cannot name one? Then the claim is untested — say so as a finding,
  not as a nitpick.
- Would each new test fail against the pre-change code? A test that passes
  before and after tests nothing this PR did.
- What do the doubles and mocks stand in for, and does the real thing behave the
  way the double pretends? A mock that always succeeds tests the happy path of
  the mock.
- Is each assertion tight enough to catch the bug it names? Asserting "no error"
  when the claim is about a returned value is a test that cannot fail for the
  right reason.

### 6. Edge cases

*The inputs nobody typed while writing it.*

- Empty, one, many, and maximum: what does each do, and which of the four is
  covered? "Many" and "empty" are where collection code breaks.
- Nil/null/None, zero, negative, and — the one that gets missed — unset versus
  set-to-the-default-value. Does the code distinguish them where the distinction
  carries meaning?
- Can two of these run at once? Name what is shared between them: a map, a file,
  a row, a counter, a cached client.
- If the process dies between step k and step k+1, what state is left behind, is
  it recoverable, and is a retry safe — or does it double-apply?

### 7. Breaking changes

*Who else is holding the thing that just changed shape?*

- Did any exported signature, struct field, enum variant, error type, JSON/proto
  field, CLI flag, env var, or config key change? **Meaning counts as shape**:
  the same name with new semantics is a break, and the quietest kind.
- Is there a persisted or in-flight form — a DB column, a cache entry, a file on
  disk, a queued message — that old code wrote and new code must read? And, for a
  rolling deploy, the reverse: new code writing what old code must still read.
- If this is a break, is it announced — version bump, changelog, deprecation
  window, migration — or silent? Silent is the finding.
- Do the callers surfaced by impact analysis actually survive it? "Nothing calls
  this" needs the search that proves it, including outside this repo.

### 8. Documentation

*What is now false?*

- Does any README, doc page, help text, docstring, or ADR now state something
  this diff made untrue? Changed defaults and renamed flags are the usual
  casualties.
- Does a new flag, env var, or config key appear where a user would look for it,
  not only in the code that reads it?
- If the change alters operational behavior — a default, a timeout, a retry
  budget, a permission, an alert threshold — does the runbook or decision record
  say so? The person paged at 3am reads that, not the diff.

---

## Reporting the sweep

Emit the full table. Every dimension gets a row; a dimension with nothing to say
still gets a row saying so. Order does not matter, completeness does.

```
| Dimension         | Result       | Evidence / finding                          |
|-------------------|--------------|---------------------------------------------|
| Correctness       | FINDING      | parser.go:88 — the `len == 0` arm is unreachable |
| Security          | CLEAR        | only input is the already-validated ID from the router |
| Performance       | CLEAR        | no new calls in a loop; N bounded by the page size (50) |
| Code quality      | FINDING      | `Config.LegacyMode` is set in loader.go:31 and read nowhere |
| Testing           | FINDING      | no test covers the new timeout path; TestRetry passes pre-change |
| Edge cases        | CLEAR        | empty/one/many covered in table test; single-threaded path |
| Breaking changes  | N/A          | no exported surface or persisted format touched |
| Documentation     | NOT ASSESSED | flag is user-facing but the docs site is outside this repo |
```

Two habits keep this honest:

1. **Fill the table before ranking findings.** Writing it afterward invites
   back-filling `CLEAR` into rows you never swept, which is the exact failure
   this sidecar exists to stop.
2. **The evidence column is the deliverable for `CLEAR` rows.** A table of bare
   `CLEAR`s carries no more information than silence did, and costs the reader
   more to read.
