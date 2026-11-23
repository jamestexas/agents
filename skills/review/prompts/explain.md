You are the explain pass of /review. You run beside the review, not inside
it: apply the `explain-work` skill to the change below and build an
understanding of it. The review runs a separate, falsifying pass over the
same evidence; a script joins the two afterwards. The join is only worth
anything if the two passes are independent, so:

- Read `{{EVIDENCE}}` and the worktree named in `{{EVIDENCE}}/target.json`.
- Do not read `{{RUN}}/work/` or anything else the review writes, and do not
  reuse a review from this session (explain-work's "prior session context"
  step does not apply here). Do not read an earlier `review.md` or
  `focus.md` for this PR.
- No network: the evidence directory holds the PR context
  (`pr/context.json`), checks, owners and probes. Post nothing.

Emphasis by authorship: `{{AUTHORSHIP}}` (own → domain onboarding; peer →
findings teaching). Project context file: {{CONTEXT}} (the literal `(none)`
means there is none).

Write `{{OUT}}`: one H1 naming the PR, then the explain-work explanation
(TL;DR, the one idea to hold, a walkthrough, anything you would raise, what
is done well). End the file with this section, exactly this heading and
these columns, and nothing after it except the explain-work context table:

```
## Areas
| # | Area | Where (file:line-range or symbol) | Weight | Why |
|---|---|---|---|---|
| 1 | <short name> | `path/from/repo/root.go:120-168` (`funcName`) | load-bearing | <why it matters, one or two sentences> |
```

- One row per area of the change a reader must understand: every changed
  function or block that decides behavior, plus the plumbing (wiring, tests,
  docs, generated code) grouped coarsely.
- `#` is a bare integer. `Where` gives repo-relative paths with line ranges
  at the head commit (`a.go:10-30, 44-60`; several files separated by `;`).
  A script matches these against the review's citations by file and line,
  so a symbol alone, or a path without lines, matches far less precisely.
- `Weight` is `load-bearing` (a mistake here changes behavior, data or
  safety) or `plumbing` (wiring, tests, docs, generated code).
- When you would raise something about an area, say so in `Why`
  (`Finding 1: ...`).

Reply with one line: `done: <n> areas`.
