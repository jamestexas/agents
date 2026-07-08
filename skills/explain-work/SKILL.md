---
name: explain-work
description: >
  Review a unit of work (a PR, a Linear ticket, or a path) and explain it so it
  sticks — composing structural context (mache/seams), team ownership
  (CODEOWNERS), and intent (the ticket) into a taught synthesis rather than a
  bare findings list. Emphasis shifts by authorship: work you own gets
  domain-onboarding (so you can defend it in a meeting); a peer's gets
  findings-teaching (so you learn to spot it yourself). Reads your situated
  context from native user rules + auto-memory when present and degrades
  gracefully without it. Local/explain only — posts nothing, edits nothing.
when_to_use: >
  When you want a review coupled with "explain this to me" — prepping to discuss
  a ticket you own, or learning from a peer's PR. Not for posting reviews (use
  pr-review) or for the reviewer-only structural pre-flight alone (use
  review-prep).
allowed-tools: "Bash,Read,Glob,Grep,Agent,mcp__mache__*"
argument-hint: "<PR number, owner/repo#N, LINEAR-ID, or path> [--deep]"
---

# explain-work — review coupled with "explain this to me"

Take one unit of work and explain it at the altitude the available context
justifies. The value is not new analysis — it is **composing** analysis you
already produce (structural, ownership, intent) and **teaching** it. This is a
generic skill: it contains no personal or org-specific data. All situated
context is read at runtime from sources below, so the skill stays shareable and
PII-free.

**Output is local only. Post nothing, edit nothing.**

## Arguments

`$ARGUMENTS` — `<PR number, owner/repo#N, LINEAR-ID, or path> [--deep]`

- The target resolves to a PR, a Linear ticket, or a path/diff (auto-detected).
- `--deep` runs the full review-lens panel (see Step 4). Default is a light pass.

## Step 0 — Check for prior session context

Before fetching anything, check whether the current session already contains
analysis of the same target. If a `pr-review-kit`, `pr-review`, or `review-prep`
pass was just run in this session for the same PR/path, **reuse that context
rather than re-fetching**. The layers that are already materialised (file reads,
commit history, inline comment triage, matrix rows) should be treated as the
`hard` layer from Step 2 — no need to repeat the gh calls or worktree setup.

Signal that session context was reused in the degradation report (Step 6) so
the user knows the explanation was built from the live analysis, not a cold
fetch.

## Step 1 — Resolve the unit of work and authorship

1. Detect the input type: PR number / `owner/repo#N` → a PR; `[A-Z]+-\d+` → a
   Linear ticket; otherwise a path or the current diff.
2. Determine **authorship**: is this the user's own work or a peer's? For a PR,
   compare the PR author to the active `gh` login (`gh api user --jq .login`).
   For a ticket, check the assignee / linked PR author. Authorship sets the
   teaching **emphasis** (Step 5).

## Step 2 — Assemble context layers (use what is reachable; degrade gracefully)

Each layer is a seam: present it when the source is available, skip it silently
when it is not. Never block on a missing layer. **Track each layer's outcome**
(reached / partial / skipped + reason) for the degradation report in Step 6.

- **Code / structural** — run `review-prep` (spec + emergent diagrams + impact)
  for a PR/diff, or read the files directly for a path. This is the `hard` layer.
- **Boundaries / dependencies** — run `seam-discovery` on the touched
  project(s) to map what this work depends on and what depends on it.
- **Team ownership** — read the repo `CODEOWNERS`; map the touched paths to
  owning team(s) ("who owns this / who will review it").
- **Intent** — for a Linear ticket (or a PR's linked ticket), pull the ticket
  body / design / acceptance criteria so the explanation is anchored to intent,
  not just code.
- **Situated identity (optional, never required)** — read the user's native
  context if present: `~/.claude/rules/identity.md`, user-level
  `~/.claude/rules/*.md`, and auto-memory (`MEMORY.md`). Also **derive** a
  lightweight identity signal from the user's recent commits and the CODEOWNERS
  teams of the paths they touch. If a richer observational source is available
  (e.g. an observational-memory MCP query for recent work / intersecting teams,
  if your harness provides one), use it.

## Step 3 — Reconcile authored vs derived identity

If both an authored identity (Step 2) and a derived signal exist and they
**meaningfully** diverge — e.g. the authored team/project does not match the
CODEOWNERS teams of the user's recent work — surface it with one
`AskUserQuestion` before explaining ("your profile says project Y, but your
recent commits are in project Z — which lens for this?"). Do not nag on minor or
ambiguous differences; only ask when the divergence would change the altitude of
the explanation.

## Step 4 — Review

- **Default (light):** the structural + ownership + intent context from Step 2 is
  enough to explain most work. Note what is notable / risky inline; do not run a
  full agent panel.
- **`--deep`:** run the full review-lens panel (delegate to `pr-review-kit`
  discipline / parallel analysis agents) and fold confirmed findings into the
  teaching. Use when the user is reviewing a substantial peer PR and wants the
  findings, not just the shape.

## Step 5 — Teach (the point of the skill)

Synthesize the layers into an explanation, not a report. For each notable thing,
give the **why**, not just the **what** — tie a finding or design choice to the
seam / ownership / intent that makes it make sense ("this touches the auth seam
your team co-owns with X, which is why the validation order matters here").

Shift emphasis by authorship (Step 1):

- **The user's own work** → domain-onboarding: the design, the AC, the
  trade-offs and the parts a reviewer will probe — so they can defend it.
- **A peer's work** → findings-teaching: the concept behind each finding and how
  to recognize it next time.

Scale to the context available: sparse context yields a solid code + findings
explanation; rich context (ownership + intent + identity) yields a situated one.

## Step 6 — Degradation report (always emit, even when everything worked)

After the teaching output, append a compact block showing what context was
actually available. This lets the user calibrate how much to trust the
explanation and where to dig deeper themselves.

Format:

```
---
**Context used for this explanation**

| Layer | Status | Notes |
|---|---|---|
| Code / structural | ✅ reached (session reuse) | pr-review-kit pass earlier this session |
| Seam / boundaries | ❌ skipped | seam-discovery not available |
| Team ownership | ✅ reached | CODEOWNERS: @org/team-name |
| Intent / ticket | ⚠️ partial | PR body only; no linked Linear ticket |
| Situated identity | ❌ skipped | no identity.md or memory present |
```

Status values:
- `✅ reached` — full data available and used
- `✅ reached (session reuse)` — used prior-session analysis, no re-fetch
- `⚠️ partial` — some data available; note what was missing
- `❌ skipped` — not available; note why (tool not connected, file absent, etc.)

Keep notes brief — one clause each. The block is a signal, not a diagnosis.
Do not omit the block when everything worked; a clean all-✅ table is itself
useful signal that the explanation is built on solid ground.

## Posture

- Local / explain only. **Post nothing to GitHub, edit no files.** (For posting a
  review, hand off to `pr-review`.)
- The skill carries no personal or org-specific data. Identity and org context
  live in the user's native rules / memory and are read at runtime, so the skill
  remains generic and shareable.
