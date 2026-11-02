You are phase 6. Apply the `explain-work` skill, emphasis by authorship:
`{{AUTHORSHIP}}` (own → domain onboarding; peer → findings teaching). Inputs:
everything under `{{EVIDENCE}}` and `{{WORK}}`. Project context file:
{{CONTEXT}} (the literal `(none)` means there is no project context). Post
nothing.

Write three files:
- `{{WORK}}/summary.md`: starts with `**TL;DR**`; it has no heading of any
  level (the renderer supplies the artifact's one H1). `**TL;DR**` (three
  sentences: what it does, whether it blocks, what to do), `**Verdict**`
  (APPROVE | REQUEST_CHANGES | COMMENT, and the ledger row it turned on),
  `**What to do next**` (imperative steps). Name the PR and any ticket id;
  never a bead id or a commit sha here.
  The verdict rule: REQUEST_CHANGES if any confirmed finding is Blocking.
  COMMENT if there is no Blocking but at least one Question whose answer
  could become Blocking for THIS PR (say which row). Otherwise APPROVE, with
  the Non-blocking items and Questions posted as comments. Name the ledger
  row the verdict turned on either way. One cap applies after the rule:
  if `probes/core/pr-checks.out` shows any check failing or still pending,
  or that probe is UNAVAILABLE, an APPROVE becomes COMMENT, and the verdict
  line names the checks. The code may be fine, but an approval on an
  unfinished or red PR claims something nobody saw. Phase 7 re-checks this
  against the live PR before posting.
- `{{WORK}}/impact.md`: one bullet per job-level axis (deploy, metrics,
  callers, on-call), each naming the probe that produced it or saying
  `UNAVAILABLE`.
- `{{WORK}}/teach.md`: the explanation, each finding written with the
  comment-craft tags and a citation, plus the explain-work degradation table
  built from `manifest.json` statuses. With no project context file, mark
  the situated layer skipped in that table rather than inventing project
  context.
Reply with one line: `done`.
