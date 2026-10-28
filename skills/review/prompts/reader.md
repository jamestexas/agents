You are one reader in phase 3. You have read-only access to `{{EVIDENCE}}`
and to the worktree named in `{{EVIDENCE}}/target.json`. You are assigned the
ledger rows listed below and no others. You have not seen any other reader's
work and you must not look for it.

Assigned rows (from `{{WORK}}/ledger.md`):
{{ROWS}}

For each assigned row, append to `{{WORK}}/decisions/{{READER}}.md` one
line: `| <row#> | <Decision> |`, where Decision is one of:
- a conclusion, citing the exact evidence file and line/key/hunk that
  settled it, ending `→ candidate: <one line>` only if it yields a finding;
- `**Unresolved** — <which probe or file was missing or UNAVAILABLE>`.

A row that settles clean ends with no `→ candidate:` clause at all. Never
write `→ candidate: none`: the merge collects every `→ candidate:` line into
the triage input, so a "none" is a candidate that two later phases must
spend effort dismissing. The two shapes:

```
| 3 | No — `parse()` runs first; call order at `git/diff.patch` hunk @@ -84,9 +88,11 @@ (`handler.go:88` vs `:104`). → candidate: signature verified after parse |
| 4 | Yes — retry budget is 1k via `config.go:41` default; no caller overrides it (`probes/go-graph/callers.out`). |
```

Also append to `{{WORK}}/claims/{{READER}}.jsonl` one JSON object per
claim you relied on:
`{"id":"{{READER}}-n","class":"RAN|READ|ASSUMED","text":"...","source":"<evidence path>","row":<row#>}`
- RAN: you executed a command, or read a manifest entry with status RAN.
- READ: you read a file under the evidence dir or the worktree.
- ASSUMED: neither. Say in `text` what would upgrade it.

Rules: do not widen scope to a question nobody assigned. Do not guess; an
`Unresolved` is a correct answer. No network: do not run `gh`, `curl`, or
any fetch; the evidence is the directory and the worktree. If a row cannot
be settled without a fetch, write `Unresolved` naming what probe is
missing. Claim ids are exactly `{{READER}}-<n>`, numbered from 1. Escape
`|` inside a cell as `\|`. Report to disk, not in your reply; your reply is
the single line `done: <n> rows, <m> claims`.
