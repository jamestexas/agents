---
name: structural-pr-review
description: >
  Deterministic PR-review chain with pluggable structural intelligence. Fetches
  the PR into an isolated worktree, gathers the PR's own context with
  scripts/pr-context.sh, runs blast-radius/impact analysis through whatever
  code-intelligence tool is available (a depgraph tool like modmap, or an MCP
  server like mache), applies the pr-review-kit discipline, sweeps the review
  dimensions, drills findings to method granularity, gates them through
  finding-triage, teaches the result via explain-work, and emits a falsifiable
  matrix. Posts to GitHub only on explicit authorization; degrades gracefully
  when no structural tool is present. Use to review a peer's PR (or your own)
  with structure-aware rigor and a reproducible sequence.
allowed-tools: "Bash,Read,Glob,Grep,Agent,Skill,mcp__modmap__*,mcp__mache__*"
argument-hint: "[PR number, owner/repo#N, or LINEAR-ID]"
---

# Structural PR Review

A deterministic, reproducible chain for reviewing one PR with structural
awareness. It composes things you already have — `scripts/pr-context.sh` (the
PR's own paper trail, gathered), a **structural tool** (blast radius +
method-level drill-down), the **pr-review-kit** discipline (state, staleness,
design-intent, verification rules, falsifiable matrix),
`skills/pr-review/DIMENSIONS.md` (the completeness sweep), **finding-triage**
(the significance gate), and **explain-work** (teach the result so it sticks) —
into a fixed sequence so every review lands the same shape of evidence.

The case it is built for: **a peer sends you a PR you have no context on, and
you have to review it well without reading or writing a novel.** Phase 2 is the
half that spares you the reading; Phase 6 is the half that spares you the
writing.

**Local by default. Post nothing, edit nothing, until the user explicitly says
to post.** This is the one non-negotiable gate.

## Arguments

`$ARGUMENTS` — a PR number (`123`), `owner/repo#123`, a Linear ticket ID
(`ABC-123` → find its PR), or nothing (auto-detect from the current branch).

---

## Phase 0 — Resolve the target and authorship

1. Resolve `$ARGUMENTS` to `OWNER`, `REPO`, `N`. If a Linear ID, resolve its
   linked PR first. If empty, `gh pr list --head "$(git branch --show-current)"`.
2. Authorship sets teaching emphasis downstream (Phase 7):
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
for the exact verb mapping and the gotchas each adapter carries.

**`none` is a supported state, not a broken one.** A missing binary, an MCP
code-intelligence server that will not connect, a repo the tool cannot index —
all land here, and all of them are ordinary. Announce it once ("no structural
tool reachable — blast radius and the method drill are skipped"), then run the
rest of the chain unchanged.

What you lose is exactly two things: the reach estimate in Phase 2.3 and the
call-site drill in Phase 5. What you keep is everything that decides the
verdict — the PR's own context (Phase 2.1), the pr-review-kit discipline
(Phase 3), the deep-lens agents and the dimension sweep (Phase 4), the
significance gate (Phase 6), the teaching (Phase 7) and the matrix (Phase 8).
**A review produced without the structural tier is a valid review with a named
gap**; record the gap as a deferred row in the Phase 8 matrix rather than as an
apology, and do not downgrade the verdict for it.

---

## Phase 2 — Orient: the PR's context, a worktree, blast radius

Orientation comes before analysis, and the PR's own paper trail comes before the
graph: it is cheaper, it never degrades, and it is what makes a no-context review
possible at all. Nothing in this phase produces a finding — it changes what you
look for in Phases 3–5.

### 2.1 Gather the PR's own context

```bash
bash scripts/pr-context.sh --pr owner/repo#N > /tmp/pr-ctx-N.json
```

One read-only JSON document (`schema: pr-context/v1`) holding what the PR
*claims*, which ticket it is meant to satisfy and that ticket's acceptance
criteria, what the bots already flagged, which review threads are resolved versus
merely buried, and which past PRs rhyme with it. Every section carries its own
status, so `empty` ("we looked, nothing is here") is never confusable with
`unavailable` ("we did not look") — carry an `unavailable` section forward as a
named gap rather than reviewing as though it were empty.

`scripts/pr-context.sh --help` documents the sections and the status contract;
read it there rather than re-deriving it here. `--similar 0` drops the slowest
section when you need the context fast.

This is the half of "review it well without reading a novel" that spares you the
reading. The script forms no findings and reaches no verdict; that judgment stays
in Phases 3–6.

### 2.2 Fetch the PR into a worktree

Prefer the tool's one-shot fetcher; else fall back to git.

- **Full/impact tool with a PR fetcher** (e.g. `modmap pr N`): run it. Capture
  the worktree path as `$WT` and the impact summary (touched modules, direct +
  transitive consumers, deploy nodes, CODEOWNERS).
- **Fallback:** `git fetch <upstream> pull/N/head:pr-N && git worktree add $WT pr-N`,
  then feed the changed-file list to the impact verb if one exists.

Every later phase reads and runs inside `$WT`, never in the user's checkout.

### 2.3 Read the blast radius

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
- **Design intent** — read the PR body/ticket FIRST; Phase 2.1 already put both
  in `/tmp/pr-ctx-N.json`. A structural anomaly that looks like a defect is often
  a documented, intentional decision; the body is where you disarm the false
  finding before filing it.
- **Verification rules** — cite primary sources or label inferences; walk
  commits forward (thread state ≠ code state); investigate, don't ask; verify
  the artifact, not the summary. Run the PR's own gates (build/test/verify
  scripts) in `$WT` rather than trusting the body's "green" claim.

---

## Phase 4 — Generation: classify the shape, dispatch deep-lens agents, sweep

Everything that *produces* candidates lives here. It is not finished when the
agents come back; it is finished when every review dimension has a named result.

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
  (pr-review-kit's own Phase 6). Agent confidence is not evidence.

**Exit gate — sweep the dimensions.** The lenses above are deep and narrow: they
find what they were pointed at, which is how a review ends up with three sharp
findings about the code you understood and total silence about the migration, the
new dependency, and the log line that now prints a token. Before leaving
generation, work through `skills/pr-review/DIMENSIONS.md` and **name a result for
every dimension it lists, explicit "nothing here" included.** Silence is not
coverage — an unswept dimension and a deliberately-clear one render identically
as nothing, and the reader cannot tell which they are looking at.

The permitted results, their per-dimension probes, and the table shape live in
that file; follow it rather than re-deriving it here. Fill the table *before*
ranking anything — written afterward it invites back-filling clean results into
rows you never swept — and carry the filled table into the Phase 8 artifact.

---

## Phase 5 — Fine tier: drill candidate findings to method granularity

For each candidate that names a function/method (and to positively confirm
additivity), run the tool's method-drill verb on `$WT`. What comes back is the
mechanism-at-a-named-line and the blast-radius evidence the Phase 6 gate runs on:

- `modmap dispatch --method <M> --scope <subtree>` (or `mcp__modmap__dispatch`),
  or `mache find_callers`/`find_callees`.
- A new function with **one call site** corroborates "additive, single entry."
  A changed shared function's call sites are the real blast radius (unlike the
  Phase 2.3 module reach).
- **Read the tier/precision field**, don't trust the flag: a `--precise` request
  may fall back to a token tier that is file-granular and homonym-collapsing
  (same-named funcs across packages merge; call sites count files, not
  expressions). Confirm exact counts with grep when a number is load-bearing.
- **Mind the root**: an MCP structural server is usually rooted at the *base*
  checkout, so it answers the *pre-PR* picture — a PR-only symbol returns empty
  there. Run the drill against `$WT` (post-PR) for the after-picture; the
  before/after delta is itself the fine-grained change.

---

## Phase 6 — Significance: triage the candidate set

Phases 4 and 5 produced *candidates*, and they were supposed to over-generate.
This phase decides which of them have earned a human's attention. Nothing reaches
Phase 8 as a finding without passing through it.

Invoke the **`finding-triage`** skill (`skills/finding-triage/SKILL.md`) on the
synthesized candidate list. It applies two bars — TRUE and MATTERS — and returns
exactly one disposition per candidate: `confirmed`, `dropped`, `already-raised`,
`already-addressed`, or `revised`. Run it; do not re-derive its judgment here.

The earlier phases are what make it cheap: the Phase 5 call-site counts are the
blast-radius evidence its MATTERS bar wants, and the Phase 2.1 context is how a
candidate gets marked `already-raised` instead of restated in your own words.
When `TOOL_KIND` is `none`, triage still runs — it weighs reachability from the
diff and grep rather than from the drill.

Only `confirmed` and `revised` findings continue as findings. The rest are
reported as triaged, with their reasons, in Phase 8. This is the half of "review
it well without writing a novel" that spares you the writing — and spares the
author reading it.

---

## Phase 7 — Teach it (explain-work)

Invoke `/explain-work` for PR `N` (session-reuse of everything above), on the
findings that cleared Phase 6. Emphasis by authorship from Phase 0: own work →
domain-onboarding (so you can defend it in a meeting); a peer's →
findings-teaching (so you learn to spot it yourself).
The output is a taught synthesis, not a bare list — tie each notable thing to
the seam/ownership/intent that makes it make sense.

---

## Phase 8 — Falsifiable matrix (the durable artifact)

Write a per-PR notes file OUTSIDE the reviewed repo (e.g.
`~/Downloads/<scope>-review/PR-N-<slug>.md`), one row per checkable claim so a
future reader verifies each in ~30s:

```markdown
| # | Claim | Evidence location | Disposition | Verdict | Verified by |
|---|---|---|---|---|---|
| 1 | <falsifiable claim> | `path:line` or command | confirmed | ✅ verified / ❌ mismatch / ⚠️ deferred | you, date |
```

**Rows carry their Phase 6 disposition, and dropped rows are included.** Every
candidate that entered triage gets a row here — a `dropped` one carrying the
reason it was dropped and which bar it failed, an `already-raised` one crediting
whoever raised it. This is not bookkeeping: a matrix listing only what survived
is indistinguishable from a triage that read three items and stopped, so the
dropped rows *are* the evidence the gate ran. State both counts — candidates in,
dispositions out.

Include: what it does (your words), design anchor (body/ticket/spec quotes), the
Phase 4 dimension table, the matrix, open gaps (deferred to other PRs — a
skipped structural tier belongs here as a deferred row, per Phase 1), and quick
verification commands.

---

## Phase 9 — Verdict + gated posting

Render exactly one verdict: **APPROVE** / **REQUEST CHANGES** / **CLOSE**.
Then STOP. Present the matrix + verdict + a draft review body locally.

The matrix is for you; the draft body is for the author, and it is written to a
different standard:

<!-- @include-begin _shared/comment-craft.md -->
**Every finding carries a severity tag whose merge impact is explicit**, so the
author never has to guess whether a comment is a gate or a thought:

| Tag | Means | Merge impact |
|---|---|---|
| `[Blocking]` | Correctness, security, or data integrity. | Blocks merge. |
| `[Non-blocking]` | A real improvement, the author's call. | Does not block. |
| `[Question]` | A design clarification — you may be the one missing context. | Does not block. |
| `[Observation]` | Informational, for the next reader. | No action implied. |

**Lead with the TL;DR in plain language**, before any detail: what you found,
whether it blocks, and what you would do. Burying the verdict under three
paragraphs of trace makes the author read the whole comment to learn it was a
nit.

**Frame findings as questions rather than commands** — *"It looks like X —
would it be worth considering Y?"* rather than *"You should do X."* The
imperative is only honest when you are certain, and you are certain less often
than you feel; the question costs the same characters and leaves the author room
to answer *"no, because…"* without it reading as defiance.

**Every finding cites evidence**: a file:line, another PR, a ticket, a doc URL,
or the output of an experiment you actually ran. A finding with no citation is
an opinion wearing a severity tag.

**Never flag style, formatting, or naming.** The formatter and the linter own
those. A review that spends its first three comments there teaches the author to
skim the rest of it.

**Match the tone to the author.** Someone senior in this code wants the
mechanism and nothing around it; someone newer needs the *why* and a pointer to
the pattern the codebase already uses. The finding is identical either way —
only the scaffolding changes.
<!-- @include-end _shared/comment-craft.md -->

**Post only when the user explicitly authorizes it.** Then:
`gh pr review N --approve|--request-changes|--comment -F /tmp/body.md`, and
verify it landed (`gh api …/reviews | select(.user.login==ME) | last`). For
inline replies / thread resolution / re-request, follow `skills/pr-review-kit/ENGAGE.md` (its Phase 9). For
a finding small enough to land as a one-click applyable suggestion, use
`scripts/pr-suggest.sh` (dry-run by default; refuses unchanged-context anchors).
Posting is the only action that touches shared state — never infer authorization.

---

## Appendix — Tool adapters

The chain is tool-agnostic; these are the known bindings for the verbs Phases
1, 2.3 and 5 want. Add a new adapter by mapping the same verbs. **Keep environment
specifics (install paths, corpus roots, private repo coordinates) out of this
file — they live in the tool's own setup doc, not here.**

**modmap** (depgraph CLI + `modmap-mcp` MCP server) — provides all verbs:
- `modmap pr N` → fetch PR head into a worktree + impact (Phase 2.2 one-shot).
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
  verify exact symbols). No PR-worktree fetcher; use the git fallback in Phase 2.2.

**none** — skip Phase 2.3 and Phase 5's tool steps. Everything else runs: the
context gather (Phase 2.1), the pr-review-kit discipline (Phase 3), the dimension
sweep (Phase 4), the significance gate (Phase 6) and explain-work (Phase 7) still
produce a rigorous, teachable review. This is the live state whenever the
code-intelligence MCP server is down, and it is not a failure of the skill.

---

## Design rationale

- **Why a fixed sequence?** Ad-hoc structural review anchors on whatever the
  reviewer noticed first. A deterministic chain guarantees the same evidence
  shape every time: orientation + reach (Phase 2) → discipline (3) →
  shape-appropriate depth, swept for completeness (4) → method truth (5) →
  significance (6) → teaching (7) → falsifiable matrix (8).
- **Why generation and significance are separate phases.** A candidate producer
  is supposed to over-generate; a gate is supposed to be stingy. Fusing them
  gives you a producer that self-censors and a gate with nothing to weigh. Phase
  4 sweeps wide and Phase 6 cuts, and because the cut is recorded per candidate
  the reader can audit both halves.
- **Why pluggable tools instead of hardcoding one?** The structural verbs
  (impact, method-drill, owners, event graph) are stable; the tool providing
  them is not. Binding late keeps the skill shareable and lets a better tool
  drop in without a rewrite.
- **Why reuse pr-review-kit + explain-work + `scripts/pr-context.sh` +
  `skills/pr-review/DIMENSIONS.md` + `finding-triage` rather than reimplement?**
  Each already carries its discipline and its own evolution; this skill's job is
  the *orchestration and the tool seam*, not re-deriving review rules. So each is
  named and invoked here and its content lives only in its own file — a copied
  decision rule is a copy that goes stale, and `/pr-review` calls the same two
  nodes at the same two points, which is what keeps the two orchestrators
  recognizable as siblings.
