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
hud/hud link                           # symlink onto PATH (~/.local/bin)
hud status                             # config, service, port, upstreams
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

## The `hud` command

<details>
<summary><strong>One entry point for the server, the service, and the gates</strong></summary>

`hud/hud` is a dispatcher, not a second implementation: every subcommand runs
the script or entry point that already existed. It resolves its own symlink
chain before taking a dirname, so a single link into a directory on `PATH`
makes it work from anywhere.

```bash
hud/hud link      # ln -s into ~/.local/bin (HUD_LINK_DIR picks another dir)
```

| Command | Does |
| --- | --- |
| `hud start` | Starts the launchd service if one is installed, otherwise `node server.mjs` backgrounded. Idempotent. If a process it did not start holds the port, it refuses and prints the pid — the same posture as `service/install.sh`. |
| `hud stop` | Boots the service out rather than killing it, because `KeepAlive` would restart anything killed. The plist stays, so `hud start` brings the same service back. |
| `hud restart` | `stop`, then `start`. |
| `hud status` | Resolved `HUD_ROOT` and config file, service state and pid, port and health, and whether each configured upstream answers. |
| `hud open` | Opens the HUD in your browser. |
| `hud logs [-f] [-n N]` | Tails `$HUD_ROOT/.generated/service.log` — the file both start paths write to. |
| `hud root` | Prints the resolved `HUD_ROOT`. |
| `hud install` / `hud uninstall` | `service/install.sh` / `service/uninstall.sh`, arguments passed through. |
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
