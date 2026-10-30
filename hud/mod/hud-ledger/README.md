# hud-ledger

A Claude Code mod that keeps an in-session ledger of receipts — the outward-facing
things a session actually did — and flushes them into the HUD (`~/hud`) as a note.

## What it captures

A `tool.call` hook records a receipt only after the call succeeded:

| Tool call | Receipt |
|---|---|
| Bash `gh pr create` / `gh pr merge N` | PR opened (with URL) / merged |
| Bash `gws docs documents batchUpdate` | Google Doc edited (with link) |
| Bash `hud sync` | HUD synced |
| Linear MCP `save_issue` / `save_comment` | issue created or updated / commented |
| Slack MCP `slack_send_message` / `slack_schedule_message` | message posted or scheduled (with link) |

Receipts persist in `$.store` per session, so they survive mod reloads, `--resume`, and restarts.

## What it shows

- A line above the prompt: receipt count, how many are unflushed, and uncommitted changes in `~/hud` (polled every 60s).
- `/hud open`: a pane listing this session's receipts (flushed ones dimmed).

## Commands

- `/hud` or `/hud status`: counts and `~/hud` state
- `/hud open`: open the receipts pane
- `/hud flush`: write unflushed receipts as an inbox note via `hud new inbox --body-file -`, then mark them flushed. Run `hud sync` afterward to push.

## Where it writes, and what it never keeps

- **The HUD root** is `$HUD_ROOT`, else `~/hud`, the same rule the `hud` CLI uses. `/hud flush` writes one inbox note there through `hud new` (argument list, no shell; body on stdin). Nothing is pushed: `hud sync` stays your call.
- **The receipt store** is the mod's own `$.store` (a JSON file under `~/.claude/plugins/store/`), keyed by session.
- **Never stored:** raw commands, tool output, or file contents. A receipt keeps only what it parsed: a PR number, an issue id, a doc id, a link. A command line can carry a token; the ledger never sees it again.
- **Never blocks a tool.** The hook only observes: it runs after the tool succeeded, and if the hook itself fails the engine skips it and the tool's result stands.
- If the `hud` CLI isn't on PATH, `/hud flush` says so and keeps the receipts.

## Develop

```bash
claude --plugin-dir ./hud/mod/hud-ledger   # load with hot reload
claude plugin validate ./hud/mod/hud-ledger
(cd hud/mod/hud-ledger && claude plugin test)
```

Requires Claude Code 2.1.287 or later (built and tested on 2.1.314). Mods are early access; the API can change between releases.
