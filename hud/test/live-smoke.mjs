#!/usr/bin/env node
// Live-updates smoke: drive one review run through its phases on disk and
// watch the card follow, headlessly, the way an open page would.
//
// The real entry point (`node server.mjs`) on a free port against a tmp
// HUD_ROOT; one event stream; one state.json written four times — phase 1 as
// the review skill writes it, then three advances — and after each write:
// the stream names `reviews` within a second, the card's ETag moves, the row
// shows the phase, `early` and `running` the file now says, and a poll with
// that ETag before the next write is a 304. Ends with one timing line.
//
//   node hud/test/live-smoke.mjs        by hand
//   node --test hud/test                with the unit tests
//
// Nothing here reads a real tree; the fixture carries no real names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const SERVER = path.join(import.meta.dirname, "..", "server.mjs");
const STATE = "projects/example-one/raw/PR-1/state.json";
const EVENT_DEADLINE_MS = 1000;
const TOTAL_BUDGET_MS = 5000;

const CONFIG = `[cards.reviews]
kind    = "fs"
glob    = "projects/*/raw/PR-*/state.json"
shape   = "review-state"
key     = "pr_url"
title   = "Review runs"
scope   = "open"
`;

/** A port nothing holds: bind an ephemeral one, then release it. */
async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** `node server.mjs` against `root`; resolves once it says it is listening. */
async function startServer(t, root, port) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, HUD_ROOT: root, HUD_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let out = "";
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${err}`)), 3000);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes(`http://127.0.0.1:${port}/`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${err}`)));
  });
  return `http://127.0.0.1:${port}`;
}

/** The event stream: `next(pred, ms)` resolves with the first matching event. */
async function openEvents(t, base) {
  const seen = [];
  const waiters = [];
  let buf = "";
  const push = (ev) => {
    const w = waiters.find((x) => x.pred(ev));
    if (!w) return seen.push(ev);
    waiters.splice(waiters.indexOf(w), 1);
    clearTimeout(w.timer);
    w.resolve(ev);
  };
  await new Promise((resolve, reject) => {
    const req = http.get(base + "/api/events", (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        let at;
        while ((at = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const ev = { event: "message", data: null };
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) ev.event = line.slice(6).trim();
            else if (line.startsWith("data:")) ev.data = JSON.parse(line.slice(5).trim());
          }
          if (ev.data !== null) push(ev);
        }
      });
      resolve();
    });
    req.on("error", reject);
    t.after(() => req.destroy());
  });
  return {
    clear: () => (seen.length = 0),
    next(pred, ms) {
      const hit = seen.find(pred);
      if (hit) {
        seen.splice(seen.indexOf(hit), 1);
        return Promise.resolve(hit);
      }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        w.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error(`no matching event within ${ms} ms`));
        }, ms);
        waiters.push(w);
      });
    },
  };
}

const isReviews = (ev) => ev.event === "card" && ev.data.name === "reviews";

test("a review run's phases reach the card as they are written, and polls between them are 304s", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-live-smoke-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "hud.toml"), CONFIG);
  // The run directory exists before the watcher does, so the first event is
  // the first write's and not the directory's.
  fs.mkdirSync(path.dirname(path.join(root, STATE)), { recursive: true });

  const t0 = Date.now();
  const base = await startServer(t, root, await freePort());
  const events = await openEvents(t, base);
  const hello = await events.next((ev) => ev.event === "hello", EVENT_DEADLINE_MS);
  assert.deepEqual(hello.data.cards, ["reviews"], "the stream covers the reviews card");

  const card = (etag) =>
    fetch(base + "/api/card/reviews?scope=open", { cache: "no-store", headers: etag ? { "if-none-match": etag } : {} });

  const started = new Date(Date.now() - 60 * 1000).toISOString();
  const at = (s) => new Date(Date.parse(started) + s * 1000).toISOString();
  const seed = { version: 1, repo: "owner/repo", pr: 1, title: "feat(example): a change", mode: "fast", started, posted: null };
  const steps = [
    {
      state: { ...seed, phase: "evidence", ended: null, phases: { evidence: { started, ended: null } } },
      expect: { phase: "evidence", running: true, early: undefined },
    },
    {
      state: { ...seed, phase: "questions", ended: null, phases: { evidence: { started, ended: at(10) }, questions: { started: at(10), ended: null } } },
      expect: { phase: "questions", running: true, early: undefined },
    },
    {
      state: {
        ...seed,
        phase: "settle",
        ended: null,
        phases: { evidence: { started, ended: at(10) }, questions: { started: at(10), ended: at(20) }, settle: { started: at(20), ended: null } },
        early: [{ row: 2, title: "an early signal", basis: "blocking-ran" }],
      },
      expect: { phase: "settle", running: true, early: 1 },
    },
    {
      state: {
        ...seed,
        phase: "rendered",
        ended: at(40),
        verdict: "COMMENT",
        phases: {
          evidence: { started, ended: at(10) },
          questions: { started: at(10), ended: at(20) },
          settle: { started: at(20), ended: at(30) },
          rendered: { started: at(30), ended: at(40) },
        },
        early: [{ row: 2, title: "an early signal", basis: "blocking-ran" }],
      },
      expect: { phase: "rendered", running: false, early: 1 },
    },
  ];

  // Before the run exists the card is empty, and that answer has an ETag too.
  const empty = await card();
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).count, 0);
  let etag = empty.headers.get("etag");
  const lags = [];

  for (const step of steps) {
    events.clear();
    const wrote = Date.now();
    fs.writeFileSync(path.join(root, STATE), JSON.stringify(step.state));
    await events.next(isReviews, EVENT_DEADLINE_MS);
    lags.push(Date.now() - wrote);

    const res = await card(etag);
    assert.equal(res.status, 200, `${step.expect.phase}: a change is a full answer`);
    const next = res.headers.get("etag");
    assert.notEqual(next, etag, `${step.expect.phase}: a change is a new ETag`);
    etag = next;
    const body = await res.json();
    assert.equal(body.count, 1);
    const row = body.items[0];
    assert.equal(row.phase, step.expect.phase);
    assert.equal(row.running, step.expect.running);
    assert.equal(row.early?.count, step.expect.early);
    assert.equal(body.refresh, step.expect.running ? 15 : 60, "polled closer while the run is in flight");
    if (step.expect.phase === "rendered") assert.equal(row.verdict, "COMMENT");

    // Between changes a poll is a 304: nothing to redraw.
    const poll = await card(etag);
    assert.equal(poll.status, 304, `${step.expect.phase}: an unchanged card is a 304`);
  }

  const total = Date.now() - t0;
  assert.ok(total < TOTAL_BUDGET_MS, `the whole sequence in under ${TOTAL_BUDGET_MS} ms (took ${total})`);
  console.log(
    `live-smoke: ${steps.length} writes, event lag ${lags.join("/")} ms (max ${Math.max(...lags)}), ` +
      `${steps.length} polls 304, total ${total} ms`,
  );
});
