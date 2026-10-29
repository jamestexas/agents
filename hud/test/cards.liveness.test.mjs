// A run's liveness, from its state file and a probe of the process that owns
// it. The normaliser only reads; healing a dead run is the writer's SessionEnd
// hook, so every case here is a pure call with the probe stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { normalize, isLive, STALE_AFTER_MS } from "../cards/normalize/review-state.mjs";

const NOW = Date.parse("2026-01-01T01:00:00Z");
const row = (data) => ({ path: "projects/example-one/raw/PR-1/state.json", project: "example-one", data });
const open = (extra = {}) => ({ version: 1, phase: "settle", started: "2026-01-01T00:50:00Z", ended: null, phases: {}, ...extra });
const owner = { session_id: "s", pid: 42, transcript_path: "/t/s.jsonl" };
const probe = ({ alive = true, mtimeMs = NOW - 60_000 } = {}) => ({ alive: () => alive, mtimeMs: () => mtimeMs });

test("no owner: today's rule (ended == null is running)", () => {
  const item = normalize(row(open()), { now: NOW, probe: probe({ alive: false }) });
  assert.equal(item.running, true);
  assert.equal(item.liveness, "running");
});

test("owner alive with a recent transcript: running", () => {
  const item = normalize(row(open({ owner })), { now: NOW, probe: probe() });
  assert.equal(item.liveness, "running");
  assert.equal(isLive(item), true);
});

test("owner pid gone: abandoned, not running", () => {
  const item = normalize(row(open({ owner })), { now: NOW, probe: probe({ alive: false }) });
  assert.equal(item.liveness, "abandoned");
  assert.equal(item.running, false);
});

test("owner alive but transcript quiet past the window: stale", () => {
  assert.equal(STALE_AFTER_MS, 10 * 60_000);
  const item = normalize(row(open({ owner })), { now: NOW, probe: probe({ mtimeMs: NOW - 11 * 60_000 }) });
  assert.equal(item.liveness, "stale");
  assert.equal(item.running, false);
});

test("owner with no transcript found: judged by the pid alone", () => {
  const item = normalize(row(open({ owner: { ...owner, transcript_path: null } })), { now: NOW, probe: probe({ mtimeMs: null }) });
  assert.equal(item.liveness, "running");
});

test("no probe in the context: today's rule", () => {
  assert.equal(normalize(row(open({ owner })), { now: NOW }).liveness, "running");
});

test("recorded abandoned/failed are terminal; a finished run is done", () => {
  for (const phase of ["abandoned", "failed"]) {
    const item = normalize(row(open({ phase, ended: "2026-01-01T00:55:00Z", owner })), { now: NOW, probe: probe() });
    assert.equal(item.liveness, phase);
    assert.equal(item.running, false);
  }
  const done = normalize(row(open({ phase: "rendered", ended: "2026-01-01T00:55:00Z", owner })), { now: NOW, probe: probe({ alive: false }) });
  assert.equal(done.liveness, "done");
});

test("owner never reaches the page", () => {
  const item = normalize(row(open({ owner })), { now: NOW, probe: probe() });
  assert.equal(item.owner, undefined);
  assert.ok(!JSON.stringify(item).includes("/t/s.jsonl"));
});
