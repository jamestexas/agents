# Workerd Work Board Design

**Status:** Approved for implementation

**Bead:** `agents-f6114b`

**Staging repository:** `agents`

**Eventual owner:** `canonical-hours`

## Purpose

Turn `work-board` from a local D3 page driven by `gh`, `jq`, and a Python
subprocess server into a portable workerd application that can run as a
Cloister bundle. Develop and prove it under `agents/work-board`; after it works
end to end, move the portable UI and Worker pieces into `canonical-hours`.

The conversational skill remains in the agents repository. Canonical Hours
eventually owns the board runtime, persistence, refresh semantics, HTTP UI, and
the MCP `get_board` surface. The existing `/pr-board` skill remains available
until the moved UI is verified through Cloister.

## Current State

`agents/work-board` currently contains:

- one static D3 document;
- `refresh.sh`, which shells out to `gh` and `jq`;
- `serve.py`, which writes `data/board.json` and exposes `POST /refresh`; and
- a richer presentation model with author/reviewer role, whose court an item is
  in, staleness, next action, merge readiness, and bot/noise classification.

Canonical Hours already contains:

- the portable Vespers board schema and tick/fold kernel;
- GitHub, Lectio, Linear, and weather source adapters;
- a workerd Worker;
- Durable Object board persistence and a cross-isolate tick lease;
- `GET /board`, `GET /board/md`, and `POST /tick`; and
- MCP `get_board` and `trigger_tick` tools with structured output.

Cloister already supports the two runtime shapes the board may need:

- Worker-to-Worker `Fetcher` service bindings; and
- external process bundles exposed over HTTP or UDS, with `udsForward` using
  the companion because workerd cannot spawn a CLI or dial `AF_UNIX` itself.

## Goals

1. Run the board UI and its same-origin API under workerd.
2. Run the staged application as a declared Cloister bundle.
3. Consume a board source through one transport-neutral contract.
4. Prefer a Worker/API source for the first implementation while preserving a
   clean boundary for a bundled CLI source when a CLI provides unique value.
5. Keep credentials, subprocesses, and provider-specific parsing out of the
   browser and UI Worker.
6. Preserve the current dial, sweep, stack, filters, low-signal bucket, live
   refresh, and copyable action list.
7. Make the portable pieces movable into Canonical Hours without redesign.
8. Repair the repository documentation so it accurately describes agents,
   skills, build/install tooling, and experimental applications.

## Non-Goals

- Do not add MCP Apps `ui://` resources in this iteration. Cloister does not
  currently proxy `resources/list` or `resources/read`. The HTTP UI must not
  depend on a particular MCP client.
- Do not remove `/pr-board` during staging.
- Do not move code into Canonical Hours before the staged application passes
  its workerd, browser, live-source, and Cloister smoke tests.
- Do not teach a Worker to execute `gh`, `jq`, Python, or arbitrary commands.
- Do not duplicate Canonical Hours lifecycle ownership inside the UI.
- Do not add human-agent session park/resume state. That adjacent lifecycle is
  owned by `agents-f50f06`.
- Do not modify the concurrently developed handoff skill or its ADR.

## Ownership and Repository Boundaries

During staging, `agents/work-board` is a self-contained package with its own
package manifest, build, tests, workerd configuration, UI source, and prototype
host adapter. No root-level dependency is added to the agents repository.

The package is split into portable and staging-only units:

- **Portable UI:** board normalization, presentation view model, SVG rendering,
  filters, action list, styles, and browser behavior.
- **Portable Worker routes:** static asset serving, health, board reads, and
  refresh forwarding through a `BoardSource`.
- **Staging adapter:** resolves the configured Canonical Hours binding or URL
  and translates its HTTP responses into the portable source contract.
- **Cloister declaration:** describes the staged HTTP bundle and its binding to
  the board source.

When the application moves, Canonical Hours receives the portable UI and route
units. Its direct Durable Object board store replaces the staging adapter. The
staging adapter and agents-specific bundle declaration are deleted rather than
carried forward.

## Runtime Architecture

```text
browser
  |
  | same-origin HTTP
  v
work-board Worker
  |- GET /board/ui and static assets
  |- GET /api/board
  |- POST /api/refresh
  `- GET /health
          |
          | BoardSource contract
          v
  service binding or configured URL
          |
          v
Canonical Hours Worker
  |- GET /board
  |- POST /tick
  `- Durable Object board store
```

Under Cloister, the preferred edge is a Worker service binding. The URL
transport remains available for local development and for an external
Canonical Hours bundle. Both transports present the same logical source.

A future CLI collector is a sibling external bundle, not code executed by the
UI Worker:

```text
work-board Worker -> Fetcher/HTTP/UDS adapter -> CLI collector process
```

The process owns command invocation, fixed configuration, provider
authentication, and output parsing. Requests cannot supply shell fragments or
arbitrary arguments. This option is implemented only when a source has a
capability or local-auth advantage that the API source lacks. GitHub collection
uses the existing Canonical Hours API path first; bundling `gh` is not required
for the initial slice.

## Board Source Contract

The UI Worker depends on behavior rather than a provider:

```ts
interface BoardSource {
  read(signal: AbortSignal): Promise<BoardSourceResult>;
  refresh(signal: AbortSignal): Promise<BoardSourceResult>;
}

interface BoardSourceResult {
  board: unknown;
  source: "service-binding" | "http" | "fixture";
  refreshed: boolean;
}
```

`read` obtains the last durable snapshot. `refresh` requests one tick and then
reads the resulting snapshot. The source returns untrusted JSON; the portable
normalizer validates it before rendering.

Source selection is deterministic:

1. use a configured Canonical Hours `Fetcher` binding;
2. otherwise use a configured Canonical Hours base URL;
3. otherwise use fixture data only when the explicit development fixture flag
   is enabled; and
4. otherwise return a configuration error.

Production never silently substitutes example data for missing live data.

## Presentation View Model

The browser consumes a presentation projection rather than provider records or
the storage schema directly:

```ts
interface WorkBoardView {
  generatedAt: string;
  tickStatus: "ok" | "degraded" | "live" | "all_clear";
  degradations: string[];
  items: WorkBoardItem[];
}

interface WorkBoardItem {
  kind: "pr" | "issue" | "event";
  artifactUri: string;
  title: string;
  url?: string;
  state: "opened" | "active" | "needs_you" | "resolved";
  role: "author" | "reviewer" | "participant";
  waitingOn: "me" | "others";
  lastActivity: string;
  nextAction?: "merge" | "ci" | "respond" | "review" | "promote" | "attend";
  isDraft: boolean;
  mergeReady: boolean;
  lowSignal: boolean;
  reason: string;
}
```

The normalizer accepts the current Canonical Hours `Board` and the richer
prototype fields. It applies documented compatibility defaults without
extracting semantics from prose:

- missing `role` becomes `author` for PRs and `participant` otherwise;
- missing `waiting_on` becomes `me` only for `needs_you`, otherwise `others`;
- missing `last_activity` becomes the latest `new_items[].at`, then the board's
  `generated_at`;
- missing booleans become `false`; and
- `next_action` is derived only from typed state, merge readiness, and role,
  never by matching `reason` text.

Provider/source work may later emit richer fields directly. The UI remains
stable because it depends on this projection.

## HTTP Surface

- `GET /` redirects to `/board/ui`.
- `GET /board/ui` and its assets serve the bundled interface.
- `GET /api/board` returns a validated `WorkBoardView`.
- `POST /api/refresh` asks the source to refresh, then returns the new validated
  `WorkBoardView`.
- `GET /health` reports host liveness and whether a board source is configured;
  it does not trigger provider work.

All browser requests are same-origin. Static assets are bundled locally; the
application does not load D3 or other executable code from a CDN.

## Error and Degradation Behavior

- A missing board is an explicit empty state, not an example board.
- A source timeout produces a bounded `504` response.
- A source protocol or validation failure produces a structured `502` response.
- If refresh fails after a previous board was loaded, the browser keeps the
  last successful board visible and adds a stale/degraded banner.
- A failed item slice is represented in board degradations rather than making
  unrelated items disappear without explanation.
- The refresh button has one in-flight request, a visible busy state, and a
  bounded timeout. Repeated clicks cannot fan out concurrent ticks.
- Invalid timestamps and unknown item kinds are surfaced as validation errors;
  they are not placed at arbitrary positions on the graph.

## Authentication and Security

- Provider credentials never enter HTML, browser storage, board JSON, or log
  messages.
- The UI Worker receives only a source capability: a service binding, an
  upstream URL protected by deployment policy, or a future UDS/HTTP bundle
  adapter.
- The UI forwards caller authorization required by the source. It does not
  manufacture approval.
- Read access and refresh authority are separate. A deployment may expose the
  board read-only while denying refresh.
- A public deployment must default-deny `POST /api/refresh` unless Cloister
  identity or an equivalent source-side action gate authorizes it.
- A future CLI adapter exposes fixed operations (`read`, `refresh`) and rejects
  user-controlled executable names, arguments, paths, and environment keys.

## Cloister Packaging

The staged application declares an external HTTP bundle because Cloister models
workerd containers and native processes through the same bundle topology. The
bundle publishes one HTTP port for the UI/route Worker and declares its source
edge separately:

- service binding when Canonical Hours is co-located as a Worker;
- HTTP URL binding when Canonical Hours is an external bundle; or
- UDS through the companion only for a future CLI process.

The Cloister smoke fixture contains two deterministic bundles: the work-board
bundle and a fixture Canonical Hours-compatible source. A second smoke path
points at a real local Canonical Hours Worker. The proof must exercise a browser
read and refresh through the generated Cloister topology, not merely start two
independent development servers.

## UI Behavior

The current three layouts remain:

- dial: state quadrant and staleness radius;
- sweep: recency angle; and
- stack: chronological rows around a now line.

The current encodings remain stable: state color, role shape, waiting-on fill,
action label, merge-ready ring, and draft dash. Filters remain `all`, `mine`,
`reviewing`, and `needs me`. Low-signal items remain hidden behind an explicit
toggle, but the count and classification are visible.

The UI is decomposed into data normalization, layout calculation, SVG
rendering, and interaction state. Layout functions are pure and testable
without a browser. Browser code owns only DOM events, fetch, and presentation.

## Documentation

The root README is rewritten to describe the repository that actually exists:

- installable agent definitions;
- user-invocable skills;
- build/lint/install tooling; and
- experimental applications such as the staged work board.

It must stop claiming the repository contains no executable code. It links to a
focused `work-board/README.md` for runtime setup, workerd development, source
configuration, tests, and the Cloister smoke path.

The README does not present `work-board` as permanently owned by this
repository. It labels the package as a staging implementation destined for
Canonical Hours.

## Verification

The implementation is complete in the staging repository only when all of the
following pass:

1. schema and compatibility-default unit tests;
2. pure layout and filtering unit tests;
3. Worker route tests under a real workerd-compatible test pool;
4. browser tests for all three layouts, filters, low-signal toggle, refresh,
   degraded refresh, empty state, and action-list copy;
5. a local live-source test against Canonical Hours;
6. a Cloister smoke test using the fixture source;
7. a Cloister smoke test using a real local Canonical Hours Worker;
8. the repository's existing `scripts/build.sh check`; and
9. a transferability check proving portable code contains no absolute path or
   import back into the agents repository.

No production code is written before its corresponding failing test.

## Migration and Retirement

Migration occurs only after the staging verification matrix is green:

1. move portable UI, view-model, layouts, and Worker routes into
   `canonical-hours`;
2. replace the staging `BoardSource` adapter with Canonical Hours' direct
   Durable Object store and tick function;
3. serve `/board/ui` from the Canonical Hours Worker;
4. keep `get_board` structured output and the HTTP UI backed by the same board;
5. update the Cloister input/bundle declaration to point at Canonical Hours;
6. run the same browser and Cloister smoke suites in their new repository;
7. update the agents skill to prefer Canonical Hours `get_board` and link the
   HTTP UI; and
8. delete the staging package from agents.

`/pr-board` may be removed only after the moved Canonical Hours UI and
`get_board` tool both work through Cloister, the agents skill points at the new
surface, and no behavior unique to `/pr-board` remains. Removal is a separate
bead and commit so it can be reverted independently.

An embedded MCP App may later reuse the same built UI by attaching it to
`get_board` after Cloister implements MCP resource forwarding. That extension
does not fork the renderer or board contract.

## Coordination

This work does not modify:

- `skills/handoff/`;
- `docs/ADR-003-handoff-at-the-seam.md`;
- `docs/handoff-skill-plan.md`; or
- the park/resume lifecycle design owned by `agents-f50f06`.

Implementation bead file scopes must preserve that separation.
