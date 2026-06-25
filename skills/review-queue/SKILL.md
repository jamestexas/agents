---
name: review-queue
description: "Fan out isolated, one-per-PR code reviews across your review queue, then synthesize. Use when you have several peer PRs to review and want each in its own context + git worktree (no cross-PR pollution), with a single consolidated report at the end. Dispatches the pr-reviewer sub-agent (isolation worktree, read-only) per PR; pulls the queue from a review inbox (zen) or gh; optionally catches up via an observational memory layer if one is connected; posts nothing without explicit per-PR authorization."
---

# Review Queue — isolated per-PR reviews, fanned out and synthesized

The problem this solves: reviewing N peer PRs in one long session pollutes context — findings, file reads, and design intent from PR A bleed into PR B. This skill keeps each review in its **own sub-agent + own git worktree**, then consolidates. One command, N clean reviews, one report.

**Model:** the orchestrator (you, the main session) builds the worklist, dispatches one `pr-reviewer` sub-agent per PR, and synthesizes. The sub-agent carries the discipline (pr-review-kit) and `isolation: worktree`; the orchestrator never reviews a PR itself (that would re-pollute the main context).

## Arguments

A list of PR numbers/URLs to review (e.g. `42088 42090 39311`, or full `chainguard-dev/mono#42090` refs). If empty, the skill builds the queue from your review inbox (Phase 0).

---

## Phase 0 — Build the worklist + catch up

1. **Get the queue** (first source that's available):
   - **zen** (if the `zen` MCP is connected): call `zen_inbox` — PRs awaiting *you* (configured authors + explicit review requests). This is the intended source.
   - **gh** fallback: `gh search prs --review-requested=@me --state=open --json number,title,repository` (and/or the repos you care about).
   - **args**: if the user passed PR refs, use those verbatim — skip discovery.
2. **Catch up via an observational memory layer** (optional — only if your harness provides one, e.g. a memory/timeline MCP) — for each PR you're about to review, a quick timeline / text search to surface *what changed and who reviewed since you last looked* (especially if it's a re-review). This is the "stay current" layer — query it, don't carry it. Skip silently if no such source is connected.
3. **Confirm the list with the user** before dispatching — show `repo#number — title` for each, note any that are drafts or already-approved, and let them prune. Don't fan out a dozen agents on an unconfirmed list.

---

## Phase 1 — Fan out (one isolated reviewer per PR)

Dispatch one **`pr-reviewer`** sub-agent per confirmed PR, **in parallel** (independent work, no shared state). Each `pr-reviewer` already declares `isolation: worktree` + read-only tools, so it gets its own repo copy and clean context.

In each dispatch prompt, give the agent exactly what it needs (it can't ask you):
- `OWNER`, `REPO`, `N` (PR number)
- the canonical remote name for fetching (`upstream` on a fork checkout, else `origin`)
- intent: **review-only — return a structured summary, post nothing**
- any design-doc pointer you have (path/URL), so it doesn't have to hunt blind

Label each agent by PR (e.g. `review:mono#42090`) so progress is legible. Sub-agents can't spawn sub-agents — that's fine; the worker is flat by design.

> Scale note: ~5 PRs fan out cleanly as parallel sub-agents. If you're ever past ~10–15, or you want the reviewers to adversarially cross-check each other before reporting, that's the **Workflow** tool's territory (codified orchestration, dozens of agents) — switch to it rather than hand-dispatching.

---

## Phase 2 — Synthesize

Collect each sub-agent's structured summary (verdict + falsifiable matrix + blockers/nits/questions). Then produce **one** consolidated report:

- **Per-PR line:** `repo#N — VERDICT — one-line why` (sortable: BLOCKED/CHANGES first, SHIP last).
- **Cross-PR themes:** anything that recurs (same nit across PRs, a shared dependency two PRs both touch, a design question that spans them). This is the value the orchestrator adds over reading N separate reports.
- **What needs *you*:** the short list of PRs where a human decision is required (a design call, an approve, a "reply to reviewer").

Verify before relaying: the sub-agents are competent but not infallible (misidentified targets, stale framing, phantom citations). For any **blocker** a sub-agent reports, spot-check its evidence command against the actual code before you present it as fact.

---

## Phase 3 — Post (only on explicit, per-PR authorization)

**Default posture: post nothing.** The report is local until the user says, per PR, "post the review on #N" or "approve #N." Posting is the one side-effect that's visible to others; never batch-post or infer authorization. When authorized, follow pr-review-kit Phase 8 (body-only review, inline threads, or atomic batch) and verify it landed.

---

## Hygiene

- The `pr-reviewer` worktrees auto-clean when the agent makes no changes — and a review makes none — so they shouldn't accumulate. Still, `git worktree list` periodically and prune anything stale.
- This skill orchestrates; the **pr-reviewer** agent and **pr-review-kit** skill carry the per-PR discipline. Keep the division: orchestrator builds the list + synthesizes; worker reviews one PR in isolation.
