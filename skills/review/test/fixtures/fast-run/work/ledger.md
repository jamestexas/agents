## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|
| 1 | Does the new guard run before the signature check? | call order in `git/diff.patch` hunk 2 vs `probes/go-graph/modmap-impact.out` | No — `parse()` is first. → finding 1 |
| 2 | Is the migration safe for a rolling deploy? | `probes/deploy/staging.out` includes base sha | **Unresolved** — deploy probe UNAVAILABLE |
| 3 | Is the retry budget bounded? | `config.go` default in worktree | Yes, 1k via config. Dropped. |

Questions asked: 3. Decisions + unresolved: 3.
