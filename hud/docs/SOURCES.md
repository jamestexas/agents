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

## The tree's own vocabulary

Not a `hud.toml` key — but the review that prompted the section descriptions
found this written down nowhere except the code and the skill's frontmatter
templates, which is a plausible reason `status: done` drifted onto notes that
have no `status` field at all.

That is now structurally impossible rather than merely noticed. The tables
below are **generated** from [`hud-contract.mjs`](../hud-contract.mjs) by
[`hud-docgen.mjs`](../hud-docgen.mjs), and `hud docgen --check` — which the
unit suite runs — fails when they stop matching it.

**Sections.** `KNOWN_SECTIONS` fixes the order of the five the HUD knows; each
carries a one-sentence description, rendered under the heading and on its
tooltip.

<!-- @generated-begin: sections-table -->
| section | what it is |
| --- | --- |
| `projects` | Live work — one directory per project, its CONTEXT.md the brief, notes beneath it. |
| `playbooks` | Procedures worth not re-deriving: how a thing is done, written down once. |
| `peers` | One file per colleague, naming the GitHub handle whose PRs light up the peers panel. |
| `inbox` | Unfiled capture — notes taken before there was a project to put them in. |
| `archive` | Finished or parked work, kept for reference. Nothing here needs you. |

Sections are an **open set**: the five above fix the left-column order, and any
other top-level directory becomes a section too, appended alphabetically with a
fallback sentence. Kinds are the opposite — closed, and there are exactly 6.
<!-- @generated-end: sections-table -->

**Groups** exist only inside `projects`: the subdirectory *is* the group, and
its `CONTEXT.md` is the brief. Groups rank active-first, then by warmth — the
newest date any entry in the group carries — then by name. The heading shows
that date, because an order the reader cannot see explains nothing.

**Containers.** Two subdirectory names inside a project mean something, and
they are asymmetric in opposite directions — which is exactly the sort of fact
that had no home before this file had a generated one.

<!-- @generated-begin: containers-table -->
| directory | within | known to the reader? | matched at | what it means |
| --- | --- | --- | --- | --- |
| `notes/` | `projects` | **no — never heard of it** | exactly its declared depth | Where dated project entries go. Writer-side only: `projects/p/notes/x.md` and `projects/p/x.md` are the same entry to the reader. |
| `raw/` | `projects` | yes, and renders differently | any depth | Immutable drops — transcripts, exports, patches. Listed and never opened; the meta slot shows a size instead of a date. |

Those two columns are not the same claim. `notes/` means nothing to the
reader because the reader has **never heard of it** — the name appears
nowhere in `server.mjs`, so an entry inside it and one beside it are
indistinguishable. `raw/` is the opposite: the reader knows it, matches it
at any depth, and changes how its entries display. One is an accident and
one is a decision, and a table that called both "inert" would hide that.

A path deeper than its kind's declared shape is currently **absorb**ed — and that is the known-wrong answer: the
intermediate directories vanish into the group, so the tree looks like you did
nothing. It is named here rather than left implicit so that changing it is a
declaration edit.
<!-- @generated-end: containers-table -->

**The frontmatter vocabulary.** The third column is the distinction that caused
the drift this section was written to record: it is what the reader
*substitutes when the key is absent*, which is not the same as a value the file
carries.

<!-- @generated-begin: fields-table -->
| key | type | reader assumes when absent | what it is |
| --- | --- | --- | --- |
| `title` | scalar | — | The entry's name. The reader falls back to the first heading, then the filename. |
| `date` | date | — | The day the entry is about. The reader falls back to the filename prefix, then mtime. |
| `type` | scalar | — | What kind of entry this is. The reader infers it from the path when absent. |
| `status` | scalar | `active` | Lifecycle. On a project brief it drives group rank and fold state; elsewhere it means what the author meant. |
| `tags` | list | — | Free-form labels. |
| `repos` | list | — | owner/name — lights up the PR panels for this entry. |
| `tickets` | list | — | Ticket ids, rendered as links through hud.toml's ticket_url_template. |
| `gh` | scalar | — | A GitHub handle. Drives the peers panel's PR lookup. |
| `applies_to` | list | — | What a playbook is for — repos, or situations. |
| `last_verified` | date | — | When a playbook was last known to still work. |
| `links` | list | — | Related material. |
<!-- @generated-end: fields-table -->

**Which kind actually writes which key** — read against the column above, this
is what makes "`status` defaults to `active`" a statement about the reader
rather than a claim about the file:

<!-- @generated-begin: frontmatter-table -->
| kind | written for you | `--set` may add | refused |
| --- | --- | --- | --- |
| `note` | `title`, `date`, `type` | `status`, `tags`, `repos`, `tickets` | `title`, `date`, `type` (derived) |
| `inbox` | `title`, `date`, `type` | `status`, `tags`, `repos`, `tickets` | `title`, `date`, `type` (derived) |
| `playbook` | `title`, `type`, `last_verified` | `status`, `tags`, `repos`, `tickets`, `applies_to`, `last_verified` | `title`, `type` (derived) |
| `context` | `title` (if given), `status` | `status`, `repos`, `tickets`, `links` | `title`, `type` (derived) |
| `peer` | `gh` | `gh`, `repos` | `type` (derived) |
| `raw` | — | — (nothing) | everything |
<!-- @generated-end: frontmatter-table -->

**How the facts are shown:**

| Fact | Source | Shown as |
| --- | --- | --- |
| `title` | frontmatter, else first heading, else filename | the row |
| `date` | frontmatter, else filename prefix, else mtime | the meta slot |
| `size` | the file | the meta slot, *instead of* a date, for `raw/` entries |
| `type` | frontmatter, else inferred from the path | **not badged in the tree** — it sorts briefs first |
| `status` | frontmatter, else the reader's `active` | a chip when not `active` |
| `store` | which store served it | a chip when not the writable one |
| `warn` | malformed frontmatter | a chip |

Two things worth knowing about `status`. It means **project lifecycle** on a
`CONTEXT.md`, which is the one kind that writes it — there it drives group rank
and the default fold state. On a note it means only what the author intended by
typing it, because no note template emits one. And `active` is never badged, so
an entry with no chip is the common case rather than a missing value.

**What the HUD does not detect.** Frontmatter damage earns a `warn` chip.
*Path* damage earns nothing — and the path carries at least as much contract as
the frontmatter does, since it decides an entry's type, section, group and
date. Moving a file between directories silently re-types it; renaming it
silently changes its date and breaks its permalink. An entry whose declared
`type` disagrees with its path-inferred `type` is the detectable case, and it
is the missing chip.

Entries that cannot need the reader — finished work and `raw/` files — fold
behind one summary line per group. That is why there is no `raw` chip: the
meta slot already shows a size instead of a date for exactly those entries.

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
wrong remote: sync has no knowledge that other roots exist. `hud pull` is the
mirror image: it fast-forwards the mounted stores and never reads `HUD_ROOT`.

### What a store has to look like

A store is a directory with section directories in it. Nothing else is
required, and there is no registration file — which is why `hud init --root
<path>` is the whole of creating one: it writes `HUD.md`, `index.md`, `log.md`,
a `.gitignore`, the `_hud` symlink, a `hud.toml`, and the five section
directories, then `git init`s the tree. **A local repository with no remote is
a valid store.** `init` deliberately does not create a remote; it prints the
`gh repo create` command instead, because that is outward-facing and not a
scaffold command's decision. A store with no remote is `skipped` by `hud pull`
("no upstream for `<branch>`") and read normally by everything else.

Four things about that shape are worth stating, because a mounted store puts
them in front of the union and the answer is the same in every case — they are
not content:

- **A mounted store's own `hud.toml` is inert.** Config is read from `HUD_ROOT`
  and nowhere else, so mounting a store does not import the stores *it* mounts.
  A tree whose contents depended on a config file the machine never read would
  be unexplainable from that machine.
- **Top-level files are not entries.** `HUD.md`, `index.md`, `log.md` and
  `hud.toml` sit above every section, and the walk only descends into section
  directories.
- **`_hud` is skipped by name**, so the machinery checkout a store links to
  never floods the tree. (Symlinks are also neither followed nor listed
  anywhere in the walk.)
- **A `.gitkeep`-only section adds the section and no entries.** An empty
  directory cannot survive a clone, so `init` leaves a dot-prefixed keepfile in
  each; the walk skips dotfiles, so the keepfile never renders. The section
  still appears, because sections are the union of top-level directories — that
  is why `peers` can be present with nothing under it.

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
renders a tree that looks complete and is not. `hud status` prints each
rejection as an `! ignored` row and `hud status --json` as a `stores` entry with
`status: "ignored"` and the reason, so a machine with no mounts is
distinguishable from one whose mounts all failed. The rest of the tree is
unaffected: a bad mount costs you that mount, not the sections the good stores
contributed.

### The limits, stated rather than worked around

**A read-only store cannot be written by the machine that mounts it — so
`hud new` cannot target it.** Authoring verbs write to `HUD_ROOT`, which is the
one store this machine owns, and `[read.<name>]` has no writable variant by
design: write-1:1 is what makes "which machine last touched this note" a
question with an answer. The consequence is real and has no flag — to add a
note to the store mounted as `work`, you author it on the machine that owns
that store. There is no local workaround, and inventing one (a `writable = true`
key, a `--store` flag on `hud new`) would trade the invariant for the
convenience.

**A shadowed entry is reported but not reachable.** `/api/md` resolves in the
same writable-first order as the tree, so the single path a collision leaves you
with serves the winner. `shadowed` tells you a losing copy exists, which store
it came from, and which store beat it — and that is the whole of what it can
tell you. Reading it means opening the file in that store's root directly. A
store selector on `/api/md` would make every mounted path addressable by a
client-supplied root name, which is a containment surface rather than a feature.

**Mounting a private store puts its data on this machine.** Only declining to
clone it prevents that. The guarantees here are "never writes across stores" and
"never pushes a store it does not own"; the config makes the boundary legible
rather than enforcing it.

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
