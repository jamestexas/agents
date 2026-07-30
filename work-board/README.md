# work-board

A local, at-a-glance board of *your* work: "how are my PRs, and does anything
need me?" — the [canonical-hours](https://github.com/agentic-research/canonical-hours)
board question, rendered as an interactive graph instead of a flat list.

Every open PR (and, later, calendar event) is a node. **One data model,
several interchangeable layouts.**

## Run (no build step)

```bash
cd work-board
export WORKBOARD_REPO=owner/repo  # the repo whose PRs you want boarded
python3 scripts/serve.py          # http://localhost:8787
```

`serve.py` serves the static page **and** exposes `POST /refresh`, so the
in-page **↻ refresh (live)** button re-pulls your PRs without a shell. (A plain
`python3 -m http.server` also works, but then the button can only re-read the
file — it can't run `gh`.)

A fresh clone with no `data/board.json` renders `data/board.example.json` so you
see the shape immediately.

## Encodings

- **colour** = lifecycle state — `opened` · `active` · `needs_you` · `resolved`
- **radius / vertical** = staleness (older = toward the rim / bottom)
- **shape** = your role — ● you authored · ◆ you're reviewing · ▢ calendar event
- **fill** = whose court — **solid** = waiting on *you* · **hollow** = *monitoring* (on others)
- **label / tag** = the next action — `merge` · `fix ci` · `respond` · `review` · `ready?` · `attend`
- **green ring** = merge-ready · **dashed** = draft

### Layouts (toggle top-left)

- **◷ dial** — quadrant = state, radius = staleness. `needs_you` wedge tinted; things drift to the rim as they rot.
- **◴ sweep** — angle purely by recency.
- **▤ stack** — vertical time column: future events above a *now*-line, PRs below, freshest→stalest. (The text list hides here — the rows *are* the list.)

### Filters + low-signal bucket

`all · mine · reviewing · needs me`, plus a **⌁ low-signal** chip that collapses
bot/dependabot PRs and review asks gone stale (>14d) so they don't bury the
handful of PRs that actually want your eyes. Click to reveal.

## Refresh with your live PRs

`data/board.json` is **gitignored** (it's your real PRs + review load). Populate it:

```bash
scripts/refresh.sh owner/repo      # or: export WORKBOARD_REPO=owner/repo && scripts/refresh.sh
```

or just hit **↻ refresh (live)** in the page. It folds three slices —
authored, `user-review-requested:@me` (direct asks, not team fan-out), and
`reviewed-by:@me` (monitoring) — running concurrently, and detects bot PRs.
Requires an authenticated `gh` + `jq`. Writes only `data/board.json`; **pushes nothing.**

## Data shape

`data/board.json` mirrors the canonical-hours board item, plus `role`,
`waiting_on`, `last_activity`, `merge_ready`, and `bot`. See
`data/board.example.json` for a runnable sample. Swap in any board that matches
the shape — this is a *view*, not a reimplementation.

## Status

Personal prototype, local only. Calendar (iCal) source is designed but not yet
wired.
