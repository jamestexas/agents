# Work-board Cloister cluster

This directory is a directly runnable Cloister cluster. It hosts the
workerd-native board and a deterministic Canonical Hours-compatible source;
Claude Code is not part of this process.

Build the two local images from the package root:

```bash
cd /path/to/agents/work-board
docker build -t work-board:smoke -f Dockerfile .
docker build -t canonical-hours-fixture:work-board-smoke \
  -f cloister/fixture.Dockerfile .
```

Start and stop it with Cloister's cluster verb:

```bash
cloister cluster up \
  --dir /path/to/agents/work-board/cloister \
  --detach

open http://127.0.0.1:8791/board/ui

cloister cluster down \
  --dir /path/to/agents/work-board/cloister
```

`cluster.toml` is the operator-readable declaration and
`cluster.compose.yaml` is the generated deployment artifact. Keep them in
sync through Cloister's TOML → compose pipeline; do not edit the generated
YAML by hand. The default `down` preserves volumes. Pass `--destroy` only
when removing the cluster's durable state is intentional.
