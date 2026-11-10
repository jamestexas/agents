// A board is its JSON: the page at projects/<p>/boards/<name>.md is rendered
// from <name>.json whenever it is read, so a producer only has to write the
// file. A stored .md is ignored while the JSON is there, and a JSON that does
// not validate is shown as its errors.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BOARD_SCHEMA } from "../boards.mjs";
import { boardPaths, buildTree, resolveRoute } from "../server.mjs";
import { fixture, serve } from "./review-fixtures.mjs";

const doc = (over = {}) =>
  JSON.stringify({
    schema: BOARD_SCHEMA,
    title: "Widgets",
    generated: "2026-01-02T03:04:05Z",
    columns: [{ id: "stage", label: "Stage" }],
    rows: [
      { id: "a", label: "Alpha", status: "Done", cells: { stage: { value: "one" } } },
      { id: "b", label: "Beta", status: "Todo", cells: { stage: { value: "two" } } },
    ],
    ...over,
  });

const entries = (root) => buildTree(root).sections.flatMap((s) => s.entries ?? s.groups?.flatMap((g) => g.entries) ?? []);

test("boardPaths names a board's page and source from either path, and nothing else", () => {
  assert.deepEqual(boardPaths("projects/p/boards/x.json"), { md: "projects/p/boards/x.md", json: "projects/p/boards/x.json" });
  assert.deepEqual(boardPaths("projects/p/boards/x.md"), { md: "projects/p/boards/x.md", json: "projects/p/boards/x.json" });
  for (const rel of ["projects/p/notes/x.md", "projects/p/boards/.history/x/1.json", "projects/p/boards/sub/x.json", "boards/x.json"]) {
    assert.equal(boardPaths(rel), null, rel);
  }
});

test("a board with only its JSON gets a page entry, titled from the JSON, at the page's path", (t) => {
  const root = fixture(t, "hud-boardpage-", { "projects/p/boards/w.json": doc() });
  const found = entries(root).filter((e) => e.path.includes("/boards/"));
  assert.equal(found.length, 1, "one entry, not one for the JSON and one for the page");
  assert.equal(found[0].path, "projects/p/boards/w.md");
  assert.equal(found[0].title, "Widgets");
  assert.equal(found[0].type, "board");
  assert.notEqual(resolveRoute("/n/projects/p/boards/w", { root }).kind, null, "the deep link resolves");
});

test("/api/md renders the page from the JSON on every read, ignoring a stale stored page", async (t) => {
  const root = fixture(t, "hud-boardpage-", {
    "projects/p/boards/w.json": doc({ title: "Fresh title" }),
    "projects/p/boards/w.md": "---\ntitle: Stale\n---\n# Stale\n",
  });
  const hud = await serve(t, root);
  const res = await hud.get("/api/md?path=" + encodeURIComponent("projects/p/boards/w.md"));
  assert.equal(res.status, 200);
  const md = await res.text();
  assert.match(md, /^# Fresh title$/m);
  assert.match(md, /Rendered from `boards\/w\.json`/, "the page names its own file");
  assert.ok(!md.includes("Stale"));
  assert.equal(entries(root).filter((e) => e.path.includes("/boards/")).length, 1, "the stored page does not add a second entry");
  // The JSON itself is still served verbatim, for agents.
  const raw = await hud.get("/api/md?path=" + encodeURIComponent("projects/p/boards/w.json"));
  assert.equal(JSON.parse(await raw.text()).title, "Fresh title");
});

test("a board JSON that does not validate is shown as its errors", async (t) => {
  const root = fixture(t, "hud-boardpage-", {
    "projects/p/boards/bad.json": doc({ rows: [], group_by: "nope" }),
    "projects/p/boards/junk.json": "not json {",
  });
  const hud = await serve(t, root);
  const bad = await (await hud.get("/api/md?path=" + encodeURIComponent("projects/p/boards/bad.md"))).text();
  assert.match(bad, /^# Widgets$/m);
  assert.match(bad, /is not valid hud\.board\/1/);
  assert.match(bad, /^- rows must be a non-empty list$/m);
  assert.match(bad, /^- group_by must name a declared column/m);
  const junk = await (await hud.get("/api/md?path=" + encodeURIComponent("projects/p/boards/junk.md"))).text();
  assert.match(junk, /could not be read/);
});
