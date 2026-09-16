# `hud status --json` — the machine-readable contract

The closed vocabularies a program can rely on, and why the command answers the
way it does. `hud status` itself is a row in
[the README's command table](../README.md#the-hud-command).

## The document

`hud status --json` emits one document carrying a versioned `schema`
(`hud-status/v1`): the resolved root, how the config resolved, serving state
and HTTP code, the service's label/loaded/pid, the log path, where the CLI is
linked, a `backup` object, and an `upstreams` array.

## Upstreams

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

## Backup

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

## The exit-code rule

**`hud status` always exits 0.** It reports state rather than asserting it, and
an unreachable upstream is a normal state — the panel greys out and the HUD
keeps serving everything else. A status command that failed the moment your
digest daemon was down would be a worse tool for exactly the situation you run
it in.

That rule holds in JSON mode too: `--json` changes the format, not what the
command asserts, so an unreachable upstream still exits 0. Both views render
from one probe, so they cannot drift from each other.

## Why this exists alongside `/api/*`

The HUD's HTTP API already serves tree and panel data machine-readably at
`/api/*`, so `--json` deliberately does not duplicate it. It exists for what
HTTP cannot tell you — service state, config resolution, and install state —
which is exactly what you want a program to see when the HUD is *not*
answering. `hud root` has no `--json`: it already prints one bare path, and
wrapping that in a document would add a schema to maintain for no information.
