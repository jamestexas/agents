---
name: review-prep
description: >
  Folded into /review — use `/review <pr>` instead, whose phase 1 collects the
  impact and structure evidence this produced. For a PR's spec-driven and
  emergent diagrams outside a review (explain-work's structural layer),
  follow skills/review-prep/PROCEDURE.md. Local only.
argument-hint: "<pr-number-or-repo#N> [repo-path]"
---

# review-prep → /review

The reviewer's structural pre-flight is now phase 1 of `/review`: the
evidence script runs the impact and structure probes (`go-graph/modmap-impact`,
`structure-*`) into the run's evidence directory, and every later phase reads
them from there.

For the diagrams themselves, or for a caller outside `/review` (`explain-work`
building its structural layer, `claim-ledger` sourcing blast radius), follow
[PROCEDURE.md](PROCEDURE.md), the former body of this skill. Its output is
local only; never put it in a GitHub review.
