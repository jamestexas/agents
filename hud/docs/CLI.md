# The `hud` command — why each verb behaves as it does

One entry point for the server, the service, and the gates. The subcommand
table — what to type — lives in [the README](../README.md#the-hud-command).
This file is the reasoning behind it: what each verb refuses to do, why
`link` and `install` are different words, and what `sync` is for.

## One dispatcher, not a second implementation

`hud/hud` is a dispatcher, not a second implementation: every subcommand runs
the script or entry point that already existed. It resolves its own symlink
chain before taking a dirname, so a single link into a directory on `PATH`
makes it work from anywhere.

```bash
hud/hud link      # put the COMMAND on your PATH
hud/hud install   # install the SERVICE — a different thing; see below
```

Upstream endpoints, the launchd label, and the port the *service* runs on all
come from `$HUD_ROOT/hud.toml`, read through the server's own `loadConfig()`.
There is no second config path and no second TOML parser; `HUD_ROOT`,
`HUD_PORT`, `HUD_HOST` and `HUD_LABEL` override the file, as they do everywhere
else in the HUD.

Two caveats the file itself cannot tell you: `server.mjs` reads `HUD_PORT` from
the environment, not `[serve] port` — the service works because `install.sh`
renders that value into the plist — and it binds `127.0.0.1` literally, so
**`[serve] host` is not read by anything**. It cannot expose the HUD, and it is
not what keeps it loopback-only.

## What the verbs refuse to do

- **`hud start`** is idempotent. If a process it did not start holds the port,
  it refuses and prints the pid — the same posture as `service/install.sh`.
- **`hud stop`** boots the service out rather than killing it, because
  `KeepAlive` would restart anything killed. The plist stays, so `hud start`
  brings the same service back.
- **`hud init`** refuses more than the rest of these put together — it will not
  overwrite a `hud.toml`, clobber an existing scaffold, create a git remote, or
  accept `/` or `$HOME` as a tree. Those are stated where the reader meets them
  rather than repeated here: see
  [SOURCES.md](SOURCES.md#what-hud-init-probes-and-what-it-writes).
- **`hud status`** always exits 0, which is a contract rather than an
  oversight; see [STATUS-JSON.md](STATUS-JSON.md#the-exit-code-rule).
- **`hud pull`** refuses any store it cannot advance without losing something:
  a dirty worktree, local commits absent from the remote, or a diverged branch.
  It fast-forwards or it does nothing — see
  [Pulling read-only stores](#pulling-read-only-stores).
- **`hud new`** refuses a frontmatter key that is not legal for the kind, a
  destination that already exists, and a tree that has not been scaffolded —
  and refuses to *guess* a project, filing the note under `inbox/` instead.
  See [Writing into the tree](#writing-into-the-tree).

## Writing into the tree

`hud new <kind>` is the only verb here that authors content, and it exists
because the authoring contract used to be prose. `skills/hud/SKILL.md` §2–§7
spelt out six file shapes, the directory each lives in, a date prefix, a kebab
slug, the frontmatter keys legal for each, and two bookkeeping appends owed
after every write — all of it stated, none of it checked. A convention that has
to be remembered is one that gets forgotten silently, and the failure mode is
not an error message: it is a note filed where nobody will look for it again.

So the intent is the argument and the rest is derived:

```bash
hud new note --project widget-service --title "debugging the flaky retry test"
hud new playbook --title "Rotating the signing key" --set applies_to=widget-service
hud new peer --handle octo-cat
hud new context --project widget-service
hud new raw --project widget-service --title "session transcript" --ext txt --body-file -
hud new inbox --title "a thought with no home"
```

The first of those writes
`projects/widget-service/notes/2026-04-07-debugging-flaky-retry-test.md` with
`title`, `date` and `type` already in it, and appends the `index.md` and
`log.md` lines.

<!-- @generated-begin: kinds-table -->
| kind | destination | date prefix |
| --- | --- | --- |
| `note` | `projects/<project>/notes/<date>-<slug>.md` | yes |
| `inbox` | `inbox/<date>-<slug>.md` | yes |
| `playbook` | `playbooks/<slug>.md` | no |
| `context` | `projects/<project>/CONTEXT.md` | no |
| `peer` | `peers/<handle>.md` | no |
| `raw` | `projects/<project>/raw/<date>-<slug>.<ext>` | yes |
<!-- @generated-end: kinds-table -->

<!-- @generated-begin: slug-rule -->
A slug is the title, lowercased, reduced to `a-z0-9-`, with `a`, `an`, `the` dropped and the result bounded at 60 characters on a word boundary. The dropped article is not a liberty — it is what SKILL.md's own worked example does.
<!-- @generated-end: slug-rule -->

What each kind writes into the file, what it will accept on top, and what it
refuses because the verb owns it:

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

One outcome per invocation, from a closed set:

<!-- @generated-begin: outcomes-table -->
|  | Means |
| --- | --- |
| `created` | the file was written and both bookkeeping lines appended |
| `planned` | `--dry-run`: the whole plan, and none of it done |
| `refused` | it could have written and should not. **The only non-zero exit.** |
<!-- @generated-end: outcomes-table -->

There is deliberately no "nothing to do" outcome. Being asked to create a file
that already exists is a refusal here rather than a no-op, because the body
that came with the request would otherwise be silently dropped — and that
refusal is also what makes the bookkeeping idempotent: a repeat write adds no
second catalog line and no second log line, because it adds nothing.

**It writes the tree directly, and there is no write route.** The server is
watch-only by construction: its content routes are GET-only and tested to stay
that way, so this verb reaches the filesystem rather than the HTTP API. Only
`HUD_ROOT` is ever written, never a `[read.<name>]` store — the same
one-writable-store split that lets [`sync`](#pulling-read-only-stores) push
without knowing read stores exist.

### What it refuses, and why each refusal beats the alternative

- **A frontmatter key that is not legal for the kind.** `gh` is a real key —
  on a peer. On a note it is a field the UI will never read, so writing it
  would leave a dead value in the tree that only a lint pass would ever find.
  The legal set per kind is the table above, generated from
  [`hud-contract.mjs`](../hud-contract.mjs) — including `raw`, which has none
  at all because an immutable drop is an artifact, not an entry.
- **A key the verb derives.** `type` comes from the destination directory and
  `title`/`date` from `--title`/`--date`; `--set` on any of them is refused
  rather than honoured, because a `type:` that disagrees with the directory
  renders a lie the tree walker cannot see past.
- **A project it cannot resolve — except for a note.** `--project` is taken as
  given, directories and all, because the caller named it. An *inferred* one
  (the repo you are standing in) must already exist under `projects/`:
  inference that creates directories is guessing with consequences. When
  inference comes up empty a note goes to `inbox/`, which is SKILL.md §2's
  rule that an unsorted note beats a misfiled one. A `context` or a `raw` drop
  refuses instead, because neither has an unfiled form — a `CONTEXT.md` belongs
  to a project by definition.
- **A tree that is not there.** `HUD_ROOT` missing, or missing its `index.md`
  and `log.md`, is `hud init`'s business. A write verb that scaffolded one
  would put notes in a tree nobody configured, at a path that was very likely
  a typo.
- **A flag that means nothing for the kind.** `hud new playbook --project x`
  is refused rather than ignored, because a caller whose `--project` was
  silently dropped believes the file is filed under it and nothing in the
  output says otherwise.

`--dry-run` prints the plan — destination, every frontmatter key, and both
bookkeeping lines — and writes nothing, the same standard `init --dry-run` is
held to. `--json` emits one document (`hud-new/v1`) and does so for refusals
too, including a refusal caused by the arguments themselves: an agent that
asked for JSON and got an English sentence on stderr would have to parse prose
to learn that it failed, which is the one thing the flag exists to avoid.
Unlike `status --json`, it needs no `jq`: the verb is a Node module, so the
machine-readable form of an agent-first write path is not the one that breaks
on a box without it.

The two appends differ on purpose:

<!-- @generated-begin: bookkeeping-table -->
| file | semantics | line |
| --- | --- | --- |
| `index.md` | catalog | `- [{title}]({path}) — {summary}` |
| `log.md` | append-only | `- {date}: added {kind} {path}` |

A link plus a one-line summary. One line per path; a path already listed is kept, not listed twice. Append-only history of what happened. A second ingest of the same path is a second line, by design.
<!-- @generated-end: bookkeeping-table -->

### How frontmatter is written, and what a reader must tolerate

<!-- @generated-begin: serialization-rules -->
- **Dates are normalized on READ**, not on write: `YYYY-MM-DD` and `ISO-8601 timestamp` are both accepted and both become `YYYY-MM-DD`. A writer-side convention would depend on a per-machine setting that is not committed; a reader that accepts both depends on nothing.
- **Empty collections are omitted**, never emitted as `[]`. YAML has no block spelling of an empty sequence, so `[]` is the one form with a second representation to drift into — and a key whose value you do not know is a key you were told not to write.
- Lists are **block sequences**, indent is **2 spaces**, scalars are quoted only where bare would be misread, and there are **no comments** inside the block.
- **Key order is not significant** and neither is formatting. Read keys and values; anything that depends on their arrangement is depending on something no serializer preserves.
<!-- @generated-end: serialization-rules -->

### One declaration, two directions

The verb is a thin dispatch to [`hud-new.mjs`](../hud-new.mjs), and none of the
rules above live in it. They live in [`hud-contract.mjs`](../hud-contract.mjs),
which declares each kind's destination as an invertible **segment grammar**
rather than a path template — because a template is write-only, and the read
path has to run it backwards. `inferType` derives an entry's type purely from
its position, the top-level directory *is* the section, a subdirectory of
`projects/` *is* the group, and a filename prefix *is* the date. Write composes
a path from intent; read decomposes meaning out of one. If those two can
disagree, an entry can be written as one type and read back as another with
nothing detecting it — so they are generated from one declaration.

Every table in this section, in SKILL.md, in SOURCES.md, and the whole of the
`HUD.md` that `hud init` scaffolds into a tree, is rendered from that file by
[`hud-docgen.mjs`](../hud-docgen.mjs). `hud docgen --check` fails on drift and
the unit suite runs it, so a table here cannot quietly stop being true.

## Two installs, two verbs

There are two unrelated things you might mean by "install the HUD", so they
have different verbs and neither does the other's job:

- **`hud link`** puts the `hud` *command* on your PATH, by symlinking this
  script into `$XDG_BIN_HOME` — falling back to `~/.local/bin`, which is the
  de-facto user bin directory. (XDG does not actually specify a variable for
  user binaries, so nothing here invents one; `HUD_LINK_DIR` overrides both for
  a one-off.) It starts nothing. `hud unlink` reverses it.
- **`hud install`** installs the launchd *service*, so the HUD keeps serving
  without you. It touches nothing on your PATH. `hud uninstall` reverses it.

`sync` is neither of these and it is worth saying so explicitly, because all
three sound like setup: `link` and `install` are about the **machinery** and you
run them once, while `sync` is about your **content** and you run it
constantly. It installs nothing, starts nothing, and is the only subcommand
that writes to the content tree's git history or talks to a remote.

`link` is idempotent — re-running when the link already points at this checkout
is a no-op. If the link points somewhere *else*, it prints both paths and
refuses, rather than quietly making `hud` mean a different checkout than you
think; remove it yourself, or point `HUD_LINK_DIR` elsewhere. If the target
directory is not on your PATH, that is a warning and not a failure: the link is
correctly made, and the fix is a line in your shell rc, which this script
prints but does not write.

Note what does **not** move to an XDG directory: everything the HUD generates —
the service log, snapshots, the mache index — stays under
`$HUD_ROOT/.generated/`, and `hud.toml` stays in the content tree. That is the
public-code / private-data split, and it is per-*tree* state, not per-*user*
state: a shared XDG directory would scatter one tree's output into a location
every other tree also writes to. Only the command on your PATH is genuinely a
per-user concern, which is why it is the only thing here that consults XDG.

## Backing the content tree up

The two repositories are backed up differently, and deliberately so. **This
one is public** — machinery, no note or name of yours in it — and you push it
like any other checkout. **The content tree is private**, it is where every
note lives, and it is edited constantly: by you, by the `hud` skill, by
whatever agent was told to write something down. That is the tree whose backup
you would otherwise be remembering to do by hand.

`hud sync` is that one command:

```bash
hud sync                        # stage, commit, push — in the content tree
hud sync -m "notes: rotation handoff"   # your message instead of a generated one
hud sync --dry-run              # name what it would do, change nothing
```

Nothing in it is a new idea about git. What it fixes is that `add`, `commit`,
`push` is three commands you have to remember, and three commands you remember
are not a backup. The message is generated by default — the changed file when
there is one, otherwise a count and the sections it came from — so a routine
sync needs no thought; `-m` is there for when the *why* is worth writing down.

Four behaviours are pre-decided, because they are what a wrapper has to get
right to be worth having:

- **A clean, in-sync tree is not an error.** It says there is nothing to sync
  and exits 0, so the command is safe to run reflexively, in a loop, or from a
  hook. A verb that failed when there was nothing to do would be one you stop
  running.
- **It never force-pushes, and never offers to.** A remote holding commits this
  tree does not means another machine wrote there, and the only safe resolution
  is a human pulling. `hud sync` refuses, prints the two commands to run, and
  exits nonzero.
- **It refuses before it touches anything.** Either the tree is staged,
  committed and pushed, or nothing happened at all — no half-synced state whose
  repair depends on how far the verb got.
- **Gitignored paths are never staged.** `.generated/` and the `_hud` symlink
  are local by construction, and the command asserts that rather than trusting
  it: if an ignored path ever showed up in what it was about to commit, it
  stops.

`--dry-run` is genuinely inert — it reads the remote with `ls-remote`, which
writes nothing locally, rather than fetching, because a dry run that moves
remote-tracking refs is not one.

**On the watch-only invariant:** the HUD renders and links out; it never acts
on a PR, a ticket, or a session, and `hud sync` does not change that. The
invariant governs *external* surfaces — someone else's repository, someone
else's queue — which the HUD only ever reads. Pushing your own tree to your own
remote is not acting on someone else's surface; it is authoring, the same
category as writing the note. `hud status` still only reads, and `sync` is a
separate verb you type.

## Pulling read-only stores

`hud sync` and `hud pull` are mirrors, and neither can reach the other's store:

| | Store | Direction |
| --- | --- | --- |
| `hud sync` | the one writable store (`HUD_ROOT`) | pushes |
| `hud pull` | every `[read.<name>]` store | fetches |

That split is what makes write-1:1 structural rather than careful. `sync` has
no knowledge that read stores exist, so it cannot push one to the wrong remote;
`pull` never reads `HUD_ROOT`, so it cannot fast-forward over your own notes.

One outcome per store, from a closed set:

| | Means |
| --- | --- |
| `updated` | fast-forwarded |
| `current` | already matches the remote |
| `skipped` | cannot participate — not a repo, no upstream, detached HEAD, remote unreachable. A normal state. |
| `refused` | could have moved and should not. **The only outcome that exits non-zero.** |

Three things earn a refusal, and each would otherwise lose work:

- **A dirty worktree.** Checked *before* any network call, so a store with
  local edits is left completely untouched, `.git` included.
- **Local commits not on the remote.** A store mounted read-only here may still
  be the writable store on another machine. Refusing beats rebasing them away.
- **A diverged branch.** Reconciling a store you do not own is not this verb's
  business.

`--dry-run` uses `ls-remote`, so it writes nothing at all — not even
`FETCH_HEAD`. A dry run that moves remote-tracking refs is not one, which is
the same standard `sync --dry-run` is held to.

**Why fast-forward only.** The guard is the ancestry check, not the `--ff-only`
flag: the merge is attempted only once `HEAD` is already an ancestor of the
fetched ref. The flag is there for the window between those two steps, where an
upstream that moved would otherwise produce a merge commit in a store you do
not own.
