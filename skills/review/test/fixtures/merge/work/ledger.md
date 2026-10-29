## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|
| 1 | Does the new guard run before the signature check? | call order in `git/diff.patch` hunk 2 | |
| 2 | Is the migration safe for a rolling deploy? | `probes/deploy/staging.out` includes base sha | |
| 3 | Does `a \| b` in the flag parser still split on the pipe? | `parser.go:12` in worktree | |
| 4 | Is the retry budget bounded? | `config.go` default in worktree | |

Questions asked: 4.
