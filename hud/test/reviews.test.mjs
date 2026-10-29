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
import http from "node:http";
import path from "node:path";

import {
  DEFAULT_REVIEWS_GLOB,
  joinReviews,
  listReviews,
  parseReviewsGlob,
} from "../server.mjs";
import {
  EXTRA_CANARY,
  REVIEW_STATE_SERVED,
  RUNNING_FOR_S,
  RUNNING_STARTED,
  UI_DIR,
  atMin,
  census,
  finished,
  fixture,
  paths,
  reviewsFixture,
  running,
  serve,
  writeConfig,
} from "./review-fixtures.mjs";

// ------------------------------------------------------------------ helpers

/** A stub board upstream answering every path with `body` as JSON. */
async function boardUpstream(t, body) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/board`;
}

/** A URL nothing is listening on: bind an ephemeral port, then release it. */
async function deadUrl() {
  const probe = http.createServer(() => {});
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return `http://127.0.0.1:${port}/api/board`;
}


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
  // `phases` is rebuilt field by field, and each timed phase gets its seconds;
  // the open phase is measured to now.
  assert.deepEqual(run.phases, {
    evidence: { started: RUNNING_STARTED, ended: atMin(1) },
    questions: { started: atMin(1), ended: atMin(5) },
    settle: { started: atMin(5), ended: atMin(12) },
    refute: { started: atMin(12), ended: null },
  });
  assert.deepEqual(Object.keys(run.phase_seconds), ["evidence", "questions", "settle", "refute"]);
  assert.equal(run.phase_seconds.evidence, 60);
  assert.equal(run.phase_seconds.questions, 240);
  assert.equal(run.phase_seconds.settle, 420);
  assert.ok(
    run.phase_seconds.refute >= 10 * 60 - 2 && run.phase_seconds.refute <= 10 * 60 + 120,
    `refute ${run.phase_seconds.refute} is not about ${10 * 60}`,
  );
  // A backfilled run has `phases: {}` and so no timings — an empty object,
  // not a missing key, so the page can tell "untimed" from "unreadable".
  assert.deepEqual(done.phases, {});
  assert.deepEqual(done.phase_seconds, {});
  // The early signal is served as a count plus the lines the page could
  // show; an entry of the wrong shape is neither counted nor shown.
  assert.deepEqual(run.early, {
    count: 2,
    items: [
      { row: 1, title: "build broken by new import", basis: "probe-failed:go-graph/build" },
      { row: 3, title: "signature verified after parse", basis: "blocking-ran" },
    ],
  });
  assert.equal(done.early, undefined, "a state file without the key serves none");

  assert.equal(done.project, "example-two");
  assert.equal(done.running, false);
  assert.equal(done.elapsed_s, 31 * 60 + 30, "ended − started, not now − started");
  assert.equal(done.pr_url, "https://github.com/owner/repo/pull/7");
  assert.equal(done.note_url, "/n/projects/example-two/notes/PR-7-finished");
  assert.deepEqual(done.posted, finished.posted);
  assert.equal(done.verdict, "APPROVE");
  // `review_state` is passed through whole, field by field: an unknown key at
  // any depth, and a reviewer entry that is not an object with a login, are
  // dropped on the way.
  assert.deepEqual(done.review_state, REVIEW_STATE_SERVED);
  // A state file without the block serves no block — not an empty one.
  assert.equal(run.review_state, undefined);

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

test("phase_seconds: ended − started per phase, now for the open one, fractional seconds parsed, junk dropped", (t) => {
  const root = fixture(t, "hud-reviews-phases-", {
    // Every phase closed, each stamp carrying fractional seconds as a
    // high-resolution clock writes them.
    "projects/p/raw/PR-1/state.json": JSON.stringify({
      started: "2026-10-27T10:00:00.250Z",
      ended: "2026-10-27T10:31:42.250Z",
      phases: {
        evidence: { started: "2026-10-27T10:00:00.250Z", ended: "2026-10-27T10:01:54.250Z" },
        questions: { started: "2026-10-27T10:01:54.250Z", ended: "2026-10-27T10:05:54.250Z" },
        settle: { started: "2026-10-27T10:05:54.250Z", ended: "2026-10-27T10:12:48.250Z" },
        refute: { started: "2026-10-27T10:12:48.250Z", ended: "2026-10-27T10:23:42.250Z" },
        triage: { started: "2026-10-27T10:23:42.250Z", ended: "2026-10-27T10:27:54.250Z" },
        teach: { started: "2026-10-27T10:27:54.250Z", ended: "2026-10-27T10:31:42.250Z" },
        // no `started`: not a timing
        rendered: { ended: "2026-10-27T10:31:42.250Z" },
        // not an object: dropped
        posted: "2026-10-27T10:32:00.000Z",
      },
    }),
    // Still running: the open phase is measured against the clock passed in.
    "projects/p/raw/PR-2/state.json": JSON.stringify({
      started: "2026-10-27T11:00:00.000Z",
      ended: null,
      phases: {
        evidence: { started: "2026-10-27T11:00:00.000Z", ended: "2026-10-27T11:01:30.000Z" },
        questions: { started: "2026-10-27T11:01:30.000Z", ended: null },
      },
    }),
    // Backfilled: no phases recorded.
    "projects/p/raw/PR-3/state.json": JSON.stringify({
      started: "2026-10-27T12:00:00.000Z",
      ended: "2026-10-27T12:10:00.000Z",
      phases: {},
    }),
    // `phases` not an object at all: no key served, no timings.
    "projects/p/raw/PR-4/state.json": JSON.stringify({
      started: "2026-10-27T12:00:00.000Z",
      ended: "2026-10-27T12:10:00.000Z",
      phases: ["evidence"],
    }),
  });
  const now = Date.parse("2026-10-27T11:05:30.000Z");
  const byPath = new Map(listReviews(root, { now }).items.map((i) => [i.path, i]));

  const full = byPath.get("projects/p/raw/PR-1/state.json");
  assert.deepEqual(full.phase_seconds, {
    evidence: 114,
    questions: 240,
    settle: 414,
    refute: 654,
    triage: 252,
    teach: 228,
  });
  assert.deepEqual(Object.keys(full.phases), ["evidence", "questions", "settle", "refute", "triage", "teach"]);
  assert.deepEqual(full.phases.evidence, { started: "2026-10-27T10:00:00.250Z", ended: "2026-10-27T10:01:54.250Z" });

  const open = byPath.get("projects/p/raw/PR-2/state.json");
  assert.deepEqual(open.phase_seconds, { evidence: 90, questions: 240 }, "the open phase runs to `now`");
  assert.equal(open.phases.questions.ended, null);

  assert.deepEqual(byPath.get("projects/p/raw/PR-3/state.json").phase_seconds, {});
  assert.deepEqual(byPath.get("projects/p/raw/PR-3/state.json").phases, {});

  const junk = byPath.get("projects/p/raw/PR-4/state.json");
  assert.equal(junk.phases, undefined, "a phases value that is not an object is not served");
  assert.deepEqual(junk.phase_seconds, {});
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

test("review_state is kept only in the shape the panel reads", (t) => {
  const at = { started: "2026-10-27T10:00:00.000Z", ended: "2026-10-27T10:00:05.000Z" };
  const root = fixture(t, "hud-reviews-state-", {
    // Not an object at all: dropped.
    "projects/p/raw/PR-1/state.json": JSON.stringify({ ...at, review_state: ["APPROVED"] }),
    // Every field the wrong type: each one is nulled or dropped, and a block
    // left with nothing in it is no block.
    "projects/p/raw/PR-2/state.json": JSON.stringify({
      ...at,
      review_state: { authorship: "theirs", humans: "none", bots: 3, threads: "two", mine: "APPROVED" },
    }),
    // Mixed: a state outside the vocabulary, a non-integer count, a bot with
    // no findings number.
    "projects/p/raw/PR-3/state.json": JSON.stringify({
      ...at,
      review_state: {
        authorship: "own",
        mine: { state: "DISMISSED", at: null, head_matches: "yes" },
        humans: [],
        bots: [{ login: "bot-two", state: "COMMENTED", findings: "many", at: "2026-10-27T09:10:00.000Z" }],
        threads: { total: 1, unresolved: 0.5, awaiting_me: 0, awaiting_author: "1" },
      },
    }),
  });
  const byPath = new Map(listReviews(root).items.map((i) => [i.path, i]));

  assert.equal(byPath.get("projects/p/raw/PR-1/state.json").review_state, undefined);
  assert.equal(byPath.get("projects/p/raw/PR-2/state.json").review_state, undefined);
  assert.deepEqual(byPath.get("projects/p/raw/PR-3/state.json").review_state, {
    authorship: "own",
    mine: { state: null, at: null, head_matches: null },
    humans: [],
    bots: [{ login: "bot-two", state: "COMMENTED", at: "2026-10-27T09:10:00.000Z", findings: null }],
    threads: { total: 1, awaiting_me: 0 },
  });
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
  assert.match(html, /<h2>Review runs<span class="sub">in flight or not yet posted<\/span><span/, "the panel is titled Review runs, with its subtitle");

  // Reviews is the first panel in the aside: a run in flight is what the
  // reader checks on, so it sits above the board and the activity feed.
  const aside = html.slice(html.indexOf("<aside>"), html.indexOf("</aside>"));
  const firstPanel = aside.indexOf('class="panel"');
  assert.ok(firstPanel !== -1, "the aside holds panels");
  assert.equal(
    aside.slice(firstPanel, aside.indexOf(">", firstPanel)).includes('id="wrap-reviews"'),
    true,
    "reviews is the first panel in the aside",
  );
  for (const id of ["wrap-board", "wrap-digest", "wrap-sessions", "wrap-loadout", "wrap-peers"]) {
    assert.ok(aside.indexOf(`id="${id}"`) > aside.indexOf('id="wrap-reviews"'), `${id} comes after reviews`);
  }

  // Panel bodies scroll inside the panel rather than growing the column; the
  // heading is outside the body, so it stays visible while the body scrolls.
  const bodyAt = html.indexOf(".panel > .body {");
  const bodyRule = html.slice(bodyAt, html.indexOf("}", bodyAt));
  assert.match(bodyRule, /max-height:\s*\d+vh/, "every panel body has a viewport-relative cap");
  assert.match(bodyRule, /overflow:\s*auto/, "and scrolls within it");
  assert.match(
    html,
    /#wrap-reviews > \.body \{\s*max-height:\s*\d+vh/,
    "the reviews body is sized separately",
  );
  assert.match(
    html,
    /<h2>Review runs<span[^]*?<div class="body" id="panel-reviews">/,
    "the heading sits outside the scrolling body",
  );

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
  // The four who-waits-on-whom columns are declared, by id, after verdict.
  const columnsAt = block.indexOf("const REVIEW_COLUMNS");
  const columns = block.slice(columnsAt, block.indexOf("];", columnsAt));
  const ids = [...columns.matchAll(/\["([a-z]+)",/g)].map((m) => m[1]);
  const verdictAt = ids.indexOf("verdict");
  assert.ok(verdictAt !== -1, "verdict is a column");
  assert.deepEqual(ids.slice(verdictAt + 1, verdictAt + 5), ["mine", "humans", "bots", "threads"]);
  // Where the time went sits beside where the run is.
  assert.deepEqual(ids.slice(verdictAt - 2, verdictAt), ["phase", "phases"]);
  assert.match(block, /function phasesCell\b/, "the block renders per-phase minutes");
  assert.match(block, /phase_seconds/, "from the server's derived seconds");
  assert.match(block, /ended == null/, "the open phase is told apart by its missing end");
  assert.match(block, /function phaseMedians\b/, "and a median per phase across the loaded runs");
  assert.match(block, /median per phase across /, "named as such under the table");
  assert.match(block, /\.toFixed\(1\)/, "minutes to one decimal");
  // The early signal sits beside the findings it anticipates, and only
  // while the run is in flight.
  assert.deepEqual(ids.slice(ids.indexOf("early"), ids.indexOf("early") + 2), ["early", "findings"]);
  assert.match(block, /function earlyCell\b/);
  assert.match(block, /r\.running && r\.early/, "a finished row shows nothing here");
  assert.match(block, /e\.count > 0 \? " hot"/, "lit when there is one");
  // A --fast run's PRELIMINARY verdict is muted and says why, in both tables.
  const verdictFn = block.slice(block.indexOf("function verdictCell("), block.indexOf("function noteCell("));
  assert.match(verdictFn, /verdict === "PRELIMINARY" \? "fast run, unrefuted"/, "the tooltip names the run kind");
  assert.match(verdictFn, /"verdict v-" \+ String\(verdict \|\| "none"\)\.toLowerCase\(\)/, "the class is the verdict, lowercased");
  const cssAt = html.indexOf(".prgrid .v-preliminary {");
  assert.ok(cssAt !== -1, "v-preliminary has a style");
  assert.match(html.slice(cssAt, html.indexOf("}", cssAt)), /color:\s*var\(--muted\)/, "in the muted colour");
  assert.match(block, /function reviewStateCells\b/, "the block renders the review_state block");
  assert.match(block, /head_matches === false/, "a review behind the head is marked");
  assert.match(block, /awaiting_me > 0/, "a thread waiting on the reader is highlighted");
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
  assert.match(loader, /\/api\/reviews\?scope=open/, "the panel shows runs in flight or not yet posted");
});

// ------------------------------------------------- joined onto the board
//
// A board row and a run name the same PR. With both sources on, the board
// row carries the run's answer; the board's own contract — passthrough,
// snapshot, degradation — is otherwise untouched.

/** A board as the upstream sends it: three PRs and one issue, mixed shapes. */
const board = {
  generated_at: "2026-10-27T11:00:00.000Z",
  items: [
    // Named by repo + number: the finished, posted run.
    {
      kind: "pr",
      repo: "owner/repo",
      number: 7,
      title: "feat(example): finished and posted",
      state: "active",
      reason: "approved",
      url: "https://github.com/owner/repo/pull/7",
    },
    // Named by URL only: the running run.
    {
      number: 101,
      title: "fix(example): still running",
      state: "needs_you",
      reason: "changes requested",
      url: "https://github.com/owner/repo/pull/101/files?diff=unified",
    },
    // A PR no run has seen.
    {
      kind: "pr",
      repo: "owner/repo",
      number: 55,
      title: "chore(example): never reviewed",
      state: "opened",
      reason: "",
      url: "https://github.com/owner/repo/pull/55",
    },
    // An issue sharing a run's number: not a PR, so not joined.
    {
      kind: "issue",
      repo: "owner/repo",
      number: 7,
      title: "bug report",
      state: "active",
      reason: "",
      url: "https://github.com/owner/repo/issues/7",
    },
  ],
};

/** Exactly what the finished run contributes to its board row, key for key. */
const REVIEW_OF_FINISHED = {
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
};

test("board rows carry their latest review run when both sources are on", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { board: { url: await boardUpstream(t, board) }, reviews: {} });
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/dyn/board");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, "board");
  assert.equal(body.stale, false);

  const [posted, running, unseen, issue] = body.data.items;
  assert.deepEqual(posted.review, REVIEW_OF_FINISHED, "the whitelisted shape, nothing else");
  assert.deepEqual(Object.keys(posted.review).sort(), [
    "elapsed_s", "findings", "gates", "note_url", "phase", "posted", "probes", "review_state", "running", "verdict",
  ]);
  // The row's own fields are untouched by the join.
  assert.deepEqual({ ...posted, review: undefined }, { ...board.items[0], review: undefined });

  // Keyed from the URL alone, path tail and query ignored.
  assert.equal(running.review.running, true);
  assert.equal(running.review.phase, "refute");
  assert.equal(running.review.verdict, null);
  assert.equal(running.review.posted, null);
  assert.equal(running.review.review_state, null, "a run without the block says so with null");
  assert.deepEqual(running.review.probes, { unavailable: 1 });
  assert.equal(running.review.note_url, "/n/projects/example-one/notes/PR-101-still-running");
  assert.ok(Number.isInteger(running.review.elapsed_s) && running.review.elapsed_s >= RUNNING_FOR_S - 2);

  assert.equal("review" in unseen, false, "a PR with no run has no review key, not a null one");
  assert.equal("review" in issue, false, "an issue is never joined, whatever its number");
  assert.equal(body.data.generated_at, board.generated_at, "the envelope around the rows is kept");

  // The snapshot is the upstream's own bytes: the join is never cached.
  const snap = JSON.parse(fs.readFileSync(path.join(hudRoot, ".generated", "cards", "board.json"), "utf8"));
  assert.deepEqual(snap.data, board);
  assert.ok(!JSON.stringify(snap).includes("note_url"));
});

test("a board without a reviews source is passed through unchanged", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { board: { url: await boardUpstream(t, board) } });
  const hud = await serve(t, hudRoot);
  const body = await (await hud.get("/api/dyn/board")).json();
  assert.deepEqual(body.data, board);
});

test("an unreachable board is not joined: stale snapshot or 503, as before", async (t) => {
  const hudRoot = reviewsFixture(t);
  writeConfig(hudRoot, { board: { url: await deadUrl() }, reviews: {} });
  const hud = await serve(t, hudRoot);

  // No snapshot: the 503 the ladder always gave.
  const down = await hud.get("/api/dyn/board");
  assert.equal(down.status, 503);
  const downBody = await down.json();
  assert.equal(downBody.source, "board");
  assert.equal(downBody.data, undefined);

  // A snapshot holding a row a run would match: served stale, and the row
  // comes back exactly as cached — no review on it.
  const cached = { items: [board.items[0]] };
  fs.mkdirSync(path.join(hudRoot, ".generated"), { recursive: true });
  fs.writeFileSync(
    path.join(hudRoot, ".generated", "board.json"),
    JSON.stringify({ cached_at: "2026-10-27T09:00:00.000Z", data: cached }),
  );
  const stale = await hud.get("/api/dyn/board");
  assert.equal(stale.status, 200);
  const staleBody = await stale.json();
  assert.equal(staleBody.stale, true);
  assert.deepEqual(staleBody.data, cached);
  assert.equal("review" in staleBody.data.items[0], false);
});

test("a reviews fault leaves a live board as the upstream sent it", async (t) => {
  const hudRoot = reviewsFixture(t);
  // A glob the walker refuses: /api/reviews is a 503, and the board is still
  // a 200 with no join rather than a fault of its own.
  writeConfig(hudRoot, { board: { url: await boardUpstream(t, board) }, reviews: { glob: "../x/*.json" } });
  const hud = await serve(t, hudRoot);
  assert.equal((await hud.get("/api/reviews")).status, 503);
  const res = await hud.get("/api/dyn/board");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.stale, false);
  assert.deepEqual(body.data, board);
});

test("joinReviews keys on repo+number, else a GitHub pull URL, in any accepted payload shape", (t) => {
  const root = reviewsFixture(t);
  const runs = listReviews(root).items;
  const rows = [
    { repo: "owner/repo", number: 7 },
    { url: "https://github.com/owner/repo/pull/7" },
    { url: "http://github.com/owner/repo/pull/7" },
    { url: "https://example.invalid/owner/repo/pull/7" },
    { url: "https://github.com/owner/repo/pull/7x" },
    { url: "https://github.com/owner/repo/issues/7" },
    { repo: "owner/repo", number: "7" },
    { repo: "https://github.com/owner/repo", number: 7 },
    { kind: "event", title: "stand-up" },
    "not a row",
    null,
  ];
  const joined = joinReviews(rows, runs);
  assert.deepEqual(
    joined.map((r) => Boolean(r && r.review)),
    [true, true, false, false, false, false, true, false, false, false, false],
  );
  assert.notEqual(joined, rows, "a new array, not the upstream's mutated");
  assert.equal("review" in rows[0], false);

  // The two wrapper keys the page accepts, and a payload that is neither.
  assert.deepEqual(Object.keys(joinReviews({ prs: rows.slice(0, 1), x: 1 }, runs)), ["prs", "x"]);
  assert.equal(joinReviews({ prs: rows.slice(0, 1) }, runs).prs[0].review.verdict, "APPROVE");
  assert.equal(joinReviews({ items: rows.slice(0, 1) }, runs).items[0].review.verdict, "APPROVE");
  const odd = { rows: rows.slice(0, 1) };
  assert.equal(joinReviews(odd, runs), odd, "an unknown shape is returned as is");
  assert.equal(joinReviews("junk", runs), "junk");
  assert.equal(joinReviews(rows, []), rows, "no runs means no copy either");
});

test("the latest run per PR wins the join", (t) => {
  const older = { ...finished, started: "2026-10-26T10:00:00.000Z", ended: "2026-10-26T10:10:00.000Z", verdict: "COMMENT" };
  const root = fixture(t, "hud-reviews-latest-", {
    "projects/a/raw/PR-7/state.json": JSON.stringify(older),
    "projects/b/raw/PR-7/state.json": JSON.stringify(finished),
    "projects/c/raw/PR-7/state.json": "not json",
  });
  const [row] = joinReviews([{ repo: "owner/repo", number: 7 }], listReviews(root).items);
  assert.equal(row.review.verdict, "APPROVE", "newest started wins over an older run of the same PR");
});

// ------------------------------------------------------------------ scope

test("?scope=open keeps runs in flight or not yet posted; all keeps every run", async (t) => {
  const hudRoot = reviewsFixture(t);
  // A finished run that never posted stays open; a finished, posted one does not.
  fs.mkdirSync(path.join(hudRoot, "projects/example-two/raw/PR-8"), { recursive: true });
  fs.writeFileSync(
    path.join(hudRoot, "projects/example-two/raw/PR-8/state.json"),
    JSON.stringify({ ...finished, pr: 8, posted: null, started: "2026-10-27T12:00:00.000Z", ended: "2026-10-27T12:05:00.000Z" }),
  );
  writeConfig(hudRoot, { reviews: {} });
  const hud = await serve(t, hudRoot);

  const open = await (await hud.get("/api/reviews?scope=open")).json();
  assert.equal(open.scope, "open");
  assert.equal(open.count, 3);
  assert.equal(open.truncated, false);
  assert.deepEqual(paths(open), [
    "projects/example-one/raw/PR-101/state.json",
    "projects/example-two/raw/PR-8/state.json",
    "projects/example-one/raw/PR-9/state.json",
  ]);

  const all = await (await hud.get("/api/reviews?scope=all")).json();
  assert.equal(all.scope, "all");
  assert.equal(all.count, 4);
  assert.ok(paths(all).includes("projects/example-two/raw/PR-7/state.json"));

  const bare = await (await hud.get("/api/reviews")).json();
  assert.equal(bare.scope, "all", "no query is today's answer");
  assert.deepEqual(paths(bare), paths(all));

  const bad = await hud.get("/api/reviews?scope=posted");
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /scope must be one of/);
});

test("MY PRS declares the review columns after its own", () => {
  const html = fs.readFileSync(path.join(UI_DIR, "index.html"), "utf8");
  const at = html.indexOf("const BOARD_COLUMNS");
  assert.ok(at !== -1, "the board declares its columns");
  const columns = html.slice(at, html.indexOf("];", at));
  const ids = [...columns.matchAll(/\["([a-z]+)",/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["pr", "title", "why", "verdict", "gates", "note", "posted", "threads"]);

  const start = html.indexOf("function boardRow(");
  const block = html.slice(start, html.indexOf("function setDial("));
  assert.match(block, /gridNode\(BOARD_COLUMNS/, "the board is the same grid the runs are");
  for (const fn of ["verdictCell", "gatesNode", "noteCell", "postedCell", "threadsCell"]) {
    assert.match(block, new RegExp(`\\b${fn}\\(`), `${fn} is shared with the runs panel`);
  }
  assert.match(block, /item\.review/, "the cells read the joined block");
  assert.ok(!/fetch\s*\(/.test(block), "the board makes no request of its own");
  assert.ok(!/https?:\/\//.test(block), "no URL is hardcoded");
  // Both tables share one style, so a verdict reads the same in each.
  assert.match(html, /function gridNode\(/);
  assert.match(html, /node\("div", "prgrid"\)/);
  assert.ok(!/\.reviews\s*\{/.test(html), "the old reviews-only table style is gone");
});
