## Triage — 2 candidates in, 2 dispositions out

| # | Candidate (one line) | Disposition | Evidence / reason |
|---|---|---|---|
| 1 | parse before signature check | confirmed | `handler.go:88` vs `:104`; every inbound webhook |
| 2 | `a \| b` splits wrongly | dropped | `parser.go:12` splits on `\|` only (read in worktree) |

**Confirmed: 1. Dropped: 1. Already raised: 0. Already addressed: 0. Revised: 0.**
