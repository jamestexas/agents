// The `boards` card: every hud.board/1 JSON under projects/*/boards/, as a row
// that opens the board's own page, which the server renders from the JSON on
// each read. Every fixture here is synthetic; nothing reads a real tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { read as fsRead, validate as fsValidate } from "../cards/kinds/fs.mjs";
import { COLUMNS, boardUrl, compare, normalize } from "../cards/normalize/boards.mjs";
import { fixture, serve } from "./review-fixtures.mjs";

const BOARDS_TOML = `
[cards.boards]
kind  = "fs"
glob  = "projects/*/boards/*.json"
shape = "boards"
title = "Boards"
`;

const board = (title, generated, rows = [{ id: "a", label: "A" }]) =>
  JSON.stringify({ schema: "hud.board/1", title, generated, rows });

function boardsTree(t, extra = {}) {
  const root = fixture(t, "hud-boards-", {
    "projects/demo/boards/older.json": board("Older board", "2026-01-01T00:00:00Z"),
    "projects/demo/boards/newer.json": board("Newer board", "2026-02-01T00:00:00Z", [{ id: "a", label: "A" }, { id: "b", label: "B" }]),
    "projects/demo/boards/older.md": "# rendered projection, not a board",
    "projects/demo/boards/.history/older/20260101T000000Z.json": board("A snapshot", "2025-12-01T00:00:00Z"),
    "projects/demo/boards/sub/nested.json": board("Too deep for the glob", "2026-01-01T00:00:00Z"),
    "projects/other/boards/broken.json": JSON.stringify({ schema: "hud.board/1", title: "Broken", rows: [] }),
    ...extra,
  });
  fs.writeFileSync(path.join(root, "hud.toml"), BOARDS_TOML);
  return root;
}

test("the fs glob lists each project's boards and nothing in history or below", (t) => {
  const root = boardsTree(t);
  const card = {};
  assert.equal(fsValidate({ glob: "projects/*/boards/*.json" }, card, { hudRoot: root }), null);
  const paths = fsRead(card).rows.map((r) => r.path).sort();
  assert.deepEqual(paths, [
    "projects/demo/boards/newer.json",
    "projects/demo/boards/older.json",
    "projects/other/boards/broken.json",
  ]);
});

test("boardUrl is the board's page, the JSON path without its extension", () => {
  assert.equal(boardUrl("projects/ces/boards/ces-in-depth.json"), "/n/projects/ces/boards/ces-in-depth");
});

test("normalize carries the title, generated time and row count, and links the page", () => {
  const item = normalize({
    path: "projects/demo/boards/newer.json",
    project: "demo",
    data: JSON.parse(board("Newer board", "2026-02-01T00:00:00Z", [{ id: "a", label: "A" }, { id: "b", label: "B" }])),
  });
  assert.deepEqual(item, {
    path: "projects/demo/boards/newer.json",
    project: "demo",
    title: "Newer board",
    url: "/n/projects/demo/boards/newer",
    updated: "2026-02-01T00:00:00Z",
    rows: 2,
    invalid: false,
    errors: 0,
  });
});

test("a board that fails validation is listed and flagged, not dropped", () => {
  const item = normalize({
    path: "projects/other/boards/broken.json",
    project: "other",
    data: { schema: "hud.board/1", title: "Broken", rows: [] },
  });
  assert.equal(item.title, "Broken");
  assert.equal(item.invalid, true);
  assert.ok(item.errors > 0, "the error count says how broken");
  assert.equal(item.url, "/n/projects/other/boards/broken", "its page shows the errors, so it is still linked");
});

test("a board with no title falls back to its file name", () => {
  const item = normalize({ path: "projects/demo/boards/untitled.json", project: "demo", data: { rows: [] } });
  assert.equal(item.title, "untitled");
  assert.equal(item.updated, null);
  assert.equal(item.invalid, true);
});

test("an unreadable row passes through so the card can say which file failed", () => {
  const row = { path: "projects/demo/boards/bad.json", project: "demo", unreadable: true, error: "not a JSON object" };
  assert.equal(normalize(row), row);
});

test("compare puts the most recently generated board first", () => {
  const a = { path: "a", updated: "2026-01-01T00:00:00Z" };
  const b = { path: "b", updated: "2026-02-01T00:00:00Z" };
  const none = { path: "c", updated: null };
  assert.deepEqual([a, none, b].sort(compare).map((i) => i.path), ["b", "a", "c"]);
});

test("GET /api/card/boards lists the boards with their default columns", async (t) => {
  const root = boardsTree(t);
  const hud = await serve(t, root);
  const res = await hud.get("/api/card/boards");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.columns, [...COLUMNS]);
  assert.deepEqual(
    body.items.map((i) => [i.project, i.title, i.invalid]),
    [["demo", "Newer board", false], ["demo", "Older board", false], ["other", "Broken", true]],
  );
});
