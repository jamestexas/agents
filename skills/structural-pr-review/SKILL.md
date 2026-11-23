---
name: structural-pr-review
description: >
  Folded into /review — use `/review <pr>` instead. Kept so the old
  invocation lands somewhere: /review now runs the same chain (isolated
  worktree, pr-context, modmap/mache blast radius, dimension sweep,
  finding-triage, explain-work) with an evidence manifest, a decision ledger
  and arithmetic gates.
argument-hint: "[PR number, owner/repo#N]"
---

# structural-pr-review → /review

This skill was folded into `/review`. Run `/review <pr>` with the same
argument (add `--deep` for the full dimension sweep, `--engage` for a
re-review of a PR you have reviewed before).

What carried over, and where it lives now:

| structural-pr-review | /review |
|---|---|
| Phase 2 orient (pr-context, worktree, blast radius) | Phase 1, `scripts/review-evidence.sh` (probes: core, go-graph, structure-*) |
| Phase 3 pr-review-kit discipline (state, staleness, design intent, walk commits forward) | Phase 1 probes (`core/staleness`, `core/base-drift`, `pr/context.json`) and, on a re-review, the `--engage` commit walk |
| Phase 4 deep-lens fan-out and its skip conditions | Phase 3 readers (`--deep`: one per dimension), with the skip recorded as a ledger row |
| Phase 4 dimension sweep | `--deep`, one reader per `skills/pr-review/DIMENSIONS.md` dimension |
| Phases 5–6 drill and triage | Phases 3–5 (settle, refute, `finding-triage`) |
| Phase 7 teach | Phase 6 teach, plus the independent explain pass and `focus.md` |
| Phase 8 matrix, Phase 9 gated posting | `review.md` with `check.mjs` gates; Phase 7 `--post` with a policy file |
| Tool adapters appendix | `skills/review/docs/structure-providers.md` |

When one invocation is expected to review a peer's PR and post nothing,
`/review <pr>` already does that: it posts only with `--post`.
