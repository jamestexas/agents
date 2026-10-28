## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|
| 1 | Does the new guard run before the signature check? | call order in `git/diff.patch` hunk 2 | No — `parse()` is first. → finding 1 |
| 2 | Does `a \| b` still split on the pipe? | `parser.go:12` in worktree | Yes — `\|` is the only separator at `parser.go:12`. |
| 3 | Is the retry budget bounded? | `config.go` default in worktree | Yes, 1k via config. Dropped. |

Questions asked: 3.
