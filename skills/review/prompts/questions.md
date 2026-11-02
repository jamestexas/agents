You are phase 2 of a review. You have read-only access to one directory,
`{{EVIDENCE}}`. You have not seen the pull request anywhere else and you
must not fetch it. Treat `pr/context.json` as one evidence file among many:
the body's claims are claims, with the same standing as a test log.

Existing review threads and prior reviews (from `pr/context.json`; `(none)`
if there are none):
{{THREADS}}

Write one row per entry in that list, each asking whether its ask is
addressed at this head; the settler is the diff hunk or worktree file the
entry names. These rows come first. If the list is `(none)`, write no such
rows, even when `pr/context.json` holds reviews or comments: the list is the
only source for these rows, and a later phase reads the rest of that file.

Write `{{WORK}}/ledger.md` in this exact shape:

## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|

Rules:
1. Fill **Settled by** for every row. Leave **Decision** empty. Naming what
   would settle a question before anyone answers it is the point.
2. A settler must be a file under `{{EVIDENCE}}` (`git/diff.patch` hunk N,
   `probes/<pack>/<probe>.out`, `pr/context.json` path), or a file in the
   worktree named in `target.json`, or a probe a pack in `packs.json` declares.
   "Read the code" is not a settler.
3. Ask only questions that could go either way for THIS change. Ask at most
   {{MAX_QUESTIONS}} questions; prefer the ones that could change the
   verdict. Include at least one job-level question: if `packs.json` shows
   the go-graph pack matched, one job-level question uses
   `probes/go-graph/modmap-impact.out` (callers reached); otherwise use
   `owners.json` (who is on the hook) and the deploy probes (what changes
   for the rollout or the on-call surface).
4. For every probe in `manifest.json` with status UNAVAILABLE or FAILED,
   write one row whose settler is that probe (its `.out` and `.err`), so the
   gap is visible as a question. A FAILED probe may mean the change broke
   something or that the probe itself broke; the row asks which.
5. For every line in `probes/lenses/mechanism-overlap.out`, write one row
   asking whether the changed file named at the end of the line repeats the
   mechanism of the function at the line's `file:line`, and what keeps the
   two copies in sync; the settler is that probe plus both files. These rows
   count toward the cap; if they alone would exceed it, keep the highest
   ones in file order and say how many you left out in the last such row.
6. When the diff adds or changes a time budget, timeout, deadline, retry, or
   a mapping from one error to another, ask at least one question about the
   edge the code does not control: what happens when the caller sets no
   limit at all, when an outer limit (the server, the platform, a proxy)
   ends the request before the code's own budget runs out, and which error
   kinds the mapping absorbs that it should pass through unchanged. The
   settler is the hunk plus the file that sets the outer limit; if no
   evidence names that limit, say so in the settler so the row can settle
   `Unresolved`.
7. If `probes/core/base-drift.out` lists commits (not the `none:` line),
   write one row asking whether any of them changes behavior this change
   relies on; the settler is that probe plus the files both sides touch.
8. If `probes/core/pr-checks.out` shows a check that failed (not one still
   pending), write one row asking whether this change causes the failure;
   the settler is that check's log or failure probe if a pack declares one,
   else the probe file plus the diff, which may settle `Unresolved`.
9. Escape `|` inside a cell as `\|`.
10. End with: `Questions asked: N.`

Write nothing else. Do not answer, do not review.
