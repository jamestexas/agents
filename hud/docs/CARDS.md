# Cards — panels as declared sources with a key and a join

A **card** is a declared source plus a presentation. The source yields rows,
rows have a **key**, and a card may **join** another card's rows on that key.
The server owns sources and joins and serves one JSON shape per card at
`GET /api/card/<name>`; the UI renders any card from that shape plus the card's
column list. Adding a card is a `hud.toml` stanza and, for a new source shape, a
normaliser file in-tree — no route, no panel code.

This is steps 1–2 of the design: the registry, the `fs` and `http` kinds, the
`reviews` and `board` cards with the reviews join, and the old `/api/reviews`
and `/api/dyn/board` routes kept as aliases. The per-source `[sources.*]`
tables in [SOURCES.md](SOURCES.md) still drive every other panel and are
synthesised into cards where a card exists for them (below).

## The schema

```toml
[cards.reviews]
kind    = "fs"
glob    = "projects/*/raw/PR-*/state.json"
shape   = "review-state"
key     = "pr_url"
title   = "Review runs"
scope   = "open"
columns = ["pr", "project", "mode", "phase", "phases", "verdict", "mine", "humans", "bots", "threads", "early", "gates", "unavail", "findings", "note", "posted"]

[cards.board]
kind    = "http"
url     = "http://127.0.0.1:2000/board"
shape   = "work-board"
key     = "pr_url"
title   = "My PRs"
columns = ["pr", "title", "why", "verdict", "gates", "note", "posted", "threads"]

[cards.board.join.reviews]
columns = ["verdict", "gates", "note", "posted", "threads"]
latest  = "started"

[layout]
order = ["reviews", "board", "digest", "sessions", "loadout", "peers"]
```

`hud.config.json` accepts the same keys as JSON. The TOML parser is the
subset SOURCES.md describes, plus single-line arrays of strings, integers and
booleans — which is what `columns` and `order` need and all they need.

| Key | Type | Required | What it is |
| --- | --- | --- | --- |
| `kind` | string | yes | Which source kind reads the rows (table below). `source` is accepted as a spelling of the same key. |
| `title` | string | no | The panel heading. Defaults to the card's name. |
| `shape` | string | yes | Which normaliser turns a row into an item. Today: `review-state`. |
| `key` | string | no | The derived field rows meet on in a join. Today: `pr_url`. |
| `scope` | string | no | A filter the shape declares; `review-state` has `open` and `all`. The card's default; `?scope=` overrides it per request. |
| `columns` | list of strings | no | Column ids the UI renders, through its cell registry. Defaults to the shape's own list. |
| `root` | string, `~` expanded | `fs` only, no | Where the glob is applied. Defaults to `HUD_ROOT`. |
| `glob` | string, `*` within one segment | `fs` only, yes | The files that are rows, relative to `root`. The same walk and refusals as `[sources.reviews] glob`. |
| `url` | string | `http` only, yes | An absolute http(s) URL to GET — loopback by intent, not enforced, because a HUD in a container reaches its board through the host's name. |
| `[cards.A.join.B]` | table | no | Attach B's row with the same key to each row of A, under the field `B`. `latest` names the field that picks between several B rows (newest wins); `columns` lists the column ids the joined row contributes. B must be a declared card other than A, and both must declare the same `key`. |
| `[layout] order` | list of strings | no | Panel order, top to bottom. Defaults to today's aside: `reviews, board, digest, sessions, loadout, peers`. |

A card's name is its route segment: letters, digits, `_` and `-`.

## Kinds

Every kind the design names is declared in the registry, so a stanza for one
that is not served yet reads *"not served yet"* rather than *"unknown kind"*,
and its required field is still checked. The table is generated from
[`cards/registry.mjs`](../cards/registry.mjs) by `hud docgen`.

<!-- @generated-begin: cards-kinds-table -->
| kind | status | reads | rows from | degraded when |
| --- | --- | --- | --- | --- |
| `fs` | **now** | files under a root matched by a segment glob (`*` within one segment) | one row per file; a file that is not a JSON object is one `unreadable` row | bad glob → misconfigured; absent root → an empty card |
| `http` | **now** | one GET of a loopback URL, JSON | the array the response carries (`items`, `prs`, or the top-level array) | non-2xx, timeout, bad JSON → last snapshot with `stale`, else 503 with the reason |
| `cmd` | next | argv, no shell | one JSON object per line, or one JSON array | non-zero exit, bad JSON → 503 with the first stderr line |
| `prometheus` | next | one PromQL instant or range query, bearer token from a `token_cmd` | one row per series (labels + value) | token command non-zero or 401 → 503 with the reason; query parse error → 503 with the API's text |
| `mcp` | next | one read-only tool call on an MCP server already configured for this machine | the array in the tool's structured result, or one row per text item | server absent from config → card off; connect failure or tool error → 503 with the first error line |
<!-- @generated-end: cards-kinds-table -->

**The single pane rule.** A card never owns a credential. `fs` reads the
tree, `http` talks to loopback, and the later kinds borrow a credential the
machine already holds — a token command, a local CLI, a configured MCP server
— by path or command, never by value. Adding a data source is a config
stanza, never a new secret store.

## Shapes

A **normaliser** is the only place that knows a source's field names. It is
registered in code by the `shape` a card names, because the HUD must not
trust arbitrary JSON onto the page: copy field by field, drop unknown keys at
every depth, derive the fields the page needs. A row the normaliser rejects is
dropped and counted in the response's `rejected`.

| shape | rows are | derives | scopes | default columns |
| --- | --- | --- | --- | --- |
| `review-state` | a review run's `state.json` | `project`, `running`, `elapsed_s`, `phase_seconds`, `pr_url`, `note_url`; `phases`, `early` and `review_state` rebuilt field by field | `open` (running or not yet posted), `all` | the sixteen the REVIEW RUNS panel shows |
| `work-board` | a row of the local work-board service | `pr_url` from `repo` + `number` or the row's `url` (null for a row whose `kind` is not `pr`); keeps `number`, `url`, `title`, `state`, `reason`, `kind`, `repo` | — | `pr`, `title`, `why`, `verdict`, `gates`, `note`, `posted`, `threads` |

The field-by-field contract of `review-state` — what each key means, what is
nulled, what is dropped — is written up under *reviews* in
[SOURCES.md](SOURCES.md#reviews-reads-the-tree-it-already-serves); the code is
[`cards/normalize/review-state.mjs`](../cards/normalize/review-state.mjs). A
file the glob names that is not a JSON object is still a row — `unreadable:
true`, the path, the reason — because a run whose state cannot be read is a
fact about the tree, not an absence from it. This shape rejects nothing.

`work-board` rejects a row that is not an object (counted in `rejected`) and
also reads the payload's **self-report** — `tick_status` and `degradations`,
whitelisted to `{source, error}` — which the response carries as `health` so
the page's banner can say "github: graphql 401" rather than "degraded".
A shape without a self-report has no `health` key at all.

## Keys and joins

A key is a **derived** field the normaliser computes, never raw input. One key
exists: `pr_url`, the canonical `https://github.com/<owner>/<name>/pull/<N>`,
computed from `repo` + `pr` (or `number`) and refused — `null` — when either
half is not what it claims. Other keys follow the same rule: one function per
key, used by every card that declares it.

`[cards.A.join.B]` attaches to each row of A the B row with the same key,
keeping the newest by `latest` when several match, under the field `B`. Join is
best effort: B unreachable or misconfigured leaves A's rows untouched and A's
response says `joins: {B: "unavailable: <reason>"}`; so does a card served
from its snapshot, because joins are applied on the live path only and never
written into a snapshot. What a joined row carries is B's shape's projection
(`forJoin`): for `review-state`, `phase`, `verdict`, `gates`,
`probes.unavailable`, `findings`, `note_url`, `posted`, `review_state`,
`running` and `elapsed_s` — every key present, null when the run has nothing
for it. A card with no joins answers `joins: {}`.

On the card route the field is named after the joined card: a board row's run
sits under `reviews`. The old `/api/dyn/board` envelope spelt it `review`,
singular, and keeps doing so — that is the one place the old name survives.

## The route

`GET /api/card/<name>` — one path segment, nothing after it — answers:

```json
{
  "card": "reviews",
  "source": "fs",
  "title": "Review runs",
  "stale": false,
  "generated_at": "2026-10-29T10:00:00.000Z",
  "root": "/path/to/hud",
  "columns": ["pr", "project", "mode", "phase", "phases", "verdict", "mine", "humans", "bots", "threads", "early", "gates", "unavail", "findings", "note", "posted"],
  "joins": {},
  "count": 3,
  "truncated": false,
  "rejected": 0,
  "items": [ { "path": "projects/example-one/raw/PR-101/state.json", "project": "example-one", "pr_url": "https://github.com/owner/repo/pull/101", "running": true } ]
}
```

`root` is present for kinds that have one; `health` for shapes that read a
self-report. `generated_at` is when the rows were produced — now for a live
answer, the snapshot's own age when `stale`. `count` is the rows served;
`truncated` is set when the kind stopped reading early (the `fs` walk looks at
2000 files at most) or when more rows than one response carries (200) were
kept. `items` is sorted by the shape's order — for `review-state`, running
first, then newest `started` first.

| Condition | Answer |
| --- | --- |
| the config declares no card by that name (or there is no config) | **404**, `{card, error: "card <name> is not configured in hud.toml"}` — the panel does not exist |
| the stanza was refused: unknown kind, a kind not served yet, a missing or unusable field | **503**, `{card, error: "misconfigured: <where>: <reason>"}` — the panel renders red with the reason; every other card is unaffected |
| `?scope=` outside the shape's vocabulary, or a scope on a shape that has none | **400**, `{card, error}` |
| the upstream is down and the card has no snapshot (`http`) | **503**, `{card, error}` with the upstream's reason |
| the upstream is down and the card has a snapshot (`http`) | **200**, `stale: true`, `generated_at` the snapshot's age, joins `unavailable` |
| any verb but GET or HEAD, on this or any path under `/api/card/` | **405** |

`?scope=<value>` overrides the card's declared scope for one request. A card
that declares none serves every row by default.

An `fs` card reads live and writes nothing. An `http` card writes its
snapshot — the upstream's own bytes, never a joined field — to
`$HUD_ROOT/.generated/cards/<name>.json` on every live answer, and reads it
back when the upstream is down; a tree from before cards still has its board
snapshot at `.generated/board.json`, which is read until a live answer writes
the new path and never written again.

`GET /api/cards` answers `{cards: [names], layout}` — every card the config
declares, misconfigured ones included (the page renders them red rather than
losing them), and `[layout].order` or the default — so the UI can draw the
aside without knowing any card's name in advance.

## Legacy config

A `hud.toml` with no `[cards]` table has its `[sources.*]` tables synthesised
into cards at load time, so nobody rewrites their config on day one:

| Legacy table | Becomes | Notes |
| --- | --- | --- |
| `[sources.reviews]` (`root`, `glob`) | `[cards.reviews]` exactly as the schema above spells it | `root` and `glob` carry over; an empty string is the same as absent. A glob the walker refuses is a misconfigured card, worded `sources.reviews.glob in hud.toml: …`. |
| `[sources.board]` (`url`) | `[cards.board]` as the schema above spells it, with `[cards.board.join.reviews]` when `[sources.reviews]` is on too | A board table with no `url` synthesises nothing, as the old route treated it as unconfigured. |

A `[cards]` table present — even empty — is the answer: with one, `[sources.*]`
is not synthesised. Mixing the two forms for the same panel is not supported.

**`/api/reviews` and `/api/dyn/board` are aliases** for the reviews and board
cards under their old envelopes, read from the registry so they answer from
either config form, and produced by the same code as the card route.
`/api/reviews` keeps `source: "reviews"`, `glob`, `scope` (default `all`) and
`items`; `/api/dyn/board` keeps `source: "board"`, `stale`, `cached_at` and
`data` — the upstream payload as it came, with `review` on each joined row —
and its old answer to "not configured", a **503** (reviews, which never had a
snapshot tier, answers the panel-off 404). `test/cards.parity.test.mjs`
asserts each alias and its card route agree on the rows and degrade the same
way. Both go after one release.

## Adding a card

1. For a source shape the tree already has a normaliser for: a stanza.
2. For a new shape: a file under `cards/normalize/` exporting `normalize(row,
   ctx)`, `COLUMNS`, optionally `SCOPES` + `inScope` and `compare`, registered
   in `SHAPES` in `cards/registry.mjs`; then a stanza. The whitelist discipline
   is not optional — a normaliser that passes a row through is the hole the
   shape exists to close.
3. No route, no UI change. The UI renders any card from its response.

Out of scope, by design: YAML, writes of any kind, a loader for third-party
normalisers, per-user layouts beyond `[layout].order`.
