# PR 7 — explanation

Some prose that is not the table.

## Areas
| # | Area | Where (file:line-range or symbol) | Weight | Why |
|---|---|---|---|---|
| 1 | Retain loop | `svc/provision.go:40-60` | load-bearing | Decides which copies settle (Finding 1) |
| 2 | Sweep | provision.go:80-90 | load-bearing | Revokes by marker |
| 3 | Request builders | svc/ces.go:10-30 (`buildRequest`) | load-bearing | Sets the exemption flags |
| 4 | Metrics labels | svc/ces.go:100-110 | plumbing | New op labels |
| 5 | Docs | docs/a.md | plumbing | Text sync; mentions a gap in wording |
