// container-entry.mjs — the HUD's main() when it runs inside a container.
//
// `node server.mjs` stays the canonical way to run the HUD on a laptop. This
// file exists because two things that are right on a laptop are wrong in a
// container, and neither can be fixed by wrapping server.mjs:
//
//   1. server.mjs self-starts only when `argv[1]` resolves to the module URL
//      node loaded it from. A launcher that exec'd it through any indirection
//      would start nothing and exit 0 — the same failure the launchd installer
//      guards against with `pwd -P` (see service/install.sh).
//   2. server.mjs binds 127.0.0.1. A published container port forwards to the
//      container's external interface, not to its loopback, so a loopback-bound
//      listener is unreachable from the host no matter what `-p` says.
//
// Importing server.mjs rather than exec'ing it leaves its self-start guard
// false, so there is exactly one listener and it is this one. The bind address
// is still a choice: HUD_HOST overrides it, and a deployment that fronts the
// HUD with something else should set it back to 127.0.0.1.
//
// The HUD's watch-only posture is unchanged — this file adds no route, no
// method, and no capability. It only decides where the socket lives.

import { createServer, DEFAULT_PORT, defaultRoot, loadConfigDetail } from "./server.mjs";

const root = defaultRoot();
const port = Number(process.env.HUD_PORT || DEFAULT_PORT);
// 0.0.0.0 because the container *is* the isolation boundary here: the image
// publishes one port and the runtime decides who reaches it. On a host, the
// process is the boundary and 127.0.0.1 is the right default — which is why
// server.mjs keeps it and this file does not change server.mjs.
const host = process.env.HUD_HOST || "0.0.0.0";

const cfg = loadConfigDetail(root);
for (const warn of cfg.warns) {
  process.stderr.write(`hud: ${cfg.file}: ${warn}\n`);
}
if (cfg.file === null) {
  // Not fatal: the static layer does not need a config. But a container whose
  // content tree failed to mount looks exactly like one with no panels, and
  // that ambiguity is expensive to debug from the outside.
  process.stderr.write(`hud: no hud.toml under ${root} — panels will be empty\n`);
}

const server = createServer({ root });

server.listen(port, host, () => {
  process.stdout.write(`hud: ${root}\nhud: http://${host}:${port}/\n`);
  // Off the request path, as on a host. In a distroless image there is no `gh`,
  // so this reliably fails and leaves any mounted snapshot untouched — the
  // peers panel then serves that snapshot, or 503s if there is none.
  server.hudRefreshPeers().then(
    (r) => process.stdout.write(`hud: peers ${r.wrote ? "refreshed" : "unchanged"}\n`),
    () => {},
  );
});

server.on("error", (err) => {
  process.stderr.write(`hud: ${err.message}\n`);
  process.exit(1);
});

// Node's default disposition for SIGTERM kills the process outright, which
// would cut in-flight responses on every `docker stop`. Closing the server
// first lets them finish; the timer is the backstop for a wedged connection.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    const forced = setTimeout(() => process.exit(0), 5000);
    forced.unref();
    server.close(() => process.exit(0));
  });
}
