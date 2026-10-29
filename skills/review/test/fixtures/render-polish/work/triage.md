# Triage

## Triage — 2 candidates in, 2 dispositions out

| # | Candidate (one line) | Disposition | Evidence / reason |
|---|---|---|---|
| 1 | parse before signature check | confirmed | `handler.go:88` vs `:104`; every inbound webhook |
| 2 | rolling deploy reads the new column | confirmed | staging probe UNAVAILABLE; kept as a Question |

**Confirmed: 2. Dropped: 0. Already raised: 0. Already addressed: 0. Revised: 0.**
