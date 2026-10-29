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
