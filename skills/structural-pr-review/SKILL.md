---
name: structural-pr-review
description: >
  Deterministic PR-review chain with pluggable structural intelligence. Fetches
  the PR into an isolated worktree, runs blast-radius/impact analysis through
  whatever code-intelligence tool is available (a depgraph tool like modmap, or
  an MCP server like mache), applies the pr-review-kit discipline, teaches the
  result via explain-work, drills confirmed findings to method granularity, and
  emits a falsifiable matrix. Posts to GitHub only on explicit authorization;
  degrades gracefully when no structural tool is present. Use to review a peer's
  PR (or your own) with structure-aware rigor and a reproducible sequence.
allowed-tools: "Bash,Read,Glob,Grep,Agent,Skill,mcp__modmap__*,mcp__mache__*"
argument-hint: "[PR number, owner/repo#N, or LINEAR-ID]"
---

# Structural PR Review

A deterministic, reproducible chain for reviewing one PR with structural
awareness. It composes three things you already have — a **structural tool**
(for blast radius + method-level drill-down), the **pr-review-kit** discipline
(state, staleness, design-intent, verification rules, falsifiable matrix), and
**explain-work** (teach the result so it sticks) — into a fixed sequence so
every review lands the same shape of evidence.

**Local by default. Post nothing, edit nothing, until the user explicitly says
to post.** This is the one non-negotiable gate.

## Arguments

`$ARGUMENTS` — a PR number (`123`), `owner/repo#123`, a Linear ticket ID
(`ABC-123` → find its PR), or nothing (auto-detect from the current branch).

---

## Phase 0 — Resolve the target and authorship

1. Resolve `$ARGUMENTS` to `OWNER`, `REPO`, `N`. If a Linear ID, resolve its
   linked PR first. If empty, `gh pr list --head "$(git branch --show-current)"`.
2. Authorship sets teaching emphasis downstream (Phase 6):
   `AUTHOR=$(gh pr view N --json author --jq .author.login)`;
   `ME=$(gh api user --jq .login)`. `AUTHOR == ME` → own work (domain
   onboarding). Else → peer (findings-teaching).

---

## Phase 1 — Detect the structural tool (the pluggable slot)

Probe, in order; bind the first available as `$TOOL` and record which verbs it
offers. Never block on absence — a missing tool degrades the review, it does not
stop it.

| Capability the chain wants | Provided by (examples) | Detect |
|---|---|---|
| PR → worktree + impact in one shot | `modmap pr` | `command -v modmap` |
| Changed-file blast radius (modules, consumers, deploy nodes) | `modmap impact` (CLI or `mcp__modmap__impact`), `mache get_impact` | tool present / MCP tool listed |
| Method-level def+call-site drill (the "fine tier") | `modmap dispatch` / `mcp__modmap__dispatch`, `mache find_callers` | as above |
| CODEOWNERS for a module | `mcp__modmap__owners`, CODEOWNERS file | as above |
| Event subscriber graph | `mcp__modmap__event_consumers`, `modmap events` | as above |

Set `TOOL_KIND ∈ {full, impact-only, none}`. See **Tool adapters** (appendix)
for the exact verb mapping and the gotchas each adapter carries. If `none`,
announce "no structural tool available — structural phases skipped" and continue
(the pr-review-kit discipline stands on its own).

---

## Phase 2 — Fetch the PR into a worktree + blast radius

Prefer the tool's one-shot fetcher; else fall back to git.

- **Full/impact tool with a PR fetcher** (e.g. `modmap pr N`): run it. Capture
  the worktree path as `$WT` and the impact summary (touched modules, direct +
  transitive consumers, deploy nodes, CODEOWNERS).
- **Fallback:** `git fetch <upstream> pull/N/head:pr-N && git worktree add $WT pr-N`,
  then feed the changed-file list to the impact verb if one exists.

**Read the impact output with the reach≠additivity lens.** A high module count is
usually *hub-inflation* (foundational modules everyone imports light up the
graph); it is not the behavioral blast radius. For additive/derived PRs, treat
high reach as noise and answer additivity from the diff (Phase 3) and the fine
tier (Phase 5). Most impact tools say this themselves — surface their caveat,
don't launder it into "231 modules at risk."

---

## Phase 3 — pr-review-kit discipline

Invoke `/pr-review-kit` against PR `N` with `$WT` and the impact summary as
context (session-reuse: it should not re-fetch what Phase 2 gathered). At
minimum, drive its load-bearing phases:

- **State cold** — reviews, inline comments, commits, `reviewDecision`.
- **Staleness gate** — how far behind base; did the *pre-existing shared files*
  the PR edits move on base since the merge-base? (New files can't drift; only
  shared edits can conflict.)
- **Design intent** — read the PR body/ticket FIRST. A structural anomaly that
  looks like a defect is often a documented, intentional decision; the body is
  where you disarm the false finding before filing it.
- **Verification rules** — cite primary sources or label inferences; walk
  commits forward (thread state ≠ code state); investigate, don't ask; verify
  the artifact, not the summary. Run the PR's own gates (build/test/verify
  scripts) in `$WT` rather than trusting the body's "green" claim.

---

## Phase 4 — Classify the PR shape, then dispatch deep-lens agents

Classify from the diff + body:

- **Mechanical / derived** (codegen, promotion, rename, config): the review
  reduces to "is it *provably* a faithful transform?" Find the PR's own
  falsifier (a `verify.sh`, a golden test, a generator) and RUN it. Do not read
  generated code line by line.
- **Feature / behavioral** (new logic, new RPC, mutation, authz, eventing):
  dispatch deep-lens agents **in parallel** (single message, multiple `Agent`
  calls) on `$WT`, each pinned to the PR head SHA and told review-only:
  - `dataflow-driven-troubleshooting` — trace load-bearing values backward from
    where they are RENDERED to where they ORIGINATE; flag emitter≠origin
    divergence (great for accounting/quota/event-subject correctness).
  - `type-driven-correctness` — build the invariant ledger; is each invariant
    carried by the strongest mechanism (type > transaction > property test >
    example > prose)? Hunt prose-demoted invariants, quantifier gaps, hidden
    partial functions.
  - Add domain agents as warranted (`security-auditor`, `production-readiness-reviewer`).

  **Verify every agent claim against the code yourself before relaying it**
  (pr-review-kit Phase 6). Agent confidence is not evidence.

---

## Phase 5 — Fine tier: drill confirmed findings to method granularity

For each finding that names a function/method (and to positively confirm
additivity), run the tool's method-drill verb on `$WT`:

- `modmap dispatch --method <M> --scope <subtree>` (or `mcp__modmap__dispatch`),
  or `mache find_callers`/`find_callees`.
- A new function with **one call site** corroborates "additive, single entry."
  A changed shared function's call sites are the real blast radius (unlike the
  Phase-2 module reach).
- **Read the tier/precision field**, don't trust the flag: a `--precise` request
  may fall back to a token tier that is file-granular and homonym-collapsing
  (same-named funcs across packages merge; call sites count files, not
  expressions). Confirm exact counts with grep when a number is load-bearing.
- **Mind the root**: an MCP structural server is usually rooted at the *base*
  checkout, so it answers the *pre-PR* picture — a PR-only symbol returns empty
  there. Run the drill against `$WT` (post-PR) for the after-picture; the
  before/after delta is itself the fine-grained change.

---

## Phase 6 — Teach it (explain-work)

Invoke `/explain-work` for PR `N` (session-reuse of everything above). Emphasis
by authorship from Phase 0: own work → domain-onboarding (so you can defend it
in a meeting); a peer's → findings-teaching (so you learn to spot it yourself).
The output is a taught synthesis, not a bare list — tie each notable thing to
the seam/ownership/intent that makes it make sense.

---

## Phase 7 — Falsifiable matrix (the durable artifact)

Write a per-PR notes file OUTSIDE the reviewed repo (e.g.
`~/Downloads/<scope>-review/PR-N-<slug>.md`), one row per checkable claim so a
future reader verifies each in ~30s:

```markdown
| # | Claim | Evidence location | Verdict | Verified by |
|---|---|---|---|---|
| 1 | <falsifiable claim> | `path:line` or command | ✅ verified / ❌ mismatch / ⚠️ deferred | you, date |
```

Include: what it does (your words), design anchor (body/ticket/spec quotes),
the matrix, open gaps (deferred to other PRs), and quick verification commands.

---

## Phase 8 — Verdict + gated posting

Render exactly one verdict: **APPROVE** / **REQUEST CHANGES** / **CLOSE**.
Then STOP. Present the matrix + verdict + a draft review body locally.

**Post only when the user explicitly authorizes it.** Then:
`gh pr review N --approve|--request-changes|--comment -F /tmp/body.md`, and
verify it landed (`gh api …/reviews | select(.user.login==ME) | last`). For
inline replies / thread resolution / re-request, follow `pr-review-kit` §9.
Posting is the only action that touches shared state — never infer authorization.

---

## Appendix — Tool adapters

The chain is tool-agnostic; these are the known bindings for the verbs Phase
1–5 want. Add a new adapter by mapping the same verbs. **Keep environment
specifics (install paths, corpus roots, private repo coordinates) out of this
file — they live in the tool's own setup doc, not here.**

**modmap** (depgraph CLI + `modmap-mcp` MCP server) — provides all verbs:
- `modmap pr N` → fetch PR head into a worktree + impact (Phase 2 one-shot).
- `modmap impact` (stdin file list) / `mcp__modmap__impact` → blast radius.
- `modmap dispatch --method M --scope D` / `mcp__modmap__dispatch` → fine tier.
- `mcp__modmap__owners` → CODEOWNERS; `mcp__modmap__event_consumers` → subscribers;
  `mcp__modmap__freshness_report` → snapshot age (check before trusting snapshot reads).
- Gotchas: MCP tools read a static snapshot rooted at the base checkout
  (pre-PR); `dispatch --precise` may fall back to the token tier (read the
  `tier` field); `event_consumers` can't see an event a PR is adding (verify in
  the worktree); impact = reach, not break-risk.

**mache** (MCP code-intelligence server) — impact-only-plus:
- `get_impact` → blast radius; `find_callers`/`find_callees` → method drill;
  `get_overview`/`get_architecture` → orientation; `find_definition` (fuzzy —
  verify exact symbols). No PR-worktree fetcher; use the git fallback in Phase 2.

**none** — skip Phases 2 and 5's tool steps; the pr-review-kit discipline
(Phase 3) and explain-work (Phase 6) still produce a rigorous, teachable review.

---

## Design rationale

- **Why a fixed sequence?** Ad-hoc structural review anchors on whatever the
  reviewer noticed first. A deterministic chain guarantees the same evidence
  shape every time: reach (Phase 2) → discipline (3) → shape-appropriate depth
  (4) → method truth (5) → teaching (6) → falsifiable matrix (7).
- **Why pluggable tools instead of hardcoding one?** The structural verbs
  (impact, method-drill, owners, event graph) are stable; the tool providing
  them is not. Binding late keeps the skill shareable and lets a better tool
  drop in without a rewrite.
- **Why reuse pr-review-kit + explain-work + existing agents rather than
  reimplement?** Each already carries its discipline and its own evolution;
  this skill's job is the *orchestration and the tool seam*, not re-deriving
  review rules.
