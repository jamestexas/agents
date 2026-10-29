// The `fs` kind and the `review-state` normaliser, as the units the reviews
// card is built from. The kind reads files into rows and knows nothing about
// reviews; the normaliser turns one row into one item and knows nothing about
// the filesystem. `collectRows` is the composition the route and the library
// call share.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { LIMITS, parseGlob, read, walk } from "../cards/kinds/fs.mjs";
import * as reviewState from "../cards/normalize/review-state.mjs";
import { collectRows } from "../cards/serve.mjs";
import {
  EXTRA_CANARY,
  REVIEW_STATE_SERVED,
  RUNNING_FOR_S,
  RUNNING_STARTED,
  atMin,
  finished,
  fixture,
  reviewsFixture,
  running,
} from "./review-fixtures.mjs";

const GLOB = "projects/*/raw/PR-*/state.json";

const card = (root, extra = {}) => ({
  name: "reviews",
  kind: "fs",
  root,
  glob: GLOB,
  shape: "review-state",
  columns: [...reviewState.COLUMNS],
  ...extra,
});

const byPath = (rows) => new Map(rows.map((r) => [r.path, r]));

// ------------------------------------------------------------ the fs kind

test("fs.read: one row per file the glob names, raw data or an unreadable row", (t) => {
  const root = reviewsFixture(t);
  const { rows, scanned, truncated } = read(card(root));

  assert.equal(scanned, 3);
  assert.equal(truncated, false);
  assert.deepEqual(
    rows.map((r) => r.path).sort(),
    [
      "projects/example-one/raw/PR-101/state.json",
      "projects/example-one/raw/PR-9/state.json",
      "projects/example-two/raw/PR-7/state.json",
    ],
  );
  const text = JSON.stringify(rows);
  assert.ok(!text.includes("evidence.txt"), "a file under PR-* that is not state.json is not a row");
  assert.ok(!text.includes(".hidden"), "a dot-prefixed project is skipped");

  const m = byPath(rows);
  const run = m.get("projects/example-one/raw/PR-101/state.json");
  // The kind parses and hands over; it does not interpret. The canary is
  // still here because the whitelist is the normaliser's job.
  assert.deepEqual(run, { path: "projects/example-one/raw/PR-101/state.json", project: "example-one", data: running });
  assert.equal(m.get("projects/example-two/raw/PR-7/state.json").project, "example-two");

  const bad = m.get("projects/example-one/raw/PR-9/state.json");
  assert.equal(bad.unreadable, true);
  assert.equal(bad.project, "example-one");
  assert.ok(bad.error, "the parse error is carried");
  assert.equal("data" in bad, false);
});

test("fs.read: a JSON value that is not an object is an unreadable row, as is a file over budget", (t) => {
  const root = fixture(t, "hud-cards-fs-shape-", {
    "projects/p/raw/PR-1/state.json": JSON.stringify([1, 2, 3]),
    "projects/p/raw/PR-2/state.json": "null",
    "projects/p/raw/PR-3/state.json": `{"pad":"${"x".repeat(LIMITS.maxBytes)}"}`,
    "projects/p/raw/PR-4/state.json": "{}",
  });
  const m = byPath(read(card(root)).rows);
  assert.equal(m.get("projects/p/raw/PR-1/state.json").unreadable, true, "an array");
  assert.equal(m.get("projects/p/raw/PR-1/state.json").error, "not a JSON object");
  assert.equal(m.get("projects/p/raw/PR-2/state.json").unreadable, true, "null");
  assert.equal(m.get("projects/p/raw/PR-3/state.json").unreadable, true, "over budget");
  assert.match(m.get("projects/p/raw/PR-3/state.json").error, new RegExp(`larger than ${LIMITS.maxBytes} bytes`));
  assert.deepEqual(m.get("projects/p/raw/PR-4/state.json"), { path: "projects/p/raw/PR-4/state.json", project: "p", data: {} });
});

test("fs.read: symlinks are neither followed nor listed; an unreadable directory contributes nothing", (t) => {
  const elsewhere = fixture(t, "hud-cards-fs-elsewhere-", {
    "raw/PR-77/state.json": JSON.stringify(finished),
  });
  const root = fixture(t, "hud-cards-fs-links-", {
    "projects/real/raw/PR-1/state.json": JSON.stringify(finished),
  });
  // A symlinked project directory, and a symlinked state file inside a real one.
  fs.symlinkSync(elsewhere, path.join(root, "projects", "linked"));
  fs.mkdirSync(path.join(root, "projects/real/raw/PR-2"));
  fs.symlinkSync(
    path.join(elsewhere, "raw/PR-77/state.json"),
    path.join(root, "projects/real/raw/PR-2/state.json"),
  );
  const { rows } = read(card(root));
  assert.deepEqual(rows.map((r) => r.path), ["projects/real/raw/PR-1/state.json"]);

  // A root that does not exist is an empty card, not a fault: the tree is
  // allowed to have no runs yet.
  assert.deepEqual(read(card(path.join(root, "nowhere"))), { rows: [], scanned: 0, truncated: false });
});

test("fs.walk: the budget bounds the files looked at, and `project` is the first wildcard's match", (t) => {
  const root = fixture(t, "hud-cards-fs-budget-", {
    "runs/alpha/PR-1/state.json": "{}",
    "runs/alpha/PR-2/state.json": "{}",
    "runs/beta/PR-3/state.json": "{}",
    "runs/beta/PR-3/notes.json": "{}",
  });
  const { segments } = parseGlob("runs/*/PR-*/state.json");
  const all = walk(root, segments, LIMITS.maxScanned);
  assert.deepEqual(
    all.map((f) => `${f.project}:${f.rel}`).sort(),
    ["alpha:runs/alpha/PR-1/state.json", "alpha:runs/alpha/PR-2/state.json", "beta:runs/beta/PR-3/state.json"],
  );
  assert.equal(walk(root, segments, 2).length, 2);
  // A glob with no wildcard has no project to name.
  assert.deepEqual(walk(root, parseGlob("runs/beta/PR-3/state.json").segments, 10), [
    { rel: "runs/beta/PR-3/state.json", project: null },
  ]);
  assert.ok(LIMITS.maxScanned >= 1000 && LIMITS.maxBytes >= 64 * 1024, "the budgets are the reviews layer's");
});

// -------------------------------------------------------- the normaliser

test("review-state.normalize derives the panel's fields and drops unknown keys at every depth", (t) => {
  const root = reviewsFixture(t);
  const now = Date.parse(RUNNING_STARTED) + 90 * 1000;
  const m = byPath(read(card(root)).rows);
  const item = reviewState.normalize(m.get("projects/example-one/raw/PR-101/state.json"), { now });

  assert.equal(item.project, "example-one");
  assert.equal(item.running, true);
  assert.equal(item.elapsed_s, 90, "now − started, exactly, with `now` passed in");
  assert.equal(item.pr_url, "https://github.com/owner/repo/pull/101");
  assert.equal(item.note_url, "/n/projects/example-one/notes/PR-101-still-running");
  assert.deepEqual(item.phases, {
    evidence: { started: RUNNING_STARTED, ended: atMin(1) },
    questions: { started: atMin(1), ended: atMin(5) },
    settle: { started: atMin(5), ended: atMin(12) },
    refute: { started: atMin(12), ended: null },
  });
  assert.deepEqual(item.phase_seconds, { evidence: 60, questions: 240, settle: 420, refute: 0 });
  assert.deepEqual(item.early, {
    count: 2,
    items: [
      { row: 1, title: "build broken by new import", basis: "probe-failed:go-graph/build" },
      { row: 3, title: "signature verified after parse", basis: "blocking-ran" },
    ],
  });
  assert.deepEqual(item.gates, running.gates);
  assert.deepEqual(item.probes, running.probes);
  assert.equal(item.review_state, undefined, "no block in the file, no block on the item");
  assert.ok(!JSON.stringify(item).includes(EXTRA_CANARY), "an unlisted key leaked at some depth");
  assert.equal("data" in item, false, "the raw row never reaches the page");

  const done = reviewState.normalize(m.get("projects/example-two/raw/PR-7/state.json"), { now });
  assert.equal(done.running, false);
  assert.equal(done.elapsed_s, 31 * 60 + 30, "ended − started");
  assert.deepEqual(done.review_state, REVIEW_STATE_SERVED);
  assert.deepEqual(done.phases, {});
  assert.deepEqual(done.phase_seconds, {});
  assert.equal(done.early, undefined);
  assert.deepEqual(done.posted, finished.posted);
  assert.ok(!JSON.stringify(done).includes(EXTRA_CANARY));

  // An unreadable row is an item that says so — never null, never dropped.
  const bad = m.get("projects/example-one/raw/PR-9/state.json");
  assert.deepEqual(reviewState.normalize(bad, { now }), bad);
  assert.equal(reviewState.normalize(bad, { now }).running, undefined);
});

test("review-state.normalize refuses the links the state cannot back, and never rejects a row", () => {
  const now = Date.parse("2026-10-27T11:00:00.000Z");
  const row = (data) => ({ path: "p/raw/PR-1/state.json", project: "p", data });
  const one = reviewState.normalize(
    row({ repo: "https://evil.example/owner/repo", pr: 1, note: "../../outside.md", started: "2026-10-27T10:00:00.000Z", ended: "2026-10-27T10:00:05.000Z" }),
    { now },
  );
  assert.equal(one.pr_url, null);
  assert.equal(one.note_url, null);
  assert.equal(one.elapsed_s, 5);
  const two = reviewState.normalize(row({ repo: "owner/repo", pr: "77", note: "/abs/note.md" }), { now });
  assert.equal(two.pr_url, "https://github.com/owner/repo/pull/77");
  assert.equal(two.note_url, null);
  assert.equal(two.elapsed_s, null);
  const empty = reviewState.normalize(row({}), { now });
  assert.equal(empty.unreadable, undefined);
  assert.equal(empty.running, true, "no `ended` reads as still running, as the contract spells it");
  assert.deepEqual(empty.phase_seconds, {});
  assert.notEqual(empty, null, "this shape has nothing to reject: a row is always an item");
});

test("review-state declares its columns, scopes and order", () => {
  assert.deepEqual([...reviewState.SCOPES], ["open", "all"]);
  assert.ok(reviewState.COLUMNS.includes("verdict") && reviewState.COLUMNS.includes("threads"));
  assert.equal(reviewState.inScope({ running: true }, "open"), true);
  assert.equal(reviewState.inScope({ running: false, posted: null }, "open"), true);
  assert.equal(reviewState.inScope({ running: false, posted: { url: "x" } }, "open"), false);
  assert.equal(reviewState.inScope({ unreadable: true }, "open"), true, "no `posted` on an unreadable row keeps it in view");
  assert.equal(reviewState.inScope({ running: false, posted: { url: "x" } }, "all"), true);

  // Running first, then newest started first, the path breaking ties.
  const items = [
    { path: "b", running: false, started: "2026-10-27T10:00:00.000Z" },
    { path: "a", running: true, started: "2026-10-26T10:00:00.000Z" },
    { path: "c", running: false, started: "2026-10-28T10:00:00.000Z" },
    { path: "d", unreadable: true },
    { path: "a2", running: true, started: "2026-10-26T10:00:00.000Z" },
  ];
  assert.deepEqual([...items].sort(reviewState.compare).map((i) => i.path), ["a", "a2", "c", "b", "d"]);
});

// --------------------------------------------------------- the composition

test("collectRows reads, normalises, sorts and scopes through one path", (t) => {
  const root = reviewsFixture(t);
  fs.mkdirSync(path.join(root, "projects/example-two/raw/PR-8"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "projects/example-two/raw/PR-8/state.json"),
    JSON.stringify({ ...finished, pr: 8, posted: null, started: "2026-10-27T12:00:00.000Z", ended: "2026-10-27T12:05:00.000Z" }),
  );
  const now = Date.parse(RUNNING_STARTED) + RUNNING_FOR_S * 1000;

  const all = collectRows(card(root), { now });
  assert.deepEqual(Object.keys(all).sort(), ["items", "rejected", "scanned", "truncated"]);
  assert.equal(all.scanned, 4);
  assert.equal(all.rejected, 0);
  assert.equal(all.truncated, false);
  assert.deepEqual(
    all.items.map((i) => i.path),
    [
      "projects/example-one/raw/PR-101/state.json",
      "projects/example-two/raw/PR-8/state.json",
      "projects/example-two/raw/PR-7/state.json",
      "projects/example-one/raw/PR-9/state.json",
    ],
  );
  assert.equal(all.items[0].elapsed_s, RUNNING_FOR_S);

  const open = collectRows(card(root), { now }, { scope: "open" });
  assert.deepEqual(
    open.items.map((i) => i.path),
    [
      "projects/example-one/raw/PR-101/state.json",
      "projects/example-two/raw/PR-8/state.json",
      "projects/example-one/raw/PR-9/state.json",
    ],
  );
  assert.equal(open.scanned, 4, "scope narrows the items, not what was read");
  assert.deepEqual(collectRows(card(root), { now }, { scope: "all" }).items, all.items);
});
