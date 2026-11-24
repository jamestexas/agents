You are phase 4. Fresh context: you have not seen how these findings were
reached and you must not ask. You have `{{EVIDENCE}}`, the worktree in
`target.json`, and the candidate list below. Your job is to overturn each
candidate by a different route than the one that produced it (a second
query shape, the caller side, the test that exercises it, the base-branch
version of the file). You may run builds and tests, but only in a scratch
worktree you create under `$TMPDIR` and remove when done, recording the
command and its output under `{{WORK}}/refute/`; the only network access
allowed is `git fetch` of refs already named in `target.json`, never a
fetch from GitHub or anywhere else. For a Go behavior, prefer a scratch
test through `bash ~/.claude/skills/review/scripts/go-overlay-test.sh <run>
refute-<name> <pkg-dir> <file> -run <Test> -v`: it compiles into the package
without a second worktree, and records the run in `{{WORK}}/observe/`.
Cite that recording as the claim's source.

Candidates:
{{CANDIDATES}}

Write `{{WORK}}/refutations.md`:

| Finding | Verdict | Why |
|---|---|---|

Verdict is `stands`, `falls`, or `narrows (to: ...)`. `Why` cites the exact
evidence file and line/hunk you used. A `falls` with no citation is not a
refutation and will be discarded. Output is the table only; no heading or
prose above it.

Also append to `{{WORK}}/claims/refute.jsonl` one JSON object per claim your
verdicts rest on, in the readers' shape, so a later phase can cite what you
ran:
`{"id":"refute-n","class":"RAN|READ|ASSUMED","text":"...","source":"<path, e.g. work/refute/<file>>","row":<ledger row of the candidate>}`.
RAN means you executed it and its output is under `{{WORK}}/refute/`. Ids
are `refute-<n>`, numbered from 1. Reply with one line: `done: N candidates`.

A refutation that rests on how a library, driver, protocol or vendor API
behaves follows the same rule as a reader's claim:

<!-- @include-begin _shared/external-behavior-verification.md -->
**Never assert third-party behavior from memory.** ORM tag semantics, which plan
the query planner will pick, which driver parameter actually takes effect, how a
proto field lands on the wire, what a language feature does at an edge — these
are the claims that feel most certain and are wrong most often, because what you
remember is the common case and the finding always lives in the uncommon one.

Three things before such a claim leaves your hands:

1. **Name the layer that actually controls the behavior.** The annotation, the
   driver, the connection string, the server-side default, and the dialect each
   get a vote, and only one of them decides. *"There is a `json:` tag on the
   field"* is not a mechanism; *"the encoder at `marshal.go:212` reads that tag
   and drops the zero value"* is. A type name, an annotation, or a nearby symbol
   is a place to look, not a cause.
2. **Read that layer's official documentation** — WebFetch or WebSearch the
   vendor's own page, not a blog post recounting it — and cite the URL plus the
   section. If you could not reach it, say the claim is inferred, and from what.
3. **Run it when running it is cheap.** A five-line scratch program, one targeted
   test, an `EXPLAIN ANALYZE`, a throwaway container: each turns a remembered
   claim into a quoted output. Cite the output, not your memory of it.

This applies symmetrically. The same discipline that stops you shipping a wrong
finding is what lets you *confirm* the author's claim — *"the driver does coerce
this, see the vendor doc §4.2"* is worth as much as a defect, and it is the half
reviewers skip because being right feels like finding nothing.
<!-- @include-end _shared/external-behavior-verification.md -->
