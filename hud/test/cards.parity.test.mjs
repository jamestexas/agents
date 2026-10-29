// Parity: for one release the old route and its card route answer the same
// rows for the same tree. `/api/reviews` is an alias for the reviews card —
// one envelope around the same `items` — and this is the test that lets the
// old body go when the release is over.
//
// The server is given a fixed clock so that `elapsed_s` and `phase_seconds`
// on the run still in flight are the same number on both requests; without
// it two requests a few milliseconds apart could straddle a second boundary
// and fail on a difference that is not a difference between the routes.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createServer } from "../server.mjs";
import { RUNNING_FOR_S, RUNNING_STARTED, UI_DIR, finished, reviewsFixture, writeConfig } from "./review-fixtures.mjs";

async function serveFrozen(t, root) {
  const now = Date.parse(RUNNING_STARTED) + RUNNING_FOR_S * 1000;
  const server = createServer({ root, uiDir: UI_DIR, now: () => now });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (p) => {
    const res = await fetch(base + p, { cache: "no-store" });
    return { status: res.status, body: await res.json() };
  };
}

/** A tree with every row kind: running, finished and posted, finished and unposted, unreadable. */
function parityFixture(t) {
  const root = reviewsFixture(t);
  fs.mkdirSync(path.join(root, "projects/example-two/raw/PR-8"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "projects/example-two/raw/PR-8/state.json"),
    JSON.stringify({ ...finished, pr: 8, posted: null, started: "2026-10-27T12:00:00.000Z", ended: "2026-10-27T12:05:00.000Z" }),
  );
  return root;
}

test("/api/reviews and /api/card/reviews return the same items and count for the same tree", async (t) => {
  const hudRoot = parityFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const get = await serveFrozen(t, hudRoot);

  for (const scope of ["all", "open"]) {
    const old = await get(`/api/reviews?scope=${scope}`);
    const card = await get(`/api/card/reviews?scope=${scope}`);
    assert.equal(old.status, 200, scope);
    assert.equal(card.status, 200, scope);
    assert.deepEqual(card.body.items, old.body.items, `items differ under scope=${scope}`);
    assert.equal(card.body.count, old.body.count, scope);
    assert.equal(card.body.truncated, old.body.truncated, scope);
    assert.equal(card.body.root, old.body.root, scope);
    assert.ok(old.body.count >= 3, "the fixture has rows under both scopes");
  }
  assert.equal((await get("/api/reviews?scope=all")).body.count, 4);
  assert.equal((await get("/api/reviews?scope=open")).body.count, 3);

  // The two envelopes name themselves differently and that is the whole of
  // the difference: the old one says `source: "reviews"` and carries `glob`
  // and `scope`; the card one says which card and which kind.
  const old = (await get("/api/reviews")).body;
  const card = (await get("/api/card/reviews?scope=all")).body;
  assert.equal(old.source, "reviews");
  assert.equal(old.scope, "all", "no query on the old route is still every run");
  assert.equal(card.card, "reviews");
  assert.equal(card.source, "fs");
  assert.deepEqual(card.items, old.items);
});

test("the alias and the card route degrade the same way", async (t) => {
  const hudRoot = parityFixture(t);
  const get = await serveFrozen(t, hudRoot);

  // Not configured: 404 on both.
  writeConfig(hudRoot, { board: { url: "http://127.0.0.1:1/board" } });
  assert.equal((await get("/api/reviews")).status, 404);
  assert.equal((await get("/api/card/reviews")).status, 404);

  // A glob the walker refuses: 503 on both, the same reason in both bodies.
  writeConfig(hudRoot, { reviews: { glob: "../x/*.json" } });
  const old = await get("/api/reviews");
  const card = await get("/api/card/reviews");
  assert.equal(old.status, 503);
  assert.equal(card.status, 503);
  assert.match(old.body.error, /reviews\.glob in hud\.toml/);
  assert.equal(card.body.error, `misconfigured: ${old.body.error}`);

  // A scope outside the vocabulary: 400 on both.
  writeConfig(hudRoot, { reviews: {} });
  assert.equal((await get("/api/reviews?scope=posted")).status, 400);
  assert.equal((await get("/api/card/reviews?scope=posted")).status, 400);
});

test("the [cards.reviews] form serves the alias too", async (t) => {
  // A tree that has moved to cards keeps its bookmarks: the alias reads the
  // registry, not the legacy table, so it answers from either form.
  const hudRoot = parityFixture(t);
  fs.writeFileSync(
    path.join(hudRoot, "hud.toml"),
    '[cards.reviews]\nkind = "fs"\nglob = "projects/*/raw/PR-*/state.json"\nshape = "review-state"\nscope = "open"\n',
  );
  const get = await serveFrozen(t, hudRoot);
  const old = await get("/api/reviews?scope=all");
  const card = await get("/api/card/reviews?scope=all");
  assert.equal(old.status, 200);
  assert.deepEqual(card.body.items, old.body.items);
  assert.equal(old.body.glob, "projects/*/raw/PR-*/state.json");
});

// --------------------------------------------------------------- the board

/** A stub board upstream answering every path with `body` as JSON. */
async function boardUpstream(t, body) {
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/board`;
}

const board = {
  generated_at: "2026-10-27T11:00:00.000Z",
  items: [
    { kind: "pr", repo: "owner/repo", number: 7, title: "feat(example): finished and posted", state: "active", reason: "approved", url: "https://github.com/owner/repo/pull/7" },
    { number: 101, title: "fix(example): still running", state: "needs_you", reason: "changes requested", url: "https://github.com/owner/repo/pull/101/files?diff=unified" },
    { kind: "pr", repo: "owner/repo", number: 55, title: "chore(example): never reviewed", state: "opened", reason: "", url: "https://github.com/owner/repo/pull/55" },
    { kind: "issue", repo: "owner/repo", number: 7, title: "bug report", state: "active", reason: "", url: "https://github.com/owner/repo/issues/7" },
  ],
};

test("/api/dyn/board and /api/card/board agree row for row: the same join on the same rows", async (t) => {
  const hudRoot = parityFixture(t);
  writeConfig(hudRoot, { board: { url: await boardUpstream(t, board) }, reviews: {} });
  const get = await serveFrozen(t, hudRoot);

  const old = await get("/api/dyn/board");
  const card = await get("/api/card/board");
  assert.equal(old.status, 200);
  assert.equal(card.status, 200);

  // The old envelope is the upstream payload with `review` on each joined row.
  assert.equal(old.body.source, "board");
  assert.equal(old.body.stale, false);
  assert.equal(old.body.data.generated_at, board.generated_at, "the envelope around the rows is kept");
  assert.equal(old.body.data.items.length, card.body.count);
  // The card envelope is the same rows, normalised, with the same `review`
  // block — or none — on each.
  old.body.data.items.forEach((raw, i) => {
    const item = card.body.items[i];
    assert.equal(item.number, raw.number);
    assert.equal(item.url, raw.url);
    // The old envelope spells the joined block `review`; the card route names
    // it after the card it came from. Same block either way.
    assert.deepEqual(item.reviews, raw.review, `row ${i}`);
    assert.equal("reviews" in item, "review" in raw, `row ${i}: joined on one route and not the other`);
  });
  assert.equal(card.body.joins.reviews, "ok");

  // Both degrade alike: a dead upstream with no snapshot is 503 on both, and
  // neither names a snapshot it did not have.
  writeConfig(hudRoot, { board: { url: "http://127.0.0.1:1/board" }, reviews: {} });
  fs.rmSync(path.join(hudRoot, ".generated"), { recursive: true, force: true });
  const oldDown = await get("/api/dyn/board");
  const cardDown = await get("/api/card/board");
  assert.equal(oldDown.status, 503);
  assert.equal(cardDown.status, 503);
  assert.equal(oldDown.body.cached_at, null);
  assert.equal(oldDown.body.stale, true);
  assert.equal(cardDown.body.error, oldDown.body.error);

  // Not configured: the old route said 503 (it had a snapshot tier, so
  // "unconfigured" had to be told apart from "no panel"); the card route says
  // 404 like every card. That one difference is the old route's, kept.
  writeConfig(hudRoot, { reviews: {} });
  assert.equal((await get("/api/dyn/board")).status, 503);
  assert.match((await get("/api/dyn/board")).body.error, /board is not configured in hud\.toml/);
  assert.equal((await get("/api/card/board")).status, 404);
});
