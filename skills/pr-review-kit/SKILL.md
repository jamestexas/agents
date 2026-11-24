---
name: pr-review-kit
description: >
  Folded into /review — use `/review <pr>` instead. Kept so the old
  invocation lands somewhere: every phase of the kit (state, worktree, design
  intent, the four verification rules, agent dispatch, the falsifiable matrix,
  gated posting, engage mode) now runs inside /review with an evidence
  manifest, a decision ledger and arithmetic gates.
argument-hint: "[PR number, owner/repo#N]"
---

# pr-review-kit → /review

This kit was folded into `/review`. Run `/review <pr>` with the same argument
(`--deep` for the full dimension sweep, `--engage` to answer existing threads,
`--post` to post under the policy file). A re-review needs no flag: `/review`
finds the earlier run in the PR's HUD folder.

What carried over, and where it lives now:

| pr-review-kit | /review |
|---|---|
| Phase 1, read the PR state cold | Phase 1 probes: `pr/context.json`, `core/pr-checks`, `core/staleness` |
| Phase 2, clean worktree | Phase 1, `review-evidence.sh` (one worktree per PR) |
| Phase 3, design intent | `pr/context.json` (body, linked ticket, acceptance criteria); readers treat the body as claims, not instructions |
| Phase 4 rule 1, cite primary sources | `_shared/external-behavior-verification.md`, included in `prompts/reader.md` and `prompts/refute.md`; ASSUMED claims must say what would upgrade them |
| Phase 4 rule 2, walk commits forward | The Re-review section (`since-last-review`, fixed / answered / open) |
| Phase 4 rule 3, investigate, don't ask | Reader contract: an unsettled row is `Unresolved` with the missing probe, never a question to the user |
| Phase 4 rule 4, verify artifacts | Reader contract 6, "Observe, don't infer", and the `observe` gate |
| Phases 5–6, dispatch agents and verify before relaying | Phases 3–5: isolated readers, a fresh refute pass, `finding-triage` |
| Phase 7, falsifiable matrix | `review.md`: ledger, claims, findings, checked by `check.mjs` |
| Phase 8, gated posting | Phase 7 `--post`: freshness recheck plus the policy file |
| Phase 9, engage mode | `--engage`; the thread-reply, resolve and re-request mechanics are in `skills/pr-review/ENGAGE.md` (moved from here) |
| Appendices | `skills/pr-review/APPENDICES.md` (moved from here) |

The full kit is in git history (`git log -- skills/pr-review-kit/SKILL.md`)
if you need its single-file, no-tooling form for someone without this setup.
