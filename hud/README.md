# `hud/` — the work HUD

One page that renders a markdown knowledge tree on the left and, on the right,
panels for whatever local services you point it at. Watch-only by
construction: content routes are GET-only and tested to stay that way, and
every "do" is a link out into the tool where a human acts.

**The code is here; the content is not.** This directory holds only the
machinery. Everything the HUD renders lives in a separate tree selected by
`HUD_ROOT` (default `~/hud`), along with its `hud.toml` and everything the HUD
writes back under a gitignored `$HUD_ROOT/.generated/`.

Node stdlib only — no npm packages, no build step, no `node_modules`.

**This directory is [AGPL-3.0-only](LICENSE), not Apache-2.0.** The repository
root's `LICENSE` is Apache-2.0 and does not govern anything under `hud/`. See
[License](#license) below before copying code out of here.

```bash
HUD_ROOT=~/hud node hud/server.mjs     # then open http://127.0.0.1:4870
```

```bash
node --test hud/test/                  # hermetic suite; touches no real tree
bash hud/smoke.sh                      # asserts against a real HUD_ROOT
bash hud/service/install.sh            # optional macOS launchd agent
```

Or reach all of it through one command, from any directory:

```bash
hud/hud link                           # symlink onto PATH ($XDG_BIN_HOME)
hud status                             # config, service, port, upstreams, backup
hud sync                               # back the content tree up to its remote
```

**New here?** → run the quickstart above, then `hud status`: it prints the
resolved tree, the service state, and which upstreams are actually answering,
which is the fastest way to see what this HUD is wired to. The sections below
are reference material — expand what you need.

## Contents

- [The `hud` command](#the-hud-command) — subcommands, and what each one delegates to
- [Container image (apko + melange)](#container-image-apko--melange) — building and running the distroless image
- [What works in the container, and what does not](#what-works-in-the-container-and-what-does-not) — the per-panel verdict
- [Mounting](#mounting) — which bind mounts the image needs
- [License](#license) — AGPL-3.0-only here, Apache-2.0 everywhere else, and the one-way boundary between them

## The `hud` command

<details>
<summary><strong>One entry point for the server, the service, and the gates</strong></summary>

`hud/hud` is a dispatcher, not a second implementation: every subcommand runs
the script or entry point that already existed. It resolves its own symlink
chain before taking a dirname, so a single link into a directory on `PATH`
makes it work from anywhere.

```bash
hud/hud link      # put the COMMAND on your PATH
hud/hud install   # install the SERVICE — a different thing; see below
```

| Command | Does |
| --- | --- |
| `hud start` | Starts the launchd service if one is installed, otherwise `node server.mjs` backgrounded. Idempotent. If a process it did not start holds the port, it refuses and prints the pid — the same posture as `service/install.sh`. |
| `hud stop` | Boots the service out rather than killing it, because `KeepAlive` would restart anything killed. The plist stays, so `hud start` brings the same service back. |
| `hud restart` | `stop`, then `start`. |
| `hud status [--json]` | Resolved `HUD_ROOT` and config file, service state and pid, port and health, and whether each configured upstream answers. `--json` emits the same facts as one document; see [Machine-readable status](#machine-readable-status). |
| `hud open` | Opens the HUD in your browser. |
| `hud logs [-f] [-n N]` | Tails `$HUD_ROOT/.generated/service.log` — the file both start paths write to. |
| `hud root` | Prints the resolved `HUD_ROOT`. |
| `hud sync [-m MSG] [--dry-run]` | Backs the **content tree** up: stage, commit, push to its git remote in one verb. A clean, in-sync tree exits 0 saying there is nothing to sync. Never force-pushes. See [Backing the content tree up](#backing-the-content-tree-up). |
| `hud link` / `hud unlink` | Puts **this command** on your PATH, and takes it off. See [Two installs, two verbs](#two-installs-two-verbs). |
| `hud install` / `hud uninstall` | Installs and removes **the launchd service**, via `service/install.sh` / `service/uninstall.sh`; arguments passed through. |
| `hud index` | `hud-index.mjs` — rebuilds the mache index. |
| `hud smoke` | `smoke.sh` — the integration gate against the real tree. |
| `hud test` | `node --test test/` — the hermetic suite. |

Ports, hosts, labels, and upstream endpoints all come from `$HUD_ROOT/hud.toml`
through the server's own `loadConfig()`. There is no second config path and no
second TOML parser; `HUD_ROOT`, `HUD_PORT`, `HUD_HOST` and `HUD_LABEL` override
the file, as they do everywhere else in the HUD.

**`hud status` always exits 0.** It reports state rather than asserting it, and
an unreachable upstream is a normal state — the panel greys out and the HUD
keeps serving everything else. A status command that failed the moment your
digest daemon was down would be a worse tool for exactly the situation you run
it in.

### Two installs, two verbs

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

### Backing the content tree up

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

### Machine-readable status

`hud status --json` emits one document carrying a versioned `schema`
(`hud-status/v1`): the resolved root, how the config resolved, serving state
and HTTP code, the service's label/loaded/pid, the log path, where the CLI is
linked, a `backup` object, and an `upstreams` array.

Every upstream entry carries `name`, `target`, a `status` from a closed
four-state vocabulary, and a `reason` that is never blank:

| `status` | Means |
| --- | --- |
| `ok` | Probed, and answering. |
| `unreachable` | Probed, and did not answer, or does not exist. |
| `absent` | Not configured — there is no panel to serve. |
| `skipped` | Configured, but not probed; `reason` says what prevented it. |

This is the same contract `scripts/pr-context.sh` emits — one status per entry,
drawn from a fixed set, always with a reason — so a consumer tests one field
and never infers meaning from an empty value. The words differ from that
tool's because the question does: it asks whether a query returned rows, this
asks whether the thing on the other end is there.

`backup` keeps the same contract for the other question `status` answers —
*is my knowledge safe?* It carries `remote`, `url`, `branch`, `upstream`, the
`ahead` / `behind` / `dirty` counts, and one `status` from its own closed
five-state vocabulary, again with a reason that is never blank:

| `status` | Means |
| --- | --- |
| `synced` | A remote is configured, and everything committed here is on it. |
| `unpushed` | Work exists only on this machine — uncommitted, or committed and unpushed, or a branch with no upstream yet. |
| `diverged` | The remote holds commits this tree does not. Pull before syncing. |
| `absent` | No remote configured; this tree is not backed up anywhere. |
| `unknown` | Could not tell; `reason` says what stopped it (no `git`, not a repo, detached HEAD). |

The counts come from the local remote-tracking ref, so they are as fresh as
your last fetch and the probe stays offline — `hud status` must not block on the
network to tell you the *service* is down. `hud sync` asks the remote itself,
because acting on a stale answer is how you force-push by accident. A count
that could not be determined is `null`, never `0`: "behind is null" and "behind
is 0" are different claims, and a program deciding whether your notes are safe
has to be able to tell them apart.

The exit-code rule above holds in JSON mode too: `--json` changes the format,
not what the command asserts, so an unreachable upstream still exits 0. Both
views render from one probe, so they cannot drift from each other.

The HUD's HTTP API already serves tree and panel data machine-readably at
`/api/*`, so `--json` deliberately does not duplicate it. It exists for what
HTTP cannot tell you — service state, config resolution, and install state —
which is exactly what you want a program to see when the HUD is *not*
answering. `hud root` has no `--json`: it already prints one bare path, and
wrapping that in a document would add a schema to maintain for no information.

</details>

## Container image (apko + melange)

<details>
<summary><strong>Building the distroless image, and why it is not how to run your own</strong></summary>

`melange.yaml` stages the machinery into an APK; `apko.yaml` assembles a
distroless image — node, the HUD, a CA bundle, nothing else. No shell, no
package manager.

```bash
melange keygen hud/melange.rsa
melange build hud/melange.yaml --source-dir hud --runner docker \
  --arch aarch64 --signing-key hud/melange.rsa --out-dir hud/packages
cd hud && apko build apko.yaml hud:0.1.0 hud.tar \
  --keyring-append melange.rsa.pub --arch aarch64
docker load < hud.tar

docker run --rm -p 4870:4870 \
  --mount type=bind,src=/path/to/your/hud,dst=/hud,ro \
  hud:0.1.0-arm64
```

The signing key is a local build credential generated per clone, not a release
key — it is gitignored, and nothing verifies the published image against it.

**This image is for distribution and for handing the HUD to a peer. It is not
the recommended way to run your own HUD.** `launchd` via
`hud/service/install.sh` remains that: it runs as you, on your filesystem,
where every path the panels reach already resolves. The next two sections are
the reason — containerising the HUD costs you most of the right-hand column.

### Two things the image must do that a wrapper cannot

`container-entry.mjs` is the container's `main()`, and it exists because
`server.mjs` is correct for a laptop in two ways that are wrong in a container:

- `server.mjs` self-starts only when `argv[1]` resolves to the module URL node
  loaded it from. Exec'ing it through any indirection starts nothing and exits
  0 — the same failure `service/install.sh` guards against with `pwd -P`.
- `server.mjs` binds `127.0.0.1`. A published container port forwards to the
  container's external interface, not its loopback, so a loopback-bound
  listener is unreachable from the host no matter what `-p` says.

`container-entry.mjs` imports the server rather than exec'ing it, so the
self-start guard stays false and there is exactly one listener. It binds
`0.0.0.0`; `HUD_HOST` overrides that.

</details>

## What works in the container, and what does not

<details>
<summary><strong>Per-panel verdict, from a real build probed route by route</strong></summary>

Verified by building the image and probing every route against a fixture tree.

| Panel / route | In a container | Why |
| --- | --- | --- |
| Static tree — `/api/tree`, `/api/md`, `/api/config` | Works | Pure reads of the mounted tree. |
| Deep links — `/n/<path>` | Works | Same reads; the path is the slug. |
| Theme, UI shell | Works | Static assets served from the image. |
| Mermaid | Works | `ui/mermaid.min.js` is vendored into the image and renders client-side. |
| Sessions — `/api/sessions` | Works **if** mounted and configured | Needs `~/.claude` bind-mounted *and* `sources.sessions.root` in `hud.toml` pointing at that mount — there is no default, so an unconfigured HUD 404s this route. The optional lectio graft stays `off`/`unavailable` without the daemon; tier-1 rows are unaffected. |
| Loadout — `/api/loadout` | Partly, and its drift is **not** trustworthy | See below. |
| Peers — `/api/dyn/peers` | Cannot | Needs the `gh` CLI plus auth. A distroless image has neither, so the refresh fails (`command not found: gh`) and the route 503s — unless a previously written `.generated/peers.json` is in the mounted tree, in which case it serves that snapshot, correctly flagged stale. |
| Digest — `/api/dyn/digest` | Cannot | Runs `sources.digest.cmd`, i.e. the `lectio` CLI, which is not in the image. 503s with `command not found: lectio`. |
| Board — `/api/dyn/board` | Works only with host networking | Fetches `sources.board.url` over HTTP. The work-board runs on the host, so the URL must be reachable from inside the container — on macOS that means `host.docker.internal`, not `127.0.0.1`. |

Adding `gh` and `lectio` to the image would not fix peers or digest. Both need
*your* credentials, and a HUD image that carried them would stop being
something you could hand to a peer.

### Why loadout degrades quietly

`~/.claude` is a directory of symlinks into checked-out repositories. Mounting
it into a container brings the links but not their targets, so the loadout
panel reports every one as a `broken-symlink` at severity `hot` — drift that
does not exist on the host.

Mounting `~/.claude` alone is therefore necessary but **not sufficient**: on a
fixture run it yielded 0 agents and 77 false broken-symlinks. Also mounting
this repository at its *identical host path* — the path the symlinks name —
restored the inventory exactly (41 skills, 26 agents, matching a host-run
baseline), but drift still disagreed with the host (38 vs 94), because drift is
a judgment about a host filesystem that the container can only partially see.

Treat the in-container inventory as usable and the in-container drift count as
an artifact of what you mounted. On a host, both are real.

</details>

## Mounting

<details>
<summary><strong>The one required bind mount, and the optional one for sessions</strong></summary>

The content tree is the only mount the image requires:

```bash
--mount type=bind,src=/path/to/your/hud,dst=/hud,ro
```

`HUD_ROOT=/hud` and `HUD_PORT=4870` are baked into the image; `/hud` exists as
a mount point owned by the run-as user (`65533`). A read-only mount is
supported — the HUD logs the failed `.generated/` write and serves the tree —
but it also means no snapshot the container produces survives the container.
Mount read-write if you want the peers snapshot or the mache index to persist.

To exercise sessions and loadout, add `~/.claude` read-only, and read the
loadout caveat above before trusting what the panel says:

```bash
--mount type=bind,src=$HOME/.claude,dst=/home/hud/.claude,ro
```

`/home/hud` is the run-as user's home, so that path is what the loadout
default (`~/.claude`) resolves to inside the image. For sessions, mount it
wherever you like and name that path in `sources.sessions.root`.

</details>

## License

**`hud/` is AGPL-3.0-only.** Full text in [`hud/LICENSE`](LICENSE); SPDX
identifier `AGPL-3.0-only`. The rest of the repository is Apache-2.0
([`../LICENSE`](../LICENSE)), and that root file does **not** cover this
directory — a reader who assumes it does, or who trusts GitHub's repository
label (the detector reads only the root file and reports "Apache-2.0"), will
get this directory wrong.

Why the asymmetry: everything else in this repository is text you copy into
your own `~/.claude/`, where permissive is the whole point. The HUD is a served
web application. Run it where others can reach it and the AGPL's section 13
network clause is exactly the obligation that fits the artifact — users of the
running instance can get its source. `-only`, not `-or-later`: version 3 of the
AGPL and no other.

The published container image carries the same identifier, so a recipient of
the bits learns the obligation from the metadata rather than from this file:
`org.opencontainers.image.licenses: AGPL-3.0-only` in
[`apko.yaml`](apko.yaml), and `copyright: [license: AGPL-3.0-only]` in
[`melange.yaml`](melange.yaml), which is what reaches the APK metadata and the
generated SBOM.

### One-way compatibility (invariant)

> Apache-2.0 code from this repository may be used **inside** `hud/`.
> Code from `hud/` may **not** be copied **out** into the Apache-2.0 part.

That direction is not a style preference; it is what the two licenses permit.
Apache-2.0 is one-way compatible with the AGPL — permissive code can be
absorbed into a copyleft work, and the result is AGPL. The reverse launders
AGPL code into an Apache-2.0 notice, mislicensing it for everyone downstream
who trusts that notice, and no tool in this repository will tell you it
happened.

**The property being preserved:** `hud/` imports nothing from outside itself —
only Node builtins (`node:fs`, `node:http`, …) and its own modules. The
vendored `hud/ui/` bundles are MIT third-party code, not repository code. That
self-containment is what makes the boundary checkable by looking at it.

**How it gets violated by accident**, which is the only way it will be:

- Lifting a helper out of `hud/server.mjs` or `hud/hud-index.mjs` into a shared
  `scripts/` module because two places now want it. The copy in `scripts/` is
  AGPL code under an Apache-2.0 notice.
- Adding an `import` in `hud/` that reaches above `hud/`. This one is legal
  license-wise (Apache flows in) but it dissolves the self-containment that
  makes the first violation easy to spot, so treat it as a boundary change and
  say so in the commit.
- Copying a `hud/ui/index.html` snippet into a skill or agent file elsewhere in
  the repository.

If code genuinely needs to be shared across the boundary, move it **into** the
Apache-2.0 part first and have `hud/` import it from there. Direction matters;
the destination license does not change under you.

### Vendored third-party code

`hud/ui/marked.min.js` and `hud/ui/mermaid.min.js` are vendored bundles, both
MIT. MIT is AGPL-compatible, but attribution is mandatory: see
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for each bundle's version
and full notice. Both files carry the notice in their own header too. If you
bump a bundle, keep the header and update the version in that file.
