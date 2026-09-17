# `hud.toml` — every source, and what its panel does when it is absent

The switchboard, key by key. A source present enables its panel; a source
absent removes it, and there is no code change either way. This file is the
reference `hud init` points at when it leaves something commented out, and it
is written against the server's **consumers** — the lines in `server.mjs` that
actually read each key — not against any particular person's config.

Read [CLI.md](CLI.md) for the verbs and [STATUS-JSON.md](STATUS-JSON.md) for the
machine-readable state contract.

## Which file, and what a bad line costs

`$HUD_ROOT/hud.toml` is canonical. `hud.config.json` is read **only** when no
readable `hud.toml` exists, so a tree copied before the migration keeps working
without a second format to maintain; a present-but-empty `hud.toml` still wins,
because "I emptied the config" is an answer rather than an absence.

A missing or malformed config is an **empty** config — no sources, so no
panels. The static layer (the tree, notes, deep links) never depends on the
config being present or valid.

The parser is a TOML subset: `[table]` and `[dotted.table]` headers,
`key = "string"`, `key = 123`, `key = true`/`false`, `#` comments whole-line or
trailing, and blank lines. Anything outside that — an array, an inline table, a
float, a dotted bare key — is **skipped with a warning printed once at
startup**, so a typo costs you one key rather than the whole switchboard.

## The sources

| Table / key | Type | Enabled by | Panel when absent |
| --- | --- | --- | --- |
| `[sources.board]` `url` | string | anything serving that URL | `/api/dyn/board` → **503**, `{error: "board is not configured in hud.toml"}` |
| `[sources.digest]` `cmd` | string | the first token being a command on `PATH` | `/api/dyn/digest` → **503**, same shape |
| `[sources.sessions]` `root` | string, leading `~` expanded | a directory of agent sessions | `/api/sessions` → **404**; the panel does not exist |
| `[sources.sessions]` `lectio` | string URL | the graft daemon answering | sessions stay **200** with `graft: "off"` — tier 1 intact |
| `[sources] loadout` | `false` only | — (it is the off switch) | — |
| `[sources.loadout]` `claude_root` | string, `~` expanded | a non-default install to inspect | defaults to `~/.claude` |

Two things that table is deliberately precise about:

**`board` and `digest` walk a degradation ladder; `sessions` and `loadout` do
not.** For a proxied source, live ⇒ last snapshot (`stale: true`, still a 200)
⇒ 503 with a JSON body. That is three distinguishable states, and the
distinction is worth keeping: "configured but down" and "not configured" are
different problems with different fixes. An absent `sessions` source is neither
— it means the panel does not exist, which is why it answers 404 and the UI
renders nothing. `loadout = false` uses that same panel-off 404.

**An unconfigured source is never served from a snapshot.** `[sources.*]` is
the switchboard, so removing a source has to remove the panel even though
yesterday's data is still sitting in `.generated/`.

### `peers` has no key at all

This is the one source with nothing to configure, and that is not an omission.
Handles come from `peers/*.md` frontmatter (`gh:`, defaulting to the filename),
so adding a colleague is adding a file; the PR lookup shells out to `gh`, which
has to be both installed and authenticated. Neither half is something a config
line could express.

The panel is **snapshot-only by design**: the read path never shells out, so
opening the HUD cannot stall on `gh`. A refresh runs once after the server
starts listening, and again on `POST /api/refresh/peers` (the ⟳ button). Before
the first successful refresh, `/api/dyn/peers` answers **503**, `{error: "no
peers snapshot yet"}`; afterwards it is a 200 carrying `stale` and `cached_at`
so the page can say *as of* rather than *now*.

### `loadout` is on unless switched off

It reads the local filesystem and calls nothing, so the default root is enough
to make it work out of the box — there is no endpoint to configure and nothing
for `hud init` to detect. `loadout = false` under `[sources]` turns it off;
`[sources.loadout]` `claude_root` points it at a non-default install.

## Top level

| Key | Type | Read by |
| --- | --- | --- |
| `ticket_url_template` | string, `{id}` substituted | the UI, through `/api/config` |

The shipped default points at a reserved documentation domain (RFC 2606), which
the UI treats **the same as unconfigured**: ticket ids render as plain chips
until a real tracker replaces it. So the placeholder is safe to commit and
obvious to spot.

`peer_pr_lookback_days` deserves a note because you will find it in older
trees: **nothing reads it.** Grepping the server, the UI, and the CLI turns up
no consumer — only two test fixtures that carry it as an inert key. It parses
and it is ignored. `hud init` does not write it, and neither should you.

## `[read.<name>]` — stores this machine reads but never writes

| Key | Type | Read by |
| --- | --- | --- |
| `path` | string, `~` expanded | `readStores()` in `server.mjs` |

```toml
[read.work]
path = "~/stores/work"
```

One machine writes to exactly one store and may read from several. The writable
store is `HUD_ROOT` and **cannot be named here** — that keeps one fact in one
place, and it is why there is no `[store]` table. `hud sync` stages, commits and
pushes only the writable store, so a mounted store cannot be pushed to the
wrong remote: sync has no knowledge that other roots exist.

What the union does:

- **Sections merge by name.** `projects/` in two stores is *one* section whose
  groups come from both, because grouping is computed after the merge.
- **Every entry carries a `store`.** Entries from the writable store are
  `local`, which is reserved: a `[read.local]` is refused with a warning rather
  than shadowing the root.
- **Collisions resolve writable-first and are reported.** The same relative path
  in two stores serves the writable copy, and the losing one is listed in the
  tree's `shadowed` array — always present, empty when there is nothing to say.
  Resolving silently would make a note that stopped being reachable look
  identical to one that never existed.
- **Mounted entries are openable**, not just listed: `/api/md` resolves across
  stores in the same order, re-checking containment against each root.

A store that is absent, unreadable, not a directory, or pointed at the writable
root is **ignored with a warning**. That is deliberate — quietly dropping it
renders a tree that looks complete and is not.

**What this does not do.** Mounting a private store puts its data on this
machine. Only declining to clone it prevents that. The guarantees here are
"never writes across stores" and "never pushes a store it does not own"; the
config makes the boundary legible rather than enforcing it.

## `[serve]`

Read by the `hud` command and by `service/install.sh`, **not** by `server.mjs`.
That indirection is worth knowing about, because it changes what two of these
keys mean:

| Key | Type | What actually consumes it |
| --- | --- | --- |
| `host` | string | The URL `hud status` prints and health-checks. **The server binds loopback literally**, so this cannot expose the HUD. |
| `port` | integer | `hud` and `install.sh` pass it to the server as `HUD_PORT`; the server itself reads only `HUD_PORT`, defaulting to 4870. |
| `label` | string | The launchd service name, which is also the plist filename. |
| `hostname` | string | Printed by `install.sh` as `/etc/hosts` guidance and nothing else. |

`HUD_ROOT`, `HUD_PORT`, `HUD_HOST` and `HUD_LABEL` in the environment win over
this table, everywhere in the HUD.

## What `hud init` probes, and what it writes

`hud init` configures only what it can find, and writes everything else into
the same file as a commented stub with the reason and the fix. The probes are
the ones `hud status` already uses, asked of candidate endpoints instead of
configured ones:

| Source | Probe | Written when it fails |
| --- | --- | --- |
| `board` | does anything answer the candidate URL | commented `[sources.board]` + why |
| `digest` | is the command's first token on `PATH` | commented `[sources.digest]` + what to install |
| `sessions` | does the candidate directory exist | commented `[sources.sessions]` + where to point it |
| `sessions.lectio` | does the graft daemon answer | commented `lectio` line; sessions still configured |
| `peers` | `gh` on `PATH` **and** `gh auth status` | a comment, since there is no key — plus the `gh auth login` step |
| `loadout` | nothing to probe | never a stub; it is on by default |

The reason a stub carries its own explanation, rather than this file carrying
all of them, is that a new user whose HUD comes up with four grey panels cannot
tell *broken* from *not configured* — and the config file is the one place they
are certain to look. So every grey panel has its explanation sitting next to
its own would-be config.

`init` never overwrites an existing `hud.toml`. It prints what it would have
written, diffed against what is there, and leaves the merge to you.
