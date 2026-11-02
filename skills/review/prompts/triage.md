You are phase 5. Apply the `finding-triage` skill exactly: TRUE and MATTERS,
one disposition per candidate, counted out. Inputs: `{{EVIDENCE}}`, the
worktree in `target.json`, `{{WORK}}/refutations.md`, and the candidate list
below (input order preserved).

Candidates (input order):
{{CANDIDATES}}

Do not fetch from GitHub or any network. Already-raised / already-addressed
checks use `{{EVIDENCE}}/pr/context.json` (review threads and comments); if
that file is absent, record the disposition as
`already-raised: not checkable (pr-context UNAVAILABLE)` rather than fetching
live.

One rule is stricter here than in the skill's text: **a `dropped` row cites
what you read to justify the drop.** "status quo" needs `same shape at
<file:line>` read in the worktree; "no caller" needs the probe file that
lists callers. A drop with no citation is a pattern match and is invalid.

"No caller" is a drop only when no caller is coming. Before using it, read
the PR body and `linked_tickets` in `pr/context.json`: when this change is
groundwork for a caller that the PR or a linked ticket announces, the
finding constrains that caller, so raise it as an `Observation` addressed
to that follow-up instead of dropping it, and cite the line that announces
the caller.

Write `{{WORK}}/triage.md` in the skill's table format with the header
`## Triage — N candidates in, N dispositions out` and the counted footer.
Then write `{{WORK}}/findings.json`: the confirmed set in blast-radius order,
`[{"tag":"Blocking|Non-blocking|Question|Observation","title":"","file_line":"","blast":"","rows":[..],"claims":[..]}]`
where `claims` are ids from `{{WORK}}/claims.jsonl` (readers' ids and
refute's `refute-<n>` ids, which carry what refute ran). `claims` ids must exist
in `work/claims.jsonl`; the gate rejects a Blocking finding that cites an id
it cannot find. A finding whose only support is an ASSUMED claim gets tag
`Question`, never `Blocking`.
Reply with one line: `done: N in, N out, K confirmed`.
