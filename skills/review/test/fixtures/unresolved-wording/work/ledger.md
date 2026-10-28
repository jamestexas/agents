## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|
| 1 | Does the new guard run before the signature check? | call order in `git/diff.patch` hunk 2 | Not unresolved after all — `parse()` is first. → finding 1 |
| 2 | Is the migration safe for a rolling deploy? | `probes/deploy/staging.out` includes base sha | **Unresolved** — deploy probe UNAVAILABLE |
| 3 | Is the retry budget bounded? | `config.go` default in worktree | unresolved — no default found |

Questions asked: 3. Decisions + unresolved: 3.
