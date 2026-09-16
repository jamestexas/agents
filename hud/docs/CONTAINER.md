# The container image (apko + melange)

Building the distroless image, why it is not how to run your own HUD, and the
per-panel verdict from a real build probed route by route.

## Building it

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

## Two things the image must do that a wrapper cannot

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

## What works in the container, and what does not

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

## Mounting

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
