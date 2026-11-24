You are one reader in phase 3. You have read-only access to `{{EVIDENCE}}`
and to the worktree named in `{{EVIDENCE}}/target.json`. You are assigned the
ledger rows listed below and no others. You have not seen any other reader's
work and you must not look for it.

Assigned rows (from `{{WORK}}/ledger.md`):
{{ROWS}}

Start from the path entries your rows name in `probes/structure-*/paths.out`
(when present): read those functions and the call sites listed, not whole
files. A caller or callee fact that output already states is cited from it
as a RAN claim (the probe ran); search only for what it does not cover, and
say which provider and tier answered (`type` is exact; `token` is file-level).

For each assigned row, append to `{{WORK}}/decisions/{{READER}}.md` one
line: `| <row#> | <Decision> |`, where Decision is one of:
- a conclusion, citing the exact evidence file and line/key/hunk that
  settled it, ending `→ candidate: <one line>` only if it yields a finding;
- `**Unresolved** — <which probe or file was missing or UNAVAILABLE>`.

A row that asks about a `prior finding` (an earlier review of this PR)
starts its Decision with **fixed**, **answered** or **open**:
- **fixed**: a commit in `probes/core/since-last-review.out` changed the
  cited code, and the code at this head no longer does the thing.
- **answered**: the author replied with a reason and the code is unchanged.
  Only possible when the row says `posted`.
- **open**: neither.

The cited file:line is from the earlier head, so find the same code at this
head first. Keep the earlier tag on an open finding unless you name new
evidence that changes it.

A candidate may carry a leading `[Blocking]` tag when you believe it blocks
merge (correctness, security, or data integrity); leave the tag off
otherwise. A row that settles clean ends with no `→ candidate:` clause at all. Never
write `→ candidate: none`: the merge collects every `→ candidate:` line into
the triage input, so a "none" is a candidate that two later phases must
spend effort dismissing. The two shapes:

```
| 3 | No — `parse()` runs first; call order at `git/diff.patch` hunk @@ -84,9 +88,11 @@ (`handler.go:88` vs `:104`). → candidate: signature verified after parse |
| 4 | Yes — retry budget is 1k via `config.go:41` default; no caller overrides it (`probes/go-graph/callers.out`). |
```

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

Also append to `{{WORK}}/claims/{{READER}}.jsonl` one JSON object per
claim you relied on:
`{"id":"{{READER}}-n","class":"RAN|READ|ASSUMED","kind":"behavior|text|history","text":"...","source":"<evidence path>","row":<row#>}`
- RAN: you executed a command, or read a manifest entry with status RAN.
- READ: you read a file under the evidence dir or the worktree.
- ASSUMED: neither. Say in `text` what would upgrade it.
- `kind` says what the claim is about. `behavior` is what code does when
  it runs: what a function returns, which error a path gives, whether a
  test asserts something, whether a branch is reached. `text` is what a
  file says. `history` is what git shows.

**Observe behavior; don't infer it.** If a behavior claim can be observed at
this commit, run it and record the run. Two readers can read the same code
two ways, but a recorded run settles it.
- A command: `bash ~/.claude/skills/review/scripts/observe.sh {{RUN}} <id> -- <cmd...>`
  (runs in the worktree; add `--cwd <dir inside it>` for a subdirectory).
- A Go behavior: write a scratch `_test.go` under `$TMPDIR`, then
  `bash ~/.claude/skills/review/scripts/go-overlay-test.sh {{RUN}} <id> <pkg-dir> <file> -run <Test> -v`.
  This compiles it into that package via `go test -overlay`, so the
  worktree is never edited and other readers are not affected.
- Cite the recording as the claim's `source` (`work/observe/<id>.json`),
  with `class` `RAN`. A claim resting on several recordings lists them as a
  JSON array (`"source":["work/observe/a.json","work/observe/b.json"]`);
  the gate checks each. Ids are `{{READER}}-<short name>` and are write-once.
- When a behavior claim cannot be observed here (it needs prod, a service
  this machine can't reach, or data that isn't in the repo), keep it `READ`
  and add `"unobservable": "<why>"`. A behavior claim that is read without
  that field counts against any Blocking finding built on it.

Rules: do not widen scope to a question nobody assigned. Do not guess; an
`Unresolved` is a correct answer. No network: do not run `gh`, `curl`, or
any fetch; the evidence is the directory and the worktree. If a row cannot
be settled without a fetch, write `Unresolved` naming what probe is
missing. Claim ids are exactly `{{READER}}-<n>`, numbered from 1. Escape
`|` inside a cell as `\|`. Report to disk, not in your reply; your reply is
the single line `done: <n> rows, <m> claims`.
