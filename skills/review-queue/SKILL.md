---
name: review-queue
description: >
  Folded into /review — use `/review <n> <n> ...` instead, which runs one
  isolated review per PR (own run directory, worktree and sub-agents) and then
  one cross-PR summary. With no PR list, build it from your review inbox first.
  Posts nothing without per-PR authorization.
argument-hint: "[PR numbers or owner/repo#N refs]"
---

# review-queue → /review with several PRs

`/review` takes several PRs: `/review 42088 42090 owner/repo#39311`. See
"Several PRs" in `skills/review/SKILL.md`. Each PR gets its own run
directory, worktree and sub-agents, so nothing from one review reaches
another; the evidence runs are safe to start in parallel against one clone.

With no list, build the queue the way this skill did, then pass it to
`/review`:

- `zen_inbox` when the zen MCP is connected (PRs awaiting you), else
- `gh search prs --review-requested=@me --state=open --json number,title,repository`.

Confirm the list with the user before fanning out, and show
`repo#number — title`, drafts and already-approved PRs marked.

Posting stays per PR: nothing posts without `--post`, and `--post` with
several PRs still asks for each one.
