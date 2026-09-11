// Hermetic tests for the HUD dynamic layer (board proxy, digest, peers).
//
// Nothing here touches the network, the real HUD_ROOT, or the real `gh`:
//   - the board upstream is a node http server on an ephemeral port,
//   - `gh` is a shim script on a per-test PATH,
//   - the digest command is a tiny script written into the fixture.
// Every fixture uses generic handles (peer-a…) — no real person, company or
// project name appears in this tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createServer, readPeerHandles, refreshPeers, tokenizeCommand } from "../server.mjs";

// ------------------------------------------------------------------ helpers

/** Build a tmp HUD_ROOT from {relative path: contents}. */
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-dyn-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function config(sources, extra = {}) {
  return JSON.stringify({ sources, ...extra }, null, 2);
}

/** Write an executable script into the fixture and return its absolute path. */
function script(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, { mode: 0o755 });
  fs.chmodSync(abs, 0o755);
  return abs;
}

/** Start the HUD server on an ephemeral port. */
async function serve(t, root, opts = {}) {
  const server = createServer({
    root,
    uiDir: path.join(import.meta.dirname, "..", "ui"),
    httpTimeoutMs: 1500,
    cmdTimeoutMs: 5000,
    ...opts,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    base,
    get: (p) => fetch(base + p, { cache: "no-store" }),
    post: (p) => fetch(base + p, { method: "POST", cache: "no-store" }),
  };
}

/** Stub board upstream. `hits` records the paths it was asked for. */
async function stubUpstream(t, handler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { hits, url: `http://127.0.0.1:${server.address().port}` };
}

/** A URL nothing is listening on: bind an ephemeral port, then release it. */
async function deadUrl() {
  const probe = http.createServer(() => {});
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return `http://127.0.0.1:${port}/api/board`;
}

const PR_JSON_FIELDS = "number,title,repository,updatedAt,url";

/**
 * Install a `gh` shim on a private PATH. It logs its argv (so the test can
 * assert the exact command) and answers per `--author`: peer-a has PRs, peer-b
 * has none, anything else fails like an un-authenticated gh.
 */
function shimGh(root, prsForPeerA) {
  const logPath = path.join(root, "gh-argv.log");
  script(
    root,
    "bin/gh",
    [
      "#!/bin/sh",
      `echo "$@" >> "${logPath}"`,
      'author=""',
      'while [ $# -gt 0 ]; do',
      '  if [ "$1" = "--author" ]; then author="$2"; shift 2; else shift; fi',
      "done",
      'case "$author" in',
      "  peer-a)",
      `    cat <<'JSON'`,
      JSON.stringify(prsForPeerA),
      "JSON",
      "    ;;",
      "  peer-b) echo '[]' ;;",
      '  *) echo "gh: could not resolve author" >&2; exit 1 ;;',
      "esac",
      "",
    ].join("\n"),
  );
  return {
    logPath,
    env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}` },
    argv: () =>
      fs.existsSync(logPath)
        ? fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean)
        : [],
  };
}

const snapshotPath = (root, name) => path.join(root, ".generated", `${name}.json`);
const readGenerated = (root, name) => JSON.parse(fs.readFileSync(snapshotPath(root, name), "utf8"));

// -------------------------------------------------------- required behaviors

test("proxy success writes snapshot", async (t) => {
  const board = {
    generated_at: "2026-09-10T09:14:00.000Z",
    items: [
      {
        number: 101,
        title: "feat: a thing",
        state: "needs_you",
        reason: "changes requested",
        url: "https://example.invalid/owner/repo/pull/101",
      },
      {
        number: 102,
        title: "fix: another thing",
        state: "waiting_on_review",
        reason: "awaiting review",
        url: "https://example.invalid/owner/repo/pull/102",
      },
    ],
  };
  const upstream = await stubUpstream(t, (req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(board));
  });
  const root = fixture(t, {
    "hud.config.json": config({ board: { url: `${upstream.url}/api/board` } }),
  });
  const { get } = await serve(t, root);

  const res = await get("/api/dyn/board");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  const body = await res.json();

  assert.equal(body.source, "board");
  assert.equal(body.stale, false);
  assert.ok(Date.parse(body.cached_at) > 0, "cached_at is an ISO timestamp");
  assert.deepEqual(body.data, board, "upstream JSON is passed through verbatim");
  assert.deepEqual(upstream.hits, ["/api/board"], "the configured path is what got fetched");

  // …and the same bytes are on disk for the next time the upstream is down.
  const snap = readGenerated(root, "board");
  assert.deepEqual(Object.keys(snap).sort(), ["cached_at", "data"]);
  assert.equal(snap.cached_at, body.cached_at);
  assert.deepEqual(snap.data, board);
  assert.equal(snap.data.items[0].state, "needs_you");
});

test("upstream down serves stale snapshot", async (t) => {
  const cachedAt = "2026-09-09T08:07:06.000Z";
  const cached = { items: [{ number: 7, title: "feat: cached", state: "needs_you", reason: "stale" }] };
  const root = fixture(t, {
    "hud.config.json": config({ board: { url: await deadUrl() } }),
    ".generated/board.json": JSON.stringify({ cached_at: cachedAt, data: cached }),
  });
  const { get } = await serve(t, root);

  const res = await get("/api/dyn/board");
  assert.equal(res.status, 200, "a down upstream is not an error for the HUD");
  const body = await res.json();
  assert.equal(body.stale, true);
  assert.equal(body.cached_at, cachedAt, "the panel reports the snapshot's own age");
  assert.deepEqual(body.data, cached);
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.length > 0, "why it is stale is reported alongside the data");

  // A failed fetch must not clobber the only copy of the data.
  assert.deepEqual(readGenerated(root, "board"), { cached_at: cachedAt, data: cached });
});

test("no snapshot yields 503 not crash", async (t) => {
  const root = fixture(t, {
    "hud.config.json": config({ board: { url: await deadUrl() } }),
    "inbox/2026-09-10-a-note.md": "# A Note\n",
  });
  const { get } = await serve(t, root);

  const res = await get("/api/dyn/board");
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  const body = await res.json();
  assert.equal(body.source, "board");
  assert.equal(body.cached_at, null);
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.length > 0);
  assert.equal(body.data, undefined, "no snapshot means no data, not empty data");
  assert.ok(!JSON.stringify(body).includes("server.mjs"), "no stack trace in the response");

  // The static layer is untouched and the server is still answering.
  const tree = await get("/api/tree");
  assert.equal(tree.status, 200);
  assert.equal((await tree.json()).sections[0].entries[0].title, "A Note");
  assert.equal((await get("/api/dyn/board")).status, 503, "still 503, not wedged");
});

test("peers json from fixture frontmatter and shimmed gh", async (t) => {
  const prs = [
    {
      number: 11,
      title: "feat: peer-a work",
      repository: { name: "repo-one", nameWithOwner: "owner/repo-one" },
      updatedAt: "2026-09-10T06:00:00Z",
      url: "https://example.invalid/owner/repo-one/pull/11",
    },
    {
      number: 12,
      title: "fix: peer-a followup",
      repository: { name: "repo-two", nameWithOwner: "owner/repo-two" },
      updatedAt: "2026-09-09T18:30:00Z",
      url: "https://example.invalid/owner/repo-two/pull/12",
    },
  ];
  const root = fixture(t, {
    "hud.config.json": config({}, { peer_pr_lookback_days: 7 }),
    // gh: frontmatter drives the lookup…
    "peers/peer-a.md": "---\ngh: peer-a\nrepos: [owner/repo-one]\n---\n# Peer A\n",
    // …and a bare file falls back to its filename.
    "peers/peer-b.md": "# Peer B\n",
    // …and a handle gh cannot resolve degrades that row only.
    "peers/peer-c.md": "---\ngh: peer-c\n---\n# Peer C\n",
    // Not a peer file: skipped, never shelled out for.
    "peers/.gitkeep": "",
    "peers/notes.txt": "not markdown\n",
  });
  const gh = shimGh(root, prs);

  assert.deepEqual(
    readPeerHandles(root).map((p) => p.handle),
    ["peer-a", "peer-b", "peer-c"],
    "handles come from frontmatter or filename, sorted, .md only",
  );

  const result = await refreshPeers(root, { env: gh.env, cmdTimeoutMs: 5000 });
  assert.equal(result.wrote, true);
  assert.equal(result.ok, false, "one unresolvable handle is reported, not hidden");
  assert.deepEqual(
    result.errors.map((e) => e.handle),
    ["peer-c"],
  );

  const snap = readGenerated(root, "peers");
  assert.deepEqual(Object.keys(snap).sort(), ["generated_at", "peers"]);
  assert.ok(Date.parse(snap.generated_at) > 0);
  assert.deepEqual(
    snap.peers.map((p) => p.handle),
    ["peer-a", "peer-b", "peer-c"],
  );
  assert.deepEqual(snap.peers[0], {
    handle: "peer-a",
    prs: [
      {
        number: 11,
        title: "feat: peer-a work",
        repository: "owner/repo-one",
        updatedAt: "2026-09-10T06:00:00Z",
        url: "https://example.invalid/owner/repo-one/pull/11",
      },
      {
        number: 12,
        title: "fix: peer-a followup",
        repository: "owner/repo-two",
        updatedAt: "2026-09-09T18:30:00Z",
        url: "https://example.invalid/owner/repo-two/pull/12",
      },
    ],
  });
  assert.deepEqual(snap.peers[1], { handle: "peer-b", prs: [] });
  assert.deepEqual(snap.peers[2].prs, []);
  assert.match(snap.peers[2].error, /could not resolve author|exit|Command failed/i);

  // The exact command, once per handle, no shell.
  assert.deepEqual(gh.argv(), [
    `search prs --author peer-a --state open --json ${PR_JSON_FIELDS}`,
    `search prs --author peer-b --state open --json ${PR_JSON_FIELDS}`,
    `search prs --author peer-c --state open --json ${PR_JSON_FIELDS}`,
  ]);

  // Serving is snapshot-only: the read path never shells out.
  const { get, post } = await serve(t, root, { env: gh.env });
  const before = gh.argv().length;
  const served = await get("/api/dyn/peers");
  assert.equal(served.status, 200);
  const body = await served.json();
  assert.equal(body.stale, true, "no refresh in this process yet, so it is a snapshot");
  assert.equal(body.cached_at, snap.generated_at);
  assert.deepEqual(body.data, snap);
  assert.equal(gh.argv().length, before, "GET /api/dyn/peers did not invoke gh");

  // The ⟳ path re-runs the lookup and reports the per-peer failure.
  const refreshed = await post("/api/refresh/peers");
  assert.equal(refreshed.status, 200);
  const rbody = await refreshed.json();
  assert.equal(rbody.refreshed, true);
  assert.equal(rbody.stale, false, "a snapshot written just now is not stale");
  assert.deepEqual(
    rbody.errors.map((e) => e.handle),
    ["peer-c"],
  );
  assert.equal(gh.argv().length, before + 3, "one gh call per handle on refresh");
  assert.notEqual(rbody.cached_at, snap.generated_at, "generated_at advanced");
});

test("missing lectio yields 503 server alive", async (t) => {
  const root = fixture(t, {
    "hud.config.json": config({ digest: { cmd: "hud-test-absent-digest-cli digest --since 24h" } }),
    "inbox/2026-09-10-still-here.md": "# Still Here\n",
  });
  const { get } = await serve(t, root);

  const res = await get("/api/dyn/digest");
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  const body = await res.json();
  assert.equal(body.source, "digest");
  assert.equal(body.cached_at, null);
  assert.match(body.error, /hud-test-absent-digest-cli|ENOENT|not found/);
  assert.ok(!JSON.stringify(body).includes("server.mjs"), "no stack trace in the response");
  assert.equal(fs.existsSync(snapshotPath(root, "digest")), false, "a failure writes no snapshot");

  // Server alive: static layer, a second digest attempt, and another route.
  assert.equal((await get("/api/tree")).status, 200);
  assert.equal((await get("/api/dyn/digest")).status, 503);
  assert.equal((await get("/")).status, 200);
});

// ---------------------------------------------------------- further cases

test("digest output is cached and replayed when the command breaks", async (t) => {
  const observations = [
    { at: "2026-09-10T09:02:00Z", kind: "commit", text: "committed to a local repo" },
    { at: "2026-09-10T08:40:00Z", kind: "session", text: "opened a session" },
  ];
  const root = fixture(t, { "inbox/x.md": "# x\n" });
  const cli = script(
    root,
    "bin/digest-cli",
    ["#!/bin/sh", `cat <<'JSON'`, JSON.stringify(observations), "JSON", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "hud.config.json"),
    config({ digest: { cmd: `"${cli}" digest --since 24h` } }),
  );
  const { get } = await serve(t, root);

  const live = await get("/api/dyn/digest");
  assert.equal(live.status, 200);
  const body = await live.json();
  assert.equal(body.stale, false);
  assert.deepEqual(body.data, observations);
  assert.deepEqual(readGenerated(root, "digest").data, observations);

  // Break the command; the panel keeps showing what it last knew.
  fs.writeFileSync(cli, "#!/bin/sh\necho boom >&2\nexit 3\n", { mode: 0o755 });
  fs.chmodSync(cli, 0o755);
  const stale = await get("/api/dyn/digest");
  assert.equal(stale.status, 200);
  const sbody = await stale.json();
  assert.equal(sbody.stale, true);
  assert.deepEqual(sbody.data, observations);
  assert.equal(sbody.cached_at, body.cached_at, "the stamp is the snapshot's, not now");

  // Non-array output is a failure too: the panel renders lines, not objects.
  fs.writeFileSync(cli, `#!/bin/sh\necho '{"not":"an array"}'\n`, { mode: 0o755 });
  fs.chmodSync(cli, 0o755);
  const bad = await get("/api/dyn/digest");
  assert.equal((await bad.json()).stale, true, "unusable output falls back to the snapshot");
  assert.deepEqual(readGenerated(root, "digest").data, observations, "snapshot survived");
});

test("a wrapped observations array is unwrapped for the panel", async (t) => {
  // The reference digest CLI emits `{"observations": [...]}`, not a bare
  // array; the route hands the panel the array either way.
  const observations = [
    { artifact_id: "fs:///tmp/fixture/a-note.md", source_id: "fs", observed_at_nanos: 1789000000000000000 },
    { artifact_id: "fs:///tmp/fixture/b-note.md", source_id: "fs", observed_at_nanos: 1789000000000000001 },
  ];
  const root = fixture(t, { "inbox/x.md": "# x\n" });
  const cli = script(
    root,
    "bin/digest-cli",
    ["#!/bin/sh", `cat <<'JSON'`, JSON.stringify({ observations }), "JSON", ""].join("\n"),
  );
  fs.writeFileSync(path.join(root, "hud.config.json"), config({ digest: { cmd: `"${cli}"` } }));
  const { get } = await serve(t, root);

  const res = await get("/api/dyn/digest");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.stale, false);
  assert.ok(Array.isArray(body.data), "the panel is handed an array, not the wrapper");
  assert.equal(body.data.length, 2);
  assert.equal(body.data[0].artifact_id, "fs:///tmp/fixture/a-note.md");
  assert.deepEqual(readGenerated(root, "digest").data, observations);
});

test("an unconfigured source is 503, not an empty panel", async (t) => {
  // `sources` is the switchboard: absent source ⇒ absent panel, even if a
  // stale snapshot happens to be lying around.
  const root = fixture(t, {
    "hud.config.json": config({}),
    ".generated/board.json": JSON.stringify({ cached_at: "2026-01-01T00:00:00.000Z", data: {} }),
  });
  const { get } = await serve(t, root);

  for (const route of ["/api/dyn/board", "/api/dyn/digest"]) {
    const res = await get(route);
    assert.equal(res.status, 503, route);
    // Names the canonical config, not the fallback this fixture happens to use.
    assert.match((await res.json()).error, /not configured in hud\.toml/);
  }

  // A missing config file behaves the same way, and never throws.
  fs.rmSync(path.join(root, "hud.config.json"));
  assert.equal((await get("/api/dyn/board")).status, 503);
  assert.equal((await get("/api/tree")).status, 200);
});

test("upstream errors and junk are failures, not passthrough", async (t) => {
  const upstream = await stubUpstream(t, (req, res) => {
    if (req.url === "/500") {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end('{"error":"upstream exploded"}');
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>login page</html>");
  });
  const root = fixture(t, { "hud.config.json": config({ board: { url: `${upstream.url}/500` } }) });
  const { get } = await serve(t, root);

  const bad = await get("/api/dyn/board");
  assert.equal(bad.status, 503);
  assert.match((await bad.json()).error, /HTTP 500/);
  assert.equal(fs.existsSync(snapshotPath(root, "board")), false, "an error body is not cached");

  fs.writeFileSync(
    path.join(root, "hud.config.json"),
    config({ board: { url: `${upstream.url}/html` } }),
  );
  const junk = await get("/api/dyn/board");
  assert.equal(junk.status, 503);
  assert.match((await junk.json()).error, /not JSON/);
});

test("peers refresh with no gh keeps the last snapshot", async (t) => {
  const existing = {
    generated_at: "2026-09-01T00:00:00.000Z",
    peers: [{ handle: "peer-a", prs: [{ number: 1, title: "feat: old", url: "https://example.invalid/1" }] }],
  };
  const root = fixture(t, {
    "peers/peer-a.md": "---\ngh: peer-a\n---\n# Peer A\n",
    ".generated/peers.json": JSON.stringify(existing, null, 2),
  });
  const before = fs.readFileSync(snapshotPath(root, "peers"), "utf8");

  // An empty PATH is "no gh on this machine".
  const result = await refreshPeers(root, { env: { ...process.env, PATH: "" }, cmdTimeoutMs: 5000 });
  assert.equal(result.ok, false);
  assert.equal(result.wrote, false, "an all-failed refresh writes nothing");
  assert.equal(fs.readFileSync(snapshotPath(root, "peers"), "utf8"), before, "bytes untouched");

  const { get, post } = await serve(t, root, { env: { ...process.env, PATH: "" } });
  const served = await get("/api/dyn/peers");
  assert.equal(served.status, 200);
  const body = await served.json();
  assert.equal(body.stale, true);
  assert.equal(body.cached_at, existing.generated_at);
  assert.deepEqual(body.data, existing);

  const refreshed = await post("/api/refresh/peers");
  assert.equal(refreshed.status, 200, "a failed refresh still serves the snapshot");
  const rbody = await refreshed.json();
  assert.equal(rbody.refreshed, false);
  assert.equal(rbody.stale, true);
  assert.deepEqual(rbody.data, existing);
});

test("no peers snapshot yields 503 and no crash", async (t) => {
  const root = fixture(t, { "inbox/x.md": "# x\n" });
  const { get, post } = await serve(t, root, { env: { ...process.env, PATH: "" } });

  const res = await get("/api/dyn/peers");
  assert.equal(res.status, 503);
  assert.equal((await res.json()).cached_at, null);

  // Zero peer files is a legitimate empty refresh, not a failure.
  const refreshed = await post("/api/refresh/peers");
  assert.equal(refreshed.status, 200);
  const body = await refreshed.json();
  assert.deepEqual(body.data.peers, []);
  assert.equal(body.stale, false);
  assert.equal((await get("/api/tree")).status, 200);
});

test("dyn routes reject the wrong method and unknown sources", async (t) => {
  const root = fixture(t, { "hud.config.json": config({}) });
  const { get, post, base } = await serve(t, root);

  assert.equal((await post("/api/dyn/board")).status, 405, "the proxy is read-only");
  assert.equal((await post("/api/tree")).status, 405);
  assert.equal((await get("/api/dyn/sessions")).status, 404, "not a route yet: a clean seam");
  assert.equal((await get("/api/refresh/peers")).status, 404, "refresh is POST-only");
  const del = await fetch(`${base}/api/refresh/peers`, { method: "DELETE" });
  assert.equal(del.status, 405);
});

test("command strings tokenize without a shell", () => {
  assert.deepEqual(tokenizeCommand("lectio digest --since 24h"), [
    "lectio",
    "digest",
    "--since",
    "24h",
  ]);
  assert.deepEqual(tokenizeCommand('  "/path/with a space/cli"  --json '), [
    "/path/with a space/cli",
    "--json",
  ]);
  assert.deepEqual(tokenizeCommand("cli --arg ''"), ["cli", "--arg", ""]);
  // No shell means these are inert argv, not two commands.
  assert.deepEqual(tokenizeCommand("cli; rm -rf /"), ["cli;", "rm", "-rf", "/"]);
  assert.deepEqual(tokenizeCommand(""), []);
});

test("implausible peer handles never reach a subprocess", (t) => {
  const root = fixture(t, {
    "peers/peer-a.md": "---\ngh: peer-a\n---\n# Peer A\n",
    "peers/injected.md": "---\ngh: \"--author=x; rm -rf /\"\n---\n# Nope\n",
    "peers/too-long.md": `---\ngh: ${"a".repeat(40)}\n---\n# Nope\n`,
    "peers/leading-dash.md": "---\ngh: -flag\n---\n# Nope\n",
  });
  assert.deepEqual(
    readPeerHandles(root).map((p) => p.handle),
    ["peer-a"],
    "only login-shaped handles survive",
  );
});
