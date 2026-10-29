## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|
| 1 | Does the module still build with the new import? | `probes/go-graph/build.out` exit code | No — `probes/go-graph/build.out` line 3: undefined symbol. → candidate: build broken by new import |
| 2 | Is the migration safe for a rolling deploy? | `probes/deploy/staging.out` includes base sha | **Unresolved** — deploy probe UNAVAILABLE |
| 3 | Does the new guard run before the signature check? | call order in `git/diff.patch` hunk 2 | No — `parse()` is first; the ordering test fails in the worktree. → candidate: [Blocking] signature verified after parse |
| 4 | Is the helper a second copy of an existing one? | body vs `other.go:40` in worktree | Yes — same body. → candidate: helper could be generic |
| 5 | Does the removed flag still have callers? | `probes/go-graph/build.out` | **Unresolved** — build failed before the caller scan ran. → candidate: [Blocking] removed flag still referenced |

Questions asked: 5.
