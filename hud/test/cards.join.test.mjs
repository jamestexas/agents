// Keys and joins: the one function per key, and the best-effort join that
// attaches another card's row on it.
//
// A key is a derived field, never raw input: `prUrl` refuses anything that is
// not the canonical GitHub pull-request URL, so two cards that both declare
// `key = "pr_url"` can only ever meet on the same string.

import { test } from "node:test";
import assert from "node:assert/strict";

import { KEYS, prUrl } from "../cards/keys.mjs";
import { joinRows } from "../cards/join.mjs";

// -------------------------------------------------------------------- keys

test("prUrl: the canonical URL from repo + number, else from a GitHub pull URL, else null", () => {
  const canon = "https://github.com/owner/repo/pull/7";
  const table = [
    [{ repo: "owner/repo", number: 7 }, canon],
    [{ repo: "owner/repo", number: "7" }, canon, "a digit string is a number"],
    [{ repo: "owner/repo", number: 7, url: "https://example.invalid/elsewhere" }, canon, "repo + number win over the url"],
    [{ url: "https://github.com/owner/repo/pull/7" }, canon],
    [{ url: "https://github.com/owner/repo/pull/7/files?diff=unified#top" }, canon, "path tail, query and fragment are ignored"],
    [{ url: "https://github.com/owner/repo/pull/7#pullrequestreview-1" }, canon],
    [{ url: "http://github.com/owner/repo/pull/7" }, null, "http is not the canonical scheme"],
    [{ url: "https://example.invalid/owner/repo/pull/7" }, null, "not GitHub"],
    [{ url: "https://github.com/owner/repo/pull/7x" }, null],
    [{ url: "https://github.com/owner/repo/issues/7" }, null, "an issue is not a pull"],
    [{ url: "https://github.com/owner/pull/7" }, null, "no repo"],
    [{ url: "not a url" }, null],
    [{ repo: "https://github.com/owner/repo", number: 7 }, null, "a repo that is not owner/name"],
    [{ repo: "owner/repo", number: 0 }, null],
    [{ repo: "owner/repo", number: -1 }, null],
    [{ repo: "owner/repo", number: 7.5 }, null, "not an integer"],
    [{ repo: "owner/repo", number: "seven" }, null],
    [{ repo: "owner/repo" }, null, "no number and no url"],
    [{}, null],
    [undefined, null],
    [null, null],
  ];
  for (const [input, want, why] of table) {
    assert.equal(prUrl(input), want, why ?? JSON.stringify(input));
  }
  assert.deepEqual(Object.keys(KEYS), ["pr_url"], "one key exists today");
  assert.equal(KEYS.pr_url({ repo: "owner/repo", number: 7 }), canon);
});

// ------------------------------------------------------------------- joins

const runs = [
  { pr_url: "https://github.com/owner/repo/pull/7", started: "2026-10-26T10:00:00.000Z", verdict: "COMMENT", secret: "x" },
  { pr_url: "https://github.com/owner/repo/pull/7", started: "2026-10-27T10:00:00.000Z", verdict: "APPROVE", secret: "y" },
  { pr_url: "https://github.com/owner/repo/pull/101", started: "2026-10-27T12:00:00.000Z", verdict: null },
  { unreadable: true, path: "p/raw/PR-9/state.json" },
  { pr_url: null, started: "2026-10-27T13:00:00.000Z" },
  "not a row",
];

const rows = [
  { pr_url: "https://github.com/owner/repo/pull/7", title: "seven" },
  { pr_url: "https://github.com/owner/repo/pull/101", title: "one-oh-one" },
  { pr_url: "https://github.com/owner/repo/pull/55", title: "never reviewed" },
  { title: "no key at all" },
  { pr_url: 7, title: "a key that is not a string" },
];

test("joinRows attaches the newest B row by `latest` under `into`; no match means no field", () => {
  const { rows: out, status } = joinRows(rows, runs, { key: "pr_url", latest: "started", into: "review" });
  assert.equal(status, "ok");
  assert.notEqual(out, rows, "a new array");
  assert.equal("review" in rows[0], false, "the input rows are not mutated");

  assert.equal(out[0].review.verdict, "APPROVE", "the newer of two runs for one PR");
  assert.equal(out[1].review.verdict, null);
  assert.equal("review" in out[2], false, "no run: no key, not a null one");
  assert.equal("review" in out[3], false, "a row without the key is never joined");
  assert.equal("review" in out[4], false);
  assert.deepEqual({ ...out[0], review: undefined }, { ...rows[0], review: undefined }, "the row's own fields are untouched");
});

test("joinRows projects the attached row through `project`, so B's shape is whitelisted", () => {
  const project = (b) => ({ verdict: b.verdict ?? null });
  const { rows: out } = joinRows(rows, runs, { key: "pr_url", latest: "started", into: "review", project });
  assert.deepEqual(out[0].review, { verdict: "APPROVE" });
  assert.deepEqual(out[1].review, { verdict: null });
  assert.ok(!JSON.stringify(out).includes("secret"), "nothing of B reaches A but what the projection names");
});

test("joinRows derives A's key through `keyOf` when the rows do not carry it", () => {
  // The legacy board payload is joined as the upstream sent it, rows without
  // a derived `pr_url`; the key is computed on the way and never written.
  const raw = [
    { repo: "owner/repo", number: 7 },
    { url: "https://github.com/owner/repo/pull/101/files" },
    { kind: "issue", repo: "owner/repo", number: 7 },
  ];
  const keyOf = (r) => (r.kind && r.kind !== "pr" ? null : prUrl(r));
  const { rows: out } = joinRows(raw, runs, { key: "pr_url", latest: "started", into: "review", keyOf });
  assert.equal(out[0].review.verdict, "APPROVE");
  assert.equal(out[1].review.verdict, null);
  assert.equal("review" in out[2], false, "an issue sharing a run's number is not joined");
  assert.equal("pr_url" in out[0], false, "the derived key is not written onto the row");
});

test("joinRows ties on `latest` keep the first seen; an unparseable `latest` loses to a parseable one", () => {
  const b = [
    { pr_url: "k", started: "garbage", n: 1 },
    { pr_url: "k", started: "2026-10-27T10:00:00.000Z", n: 2 },
    { pr_url: "k", started: "2026-10-27T10:00:00.000Z", n: 3 },
    { pr_url: "k", n: 4 },
  ];
  const { rows: out } = joinRows([{ pr_url: "k" }], b, { key: "pr_url", latest: "started", into: "b" });
  assert.equal(out[0].b.n, 2);
  // Without `latest`, the first B row seen wins: B arrives in its shape's order.
  assert.equal(joinRows([{ pr_url: "k" }], b, { key: "pr_url", into: "b" }).rows[0].b.n, 1);
});

test("joinRows is best effort: nothing to join returns the rows as they came, and says why", () => {
  assert.deepEqual(joinRows(rows, [], { key: "pr_url", latest: "started", into: "review" }), { rows, status: "ok" });
  const same = joinRows(rows, [], { key: "pr_url", latest: "started", into: "review" }).rows;
  assert.equal(same, rows, "no B rows means no copy either");

  const bad = joinRows(rows, "down", { key: "pr_url", latest: "started", into: "review" });
  assert.equal(bad.rows, rows);
  assert.match(bad.status, /^unavailable: /);

  const noKey = joinRows(rows, runs, { key: "", into: "review" });
  assert.equal(noKey.rows, rows);
  assert.match(noKey.status, /^unavailable: .*key/);

  const noInto = joinRows(rows, runs, { key: "pr_url", into: "" });
  assert.match(noInto.status, /^unavailable: .*into/);

  assert.deepEqual(joinRows("junk", runs, { key: "pr_url", into: "review" }), { rows: "junk", status: "unavailable: rows are not a list" });
});
