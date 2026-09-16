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
root's `LICENSE` is Apache-2.0 and does **not** cover anything under `hud/`,
and GitHub's repository label is wrong about this directory — its detector
reads only the root file and reports "Apache-2.0". Apache-2.0 code may be used
**inside** `hud/`; code from `hud/` may **not** be copied **out**. Full
statement and rationale: [docs/LICENSING.md](docs/LICENSING.md).

## Run it

Start here — you have no content tree yet, and this makes one:

```bash
hud/hud init                           # scaffold a tree + hud.toml, then follow
hud/hud init --dry-run                 # the whole plan, writing nothing
```

`init` probes for each source and configures only what is actually running on
your machine; everything it cannot find is written into `hud.toml` as a
commented stub saying why and what to install. It never overwrites an existing
`hud.toml` and never creates a git remote — see
[docs/SOURCES.md](docs/SOURCES.md).

With a tree in place:

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

**New here?** → `hud/hud init`, then `hud status`: init tells you what it
found and what it left as a stub, and status prints the resolved tree, the
service state, and which upstreams are actually answering. Between them, that
is the fastest way to see what this HUD is wired to and what it is not.

## The `hud` command

| Command | Does |
| --- | --- |
| `hud init [--root DIR] [--yes] [--dry-run]` | Scaffolds a new content tree and its `hud.toml`, configuring only the sources it can actually detect and commenting out the rest with a reason. Adds what is missing to an existing tree, never overwrites `hud.toml`, never creates a git remote. See [docs/SOURCES.md](docs/SOURCES.md). |
| `hud start` | Starts the launchd service if one is installed, otherwise `node server.mjs` backgrounded; idempotent. |
| `hud stop` | Boots the service out; the plist stays, so `hud start` brings it back. |
| `hud restart` | `stop`, then `start`. |
| `hud status [--json]` | Resolved `HUD_ROOT` and config file, service state and pid, port and health, and whether each configured upstream answers. `--json` emits the same facts as one document — see [docs/STATUS-JSON.md](docs/STATUS-JSON.md). |
| `hud open` | Opens the HUD in your browser. |
| `hud logs [-f] [-n N]` | Tails `$HUD_ROOT/.generated/service.log` — the file both start paths write to. |
| `hud root` | Prints the resolved `HUD_ROOT`. |
| `hud sync [-m MSG] [--dry-run]` | Backs the **content tree** up: stage, commit, push to its git remote in one verb. Never force-pushes. See [Backing the content tree up](docs/CLI.md#backing-the-content-tree-up). |
| `hud link` / `hud unlink` | Puts **this command** on your PATH, and takes it off. See [Two installs, two verbs](docs/CLI.md#two-installs-two-verbs). |
| `hud install` / `hud uninstall` | Installs and removes **the launchd service**, via `service/install.sh` / `service/uninstall.sh`; arguments passed through. |
| `hud index` | `hud-index.mjs` — rebuilds the mache index. |
| `hud smoke` | `smoke.sh` — the integration gate against the real tree. |
| `hud test` | `node --test test/` — the hermetic suite. |

Upstream endpoints, the launchd label, and the port the *service* runs on all
come from `$HUD_ROOT/hud.toml`. Two caveats the file itself cannot tell you:
`server.mjs` reads `HUD_PORT` from the environment, not `[serve] port` — the
service works because `install.sh` renders that value into the plist — and it
binds `127.0.0.1` literally, so **`[serve] host` is not read by anything**. It
cannot expose the HUD, and it is not what keeps it loopback-only;
`HUD_ROOT`, `HUD_PORT`, `HUD_HOST` and `HUD_LABEL` override the file. `hud
status` always exits 0 — it reports state rather than asserting it.

## Further reading

- [docs/SOURCES.md](docs/SOURCES.md) — every `hud.toml` key, what tool or
  service enables it, and what each panel does when its source is absent
- [docs/CLI.md](docs/CLI.md) — what each verb refuses to do, `link` vs
  `install` vs `sync`, the XDG reasoning, and what `hud sync` pre-decides
- [docs/STATUS-JSON.md](docs/STATUS-JSON.md) — the `hud-status/v1` document,
  both closed status vocabularies, and the exit-code rule
- [docs/CONTAINER.md](docs/CONTAINER.md) — building the distroless image, the
  per-panel verdict, and which bind mounts it needs
- [docs/LICENSING.md](docs/LICENSING.md) — AGPL-3.0-only here, Apache-2.0
  everywhere else, and the one-way boundary between them
