## Triage — 3 candidates in, 3 dispositions out

| # | Candidate (one line) | Disposition | Evidence / reason |
|---|---|---|---|
| 1 | parse before signature check | confirmed | `handler.go:88` vs `:104`; every inbound webhook |
| 2 | helper could be generic | dropped | fails MATTERS — no second caller in `probes/go-graph/modmap-impact.out` |
| 3 | naming inconsistent | dropped | status quo — same shape at `other.go:40`, `:67` (read in worktree) |

**Confirmed: 1. Dropped: 2. Already raised: 0. Already addressed: 0. Revised: 2.**

### Revised candidates

| # | Was | Now |
|---|---|---|
| 1 | helper could be generic | dropped, no second caller |
| 2 | naming inconsistent | dropped, status quo |
