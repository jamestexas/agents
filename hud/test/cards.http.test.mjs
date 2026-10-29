// The `http` kind, the `work-board` normaliser, and the board card they make:
// one loopback GET, a snapshot under `.generated/cards/<name>.json`, `stale`
// when served from it, 503 with the reason when there is nothing to serve.
// The reviews join rides the live path only; the snapshot is the upstream's
// own bytes and never carries a joined field.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { LIMITS, read, rowsOf, snapshotFile, legacySnapshotFile } from "../cards/kinds/http.mjs";
import * as workBoard from "../cards/normalize/work-board.mjs";
import { REVIEW_STATE_SERVED, finished, fixture, reviewsFixture, serve, writeConfig } from "./review-fixtures.mjs";

// ------------------------------------------------------------------ helpers

/** A stub upstream answering every path through `handler`; records the paths hit. */
async function upstream(t, handler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { hits, url: `http://127.0.0.1:${server.address().port}/api/board` };
}

const json = (body) => (req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** A URL nothing is listening on: bind an ephemeral port, then release it. */
async function deadUrl() {
  const probe = http.createServer(() => {});
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return `http://127.0.0.1:${port}/api/board`;
}

const card = (root, url, extra = {}) => ({
  name: "board",
  kind: "http",
  url,
  shape: "work-board",
  key: "pr_url",
  title: "My PRs",
  columns: [...workBoard.COLUMNS],
  ...extra,
});

const ctx = (root, ms = 1500) => ({ hudRoot: root, httpTimeoutMs: ms });

/** A board as the upstream sends it: three PRs, one issue, and a self-report. */
const board = {
  generated_at: "2026-10-27T11:00:00.000Z",
  tick_status: "ok",
  degradations: [{ source: "linear", error: "graphql 401", extra: "dropped" }, "junk"],
  items: [
    { kind: "pr", repo: "owner/repo", number: 7, title: "feat(example): finished and posted", state: "active", reason: "approved", url: "https://github.com/owner/repo/pull/7", extra: "dropped" },
    { number: 101, title: "fix(example): still running", state: "needs_you", reason: "changes requested", url: "https://github.com/owner/repo/pull/101/files?diff=unified" },
    { kind: "pr", repo: "owner/repo", number: 55, title: "chore(example): never reviewed", state: "opened", reason: "", url: "https://github.com/owner/repo/pull/55" },
    { kind: "issue", repo: "owner/repo", number: 7, title: "bug report", state: "active", reason: "", url: "https://github.com/owner/repo/issues/7" },
    "not a row",
  ],
};

// ------------------------------------------------------------ the http kind

test("http.read: one GET, rows from the array the payload carries, snapshot written under .generated/cards", async (t) => {
  const root = fixture(t, "hud-cards-http-", {});
  const up = await upstream(t, json(board));
  const got = await read(card(root, up.url), ctx(root));

  assert.deepEqual(up.hits, ["/api/board"], "the configured path is what got fetched");
  assert.equal(got.stale, false);
  assert.equal(got.error, undefined);
  assert.match(got.cached_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(got.payload, board, "the payload is kept whole for the shape to read its self-report");
  assert.deepEqual(got.rows, board.items, "rows are the array, raw: the whitelist is the normaliser's job");

  const snap = JSON.parse(fs.readFileSync(snapshotFile(root, "board"), "utf8"));
  assert.deepEqual(Object.keys(snap).sort(), ["cached_at", "data"]);
  assert.equal(snap.cached_at, got.cached_at);
  assert.deepEqual(snap.data, board, "the snapshot is the upstream's own bytes");
  assert.equal(snapshotFile(root, "board"), path.join(root, ".generated", "cards", "board.json"));
  assert.equal(legacySnapshotFile(root, "board"), path.join(root, ".generated", "board.json"));
  assert.equal(fs.existsSync(legacySnapshotFile(root, "board")), false, "the legacy path is read, never written");
});

test("http.rowsOf: items, prs, a bare array; anything else is no rows", () => {
  assert.deepEqual(rowsOf({ items: [1] }), [1]);
  assert.deepEqual(rowsOf({ prs: [2] }), [2]);
  assert.deepEqual(rowsOf({ items: [1], prs: [2] }), [1], "items first");
  assert.deepEqual(rowsOf([3]), [3]);
  assert.deepEqual(rowsOf({ rows: [4] }), []);
  assert.deepEqual(rowsOf("junk"), []);
  assert.deepEqual(rowsOf(null), []);
});

test("http.read: a failure with no snapshot is an error, and writes nothing", async (t) => {
  const root = fixture(t, "hud-cards-http-down-", {});
  const got = await read(card(root, await deadUrl()), ctx(root));
  assert.equal(got.stale, true);
  assert.equal(got.cached_at, null);
  assert.equal(got.rows, undefined);
  assert.ok(typeof got.error === "string" && got.error.length > 0);
  assert.equal(fs.existsSync(path.join(root, ".generated")), false);

  // Timeout, non-2xx, not JSON, too large: each is the reason, none is cached.
  const slow = await upstream(t, () => {});
  const timed = await read(card(root, slow.url), ctx(root, 150));
  assert.match(timed.error, /timeout|timed out|aborted/i);

  const bad = await upstream(t, (req, res) => {
    if (req.url.endsWith("/500")) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end('{"error":"upstream exploded"}');
    }
    if (req.url.endsWith("/big")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ items: [], pad: "x".repeat(LIMITS.maxBytes) }));
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>login page</html>");
  });
  assert.match((await read(card(root, `${bad.url}/500`), ctx(root))).error, /HTTP 500/);
  assert.match((await read(card(root, `${bad.url}/big`), ctx(root))).error, /too large/);
  assert.match((await read(card(root, `${bad.url}/html`), ctx(root))).error, /not JSON/);
  assert.equal(fs.existsSync(path.join(root, ".generated")), false, "an error body is never cached");
});

test("http.read: a failure with a snapshot serves it stale, from the cards path or the legacy one", async (t) => {
  const cachedAt = "2026-10-27T09:00:00.000Z";
  const cached = { items: [board.items[0]] };
  const root = fixture(t, "hud-cards-http-stale-", {
    ".generated/cards/board.json": JSON.stringify({ cached_at: cachedAt, data: cached }),
  });
  const got = await read(card(root, await deadUrl()), ctx(root));
  assert.equal(got.stale, true);
  assert.equal(got.cached_at, cachedAt, "the snapshot's own age");
  assert.deepEqual(got.payload, cached);
  assert.deepEqual(got.rows, cached.items);
  assert.ok(got.error, "why it is stale travels with the rows");
  // A failed fetch must not clobber the only copy of the data.
  assert.deepEqual(JSON.parse(fs.readFileSync(snapshotFile(root, "board"), "utf8")), { cached_at: cachedAt, data: cached });

  // A tree from before cards: its board snapshot sits at .generated/board.json
  // and is read until a live answer writes the new path.
  const old = fixture(t, "hud-cards-http-legacy-", {
    ".generated/board.json": JSON.stringify({ cached_at: cachedAt, data: cached }),
  });
  const viaLegacy = await read(card(old, await deadUrl()), ctx(old));
  assert.equal(viaLegacy.stale, true);
  assert.deepEqual(viaLegacy.rows, cached.items);

  // A corrupt snapshot is no snapshot.
  const corrupt = fixture(t, "hud-cards-http-corrupt-", { ".generated/cards/board.json": "{not json" });
  assert.equal((await read(card(corrupt, await deadUrl()), ctx(corrupt))).rows, undefined);
});

// ----------------------------------------------------------- the normaliser

test("work-board.normalize keeps the fields the board reads, derives pr_url, rejects a non-row", () => {
  const seven = workBoard.normalize(board.items[0], {});
  assert.deepEqual(seven, {
    kind: "pr",
    repo: "owner/repo",
    number: 7,
    title: "feat(example): finished and posted",
    state: "active",
    reason: "approved",
    url: "https://github.com/owner/repo/pull/7",
    pr_url: "https://github.com/owner/repo/pull/7",
  });
  const running = workBoard.normalize(board.items[1], {});
  assert.equal(running.pr_url, "https://github.com/owner/repo/pull/101", "keyed from the url alone");
  assert.equal(running.kind, undefined, "a key the row does not carry is not invented");
  assert.equal(workBoard.normalize(board.items[3], {}).pr_url, null, "an issue has no PR key");
  assert.equal(workBoard.normalize("not a row", {}), null, "rejected");
  assert.equal(workBoard.normalize(null, {}), null);
  assert.equal(workBoard.normalize({ number: "x", title: 3 }, {}).number, undefined, "wrong types are dropped, not passed");
  assert.deepEqual([...workBoard.COLUMNS], ["pr", "title", "why", "verdict", "gates", "note", "posted", "threads"]);
});

test("work-board.meta whitelists the payload's self-report", () => {
  assert.deepEqual(workBoard.meta(board), {
    tick_status: "ok",
    degradations: [{ source: "linear", error: "graphql 401" }],
  });
  assert.deepEqual(workBoard.meta({ tickStatus: "example", degradations: [{ name: "github", reason: "401" }] }), {
    tick_status: "example",
    degradations: [{ source: "github", error: "401" }],
  }, "both spellings the board has used");
  assert.equal(workBoard.meta({ items: [] }), null, "no self-report, no block");
  assert.equal(workBoard.meta([1, 2]), null);
});

// ---------------------------------------------------------------- the card

test("GET /api/card/board: normalised rows with the latest review run joined on the live path", async (t) => {
  const hudRoot = reviewsFixture(t);
  const up = await upstream(t, json(board));
  writeConfig(hudRoot, { board: { url: up.url }, reviews: {} });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/card/board");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), [
    "card", "source", "title", "stale", "generated_at", "refresh", "columns", "joins", "health", "count", "truncated", "rejected", "items",
  ]);
  assert.equal(body.card, "board");
  assert.equal(body.source, "http");
  assert.equal(body.title, "My PRs");
  assert.equal(body.stale, false);
  assert.deepEqual(body.columns, [...workBoard.COLUMNS]);
  assert.deepEqual(body.joins, { reviews: "ok" });
  assert.deepEqual(body.health, { tick_status: "ok", degradations: [{ source: "linear", error: "graphql 401" }] });
  assert.equal(body.count, 4);
  assert.equal(body.rejected, 1, "the string in the array");
  assert.equal(body.truncated, false);

  const [posted, running, unseen, issue] = body.items;
  assert.equal(posted.pr_url, "https://github.com/owner/repo/pull/7");
  assert.deepEqual(posted.reviews, {
    phase: "posted",
    verdict: "APPROVE",
    gates: finished.gates,
    probes: { unavailable: 0 },
    findings: finished.findings,
    note_url: "/n/projects/example-two/notes/PR-7-finished",
    posted: finished.posted,
    review_state: REVIEW_STATE_SERVED,
    running: false,
    elapsed_s: 31 * 60 + 30,
  });
  assert.equal(running.reviews.running, true);
  assert.equal(running.reviews.verdict, null);
  assert.equal("reviews" in unseen, false, "no run: no key");
  assert.equal("reviews" in issue, false, "an issue is never joined");
  assert.ok(!JSON.stringify(body).includes('"extra"'), "nothing unlisted reaches the page");

  // The snapshot is the upstream's bytes: no join, no derived key.
  const snap = JSON.parse(fs.readFileSync(snapshotFile(hudRoot, "board"), "utf8"));
  assert.deepEqual(snap.data, board);
  assert.ok(!JSON.stringify(snap).includes("pr_url"));
  assert.ok(!JSON.stringify(snap).includes("note_url"));
});

test("GET /api/card/board: stale from the snapshot with the join marked unavailable; 503 with no snapshot", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { board: { url: await deadUrl() }, reviews: {} });
  const hud = await serve(t, hudRoot);

  const down = await hud.get("/api/card/board");
  assert.equal(down.status, 503);
  const downBody = await down.json();
  assert.equal(downBody.card, "board");
  assert.ok(downBody.error);
  assert.equal(downBody.items, undefined);

  const cachedAt = "2026-10-27T09:00:00.000Z";
  fs.mkdirSync(path.join(hudRoot, ".generated", "cards"), { recursive: true });
  fs.writeFileSync(snapshotFile(hudRoot, "board"), JSON.stringify({ cached_at: cachedAt, data: { items: [board.items[0]] } }));
  const stale = await hud.get("/api/card/board");
  assert.equal(stale.status, 200);
  const staleBody = await stale.json();
  assert.equal(staleBody.stale, true);
  assert.equal(staleBody.generated_at, cachedAt, "generated_at is when the rows were produced, the snapshot's age");
  assert.equal(staleBody.count, 1);
  assert.equal(staleBody.items[0].pr_url, "https://github.com/owner/repo/pull/7", "normalised even from a snapshot");
  assert.equal("reviews" in staleBody.items[0], false, "joins ride the live path only");
  assert.match(staleBody.joins.reviews, /^unavailable: /);
  assert.equal(staleBody.health, null);
});

test("GET /api/card/board: a reviews fault leaves the board live with the join marked, never a fault of its own", async (t) => {
  const hudRoot = reviewsFixture(t);
  const up = await upstream(t, json(board));
  // A reviews glob the walker refuses: that card is 503, the board is 200 unjoined.
  writeConfig(hudRoot, { board: { url: up.url }, reviews: { glob: "../x/*.json" } });
  const hud = await serve(t, hudRoot);
  assert.equal((await hud.get("/api/card/reviews")).status, 503);
  const body = await (await hud.get("/api/card/board")).json();
  assert.equal(body.stale, false);
  assert.equal(body.count, 4);
  assert.ok(body.items.every((i) => !("reviews" in i)));
  assert.match(body.joins.reviews, /^unavailable: /);

  // No reviews source at all: no join declared, so no entry.
  writeConfig(hudRoot, { board: { url: up.url } });
  const alone = await (await hud.get("/api/card/board")).json();
  assert.deepEqual(alone.joins, {});
});

test("the board card writes only its snapshot, and only on a live answer", async (t) => {
  const hudRoot = reviewsFixture(t);
  const up = await upstream(t, json(board));
  writeConfig(hudRoot, { board: { url: up.url }, reviews: {} });
  const hud = await serve(t, hudRoot);
  for (const method of ["POST", "PUT", "DELETE"]) {
    assert.equal((await hud.verb(method, "/api/card/board")).status, 405, method);
  }
  await hud.get("/api/card/board");
  const generated = fs.readdirSync(path.join(hudRoot, ".generated"), { recursive: true }).map(String).sort();
  assert.deepEqual(generated, ["cards", path.join("cards", "board.json")]);
});

test("GET /api/cards lists the cards and the layout", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { board: { url: "http://127.0.0.1:1/board" }, reviews: {} });
  const hud = await serve(t, hudRoot);
  const res = await hud.get("/api/cards");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    cards: ["reviews", "board"],
    layout: { order: ["reviews", "board", "digest", "sessions", "loadout", "peers"] },
  });
  assert.equal((await hud.verb("POST", "/api/cards")).status, 405);

  fs.writeFileSync(
    path.join(hudRoot, "hud.toml"),
    '[cards.runs]\nkind = "fs"\nglob = "a/*/x.json"\nshape = "review-state"\n\n[cards.odd]\nkind = "pigeon"\n\n[layout]\norder = ["odd", "runs"]\n',
  );
  assert.deepEqual(await (await hud.get("/api/cards")).json(), {
    cards: ["runs", "odd"],
    layout: { order: ["odd", "runs"] },
  }, "a misconfigured card is still listed: the page must render it red, not lose it");

  fs.rmSync(path.join(hudRoot, "hud.toml"));
  fs.rmSync(path.join(hudRoot, "hud.config.json"));
  assert.deepEqual(await (await hud.get("/api/cards")).json(), {
    cards: [],
    layout: { order: ["reviews", "board", "digest", "sessions", "loadout", "peers"] },
  });
});
