// Hermetic tests for the reviews panel (`GET /api/reviews`).
//
// Every case builds a tmp HUD_ROOT holding a fixture tree of review runs —
// one still running, one finished and posted, one whose state file is not
// JSON — and a config that does or does not switch the source on. Nothing
// here reads a real tree. No fixture carries a real person, company,
// repository or project name.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_REVIEWS_GLOB, createServer, listReviews, parseReviewsGlob } from "../server.mjs";

const UI_DIR = path.join(import.meta.dirname, "..", "ui");

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
  const server = createServer({ root, uiDir: UI_DIR, httpTimeoutMs: 1500, cmdTimeoutMs: 5000 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: (p) => fetch(base + p, { cache: "no-store" }),
    verb: (method, p) => fetch(base + p, { method, cache: "no-store" }),
  };
}

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

// ----------------------------------------------------------------- fixtures

const RUNNING_FOR_S = 22 * 60;
const RUNNING_STARTED = new Date(Date.now() - RUNNING_FOR_S * 1000).toISOString();

/** A value the state file carries under a key the contract does not name. */
const EXTRA_CANARY = "extra-key-must-not-be-served";

const running = {
  version: 1,
  repo: "owner/repo",
  pr: 101,
  title: "fix(example): still running",
  author: "login",
  mode: "deep",
  head: "0123456789abcdef",
  base: "main",
  phase: "refute",
  phases: { evidence: { started: RUNNING_STARTED, ended: RUNNING_STARTED } },
  started: RUNNING_STARTED,
  ended: null,
  verdict: null,
  gates: { ledger: "ok", triage: null, blocking: null },
  probes: { total: 20, ran: 19, failed: 0, unavailable: 1 },
  findings: { blocking: 0, non_blocking: 1, question: 1, observation: 0 },
  note: "projects/example-one/notes/PR-101-still-running.md",
  posted: null,
  extra: EXTRA_CANARY,
};

const finished = {
  version: 1,
  repo: "owner/repo",
  pr: 7,
  title: "feat(example): finished and posted",
  author: "login",
  mode: "default",
  head: "fedcba9876543210",
  base: "main",
  phase: "posted",
  phases: {},
  started: "2026-10-27T10:00:00.000Z",
  ended: "2026-10-27T10:31:30.000Z",
  verdict: "APPROVE",
  gates: { ledger: "ok", triage: "ok", blocking: "ok" },
  probes: { total: 20, ran: 20, failed: 0, unavailable: 0 },
  findings: { blocking: 0, non_blocking: 0, question: 0, observation: 2 },
  note: "projects/example-two/notes/PR-7-finished.md",
  posted: {
    url: "https://github.com/owner/repo/pull/7#pullrequestreview-1",
    state: "APPROVED",
    at: "2026-10-27T10:31:00.000Z",
  },
};

/**
 * Two projects, three runs: running, finished, and one whose state file is
 * not JSON. Plus the things the glob must not match: a file under `raw/PR-*`
 * that is not `state.json`, the note the running run points at, and a run in
 * a dot-prefixed project.
 */
function reviewsFixture(t) {
  return fixture(t, "hud-reviews-", {
    "projects/example-one/raw/PR-101/state.json": JSON.stringify(running),
    "projects/example-two/raw/PR-7/state.json": JSON.stringify(finished),
    "projects/example-one/raw/PR-9/state.json": "not json {\n",
    "projects/example-one/raw/PR-5/evidence.txt": "not a state file\n",
    "projects/example-one/notes/PR-101-still-running.md": "# still running\n",
    "projects/.hidden/raw/PR-3/state.json": JSON.stringify(finished),
  });
}

const paths = (body) => body.items.map((i) => i.path);

// ------------------------------------------------------- required behaviors

test("reviews source absent yields 404 panel off", async (t) => {
  const hudRoot = reviewsFixture(t);
  // Other sources configured, reviews not: the files are there and the panel
  // still does not exist.
  writeConfig(hudRoot, { board: { url: "http://127.0.0.1:1/board" } });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/reviews");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.source, "reviews");
  assert.match(body.error, /not configured in hud\.toml/);
  // Panel off means no data at all, not an empty rendering.
  assert.equal(body.items, undefined);
  assert.equal(body.count, undefined);
  assert.ok(!JSON.stringify(body).includes(hudRoot));

  // A config file that is missing entirely is the same answer.
  fs.rmSync(path.join(hudRoot, "hud.config.json"));
  assert.equal((await hud.get("/api/reviews")).status, 404);
});

test("api reviews serves runs running-first with the derived fields", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/reviews");
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);

  assert.equal(body.source, "reviews");
  assert.equal(body.stale, false);
  assert.equal(body.root, hudRoot, "no root configured means the HUD root");
  assert.equal(body.glob, DEFAULT_REVIEWS_GLOB);
  assert.equal(body.count, 3);
  assert.equal(body.truncated, false);
  assert.match(body.generated_at, /^\d{4}-\d{2}-\d{2}T/);

  // Running first, then newest started first; the unreadable row, which has
  // no `started`, lands last.
  assert.deepEqual(paths(body), [
    "projects/example-one/raw/PR-101/state.json",
    "projects/example-two/raw/PR-7/state.json",
    "projects/example-one/raw/PR-9/state.json",
  ]);
  // Neither the non-state file nor the dot-prefixed project is a run.
  assert.ok(!text.includes("evidence.txt"));
  assert.ok(!text.includes(".hidden"));

  const [run, done, bad] = body.items;

  assert.equal(run.project, "example-one");
  assert.equal(run.running, true);
  assert.equal(run.phase, "refute");
  assert.equal(run.verdict, null);
  // now − started, give or take the time the test itself took.
  assert.ok(
    run.elapsed_s >= RUNNING_FOR_S - 2 && run.elapsed_s <= RUNNING_FOR_S + 120,
    `elapsed_s ${run.elapsed_s} is not about ${RUNNING_FOR_S}`,
  );
  assert.equal(run.pr_url, "https://github.com/owner/repo/pull/101");
  assert.equal(run.note_url, "/n/projects/example-one/notes/PR-101-still-running");
  assert.deepEqual(run.probes, running.probes);
  assert.deepEqual(run.findings, running.findings);
  assert.deepEqual(run.gates, running.gates);

  assert.equal(done.project, "example-two");
  assert.equal(done.running, false);
  assert.equal(done.elapsed_s, 31 * 60 + 30, "ended − started, not now − started");
  assert.equal(done.pr_url, "https://github.com/owner/repo/pull/7");
  assert.equal(done.note_url, "/n/projects/example-two/notes/PR-7-finished");
  assert.deepEqual(done.posted, finished.posted);
  assert.equal(done.verdict, "APPROVE");

  // The unreadable file is a row that says so, with the path, and nothing
  // pretending to be state.
  assert.equal(bad.unreadable, true);
  assert.equal(bad.path, "projects/example-one/raw/PR-9/state.json");
  assert.equal(bad.project, "example-one");
  assert.ok(bad.error, "the parse error is carried");
  assert.equal(bad.pr, undefined);
  assert.equal(bad.running, undefined);

  // The state fields are copied by name: a key the contract does not name
  // never reaches the page.
  assert.ok(!text.includes(EXTRA_CANARY), "an unlisted state key leaked through");
});

test("a bare [sources.reviews] table in hud.toml is the on switch", async (t) => {
  const hudRoot = reviewsFixture(t);
  fs.writeFileSync(path.join(hudRoot, "hud.toml"), "[sources.reviews]\n");
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/reviews");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).count, 3);

  fs.writeFileSync(path.join(hudRoot, "hud.toml"), "[sources.board]\nurl = \"http://127.0.0.1:1/b\"\n");
  assert.equal((await hud.get("/api/reviews")).status, 404);
});

test("root and glob are honoured", async (t) => {
  const elsewhere = fixture(t, "hud-reviews-elsewhere-", {
    "runs/alpha/PR-1/state.json": JSON.stringify(finished),
    "runs/alpha/PR-2/notes.json": "{}",
    "runs/beta/PR-3/state.json": JSON.stringify({ ...finished, pr: 3 }),
  });
  const hudRoot = fixture(t, "hud-reviews-root-", {});
  writeConfig(hudRoot, { reviews: { root: elsewhere, glob: "runs/*/PR-*/state.json" } });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/reviews");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.root, elsewhere);
  assert.equal(body.glob, "runs/*/PR-*/state.json");
  assert.deepEqual(paths(body), ["runs/alpha/PR-1/state.json", "runs/beta/PR-3/state.json"]);
  // `project` is the first wildcard's match, whatever the glob calls it.
  assert.deepEqual(
    body.items.map((i) => i.project),
    ["alpha", "beta"],
  );

  // The default glob against that root finds nothing — and says so with a
  // 200, because an empty tree is an answer.
  writeConfig(hudRoot, { reviews: { root: elsewhere } });
  const none = await (await hud.get("/api/reviews")).json();
  assert.equal(none.count, 0);
  assert.deepEqual(none.items, []);
});

test("a glob the walker cannot honour answers 503 with the reason", async (t) => {
  const hudRoot = reviewsFixture(t);
  const hud = await serve(t, hudRoot);
  for (const glob of ["../elsewhere/*.json", "/abs/*.json", "projects//state.json", "a/./b"]) {
    writeConfig(hudRoot, { reviews: { glob } });
    const res = await hud.get("/api/reviews");
    assert.equal(res.status, 503, glob);
    const body = await res.json();
    assert.equal(body.source, "reviews");
    assert.match(body.error, /reviews\.glob in hud\.toml/);
    assert.equal(body.items, undefined);
  }
});

test("reviews routes reject non-get", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { reviews: {} });
  const before = census(hudRoot);
  const hud = await serve(t, hudRoot);

  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await hud.verb(method, "/api/reviews");
    assert.equal(res.status, 405, `${method} /api/reviews`);
  }
  // There is no mutating reviews route to reach under any name.
  for (const p of ["/api/reviews/refresh", "/api/refresh/reviews"]) {
    assert.equal((await hud.verb("POST", p)).status, 405, `POST ${p}`);
    assert.equal((await hud.verb("GET", p)).status, 404, `GET ${p}`);
  }

  // GET still works, and nothing under the root moved.
  assert.equal((await hud.get("/api/reviews")).status, 200);
  assert.deepEqual(census(hudRoot), before);
});

// -------------------------------------------------------------- the library

test("listReviews takes `now`, so elapsed_s is exact", (t) => {
  const root = reviewsFixture(t);
  const now = Date.parse(RUNNING_STARTED) + 90 * 1000;
  const { items, scanned, truncated } = listReviews(root, { now });
  assert.equal(scanned, 3);
  assert.equal(truncated, false);
  assert.equal(items[0].elapsed_s, 90);
  assert.equal(items[1].elapsed_s, 31 * 60 + 30);
  assert.equal(items[2].elapsed_s, undefined);
});

test("derived links are refused when the state cannot back them", (t) => {
  const root = fixture(t, "hud-reviews-links-", {
    "projects/p/raw/PR-1/state.json": JSON.stringify({
      repo: "https://evil.example/owner/repo",
      pr: 1,
      note: "../../outside.md",
      started: "2026-10-27T10:00:00.000Z",
      ended: "2026-10-27T10:00:05.000Z",
    }),
    "projects/p/raw/PR-2/state.json": JSON.stringify({ repo: "owner/repo", pr: "77", note: "/abs/note.md" }),
    "projects/p/raw/PR-3/state.json": JSON.stringify([1, 2, 3]),
    "projects/p/raw/PR-4/state.json": JSON.stringify({}),
  });
  const byPath = new Map(listReviews(root).items.map((i) => [i.path, i]));

  const one = byPath.get("projects/p/raw/PR-1/state.json");
  assert.equal(one.pr_url, null, "a repo that is not owner/name is not a GitHub URL");
  assert.equal(one.note_url, null, "a note path that climbs out of the tree is not a link");
  assert.equal(one.elapsed_s, 5);

  const two = byPath.get("projects/p/raw/PR-2/state.json");
  assert.equal(two.pr_url, "https://github.com/owner/repo/pull/77", "a digit-string pr is accepted");
  assert.equal(two.note_url, null, "an absolute note path is not a link");
  assert.equal(two.elapsed_s, null, "no started means no elapsed");

  const three = byPath.get("projects/p/raw/PR-3/state.json");
  assert.equal(three.unreadable, true, "a JSON array is not a state object");

  // Nothing in it at all: still a row, every optional field simply absent.
  const four = byPath.get("projects/p/raw/PR-4/state.json");
  assert.equal(four.unreadable, undefined);
  assert.equal(four.pr_url, null);
  assert.equal(four.note_url, null);
  assert.equal(four.elapsed_s, null);
});

test("the glob subset matches within a segment only", () => {
  const ok = parseReviewsGlob("projects/*/raw/PR-*/state.json");
  assert.equal(ok.error, undefined);
  assert.deepEqual(
    ok.segments.map((s) => (s.literal !== undefined ? "lit" : "re")),
    ["lit", "re", "lit", "re", "lit"],
  );
  assert.ok(ok.segments[3].re.test("PR-76409"));
  assert.ok(!ok.segments[3].re.test("PR-7/6409"), "a star never crosses a separator");
  assert.ok(!ok.segments[3].re.test("xPR-1"), "anchored at both ends");
  // Regex metacharacters in a literal are literal.
  assert.ok(parseReviewsGlob("a.b/*").segments[0].literal === "a.b");
  assert.ok(parseReviewsGlob("a.b*/x").segments[0].re.test("a.bc"));
  assert.ok(!parseReviewsGlob("a.b*/x").segments[0].re.test("aXbc"));

  for (const bad of ["", "/abs", "a//b", "a/../b", "./a", "a\\b"]) {
    assert.ok(parseReviewsGlob(bad).error, `${JSON.stringify(bad)} should be refused`);
  }
});

// --------------------------------------------------------------- the panel
//
// The builder needs a DOM, so it is not evaluated here. What is checked is
// the part that can rot silently: that the panel is wired into both paint
// paths, and that every "do" in the block is a link — out to GitHub, or into
// the tree — never a request.

test("reviews panel is wired and only links", () => {
  const html = fs.readFileSync(path.join(UI_DIR, "index.html"), "utf8");

  for (const id of ["wrap-reviews", "panel-reviews", "stamp-reviews"]) {
    assert.ok(html.includes(`id="${id}"`), `the shell declares ${id}`);
  }
  assert.match(html, /<h2>Reviews<span/, "the panel is titled Reviews");

  // Definition, ⟳, first paint. Fewer means a path that never renders it.
  assert.equal(
    (html.match(/loadReviews/g) || []).length,
    3,
    "loadReviews is defined, refreshed, and painted",
  );

  const start = html.indexOf("// ------------------------------------------------------ reviews panel");
  const end = html.indexOf("// ------------------------------------------------------ loadout panel");
  assert.ok(start !== -1 && end > start, "the reviews block is still marked, and sits before loadout");
  const block = html.slice(start, end);

  assert.match(block, /function buildReviews\b/, "the block still builds the panel");
  assert.match(block, /\.running\b/, "running rows are distinguished");
  assert.match(block, /unreadable/, "unreadable rows are rendered");
  assert.ok(!/fetch\s*\(/.test(block), "the panel makes no request of its own");
  assert.ok(!/method:/.test(block), "no verb but the page's GETs");
  // Links out go through linkOut (http(s) only, new tab, noopener); the one
  // link in goes to the tree's /n/ route and nowhere else.
  assert.ok(!/https?:\/\//.test(block), "no URL is hardcoded; every link comes from the payload");
  assert.match(block, /a\.href = url/, "the note link is a real href");
  assert.match(block, /parseRoute\(url\)/, "and it opens through the same route rule a tree click uses");

  // The loader treats 404 as panel-off and anything else as a fault worth
  // the banner — not a quiet hide, which would make a typo in the glob read
  // as "no runs".
  const loader = html.slice(html.indexOf("async function loadReviews"), html.indexOf("async function refreshAll"));
  assert.match(loader, /res\.status === 404/);
  assert.match(loader, /noteSource\("reviews", "absent"/);
});
