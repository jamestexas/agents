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
| `refresh` | string, `"15s"` or `"2m"` | no | How often an open page polls the card. A whole number of seconds or minutes, at least `1s`; anything else (`"soon"`, `"15"`, `"1.5m"`) makes the card misconfigured. Defaults to `60s`. A `review-state` card holding a run in flight is polled every `15s` at most (see [Live updates](#live-updates)). |
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
  "refresh": 15,
  "root": "/path/to/hud",
  "columns": ["pr", "project", "mode", "phase", "phases", "verdict", "mine", "humans", "bots", "threads", "early", "gates", "unavail", "findings", "note", "posted"],
  "joins": {},
  "count": 3,
  "truncated": false,
  "rejected": 0,
  "items": [ { "path": "projects/example-one/raw/PR-101/state.json", "project": "example-one", "pr_url": "https://github.com/owner/repo/pull/101", "running": true } ]
}
```

`refresh` is the seconds the page waits before its next poll (below).
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
| `If-None-Match` names the answer's current `ETag` | **304**, no body ([Live updates](#live-updates)) |
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

## Live updates

An open page follows its cards without a reload, two ways at once: it polls
every card on the card's own cadence, and it listens on one event stream that
names a card the moment a file it reads changes. The stream is the fast path;
the polls are the floor, so a stream that drops — or a card the stream cannot
see — costs latency, never data.

**ETag polling.** A `200` from `GET /api/card/<name>` carries an `ETag` — the
sha256 of the body as served — and `Cache-Control: no-cache`. The page sends
it back as `If-None-Match`; when nothing changed the answer is **304** with no
body, and the rows already drawn stand. The hash is taken after normalisation
and joins, so a change to a joined card's rows (a board row's run) moves the
board's ETag too, as does a config edit to the card's columns or title. Left
out of the hash: `generated_at`, and the fields a shape derives from the clock
(`elapsed_s`, `phase_seconds` for `review-state`) — they move every second a
run is in flight while the run has not changed; the page advances them itself
between answers. Errors (404, 400, 503) carry no ETag, and the
`/api/reviews` and `/api/dyn/board` aliases answer as they always did.

**Cadence.** The body's `refresh` is when to ask next, in seconds: the card's
`refresh` (default `60`), or `15` while a `review-state` card holds a run in
flight (`running`), whichever is sooner. A card that answered with an error is
asked again after `60`; one that answered 404 — its stanza gone — is not asked
again until ⟳.

**The event stream.** `GET /api/events` is a Server-Sent Events stream. It
opens with

```
retry: 5000
event: hello
data: {"watching":true,"cards":["reviews"]}
```

— which cards it will name — and then sends, for every change it sees,

```
event: card
data: {"name":"reviews"}
```

plus a `: ping` comment every 25 s so an idle stream is not dropped. Behind it
is one `fs.watch` on `HUD_ROOT`, recursive, shared by every open stream and
closed with the last; changes are gathered for 250 ms, then matched against
every `fs` card whose `root` is `HUD_ROOT` or under it, by the same rules the
walk uses (a dot-prefixed or `_hud` name is never a row, so `.generated/`
writes name nothing). A path names a card when the glob covers it — a file
the glob matches, or a directory on the way to one. An `fs` card rooted
outside `HUD_ROOT`, and every `http` card, is not in `hello.cards`: it is
polled only. When the watcher cannot start, `hello` says `watching: false`
with the reason and the page polls.

The stream carries names, never rows: the card route stays the one place a
card is read. It is **GET only** (every other verb, HEAD included, is 405),
never reads a request body, and never writes to the tree.

**The page.** Each panel's heading says how it is following: `live · 3s ago`
for a card the open stream names, `polling · 3s ago` otherwise, where the age
is since the card last confirmed its rows (a 200 or a 304). A stale card keeps
its `as of <time>` stamp. When the stream errors the browser reconnects by
itself, every panel reads `polling` meanwhile, and each `hello` on reconnect
refetches the cards it names, so a change made while the stream was down is
not missed.

### Proving live updates

Headlessly, `node hud/test/live-smoke.mjs` (also run by `node --test hud/test`)
starts the real server on a free port against a tmp `HUD_ROOT`, opens the
stream, writes one run's `state.json` at phase `evidence` with `ended: null`,
then rewrites it three times — `questions`; `settle` with one early signal;
`rendered` with a verdict and `ended` — and asserts after each write that the
stream names `reviews` within a second, the card's ETag moves, the row shows
the phase, `early` and `running` the file says, and a poll with that ETag
before the next write is a 304. It prints one line:

```
live-smoke: 4 writes, event lag 250/262/262/262 ms (max 262), 4 polls 304, total 1138 ms
```

and fails if the whole sequence takes five seconds or more.

By hand, against a real review: `hud restart`, open the page and its network
panel, and from an agent session run `/review <owner>/<repo>#<N> --fast` on a
small open PR. What should be seen, with no reload at any point:

1. The run appears on REVIEW RUNS within a second of the skill's first
   `state.json` write, its stamp reading `live · Ns ago`.
2. The `phases` cell advances at each phase as the skill records it.
3. `early` lights if the run finds an early signal.
4. When the run posts, the row leaves the `open` scope.
5. Between those changes, the network panel's polls of `/api/card/reviews`
   are 304s, every 15 s while the run is in flight.

Record the PR, the timestamps in `state.json`'s `phases` against the times the
page showed each change, and whether any refresh was manual. A change that
needed a reload is a failure of this section, not a slow page.

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
