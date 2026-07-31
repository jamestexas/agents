# work-board

`work-board` is the staging implementation of Canonical Hours' visual board.
It runs as a workerd Worker, reads Canonical Hours through a service binding or
explicit HTTP URL, and serves the UI at `/board/ui`.

This package is intentionally staged in `agents/`. Once the workerd, browser,
live-source, and Cloister proofs pass, its portable files move to
`canonical-hours`. The `/pr-board` skill remains available during that move.

## Run with fixtures

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev
open http://127.0.0.1:8787/board/ui
```

Wrangler starts the Worker in its local workerd runtime. Fixture mode is the
checked-in default in `wrangler.toml`.

## Run with Canonical Hours

Set `WORK_BOARD_FIXTURE=false` and provide either the
`CANONICAL_HOURS` service binding or
`CANONICAL_HOURS_URL=http://127.0.0.1:2000`. Refresh remains disabled unless
fixture mode is active or `WORK_BOARD_REFRESH_MODE=source-authorized` delegates
authorization to the configured source.

The upstream source contract is fixed HTTP semantics: `GET /board` reads the
Canonical Hours projection and `POST /tick` refreshes it. The Worker validates
and normalizes both fixture and real-source payloads before they reach the
browser.

## Run as a Cloister cluster

The board is hosted as a cluster bundle; it is not a Claude Code harness. Build
the two local images from this package root, then use Cloister's native cluster
verb against the checked-in cluster directory:

```bash
docker build -t work-board:smoke -f Dockerfile .
docker build -t canonical-hours-fixture:work-board-smoke \
  -f cloister/fixture.Dockerfile .

cloister cluster up \
  --dir "$PWD/cloister" \
  --detach

open http://127.0.0.1:8791/board/ui

cloister cluster down --dir "$PWD/cloister"
```

`cloister run --harness ... --repo ...` is a separate door for running a
confined coding harness. It is not needed to host this Worker. `cluster.toml`
is the operator-readable declaration; `cluster.compose.yaml` is the generated
artifact consumed by `cloister cluster up`.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/board/ui` | bundled visual board |
| GET | `/api/board` | validated presentation projection |
| POST | `/api/refresh` | upstream tick followed by board read |
| GET | `/health` | host/source configuration liveness |

## Verification

```bash
pnpm check
pnpm test:e2e
CLOISTER_REPO=../../../art/cloister pnpm test:cloister:contracts
CLOISTER_REPO=../../../art/cloister pnpm test:cloister
CANONICAL_HOURS_URL=http://127.0.0.1:8790 pnpm test:live
```

`pnpm check` is the standalone package gate and does not require a neighboring
Cloister checkout. The explicit Cloister commands require `CLOISTER_REPO`;
`test:cloister:contracts` validates manifest parsing, cleanup behavior, and the
Docker context policy, while `test:cloister` runs those contracts before the
two-bundle smoke topology.

Pnpm lifecycle scripts remain denied by default. Do not approve lifecycle
scripts for `esbuild`, `sharp`, or `workerd` merely to silence the install
warning: the verified optional native binary packages support the current
development and container platforms without granting install-time execution.

## Security

The browser receives board data, never provider credentials. The Worker cannot
spawn a CLI. A future CLI collector must run as a sibling Cloister bundle
behind the same fixed `read`/`refresh` source contract.

Board reads and refresh authority are separate. Refresh is default-deny outside
fixture mode. In a real deployment, `source-authorized` means authorization is
delegated to the configured source; it does not grant the browser provider
credentials.

## Cloister topology

`cloister/cluster.toml` is authoritative for this non-MCP UI. It declares
separate `canonical-hours-fixture` and `work-board` external bundles connected
by the fixed HTTP adapter. `server.json` carries the producer-side OCI artifact
and `art.cloister/v1.bundles[]` facts; the operator-owned TOML supplies the
deployment choice. Cloister resolves the producer image when registry-backed
and validates the operator's tier, kind, and port against those producer facts.
This staging cluster uses explicit local image tags, so it can be run without
publishing an OCI artifact first.

A future CLI collector, if needed, is another sibling bundle exposing the same
fixed HTTP or UDS adapter. The Worker never spawns it.

## Encodings

- **colour** = `state` — `opened` · `active` · `needs_you` · `resolved`
- **radius / vertical** = `lastActivity` staleness (older = toward the rim / bottom)
- **shape** = `role` / `kind` — ● `author` · ◆ `reviewer` · ▢ `event`
- **fill** = `waitingOn` — **solid** = `me` · **hollow** = `others`
- **label / tag** = `nextAction` — `merge` · `ci` · `respond` · `review` · `promote` · `attend`
- **green ring** = `mergeReady` · **dashed** = `isDraft`

### Layouts (toggle top-left)

- **◷ dial** — quadrant = state, radius = staleness. `needs_you` wedge tinted; things drift to the rim as they rot.
- **◴ sweep** — angle purely by recency.
- **▤ stack** — vertical time column: future events above a *now*-line, PRs below, freshest→stalest. (The text list hides here — the rows *are* the list.)

### Filters + low-signal bucket

`all · mine · reviewing · needs me`, plus a **⌁ low-signal** chip that collapses
items where `lowSignal` is true, including bot PRs and review asks gone stale
(>14d), so they don't bury the handful of PRs that actually want your eyes.
Click to reveal.

## Data shape

Canonical Hours supplies snake_case source fields. The Worker exposes a
validated camelCase presentation model: `generatedAt`, `tickStatus`,
`degradations`, and `items`, with item fields including `artifactUri`,
`waitingOn`, `lastActivity`, `nextAction`, `isDraft`, `mergeReady`,
`lowSignal`, and `reason`. This package remains a view, not a second work-state
implementation.
