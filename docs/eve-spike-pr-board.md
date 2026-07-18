# Spike: pr-board as a persistent eve.dev service

Bead: `agents-395c30`. Design note only — no build, no deploy. Go/no-go to be
recorded as a comment on that bead before any implementation bead opens.

## Why pr-board

Of the always-on-flavored skills in this repo (`pr-board`, `rosary:evolve`,
`watch-pr`), `pr-board` is the cleanest candidate to spike: it's read-only
(never posts), has one clear data dependency (lectio), and its value —
"tell me what's new on my PRs without me asking" — is exactly the shape of
thing that's wasted if it only runs when a Claude Code session happens to be
open. It's also the smallest: no write path to get wrong.

## What it'd look like as an eve subagent

```
agent/
├── instructions.md          # "you are pr-board" — condensed from SKILL.md
├── agent.ts                 # model config
├── tools/
│   └── (none needed — lectio is reached via connections/, not a custom tool)
├── connections/
│   └── lectio.ts             # MCP connection to lectio (memory_authored_activity, etc.)
├── channels/
│   └── slack.ts               # or discord — see "channel choice" below
└── schedules/
    └── board-sweep.ts         # cron: every N hours, run the Phase 0-3 flow, post if non-empty
```

- **instructions.md** is close to a direct port of the current SKILL.md body — the
  Phase 0–3 flow (freshness → ask lectio → join local context → present) doesn't
  change; it's substrate-agnostic prose.
- **connections/lectio.ts** is the one genuinely new piece: eve needs its own MCP
  connection to lectio, configured independently of whatever gives Claude Code
  sessions access to it today. This is the actual "connections/ as an explicit
  contract" idea from the earlier eve-mapping discussion, applied for real.
- **schedules/board-sweep.ts** replaces the human typing `/pr-board` — a cron
  tick runs the same flow and only speaks if there's something to report
  ("2 PRs with new activity" vs. silence when there's nothing new, matching the
  skill's existing "empty result is a real answer" posture).
- **channels/**: the skill's output is a scannable text block today (Phase 3).
  A Slack DM channel is the natural fit — post the board only when non-empty,
  so it behaves like a notification, not a noisy always-on feed.

## Duplication vs. net-new

| Piece | Status |
|---|---|
| Phase 0–3 logic (freshness, ask lectio, join local context, present) | **Duplicated** — same prose, new home. Two copies to keep in sync if pr-board's logic changes. |
| lectio MCP connection | **Net-new config**, same underlying server — not a new dependency, just a second place it's wired up. |
| "join to local worktree" (Phase 2) | **Doesn't port cleanly** — that step reads the *local filesystem* of whichever machine ran the Claude Code session. An eve service running elsewhere (e.g. Vercel) has no access to your local worktrees. This phase would need to be dropped or reworked to point at a different signal (e.g. just the PR + lectio's cross-source threads, minus the worktree path). |
| Presentation/posture ("read-only, never posts") | **Net-new enforcement** — as a Slack channel it *does* post (a DM to you), which is a posture change from "answers a question when asked" to "speaks unprompted." Worth being deliberate about, not just porting the label. |

## Open questions (for you, not for me to decide)

1. **Hosting** — eve needs somewhere to run continuously. Vercel is the natural home given eve is a Vercel project; that's a real account/billing decision, not a local `npm run dev`.
2. **Secrets** — a standing service needs its own copy of whatever credentials the lectio MCP connection and Slack app require, held somewhere other than your local Claude Code session's config. New secret-management surface.
3. **Cost** — model calls on a cron schedule run whether or not anything's new, unless the schedule is cheap/gated well. Small for something like pr-board (short prompts, infrequent), but non-zero and worth sizing before committing.
4. **Maintenance burden** — a second runtime means the Phase 0–3 logic (see "duplication" above) can drift between the SKILL.md version and the eve version unless one is generated from the other or one is retired in favor of the other.
5. **Is this actually the itch?** — the original gap was "nothing runs without an open Claude Code session." `/loop` + a scheduled wakeup gets partway there *without* a second runtime, at the cost of still needing a live session. Worth confirming the always-on requirement is worth the operational cost before building, vs. leaning harder on Claude Code's own scheduling.

## Recommendation

Worth a real prototype only if you specifically want pr-board (or one of the
others) to notify you *without* a Claude Code session running — e.g. Slack
pings during the day while you're not in an active session. If the itch is
better described as "I keep forgetting to run `/pr-board`," a scheduled
wakeup inside Claude Code is far cheaper and doesn't introduce a second
runtime to maintain. Recording this as an open question on `agents-395c30`
rather than a decision — your call.
