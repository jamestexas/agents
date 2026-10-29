// `GET /api/card/<name>`: one route for every card, and what it answers when
// the card is absent, misconfigured, or asked for a scope it does not have.
//
// Each case builds a tmp HUD_ROOT with the shared review-run fixtures and a
// config in one of the two forms — legacy `[sources.reviews]`, which the
// registry synthesises into the reviews card, or `[cards.reviews]` written as
// the docs show it. Nothing here reads a real tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { COLUMNS } from "../cards/normalize/review-state.mjs";
import { census, paths, reviewsFixture, serve, writeConfig } from "./review-fixtures.mjs";

const CARD_KEYS = [
  "card", "source", "stale", "generated_at", "root", "columns", "joins", "count", "truncated", "rejected", "items",
];

const CARDS_TOML = `
[cards.reviews]
kind    = "fs"
glob    = "projects/*/raw/PR-*/state.json"
shape   = "review-state"
key     = "pr_url"
title   = "Review runs"
scope   = "open"
columns = ["pr", "project", "phase", "verdict", "note"]

[layout]
order = ["reviews", "board"]
`;

test("GET /api/card/reviews serves the card envelope over the same rows", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/card/reviews?scope=all");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), CARD_KEYS, "the envelope, in a fixed order");
  assert.equal(body.card, "reviews");
  assert.equal(body.source, "fs");
  assert.equal(body.stale, false);
  assert.match(body.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(body.root, hudRoot);
  assert.deepEqual(body.columns, [...COLUMNS], "the synthesised card shows the shape's columns");
  assert.deepEqual(body.joins, {});
  assert.equal(body.count, 3);
  assert.equal(body.truncated, false);
  assert.equal(body.rejected, 0);
  assert.deepEqual(paths(body), [
    "projects/example-one/raw/PR-101/state.json",
    "projects/example-two/raw/PR-7/state.json",
    "projects/example-one/raw/PR-9/state.json",
  ]);
  assert.equal(body.items[0].running, true);
  assert.equal(body.items[2].unreadable, true);
});

test("scope defaults to the card's, is overridden by the query, and is refused outside the vocabulary", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serve(t, hudRoot);

  // The synthesised card declares `scope = "open"`: the posted run drops out.
  const bare = await (await hud.get("/api/card/reviews")).json();
  assert.equal(bare.count, 2);
  assert.deepEqual(paths(bare), [
    "projects/example-one/raw/PR-101/state.json",
    "projects/example-one/raw/PR-9/state.json",
  ]);
  assert.equal((await (await hud.get("/api/card/reviews?scope=open")).json()).count, 2);
  assert.equal((await (await hud.get("/api/card/reviews?scope=all")).json()).count, 3);

  const bad = await hud.get("/api/card/reviews?scope=posted");
  assert.equal(bad.status, 400);
  const badBody = await bad.json();
  assert.equal(badBody.card, "reviews");
  assert.match(badBody.error, /scope must be one of open, all/);
  assert.equal(badBody.items, undefined);

  // A card that declares no scope serves every row by default.
  fs.writeFileSync(path.join(hudRoot, "hud.toml"), CARDS_TOML.replace('scope   = "open"\n', ""));
  assert.equal((await (await hud.get("/api/card/reviews")).json()).count, 3);
});

test("the [cards.reviews] form in hud.toml is served with its own columns", async (t) => {
  const hudRoot = reviewsFixture(t);
  fs.writeFileSync(path.join(hudRoot, "hud.toml"), CARDS_TOML);
  const hud = await serve(t, hudRoot);

  const body = await (await hud.get("/api/card/reviews")).json();
  assert.deepEqual(body.columns, ["pr", "project", "phase", "verdict", "note"]);
  assert.equal(body.count, 2, "its scope is open");
  assert.equal(body.root, hudRoot);
});

test("an undeclared card is 404: not configured, no data", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/card/board");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.card, "board");
  assert.match(body.error, /card board is not configured in hud\.toml/);
  assert.equal(body.items, undefined);
  assert.equal(body.count, undefined);

  // No name, a name with a slash, and a name the registry would refuse.
  for (const p of ["/api/card/", "/api/card/reviews/x", "/api/card/re%2Fviews", "/api/card"]) {
    assert.equal((await hud.get(p)).status, 404, p);
  }

  // No config at all is the same answer, for every name.
  fs.rmSync(path.join(hudRoot, "hud.config.json"));
  assert.equal((await hud.get("/api/card/reviews")).status, 404);
});

test("a misconfigured card is 503 with the reason, and the other cards are unaffected", async (t) => {
  const hudRoot = reviewsFixture(t);
  const hud = await serve(t, hudRoot);

  fs.writeFileSync(
    path.join(hudRoot, "hud.toml"),
    `${CARDS_TOML}\n[cards.odd]\nkind = "carrier-pigeon"\n\n[cards.runs]\nkind = "fs"\nglob = "../x/*.json"\nshape = "review-state"\n`,
  );
  const odd = await hud.get("/api/card/odd");
  assert.equal(odd.status, 503);
  const oddBody = await odd.json();
  assert.equal(oddBody.card, "odd");
  assert.match(oddBody.error, /^misconfigured: cards\.odd: unknown kind "carrier-pigeon"$/);
  assert.equal(oddBody.items, undefined);

  const runs = await hud.get("/api/card/runs");
  assert.equal(runs.status, 503);
  assert.match((await runs.json()).error, /^misconfigured: cards\.runs\.glob in hud\.toml: glob must/);

  const ok = await hud.get("/api/card/reviews");
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).count, 2);

  // The legacy form's bad glob reads the same way through the card route.
  // (hud.toml wins over hud.config.json while it exists, so it goes first.)
  fs.rmSync(path.join(hudRoot, "hud.toml"));
  writeConfig(hudRoot, { reviews: { glob: "/abs/*.json" } });
  const legacy = await hud.get("/api/card/reviews");
  assert.equal(legacy.status, 503);
  assert.match((await legacy.json()).error, /^misconfigured: sources\.reviews\.glob in hud\.toml: /);
});

test("the card route rejects non-get and writes nothing", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const before = census(hudRoot);
  const hud = await serve(t, hudRoot);

  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    assert.equal((await hud.verb(method, "/api/card/reviews")).status, 405, `${method} /api/card/reviews`);
  }
  // There is no mutating card route to reach under any name.
  for (const p of ["/api/card/reviews/refresh", "/api/refresh/card/reviews", "/api/cards/refresh"]) {
    assert.equal((await hud.verb("POST", p)).status, 405, `POST ${p}`);
    assert.equal((await hud.verb("GET", p)).status, 404, `GET ${p}`);
  }
  // HEAD is a GET without a body, as everywhere else.
  assert.equal((await hud.verb("HEAD", "/api/card/reviews")).status, 200);

  assert.equal((await hud.get("/api/card/reviews")).status, 200);
  assert.deepEqual(census(hudRoot), before, "a card request leaves the tree as it found it");
  assert.equal(fs.existsSync(path.join(hudRoot, ".generated")), false, "and writes no snapshot");
});

test("an absent root is an empty card, and the row budget marks truncation", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: { root: path.join(hudRoot, "nowhere") } });
  const hud = await serve(t, hudRoot);
  const empty = await (await hud.get("/api/card/reviews?scope=all")).json();
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.truncated, false);

  // More runs than one response carries: `truncated` says so, and the rows
  // served are the first by the shape's order.
  const many = {};
  for (let i = 1; i <= 205; i++) {
    many[`projects/p/raw/PR-${i}/state.json`] = JSON.stringify({
      repo: "owner/repo", pr: i, started: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z`, ended: "2026-10-29T00:00:00.000Z", posted: null,
    });
  }
  const bigRoot = reviewsFixture(t);
  for (const [rel, body] of Object.entries(many)) {
    fs.mkdirSync(path.dirname(path.join(bigRoot, rel)), { recursive: true });
    fs.writeFileSync(path.join(bigRoot, rel), body);
  }
  writeConfig(hudRoot, { reviews: { root: bigRoot } });
  const big = await (await hud.get("/api/card/reviews?scope=all")).json();
  assert.equal(big.count, 200);
  assert.equal(big.items.length, 200);
  assert.equal(big.truncated, true);
});
