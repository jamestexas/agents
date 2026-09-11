// Hermetic tests for the sessions panel wire-in (`GET /api/sessions`).
//
// Nothing here reads the real `~/.claude` or the real lectio daemon: every
// case builds a tmp HUD_ROOT whose `hud.config.json` points `sources.sessions`
// at a tmp `~/.claude`-shaped tree, and the graft cases talk to a stub daemon
// on an ephemeral port. The daemon token is stubbed through the environment so
// the real one is never read, let alone sent anywhere. No fixture carries a
// real person, company, or project name.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createServer } from "../server.mjs";

// ------------------------------------------------------------------ helpers

/** Build a tmp tree from {relative path: contents}; dirs are created as needed. */
function fixture(t, prefix, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeConfig(root, sources) {
  fs.writeFileSync(path.join(root, "hud.config.json"), JSON.stringify({ sources }, null, 2));
}

/** Start the HUD server on an ephemeral port. */
async function serve(t, root) {
  const server = createServer({
    root,
    uiDir: path.join(import.meta.dirname, "..", "ui"),
    httpTimeoutMs: 1500,
    cmdTimeoutMs: 5000,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    get: (p) => fetch(base + p, { cache: "no-store" }),
    verb: (method, p) => fetch(base + p, { method, cache: "no-store" }),
  };
}

/** Start a stub lectio daemon; `handler(body) => jsonrpc result`. */
async function stubDaemon(t, handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push({ body, url: req.url, token: req.headers["x-lectio-token"] });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body) }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

/** Wrap a tool payload the way the daemon's `tools/call` arm does. */
const contentEnvelope = (payload) => ({ content: [{ type: "text", text: JSON.stringify(payload) }] });

/** A port nobody is listening on. */
async function deadPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** One JSONL line. */
const jl = (obj) => `${JSON.stringify(obj)}\n`;

/** A user prose turn, in the shape Claude Code writes. */
const userTurn = (text, timestamp) =>
  jl({ type: "user", timestamp, message: { role: "user", content: text } });

const ALPHA = "-tmp-fixture-alpha";
const BETA = "-tmp-fixture-beta";
const S_A = "aaaaaaaa-0000-0000-0000-000000000001";
const S_B = "bbbbbbbb-0000-0000-0000-000000000002";
const S_C = "cccccccc-0000-0000-0000-000000000003";
const S_D = "dddddddd-0000-0000-0000-000000000004";

/**
 * Two projects, four sessions: two ordinary ones under alpha, and under beta
 * one with subagents plus one whose bytes are not JSON at all (the degraded
 * row). The degraded row's only clock is its mtime — written now, so it sorts
 * ahead of every dated fixture.
 */
function sessionsFixture(t) {
  return fixture(t, "hud-sessions-wire-", {
    [`projects/${ALPHA}/${S_A}.jsonl`]: userTurn("older alpha prompt", "2026-09-08T12:00:00.000Z"),
    [`projects/${ALPHA}/${S_B}.jsonl`]: userTurn("newer alpha prompt", "2026-09-09T09:00:00.000Z"),
    [`projects/${BETA}/${S_C}.jsonl`]: userTurn("beta prompt with helpers", "2026-09-10T08:00:00.000Z"),
    [`projects/${BETA}/${S_C}/subagents/agent-one.jsonl`]: userTurn("sub one", "2026-09-10T08:01:00.000Z"),
    [`projects/${BETA}/${S_C}/subagents/agent-two.jsonl`]: userTurn("sub two", "2026-09-10T08:02:00.000Z"),
    // Not a transcript, so not part of the count.
    [`projects/${BETA}/${S_C}/subagents/agent-one.meta.json`]: "{}\n",
    [`projects/${BETA}/${S_D}.jsonl`]: "not json at all\nnor this line\n",
    // A slug dir with no transcript is not a project the panel knows about.
    [`projects/-tmp-fixture-gamma/memory/MEMORY.md`]: "- a memory line\n",
  });
}

/** Every session row across every group, in panel order. */
const flatten = (body) => body.groups.flatMap((g) => g.sessions);

/** Sorted `relpath\0size` census, to prove a request changed nothing on disk. */
function census(root) {
  const out = [];
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(child);
      else out.push(`${child}\0${fs.statSync(path.join(root, child)).size}`);
    }
  };
  walk("");
  return out.sort();
}

// ------------------------------------------------------- required behaviors

test("api sessions serves grouped sessions", async (t) => {
  // Stubbed so the real daemon token is never read or transmitted.
  const priorToken = process.env.LECTIO_DAEMON_TOKEN;
  process.env.LECTIO_DAEMON_TOKEN = "fixture-token";
  t.after(() => {
    if (priorToken === undefined) delete process.env.LECTIO_DAEMON_TOKEN;
    else process.env.LECTIO_DAEMON_TOKEN = priorToken;
  });

  const sessionsRoot = sessionsFixture(t);
  const daemon = await stubDaemon(t, (body) => {
    const uri = body.params?.arguments?.uri;
    if (uri !== `claude://session/${S_C}`) return contentEnvelope({ neighbors: [] });
    return contentEnvelope({
      neighbors: [
        { other: "gh://fixture-org/fixture-repo/pr/7", kind: "touches" },
        { other: "git://fixture-repo/commit/abcdef1234567890", kind: "produced" },
        // Neither a commit, a PR, nor a ticket: not a graft column.
        { other: "fs:///tmp/fixture/file.md", kind: "mentions" },
      ],
    });
  });

  const hudRoot = fixture(t, "hud-sessions-wire-root-", {});
  writeConfig(hudRoot, { sessions: { root: sessionsRoot, lectio: daemon.url } });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/sessions");
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.source, "sessions");
  assert.equal(body.stale, false);
  assert.equal(body.root, sessionsRoot);
  assert.equal(body.window_days, 30);
  assert.equal(body.truncated, false);
  assert.equal(body.count, 4);

  // Grouped by project, groups newest-first, sessions newest-first inside.
  assert.deepEqual(
    body.groups.map((g) => g.project),
    ["beta", "alpha"],
  );
  assert.deepEqual(
    body.groups.map((g) => g.projectSlug),
    [BETA, ALPHA],
  );
  assert.deepEqual(
    body.groups.map((g) => g.sessions.map((s) => s.id)),
    [
      [S_D, S_C],
      [S_B, S_A],
    ],
  );

  // Tier 1 per row: title, times, subagent count, warn marker.
  const rows = new Map(flatten(body).map((s) => [s.id, s]));
  assert.equal(rows.get(S_B).title, "newer alpha prompt");
  assert.equal(rows.get(S_B).startedAt, "2026-09-09T09:00:00.000Z");
  assert.equal(rows.get(S_B).lastAt, "2026-09-09T09:00:00.000Z");
  assert.equal(rows.get(S_B).subagentCount, 0);
  assert.equal(rows.get(S_B).warn, undefined);
  assert.equal(rows.get(S_C).subagentCount, 2); // the .meta.json sibling is not one
  assert.equal(rows.get(S_D).warn, true);
  assert.equal(rows.get(S_D).title, `${S_D}.jsonl`);
  assert.equal(rows.get(S_D).startedAt, null);

  // Tier 2: the daemon answered, so the panel is live and the row that had
  // edges carries them as links out.
  assert.equal(body.graft, "live");
  assert.deepEqual(rows.get(S_C).graft.prs, [
    {
      uri: "gh://fixture-org/fixture-repo/pr/7",
      label: "fixture-org/fixture-repo#7",
      url: "https://github.com/fixture-org/fixture-repo/pull/7",
      kind: "touches",
    },
  ]);
  assert.equal(rows.get(S_C).graft.commits.length, 1);
  assert.equal(rows.get(S_C).graft.commits[0].label, "abcdef12");
  assert.deepEqual(rows.get(S_C).graft.tickets, []);
  assert.deepEqual(rows.get(S_B).graft, { commits: [], prs: [], tickets: [] });

  // One MCP call per row, to the daemon's /mcp endpoint, carrying the token.
  assert.equal(daemon.seen.length, 4);
  assert.deepEqual([...new Set(daemon.seen.map((s) => s.url))], ["/mcp"]);
  assert.deepEqual([...new Set(daemon.seen.map((s) => s.token))], ["fixture-token"]);
  assert.deepEqual([...new Set(daemon.seen.map((s) => s.body.params.name))], ["memory_traverse"]);

  // ?project= narrows by display label or by slug; both are the same project.
  const byLabel = await (await hud.get("/api/sessions?project=alpha")).json();
  assert.deepEqual(
    byLabel.groups.map((g) => g.project),
    ["alpha"],
  );
  assert.deepEqual(flatten(byLabel).map((s) => s.id), [S_B, S_A]);
  assert.equal(byLabel.count, 2);

  const bySlug = await (await hud.get(`/api/sessions?project=${BETA}`)).json();
  assert.deepEqual(flatten(bySlug).map((s) => s.id), [S_D, S_C]);

  const unknown = await hud.get("/api/sessions?project=nope");
  assert.equal(unknown.status, 200);
  const unknownBody = await unknown.json();
  assert.deepEqual(unknownBody.groups, []);
  assert.equal(unknownBody.count, 0);
});

test("sessions source absent yields 404 panel off", async (t) => {
  const sessionsRoot = sessionsFixture(t);
  const hudRoot = fixture(t, "hud-sessions-wire-root-", {});
  // A config with other sources but no `sessions`: the switchboard says the
  // panel does not exist, even though a readable tree is sitting right there.
  writeConfig(hudRoot, { board: { url: "http://127.0.0.1:1/api/board" } });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/sessions");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  const body = await res.json();
  assert.equal(body.source, "sessions");
  // Names the canonical config, not the fallback this fixture happens to use.
  assert.match(body.error, /not configured in hud\.toml/);
  // Panel off means no data at all, not an empty rendering.
  assert.equal(body.groups, undefined);
  assert.equal(body.count, undefined);
  assert.ok(!JSON.stringify(body).includes(sessionsRoot));

  // A config file that is missing entirely is the same answer.
  fs.rmSync(path.join(hudRoot, "hud.config.json"));
  assert.equal((await hud.get("/api/sessions")).status, 404);
});

test("sessions routes reject non-get", async (t) => {
  const sessionsRoot = sessionsFixture(t);
  const before = census(sessionsRoot);
  const hudRoot = fixture(t, "hud-sessions-wire-root-", {});
  writeConfig(hudRoot, { sessions: { root: sessionsRoot } });
  const hud = await serve(t, hudRoot);

  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await hud.verb(method, "/api/sessions");
    assert.equal(res.status, 405, `${method} /api/sessions`);
  }
  // There is no mutating sessions route to reach under any name.
  for (const p of ["/api/sessions/refresh", "/api/refresh/sessions"]) {
    assert.equal((await hud.verb("POST", p)).status, 405, `POST ${p}`);
    assert.equal((await hud.verb("GET", p)).status, 404, `GET ${p}`);
  }

  // GET still works, and nothing under the sessions root moved.
  assert.equal((await hud.get("/api/sessions")).status, 200);
  assert.deepEqual(census(sessionsRoot), before);
});

test("daemon down still 200 with graft unavailable", async (t) => {
  const sessionsRoot = sessionsFixture(t);
  const hudRoot = fixture(t, "hud-sessions-wire-root-", {});
  writeConfig(hudRoot, {
    sessions: { root: sessionsRoot, lectio: `http://127.0.0.1:${await deadPort()}` },
  });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/sessions");
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.graft, "unavailable");
  const rows = flatten(body);
  assert.equal(rows.length, 4);
  assert.deepEqual([...new Set(rows.map((s) => s.graft))], ["unavailable"]);

  // Tier 1 is unaffected by tier 2 being gone: same grouping, same titles.
  assert.deepEqual(
    body.groups.map((g) => g.project),
    ["beta", "alpha"],
  );
  assert.equal(rows.find((s) => s.id === S_A).title, "older alpha prompt");
  assert.equal(rows.find((s) => s.id === S_C).subagentCount, 2);
});
