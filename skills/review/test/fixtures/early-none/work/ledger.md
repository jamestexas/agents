## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|
| 1 | Is the helper a second copy of an existing one? | body vs `other.go:40` in worktree | Yes — same body. → candidate: helper could be generic |
| 2 | Does the module still build? | `probes/go-graph/build.out` exit code | Yes — `probes/go-graph/build.out` is empty, exit 0. |

Questions asked: 2.
