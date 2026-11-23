---
name: pr-review
description: >
  Folded into /review. Review mode: use `/review <pr>`. Respond mode
  (addressing comments on your own PR): run `/review <pr> --engage` to settle
  every thread against the current code, then skills/pr-review/RESPOND.md for
  the fix, push and reply steps.
argument-hint: "[--review|--respond] [PR number, owner/repo#N]"
---

# pr-review → /review

**Review mode** (`/pr-review <pr>`, `/pr-review --review <pr>`): run
`/review <pr>`. Its readers cover the three lenses this skill dispatched
(convention, behavior, infrastructure) as ledger questions settled from
recorded evidence; `--deep` adds one reader per dimension in
[DIMENSIONS.md](DIMENSIONS.md), which stays here because `/review` reads it.

**Respond mode** (`/pr-review --respond <pr>`, you are the author): run
`/review <pr> --engage` first. It seeds one ledger row per unresolved thread
and prior review, walks the commits pushed since each comment, and records
which are fixed, answered or still open. For the ones that need code or a
reply, follow [RESPOND.md](RESPOND.md): fix, run the quality checks, push,
then reply in each thread with a permalink. Always confirm with the user
before pushing or posting.
