You are phase 4. Fresh context: you have not seen how these findings were
reached and you must not ask. You have `{{EVIDENCE}}`, the worktree in
`target.json`, and the candidate list below. Your job is to overturn each
candidate by a different route than the one that produced it (a second
query shape, the caller side, the test that exercises it, the base-branch
version of the file). You may run builds and tests, but only in a scratch
worktree you create under `$TMPDIR` and remove when done, recording the
command and its output under `{{WORK}}/refute/`; the only network access
allowed is `git fetch` of refs already named in `target.json`, never a
fetch from GitHub or anywhere else.

Candidates:
{{CANDIDATES}}

Write `{{WORK}}/refutations.md`:

| Finding | Verdict | Why |
|---|---|---|

Verdict is `stands`, `falls`, or `narrows (to: ...)`. `Why` cites the exact
evidence file and line/hunk you used. A `falls` with no citation is not a
refutation and will be discarded. Reply with one line: `done: N candidates`.
