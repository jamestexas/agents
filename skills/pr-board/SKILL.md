---
name: pr-board
description: >
  Use when you ask "how are my PRs?", "did I address Mark's review?", "what's
  new on the PRs I opened?", or "anything waiting on me?" — the recurring
  authored-PR status question. Answers it lectio-first via
  memory_authored_activity (reviews/comments by OTHERS on PRs you authored,
  your own replies excluded), refreshes the gh source if it's stale, joins
  each PR to your local worktrees + notes, and prints a board of what needs
  you. Falls back to gh only for coverage gaps. Read-only; posts nothing.
user-invocable: true
argument-hint: "[--since <dur>] [--pr <ref>] [--no-refresh]"
allowed-tools: "mcp__lectio__*, Bash(lectio:*), Bash(gh:*)"
---

# pr-board — what's new on the PRs I authored

The recurring question this answers: *"how are my PRs / did I address the
reviews?"* — asked constantly during review cycles, and usually answered by
hand-rolling `gh` because nothing makes the better tool the default reach.
lectio already has the answer: `memory_authored_activity` is purpose-built for
"reviews and comments by other people on PRs I authored, since I last looked,
excluding my own replies." This skill makes that the default, keeps it
**fresh**, and adds the cross-source join (PR ↔ local worktree ↔ notes) that
only lectio can do.

**Model:** lectio is the substrate; this skill is the *reach* + *freshness* +
*presentation* layer. lectio reports last-known state; the skill decides
whether that's fresh enough and refreshes if not (the "derive current state"
move). gh is the fallback for what lectio doesn't cover, never the first reach.

## Arguments

- `--since <dur>` — window for "new activity" (e.g. `24h`, `3d`). Default `24h`.
- `--pr <ref>` — focus one PR (`42090` or `chainguard-dev/mono#42090`); skips the board, deep-dives that PR's review thread + your reply status.
- `--no-refresh` — skip the freshness step (use lectio as-is; faster, possibly stale).

---

## Phase 0 — Freshness (derive current state)

lectio's answer is only as current as its last `gh` sweep. Before reading,
make it fresh — this is now safe to run alongside the launchd sweep timer
(WAL + busy_timeout, lectio bead fa895f), so it won't error on a lock.

1. Unless `--no-refresh`: `lectio sweep --source gh --if-stale 10m`
   (also `--source linear --if-stale 10m` if the question touches Linear).
   `--if-stale` no-ops when gh swept within 10 min, sweeps otherwise — cheap to
   call every time.
2. Optional sanity read: `lectio status --json` shows per-source
   `last_advanced_at` — if gh is hours stale and the refresh didn't move it,
   the sweep service may be wedged (see lectio bead 0618a0); say so rather than
   silently reporting stale data.

> If the `lectio` MCP / CLI isn't available at all, skip to Phase 3 (pure gh
> fallback) and say up front that this is gh-only, no cross-source join.

---

## Phase 1 — Ask lectio the authored-activity question

Call `memory_authored_activity` with `since_nanos` = now − `--since`
(default 24h). It resolves "mine" from your `[identity] gh_logins` (falls back
to `gh.authors`) — no need to pass authors. It returns, per PR you authored:
the PR (repo, number, title, state/merged), and the **new items** — reviews and
review-comments by people who aren't you, since the window — each with author,
path, preview, timestamp. Author attribution is present (lectio bead 380b79),
so "whose review" is answered without falling back to gh.

If it returns an empty/zero result, that's a real answer ("nothing new on your
PRs since <t>") — report it, don't go hunting in gh to manufacture activity.

---

## Phase 2 — Join each PR to your local context (lectio's edge)

For each PR with new activity, a quick `memory_search "<number>"` (and/or
`memory_traverse` on the PR URI) surfaces the cross-source threads lectio
uniquely holds: your local review worktree (`fs://…/<repo>-pr-<n>-review`),
notes files, the commits that touch the same files, prior turns where you
discussed it. This is the value over `gh` alone — gh knows the PR, the
filesystem knows your worktree, lectio has both joined on one graph.

For `--pr <ref>`: skip the board, deep-dive this one — full review timeline
(`memory_get_timeline` on the PR URI), each reviewer's comments, and crucially
**whether you replied after their latest comment** (compare your latest
authored item's timestamp vs the reviewer's). That's the literal
"did I address the review?" answer.

---

## Phase 3 — Present the board

One scannable block, sorted by what needs you most (unanswered reviews first):

```
PR board — new since <window>  (gh swept <freshness>)

chainguard-dev/mono#42090 — "title" — OPEN — ⚠ NEEDS REPLY
  • Mark: 3 review comments (src/foo.rs, src/bar.rs) — 2h ago — you haven't replied since
  • local: ~/github/.../mono-pr-42090-review worktree, notes at <path>
chainguard-dev/mono#39311 — "title" — OPEN — ✓ replied
  • Carol: 1 approval — 1d ago
…
2 PRs with new activity · 1 needs your reply
```

- **What needs you:** the short list where a reply or decision is pending — the actual point of the board.
- **Attribution:** name the reviewer (Mark, Carol) — it's in the data now.
- **Cite URIs** for claims drawn from lectio (per its epistemic contract), and flag any answer that's from stale data if Phase 0 couldn't refresh.

**gh fallback (coverage gaps only):** if a PR you know exists isn't in lectio's
result, it's likely outside configured `gh` coverage (`memory_list_sources`
shows the scopes). For that specific gap, `gh pr view <ref> --json …` — and
note it's a coverage gap worth adding to `[[gh.repo]]` or `author_scoped`, so
next time lectio has it.

---

## Posture

Read-only. This skill answers a question; it never posts a reply, approves, or
comments. When the board says "#42090 needs a reply," handing off to compose
that reply is a separate, explicit step the user initiates.
