## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|
| 1 | Does the new guard run before the signature check? | `probes/go-graph/modmap-impact.out` | **Unresolved** — graph probe UNAVAILABLE |
| 2 | Is the migration safe for a rolling deploy? | `probes/deploy/staging.out` includes base sha | **Unresolved** — deploy probe UNAVAILABLE |
| 3 | Is the retry budget bounded? | `config.go` default in worktree | Unresolved — worktree checkout FAILED |

Questions asked: 3. Decisions + unresolved: 3.
