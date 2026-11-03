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
  with `class` `RAN`. Ids are `{{READER}}-<short name>` and are write-once.
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
