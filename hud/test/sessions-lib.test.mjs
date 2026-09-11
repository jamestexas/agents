// Hermetic tests for the sessions panel data layer.
//
// Every case builds its own tmp ~/.claude-shaped tree; the graft cases talk
// to a node http server on an ephemeral port. Nothing here reads the real
// ~/.claude or the real lectio daemon, and no fixture carries a real person,
// company, or project name.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { lectioGraft, listSessions, projectNameFromSlug, sessionUri } from "../sessions.mjs";

/** Build a tmp tree from {relative path: contents}; dirs are created as needed. */
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-sessions-test-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** One JSONL line. */
const jl = (obj) => `${JSON.stringify(obj)}\n`;

/** A user prose turn, in the shape Claude Code writes. */
const userTurn = (text, timestamp, extra = {}) =>
  jl({ type: "user", timestamp, message: { role: "user", content: text }, ...extra });

/** Start a stub lectio daemon; `handler(body) => jsonrpc result`. */
async function stubDaemon(t, handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push({ body, headers: req.headers, url: req.url, method: req.method });
      const result = handler(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
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

const SESSION_A = "11111111-2222-3333-4444-555555555555";
const SESSION_B = "66666666-7777-8888-9999-aaaaaaaaaaaa";

// ------------------------------------------------------- required behaviors

test("slug dir without jsonl skipped", (t) => {
  const root = fixture(t, {
    [`projects/-tmp-fixture-project-a/${SESSION_A}.jsonl`]:
      userTurn("first prompt in project a", "2026-09-01T10:00:00.000Z"),
    // Only a memory/ subtree: not a project the panel knows about.
    "projects/-tmp-fixture-project-b/memory/MEMORY.md": "- a memory line\n",
    "projects/-tmp-fixture-project-b/memory/note.md": "body\n",
    // Not even that: an empty slug dir.
    "projects/-tmp-fixture-project-c/.keep": "",
  });

  const rows = listSessions(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, SESSION_A);
  assert.equal(rows[0].project, "project-a");
  assert.equal(rows[0].projectSlug, "-tmp-fixture-project-a");
  assert.deepEqual(
    rows.map((r) => r.project),
    ["project-a"],
    "project-b and project-c contribute no rows at all",
  );
});

test("title from first user message", (t) => {
  const root = fixture(t, {
    [`projects/-tmp-fixture-project-a/${SESSION_A}.jsonl`]: [
      // Head metadata records carry no timestamp and no title.
      jl({ type: "last-prompt", sessionId: SESSION_A, leafUuid: "u1" }),
      jl({ type: "mode", sessionId: SESSION_A, mode: "default" }),
      jl({ type: "assistant", timestamp: "2026-09-02T08:00:00.000Z", message: { role: "assistant", content: [] } }),
      // A wrapped local-command echo: present in real transcripts, never a title.
      jl({
        type: "user",
        isMeta: true,
        timestamp: "2026-09-02T08:00:01.000Z",
        message: {
          role: "user",
          content: "<local-command-caveat>Caveat: generated while running local commands.</local-command-caveat>",
        },
      }),
      userTurn(
        "  wire the sessions panel to the bounded walker\nand then check the cap  ",
        "2026-09-02T08:00:02.000Z",
      ),
      userTurn("a later prompt that must not win", "2026-09-02T08:30:00.000Z"),
    ].join(""),
    // Same test, block-array content plus a leading tool_result block.
    [`projects/-tmp-fixture-project-a/${SESSION_B}.jsonl`]: [
      jl({
        type: "user",
        timestamp: "2026-09-02T09:00:00.000Z",
        message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
      }),
      jl({
        type: "user",
        timestamp: "2026-09-02T09:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "audit the graft column" }] },
      }),
    ].join(""),
  });

  const rows = listSessions(root);
  const a = rows.find((r) => r.id === SESSION_A);
  const b = rows.find((r) => r.id === SESSION_B);

  assert.equal(a.title, "wire the sessions panel to the bounded walker");
  assert.equal(a.startedAt, "2026-09-02T08:00:00.000Z", "startedAt is the first timestamped line");
  assert.equal(a.lastAt, "2026-09-02T08:30:00.000Z");
  assert.equal(a.warn, undefined);
  assert.equal(b.title, "audit the graft column", "a tool_result block is not a title");
});

test("bounded read never exceeds cap", (t) => {
  const cap = 8 * 1024;
  const head = [
    jl({ type: "last-prompt", sessionId: SESSION_A, leafUuid: "u1" }),
    userTurn("find the cap bug", "2026-09-03T07:00:00.000Z"),
  ].join("");
  // Filler between head and tail: unremarkable assistant lines, padded past 5MB.
  const filler = jl({
    type: "assistant",
    timestamp: "2026-09-03T07:00:30.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "x".repeat(900) }] },
  });
  const fillerCount = Math.ceil((5 * 1024 * 1024) / filler.length) + 1;
  const tail = userTurn("the very last prompt", "2026-09-03T09:15:00.000Z");
  const transcript = head + filler.repeat(fillerCount) + tail;
  assert.ok(transcript.length > 5 * 1024 * 1024, "fixture must exceed 5MB to be a real test");

  const root = fixture(t, {
    [`projects/-tmp-fixture-project-a/${SESSION_A}.jsonl`]: transcript,
  });

  const rows = listSessions(root, { maxBytes: cap });
  assert.equal(rows.length, 1);
  const row = rows[0];

  assert.ok(row.bytesRead <= cap, `bytesRead ${row.bytesRead} must be <= cap ${cap}`);
  assert.ok(row.bytesRead > 0);
  assert.ok(
    row.bytesRead < transcript.length / 100,
    "the whole file was emphatically not read",
  );
  // ...and the row is still fully derived from head + tail alone.
  assert.equal(row.title, "find the cap bug");
  assert.equal(row.startedAt, "2026-09-03T07:00:00.000Z");
  assert.equal(row.lastAt, "2026-09-03T09:15:00.000Z", "lastAt comes from the tail chunk");
  assert.equal(row.warn, undefined);
});

test("unparseable jsonl degrades to filename row", (t) => {
  const root = fixture(t, {
    // Not JSON at all: a truncated write, or a format version we do not know.
    [`projects/-tmp-fixture-project-a/${SESSION_A}.jsonl`]:
      "\x00\x01 not json {{{ \nalso not json ]]]\n",
    // One bad line among good ones costs the line, not the row.
    [`projects/-tmp-fixture-project-a/${SESSION_B}.jsonl`]:
      `{"type":"user" TRUNCATED\n${userTurn("survived a bad neighbour", "2026-09-04T11:00:00.000Z")}`,
  });
  const mtime = new Date(
    fs.statSync(path.join(root, "projects/-tmp-fixture-project-a", `${SESSION_A}.jsonl`)).mtimeMs,
  ).toISOString();

  const rows = listSessions(root);
  const bad = rows.find((r) => r.id === SESSION_A);
  const ok = rows.find((r) => r.id === SESSION_B);

  assert.equal(bad.warn, true);
  assert.equal(bad.title, `${SESSION_A}.jsonl`, "title falls back to the filename");
  assert.equal(bad.lastAt, mtime, "lastAt falls back to mtime");
  assert.equal(bad.id, SESSION_A);
  assert.equal(bad.project, "project-a");
  assert.equal(bad.startedAt, null);

  assert.equal(ok.warn, undefined);
  assert.equal(ok.title, "survived a bad neighbour");
});

test("subagents dir not listed, badge counted", (t) => {
  const root = fixture(t, {
    [`projects/-tmp-fixture-project-a/${SESSION_A}.jsonl`]:
      userTurn("dispatch two agents", "2026-09-05T12:00:00.000Z"),
    // Subagent transcripts, plus the .meta.json sidecars that are not transcripts.
    [`projects/-tmp-fixture-project-a/${SESSION_A}/subagents/agent-aaaa1111.jsonl`]:
      userTurn("subagent one", "2026-09-05T12:01:00.000Z"),
    [`projects/-tmp-fixture-project-a/${SESSION_A}/subagents/agent-aaaa1111.meta.json`]: "{}\n",
    [`projects/-tmp-fixture-project-a/${SESSION_A}/subagents/agent-bbbb2222.jsonl`]:
      userTurn("subagent two", "2026-09-05T12:02:00.000Z"),
    [`projects/-tmp-fixture-project-a/${SESSION_A}/subagents/agent-bbbb2222.meta.json`]: "{}\n",
    // A session with no subagents at all.
    [`projects/-tmp-fixture-project-a/${SESSION_B}.jsonl`]:
      userTurn("solo session", "2026-09-05T13:00:00.000Z"),
  });

  const rows = listSessions(root);
  assert.equal(rows.length, 2, "subagent transcripts are never top-level rows");
  assert.deepEqual(rows.map((r) => r.id).sort(), [SESSION_A, SESSION_B].sort());
  assert.equal(rows.find((r) => r.id === SESSION_A).subagentCount, 2);
  assert.equal(rows.find((r) => r.id === SESSION_B).subagentCount, 0);
  assert.equal(
    rows.some((r) => r.title === "subagent one" || r.title === "subagent two"),
    false,
    "no row was built from a subagent transcript",
  );
});

test("daemon stub decorates with commit links", async (t) => {
  const root = fixture(t, {
    [`projects/-tmp-fixture-project-a/${SESSION_A}.jsonl`]:
      userTurn("land the walker", "2026-09-06T08:00:00.000Z"),
  });
  const sessions = listSessions(root);

  const daemon = await stubDaemon(t, () =>
    contentEnvelope({
      from: sessionUri(SESSION_A),
      neighbors: [
        { other: "git:///tmp/fixture/project-a/commit/abcdef1234567890", kind: "produced_commit" },
        { other: "gh://fixture-owner/fixture-repo/pr/101", kind: "references_pr" },
        { other: "linear://fixture-ws/TEAM-42", kind: "references_ticket" },
        { other: "rosary://fixture-repo/bead/fixture-13d7b3", kind: "references_bead" },
        // Not a graft column: dropped, not crashed on.
        { other: "fs:///tmp/fixture/project-a/README.md", kind: "references_file" },
        // A duplicate edge (edges table unions both directions).
        { other: "gh://fixture-owner/fixture-repo/pr/101", kind: "referenced_by" },
      ],
    }),
  );

  const decorated = await lectioGraft(sessions, daemon.url, { token: "fixture-token" });
  assert.equal(decorated.length, 1);
  const { graft, ...rest } = decorated[0];

  assert.deepEqual(rest, sessions[0], "graft is additive; the raw row is untouched");
  assert.deepEqual(graft.commits, [
    {
      uri: "git:///tmp/fixture/project-a/commit/abcdef1234567890",
      label: "abcdef12",
      url: null,
      kind: "produced_commit",
    },
  ]);
  assert.deepEqual(graft.prs, [
    {
      uri: "gh://fixture-owner/fixture-repo/pr/101",
      label: "fixture-owner/fixture-repo#101",
      url: "https://github.com/fixture-owner/fixture-repo/pull/101",
      kind: "references_pr",
    },
  ]);
  assert.deepEqual(
    graft.tickets.map((t2) => t2.label),
    ["TEAM-42", "fixture-13d7b3"],
    "linear issues and rosary beads both land in tickets, ordered by uri",
  );

  // The wire shape the daemon actually requires.
  assert.equal(daemon.seen.length, 1);
  const call = daemon.seen[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "/mcp");
  assert.equal(call.headers["x-lectio-token"], "fixture-token");
  assert.deepEqual(call.body, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "memory_traverse", arguments: { uri: `claude://session/${SESSION_A}` } },
  });
});

test("daemon down returns undecorated", async (t) => {
  const root = fixture(t, {
    [`projects/-tmp-fixture-project-a/${SESSION_A}.jsonl`]:
      userTurn("no daemon today", "2026-09-07T08:00:00.000Z"),
    [`projects/-tmp-fixture-project-b-two/${SESSION_B}.jsonl`]:
      userTurn("still no daemon", "2026-09-07T09:00:00.000Z"),
  });
  const sessions = listSessions(root);
  assert.equal(sessions.length, 2);

  const port = await deadPort();
  const decorated = await lectioGraft(sessions, `http://127.0.0.1:${port}`, {
    token: "fixture-token",
    timeoutMs: 500,
  });

  assert.equal(decorated.length, 2);
  for (const [i, row] of decorated.entries()) {
    assert.equal(row.graft, "unavailable");
    const { graft, ...rest } = row;
    assert.deepEqual(rest, sessions[i], "the raw tier survives the graft tier being down");
  }
});

// ------------------------------------------------------- supporting behaviors

test("daemon error response yields unavailable, not a throw", async (t) => {
  const sessions = [{ id: SESSION_A, project: "project-a", title: "t", lastAt: "2026-09-08T00:00:00.000Z" }];

  const isError = await stubDaemon(t, () => ({
    content: [{ type: "text", text: "no such artifact" }],
    isError: true,
  }));
  assert.equal((await lectioGraft(sessions, isError.url, {}))[0].graft, "unavailable");

  const garbage = await stubDaemon(t, () => contentEnvelope("not-an-object"));
  assert.equal((await lectioGraft(sessions, garbage.url, {}))[0].graft, "unavailable");

  const noNeighbors = await stubDaemon(t, () => contentEnvelope({ from: "x" }));
  assert.deepEqual((await lectioGraft(sessions, noNeighbors.url, {}))[0].graft, {
    commits: [],
    prs: [],
    tickets: [],
  });
});

test("project display name derives from the flattened slug", () => {
  // Home root + username + forge dir are dropped; the repo segment remains.
  assert.equal(projectNameFromSlug("-Users-someone-github-fixture-owner-alpha"), "alpha");
  assert.equal(projectNameFromSlug("-home-someone-code-beta"), "beta");
  assert.equal(projectNameFromSlug("-Users-someone-hud"), "hud");
  // A trailing stub keeps its predecessor, so the label still says something.
  assert.equal(projectNameFromSlug("-tmp-fixture-project-a"), "project-a");
  assert.equal(projectNameFromSlug("-Users-someone-fixture-stack-tf"), "stack-tf");
  // The flattening is lossy and this heuristic does not pretend otherwise: a
  // repo literally named "fixture-repo" is indistinguishable from a "repo"
  // dir nested under "fixture". projectSlug carries the unambiguous original.
  assert.equal(projectNameFromSlug("-Users-someone-github-owner-fixture-repo"), "repo");
});

test("rows sort most-recently-active first", (t) => {
  const root = fixture(t, {
    [`projects/-tmp-fixture-project-a/${SESSION_A}.jsonl`]:
      userTurn("older", "2026-09-01T00:00:00.000Z"),
    [`projects/-tmp-fixture-project-b-two/${SESSION_B}.jsonl`]:
      userTurn("newer", "2026-09-09T00:00:00.000Z"),
  });

  assert.deepEqual(
    listSessions(root).map((r) => r.title),
    ["newer", "older"],
  );
});

test("missing root is empty, not a throw", () => {
  assert.deepEqual(listSessions(path.join(os.tmpdir(), "hud-sessions-does-not-exist-4f2a")), []);
  assert.deepEqual(listSessions(""), []);
});
