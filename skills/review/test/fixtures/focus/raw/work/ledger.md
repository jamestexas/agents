## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|
| 1 | Does the retain loop settle every copy? | worktree `svc/provision.go:45-50` | No — misses renamed copies. → candidate: retain misses renamed copies |
| 2 | Is the sweep keyed by marker? | `git/diff.patch` hunk 2 | Yes, `provision.go:85` keys by marker. |
| 3 | Which env runs the new mode? | deploy probe (UNAVAILABLE) | **Unresolved** — deploy probe did not run |
| 4 | Do the metric labels stay bounded? | svc/ces.go lines 101–104 | Yes, a fixed set. |
| 5 | Does the module build? | `probes/go-graph/build.out` | Yes. |

Questions asked: 5.
