You are phase 6. Apply the `explain-work` skill, emphasis by authorship:
`{{AUTHORSHIP}}` (own → domain onboarding; peer → findings teaching). Inputs:
everything under `{{EVIDENCE}}` and `{{WORK}}`, plus `{{CONTEXT}}` if it
exists. Post nothing.

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
  row the verdict turned on either way.
- `{{WORK}}/impact.md`: one bullet per job-level axis (deploy, metrics,
  callers, on-call), each naming the probe that produced it or saying
  `UNAVAILABLE`.
- `{{WORK}}/teach.md`: the explanation, each finding written with the
  comment-craft tags and a citation, plus the explain-work degradation table
  built from `manifest.json` statuses.
Reply with one line: `done`.
