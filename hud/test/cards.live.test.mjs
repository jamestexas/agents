// Live updates: an ETag on every card answer so a poll between changes is a
// 304, a `refresh` cadence the page schedules its polls by, and one GET-only
// Server-Sent Events stream fed by a watcher on the tree that names the card a
// change belongs to.
//
// Each case builds a tmp HUD_ROOT from the shared review-run fixtures. Nothing
// here reads a real tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { createServer, parseToml } from "../server.mjs";
import { DEFAULT_REFRESH_S, loadCards, parseRefresh } from "../cards/registry.mjs";
import { UI_DIR, census, finished, reviewsFixture, running, writeConfig } from "./review-fixtures.mjs";

// ------------------------------------------------------------------ helpers

/** The HUD on an ephemeral port, with the stream's timings and the clock as seams. */
async function serveLive(t, root, opts = {}) {
  const server = createServer({ root, uiDir: UI_DIR, httpTimeoutMs: 1500, cmdTimeoutMs: 5000, ...opts });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    get: (p, headers = {}) => fetch(base + p, { cache: "no-store", headers }),
    verb: (method, p) => fetch(base + p, { method, cache: "no-store" }),
  };
}

/**
 * The event stream, parsed: every event and comment as it arrives, and a
 * `next(pred, ms)` that resolves with the first one matching or rejects at
 * the deadline. Read with `http.get` so the raw frames are what is parsed.
 */
function openEvents(t, base) {
  const seen = [];
  const waiters = [];
  let buf = "";
  let res;
  const push = (ev) => {
    seen.push(ev);
    for (const w of [...waiters]) {
      if (w.pred(ev)) {
        waiters.splice(waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(ev);
      }
    }
  };
  const ready = new Promise((resolve, reject) => {
    const req = http.get(base + "/api/events", (r) => {
      res = r;
      r.setEncoding("utf8");
      r.on("data", (chunk) => {
        buf += chunk;
        let at;
        while ((at = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const ev = { event: "message", data: null, comments: [] };
          for (const line of frame.split("\n")) {
            if (line.startsWith(":")) ev.comments.push(line.slice(1).trim());
            else if (line.startsWith("event:")) ev.event = line.slice(6).trim();
            else if (line.startsWith("data:")) ev.data = JSON.parse(line.slice(5).trim());
          }
          if (ev.data === null && ev.comments.length) ev.event = "comment";
          push(ev);
        }
      });
      resolve(r);
    });
    req.on("error", reject);
    t.after(() => req.destroy());
  });
  return {
    ready,
    seen,
    get res() {
      return res;
    },
    next(pred, ms = 1000) {
      const hit = seen.find(pred);
      if (hit) {
        seen.splice(seen.indexOf(hit), 1);
        return Promise.resolve(hit);
      }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        w.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error(`no matching event within ${ms} ms; saw ${JSON.stringify(seen)}`));
        }, ms);
        waiters.push(w);
      });
    },
    clear() {
      seen.length = 0;
    },
  };
}

const isCard = (name) => (ev) => ev.event === "card" && ev.data && ev.data.name === name;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (root, rel, body) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof body === "string" ? body : JSON.stringify(body));
};

// ---------------------------------------------------------------- (a) ETag

test("a card answer carries an ETag; If-None-Match on unchanged rows is a 304 with no body", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serveLive(t, hudRoot);

  const first = await hud.get("/api/card/reviews?scope=all");
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.match(etag, /^"[0-9a-f]{64}"$/, "a strong ETag: the sha256 of the served rows");
  assert.equal(first.headers.get("cache-control"), "no-cache", "the browser may keep it, but must ask");
  await first.json();

  const again = await hud.get("/api/card/reviews?scope=all", { "if-none-match": etag });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get("etag"), etag);
  assert.equal(await again.text(), "");

  // A list, a weak spelling and `*` all match, as RFC 9110 has them.
  assert.equal((await hud.get("/api/card/reviews?scope=all", { "if-none-match": `"nope", W/${etag}` })).status, 304);
  assert.equal((await hud.get("/api/card/reviews?scope=all", { "if-none-match": "*" })).status, 304);
  assert.equal((await hud.get("/api/card/reviews?scope=all", { "if-none-match": '"nope"' })).status, 200);

  // A scope serves other rows, so it is another ETag.
  const open = await hud.get("/api/card/reviews?scope=open", { "if-none-match": etag });
  assert.equal(open.status, 200);
  assert.notEqual(open.headers.get("etag"), etag);

  // A changed state file is a new ETag and a full answer.
  write(hudRoot, "projects/example-one/raw/PR-101/state.json", { ...running, phase: "render" });
  const changed = await hud.get("/api/card/reviews?scope=all", { "if-none-match": etag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
  assert.equal((await changed.json()).items[0].phase, "render");
});

test("the clock is not a change: a running row's elapsed time does not move the ETag", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  let clock = Date.parse(running.started) + 60 * 1000;
  const hud = await serveLive(t, hudRoot, { now: () => clock });

  const first = await hud.get("/api/card/reviews?scope=all");
  const etag = first.headers.get("etag");
  const before = await first.json();
  clock += 30 * 1000;
  const later = await hud.get("/api/card/reviews?scope=all");
  const after = await later.json();
  assert.notEqual(after.items[0].elapsed_s, before.items[0].elapsed_s, "the body does move");
  assert.equal(later.headers.get("etag"), etag, "the ETag does not");
  assert.equal((await hud.get("/api/card/reviews?scope=all", { "if-none-match": etag })).status, 304);
});

test("a join is part of the answer: a change to the joined card's rows moves the board's ETag", async (t) => {
  const hudRoot = reviewsFixture(t);
  const up = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ kind: "pr", repo: "owner/repo", number: 7, title: "a pr" }] }));
  });
  await new Promise((resolve) => up.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => up.close(resolve)));
  writeConfig(hudRoot, { board: { url: `http://127.0.0.1:${up.address().port}/board` }, reviews: {} });
  const hud = await serveLive(t, hudRoot);

  const first = await hud.get("/api/card/board");
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.equal((await first.json()).items[0].reviews.verdict, "APPROVE");
  assert.equal((await hud.get("/api/card/board", { "if-none-match": etag })).status, 304);

  write(hudRoot, "projects/example-two/raw/PR-7/state.json", { ...finished, verdict: "REQUEST_CHANGES" });
  const changed = await hud.get("/api/card/board", { "if-none-match": etag });
  assert.equal(changed.status, 200, "the upstream's bytes are the same; the joined run is not");
  assert.equal((await changed.json()).items[0].reviews.verdict, "REQUEST_CHANGES");
});

test("only the card route answers conditionally: errors carry no ETag, and the aliases are unchanged", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serveLive(t, hudRoot);

  const missing = await hud.get("/api/card/board", { "if-none-match": "*" });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("etag"), null);
  const alias = await hud.get("/api/reviews", { "if-none-match": "*" });
  assert.equal(alias.status, 200);
  assert.equal(alias.headers.get("etag"), null);
});

// ------------------------------------------------------------- refresh

test("refresh is served in seconds: the card's own, 60 by default, 15 while a run is in flight", async (t) => {
  const hudRoot = reviewsFixture(t);
  const toml = (refresh) =>
    `[cards.reviews]\nkind = "fs"\nglob = "projects/*/raw/PR-*/state.json"\nshape = "review-state"\nkey = "pr_url"\n` +
    (refresh ? `refresh = "${refresh}"\n` : "");
  fs.writeFileSync(path.join(hudRoot, "hud.toml"), toml(null));
  const hud = await serveLive(t, hudRoot);

  const live = await (await hud.get("/api/card/reviews")).json();
  assert.equal(live.refresh, 15, "the fixture has a running run");
  // Without the running run, the card's own cadence.
  fs.rmSync(path.join(hudRoot, "projects/example-one/raw/PR-101/state.json"));
  assert.equal((await (await hud.get("/api/card/reviews")).json()).refresh, DEFAULT_REFRESH_S);
  fs.writeFileSync(path.join(hudRoot, "hud.toml"), toml("2m"));
  assert.equal((await (await hud.get("/api/card/reviews")).json()).refresh, 120);
  // A card asking for faster than the in-flight cadence keeps its own.
  fs.writeFileSync(path.join(hudRoot, "hud.toml"), toml("5s"));
  write(hudRoot, "projects/example-one/raw/PR-101/state.json", running);
  assert.equal((await (await hud.get("/api/card/reviews")).json()).refresh, 5);
});

// ---------------------------------------------------------------- (d) parse

test("refresh parses seconds and minutes and refuses anything else as a config error", () => {
  assert.equal(DEFAULT_REFRESH_S, 60);
  assert.equal(parseRefresh("15s"), 15);
  assert.equal(parseRefresh("2m"), 120);
  for (const bad of ["soon", "0s", "15", "1.5m", "-5s", "", 15, null]) {
    assert.equal(parseRefresh(bad), null, JSON.stringify(bad));
  }

  const stanza = (refresh) => `[cards.reviews]\nkind = "fs"\nglob = "projects/*/state.json"\nshape = "review-state"\nrefresh = "${refresh}"\n`;
  const ok = loadCards(parseToml(stanza("15s")).data, { hudRoot: "/tmp/x" });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.cards.get("reviews").refresh, 15);

  const bad = loadCards(parseToml(stanza("soon")).data, { hudRoot: "/tmp/x" });
  assert.deepEqual(bad.errors, ['cards.reviews: refresh must be a duration like "15s" or "2m"']);
  assert.equal(bad.cards.get("reviews").error, bad.errors[0]);

  // Undeclared stays undeclared on the card; the default is applied when served.
  const none = loadCards(parseToml(stanza("15s").replace(/refresh.*\n/, "")).data, { hudRoot: "/tmp/x" });
  assert.equal(none.cards.get("reviews").refresh, undefined);
});

// ------------------------------------------------------------- (b) events

test("GET /api/events is an event stream naming the card a tree change belongs to", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serveLive(t, hudRoot, { eventsPingMs: 60 * 1000 });
  const events = openEvents(t, hud.base);
  const res = await events.ready;
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /^text\/event-stream/);
  assert.equal(res.headers["cache-control"], "no-cache");

  // The stream opens by saying which cards it will name, so the page knows
  // which panels are live and which only poll.
  const hello = await events.next((ev) => ev.event === "hello");
  assert.deepEqual(hello.data, { watching: true, cards: ["reviews"] });

  const t0 = Date.now();
  write(hudRoot, "projects/example-three/raw/PR-12/state.json", { ...running, pr: 12 });
  await events.next(isCard("reviews"), 1000);
  assert.ok(Date.now() - t0 < 1000);
});

test("a write outside every card's glob names no card", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serveLive(t, hudRoot, { eventsPingMs: 60 * 1000 });
  const events = openEvents(t, hud.base);
  await events.ready;
  await events.next((ev) => ev.event === "hello");

  write(hudRoot, "notes/2026-10-29-a-note.md", "# a note\n");
  write(hudRoot, "projects/example-one/raw/PR-5/evidence.txt", "still not a state file\n");
  write(hudRoot, "projects/.hidden/raw/PR-3/state.json", JSON.stringify(finished));
  write(hudRoot, ".generated/cards/board.json", "{}");
  await sleep(700);
  assert.deepEqual(events.seen.filter((ev) => ev.event === "card"), []);

  // The watcher is still there: the next change inside the glob is named.
  write(hudRoot, "projects/example-one/raw/PR-101/state.json", { ...running, phase: "render" });
  await events.next(isCard("reviews"), 1000);
});

test("a ping comment keeps the stream open at the ping interval", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serveLive(t, hudRoot, { eventsPingMs: 50 });
  const events = openEvents(t, hud.base);
  await events.ready;
  const ping = await events.next((ev) => ev.event === "comment" && ev.comments.includes("ping"), 500);
  assert.ok(ping);
});

test("a tree with no fs card under it still streams, and says it names nothing", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: { root: path.join(hudRoot, "..", "elsewhere") } });
  const hud = await serveLive(t, hudRoot, { eventsPingMs: 50 });
  const events = openEvents(t, hud.base);
  await events.ready;
  assert.deepEqual((await events.next((ev) => ev.event === "hello")).data, { watching: true, cards: [] });
});

// -------------------------------------------------------- (c) GET only

test("the event stream is GET-only and writes nothing", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const before = census(hudRoot);
  const hud = await serveLive(t, hudRoot, { eventsPingMs: 60 * 1000 });

  for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD"]) {
    assert.equal((await hud.verb(method, "/api/events")).status, 405, `${method} /api/events`);
  }
  const events = openEvents(t, hud.base);
  await events.ready;
  await events.next((ev) => ev.event === "hello");
  events.res.destroy();
  await sleep(50);
  assert.deepEqual(census(hudRoot), before, "streaming leaves the tree as it found it");
});

test("closing the server ends open streams rather than waiting on them", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const server = createServer({ root: hudRoot, uiDir: UI_DIR, eventsPingMs: 60 * 1000 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const events = openEvents(t, base);
  await events.ready;
  await events.next((ev) => ev.event === "hello");
  const ended = new Promise((resolve) => events.res.on("end", resolve));
  const closed = new Promise((resolve) => server.close(resolve));
  await Promise.race([Promise.all([ended, closed]), sleep(1000).then(() => assert.fail("close waited on the stream"))]);
});

// ------------------------------------------------------------------ UI

const html = fs.readFileSync(path.join(UI_DIR, "index.html"), "utf8");

test("the page polls each card on its served refresh, conditionally, and listens on one stream", () => {
  assert.equal((html.match(/new EventSource\(/g) || []).length, 1, "one stream for the page");
  assert.match(html, /new EventSource\("\/api\/events"\)/);
  assert.match(html, /addEventListener\("card"/, "a named card is refetched");
  assert.match(html, /addEventListener\("hello"/, "the stream says which cards it names");
  assert.match(html, /"if-none-match"/, "polls carry the last ETag");
  assert.match(html, /res\.status === 304/, "a 304 keeps the rows already drawn");
  assert.match(html, /body\.refresh/, "the timer is the card's served refresh");
  assert.match(html, /"live · "/, "a live panel says so");
  assert.match(html, /"polling · "/, "and one that only polls says that");
});
