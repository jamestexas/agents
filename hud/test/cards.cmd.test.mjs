// The `cmd` kind, the `gh-reviews` shape, and the card they make: one local
// command's rows, a snapshot under `.generated/cards/<name>.json` that is
// served as live while it is younger than the card's refresh, `stale` when
// the command fails and a snapshot exists, 503 with the first stderr line when
// none does. The commands here are `node -e` scripts, so nothing needs `gh`.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parseRows, read, validate } from "../cards/kinds/cmd.mjs";
import { snapshotFile } from "../cards/kinds/http.mjs";
import * as ghReviews from "../cards/normalize/gh-reviews.mjs";
import { loadCards } from "../cards/registry.mjs";
import { finished, fixture, serve } from "./review-fixtures.mjs";

// ------------------------------------------------------------------ helpers

const node = (script) => [process.execPath, "-e", script];

/** A command that prints `rows` as JSON and appends a line to `count` each time it runs. */
const printing = (rows, count) =>
  node(`require("fs").appendFileSync(${JSON.stringify(count)}, "x"); process.stdout.write(${JSON.stringify(JSON.stringify(rows))})`);

const runs = (count) => (fs.existsSync(count) ? fs.readFileSync(count, "utf8").length : 0);

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

/** A row as the documented `gh api graphql --jq` filter prints it. */
const ghRow = (over = {}) => ({
  repo: "owner/repo",
  number: 7,
  title: "feat(example): reviewed",
  url: "https://github.com/owner/repo/pull/7",
  state: "OPEN",
  head: HEAD,
  updated_at: "2026-11-09T19:00:00Z",
  review: {
    state: "APPROVED",
    commit: HEAD,
    url: "https://github.com/owner/repo/pull/7#pullrequestreview-9",
    at: "2026-11-09T18:00:00Z",
  },
  ...over,
});

// ------------------------------------------------------------------ the kind

test("cmd.parseRows: a JSON array, JSON lines, nothing; anything else throws", () => {
  assert.deepEqual(parseRows('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(parseRows('{"a":1}\n\n{"a":2}\n'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(parseRows("  \n"), []);
  assert.throws(() => parseRows("not json"), /not a JSON array or JSON lines/);
});

test("cmd.validate: an argv list is kept, a string is split like the digest's; nothing to run is refused", () => {
  const list = {};
  assert.equal(validate({ cmd: ["gh", "api", "graphql"] }, list), null);
  assert.deepEqual(list.cmd, ["gh", "api", "graphql"]);
  const str = {};
  assert.equal(validate({ cmd: 'example-digest --since "24 h"' }, str), null);
  assert.deepEqual(str.cmd, ["example-digest", "--since", "24 h"]);
  for (const cmd of ["   ", [], ["gh", ""], [1]]) {
    assert.equal(validate({ cmd }, {}).field, "cmd", JSON.stringify(cmd));
  }
});

test("cmd.read: runs once, snapshots the rows, and serves the snapshot as live inside the refresh window", async (t) => {
  const hudRoot = fixture(t, "hud-cmd-", {});
  const count = path.join(hudRoot, "count");
  const card = { name: "my-reviews", cmd: printing([{ a: 1 }], count), refresh: 60 };
  const t0 = Date.parse("2026-11-09T20:00:00Z");

  const first = await read(card, { hudRoot, now: t0 });
  assert.equal(first.stale, false);
  assert.deepEqual(first.rows, [{ a: 1 }]);
  assert.equal(runs(count), 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(snapshotFile(hudRoot, "my-reviews"), "utf8")).data, [{ a: 1 }]);

  // Inside the window: the snapshot answers and the command does not run.
  const cachedAt = Date.parse(first.cached_at);
  const again = await read(card, { hudRoot, now: cachedAt + 59_000 });
  assert.equal(again.stale, false);
  assert.deepEqual(again.rows, [{ a: 1 }]);
  assert.equal(runs(count), 1, "a fresh snapshot is not a reason to spend the command again");

  // Past it: the command runs again.
  await read(card, { hudRoot, now: cachedAt + 61_000 });
  assert.equal(runs(count), 2);
});

test("cmd.read: concurrent reads past the window share one run", async (t) => {
  const hudRoot = fixture(t, "hud-cmd-", {});
  const count = path.join(hudRoot, "count");
  const card = { name: "shared", cmd: printing([{ a: 1 }], count) };
  const got = await Promise.all([read(card, { hudRoot }), read(card, { hudRoot }), read(card, { hudRoot })]);
  assert.ok(got.every((r) => r.stale === false && r.rows.length === 1));
  assert.equal(runs(count), 1);
});

test("cmd.read: a failure with no snapshot is the first stderr line, and writes nothing", async (t) => {
  const hudRoot = fixture(t, "hud-cmd-", {});
  const card = { name: "broken", cmd: node('process.stderr.write("\\ngh: HTTP 401: Bad credentials\\nmore\\n"); process.exit(1)') };
  const got = await read(card, { hudRoot });
  assert.deepEqual(got, { stale: true, cached_at: null, error: "gh: HTTP 401: Bad credentials" });
  assert.equal(fs.existsSync(snapshotFile(hudRoot, "broken")), false);
});

test("cmd.read: bad output or a failure with a snapshot serves the snapshot stale", async (t) => {
  const hudRoot = fixture(t, "hud-cmd-", {});
  const file = snapshotFile(hudRoot, "flaky");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cached_at: "2026-11-01T00:00:00.000Z", data: [{ a: 1 }] }));

  const bad = await read({ name: "flaky", cmd: node('process.stdout.write("not json")') }, { hudRoot });
  assert.equal(bad.stale, true);
  assert.deepEqual(bad.rows, [{ a: 1 }]);
  assert.equal(bad.cached_at, "2026-11-01T00:00:00.000Z");
  assert.match(bad.error, /not a JSON array/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).data, [{ a: 1 }], "a failure never overwrites the snapshot");
});

test("cmd.read: the command runs from the tree's root with HUD_ROOT set", async (t) => {
  const hudRoot = fixture(t, "hud-cmd-", {});
  const card = { name: "where", cmd: node('process.stdout.write(JSON.stringify([{cwd: process.cwd(), root: process.env.HUD_ROOT}]))') };
  const [row] = (await read(card, { hudRoot })).rows;
  assert.equal(fs.realpathSync(row.cwd), fs.realpathSync(hudRoot));
  assert.equal(row.root, hudRoot);
});

test("registry: a cmd card is served in either form; a cmd with an empty argument is misconfigured", () => {
  const { cards, errors } = loadCards(
    {
      cards: {
        "my-reviews": { kind: "cmd", cmd: ["gh", "api", "graphql"], shape: "gh-reviews", key: "pr_url" },
        "as-string": { kind: "cmd", cmd: "gh api graphql", shape: "gh-reviews" },
        "empty-arg": { kind: "cmd", cmd: ["gh", ""], shape: "gh-reviews" },
      },
    },
    { hudRoot: "/tmp/hud" },
  );
  assert.equal(cards.get("my-reviews").error, undefined);
  assert.deepEqual(cards.get("my-reviews").columns, [...ghReviews.COLUMNS]);
  assert.deepEqual(cards.get("as-string").cmd, ["gh", "api", "graphql"]);
  assert.match(cards.get("empty-arg").error, /cmd must be a command string or a non-empty list/);
  assert.equal(errors.length, 1);
});

// ------------------------------------------------------------------ the shape

test("gh-reviews.normalize: the status follows the review's commit against the head", () => {
  const status = (over) => {
    const item = ghReviews.normalize(ghRow(over));
    return [item.state, item.reason];
  };
  assert.deepEqual(status({}), ["done", "approved at head"]);
  assert.deepEqual(status({ review: { ...ghRow().review, commit: OLD } }), ["needs_you", "head moved since your approval"]);
  assert.deepEqual(status({ review: { ...ghRow().review, state: "COMMENTED" } }), ["waiting", "your comment stands at head"]);
  assert.deepEqual(
    status({ review: { ...ghRow().review, state: "CHANGES_REQUESTED", commit: OLD } }),
    ["needs_you", "head moved since your change request"],
  );
  assert.deepEqual(status({ review: null }), ["needs_you", "no review of yours on GitHub"]);
  assert.deepEqual(status({ state: "MERGED", review: { ...ghRow().review, commit: OLD } }), ["done", "merged"]);
  assert.deepEqual(status({ state: "CLOSED" }), ["done", "closed"]);
});

test("gh-reviews.normalize: posted and mine carry a run's field names; unknown keys and states are dropped", () => {
  const item = ghReviews.normalize(ghRow({ extra: "x", review: { ...ghRow().review, commit: OLD, extra: "x" } }));
  assert.equal(item.pr_url, "https://github.com/owner/repo/pull/7");
  assert.equal(item.number, 7);
  assert.equal(item.pr_state, "OPEN");
  assert.deepEqual(item.posted, {
    url: "https://github.com/owner/repo/pull/7#pullrequestreview-9",
    state: "APPROVED",
    at: "2026-11-09T18:00:00Z",
  });
  assert.deepEqual(item.review_state, { mine: { state: "APPROVED", at: "2026-11-09T18:00:00Z", head_matches: false } });
  assert.ok(!JSON.stringify(item).includes('"extra"'));

  const pending = ghReviews.normalize(ghRow({ review: { state: "PENDING", commit: HEAD } }));
  assert.equal(pending.posted, null, "a pending review is not posted");
  assert.deepEqual(pending.review_state, { mine: null });

  assert.equal(ghReviews.normalize(ghRow({ repo: undefined, number: undefined, url: "https://example.com/x" })), null);
  assert.equal(ghReviews.normalize("not a row"), null);
});

test("gh-reviews: open scope keeps open PRs; needs_you sorts first, open before merged, then most recently updated", () => {
  const items = [
    ghRow({ number: 1, url: "https://github.com/owner/repo/pull/1", updated_at: "2026-11-09T10:00:00Z" }),
    ghRow({ number: 2, url: "https://github.com/owner/repo/pull/2", state: "MERGED" }),
    ghRow({ number: 3, url: "https://github.com/owner/repo/pull/3", review: { ...ghRow().review, commit: OLD } }),
    ghRow({ number: 4, url: "https://github.com/owner/repo/pull/4", updated_at: "2026-11-09T12:00:00Z" }),
  ].map((r) => ghReviews.normalize(r));
  assert.deepEqual(items.filter((i) => ghReviews.inScope(i, "open")).map((i) => i.number), [1, 3, 4]);
  assert.deepEqual([...items].sort(ghReviews.compare).map((i) => i.number), [3, 4, 1, 2]);
});

// ------------------------------------------------------------------ the card

test("GET /api/card/my-reviews: GitHub's rows with the local run joined; a PR with no run still has a row", async (t) => {
  const hudRoot = fixture(t, "hud-cmd-", {
    "projects/example-two/prs/PR-7/raw/state.json": JSON.stringify({ ...finished, posted: null }),
  });
  const rows = [
    ghRow(),
    ghRow({ number: 8, url: "https://github.com/owner/repo/pull/8", review: { ...ghRow().review, commit: OLD } }),
  ];
  const count = path.join(hudRoot, "count");
  fs.writeFileSync(
    path.join(hudRoot, "hud.config.json"),
    JSON.stringify({
      cards: {
        reviews: { kind: "fs", glob: "projects/*/prs/PR-*/raw/state.json", shape: "review-state", key: "pr_url" },
        "my-reviews": {
          kind: "cmd",
          cmd: printing(rows, count),
          shape: "gh-reviews",
          key: "pr_url",
          scope: "all",
          join: { reviews: { latest: "started" } },
        },
      },
    }),
  );
  const hud = await serve(t, hudRoot);

  const res = await hud.get("/api/card/my-reviews");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, "cmd");
  assert.equal(body.stale, false);
  assert.deepEqual(body.joins, { reviews: "ok" });
  const [moved, approved] = body.items;
  assert.equal(moved.number, 8, "needs_you first");
  assert.equal(moved.state, "needs_you");
  assert.equal("reviews" in moved, false, "no local run: the row stands on GitHub's facts alone");
  assert.equal(approved.number, 7);
  assert.equal(approved.posted.state, "APPROVED", "GitHub's post, though the run recorded none");
  assert.equal(approved.reviews.verdict, "APPROVE");
  assert.equal(approved.reviews.posted, null);

  await hud.get("/api/card/my-reviews");
  assert.equal(runs(count), 1, "a second request inside the refresh window does not run the command");
});
