// The `pages` card: generated HTML pages in the tree, listed by an `fs` card
// with `format = "text"`, and served by /api/page only while a pages card's
// glob names them. Every fixture here is synthetic; nothing reads a real tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { read as fsRead, validate as fsValidate, LIMITS } from "../cards/kinds/fs.mjs";
import { COLUMNS, compare, normalize, pageUrl, titleOf } from "../cards/normalize/pages.mjs";
import { fixture, serve } from "./review-fixtures.mjs";

const PAGES_TOML = `
[cards.pages]
kind   = "fs"
glob   = "projects/*/*.html"
format = "text"
shape  = "pages"
title  = "Pages"
`;

const page = (title, body = "") => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

function pagesTree(t, extra = {}) {
  const root = fixture(t, "hud-pages-", {
    "projects/demo/tracker.html": page("Demo &amp; tracker", "<script>document.title</script>"),
    "projects/demo/notes/inner.html": page("Too deep for the glob"),
    "projects/other/report.html": "<html><body>no title here</body></html>",
    "projects/other/data.json": "{}",
    "secrets/elsewhere.html": page("Not under projects"),
    ...extra,
  });
  fs.writeFileSync(path.join(root, "hud.toml"), PAGES_TOML);
  return root;
}

test("format = text hands over each file's head, size and mtime, unparsed", (t) => {
  const root = pagesTree(t);
  const card = {};
  assert.equal(fsValidate({ glob: "projects/*/*.html", format: "text" }, card, { hudRoot: root }), null);
  assert.equal(card.format, "text");
  const { rows } = fsRead(card);
  const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(byPath).sort(), ["projects/demo/tracker.html", "projects/other/report.html"]);
  const row = byPath["projects/demo/tracker.html"];
  assert.equal(row.project, "demo");
  assert.match(row.data.text, /<title>Demo &amp; tracker<\/title>/);
  assert.equal(typeof row.data.size, "number");
  assert.match(row.data.mtime, /^\d{4}-\d{2}-\d{2}T/);
});

test("format = text reads only the head of a large file", (t) => {
  const big = page("Big") + "x".repeat(LIMITS.headBytes * 3);
  const root = pagesTree(t, { "projects/big/huge.html": big });
  const card = {};
  fsValidate({ glob: "projects/*/*.html", format: "text" }, card, { hudRoot: root });
  const row = fsRead(card).rows.find((r) => r.path === "projects/big/huge.html");
  assert.equal(row.data.text.length, LIMITS.headBytes, "the head, not the file");
  assert.equal(row.data.size, Buffer.byteLength(big));
});

test("format is absent unless named, reads as json, and refuses anything else", (t) => {
  const card = {};
  assert.equal(fsValidate({ glob: "a/*.json" }, card, { hudRoot: "/tmp" }), null);
  assert.equal("format" in card, false, "a stanza that names no format keeps its old shape");
  const root = fixture(t, "hud-pages-json-", { "a/x.json": '{"k":1}' });
  const jsonCard = {};
  fsValidate({ glob: "a/*.json" }, jsonCard, { hudRoot: root });
  assert.deepEqual(fsRead(jsonCard).rows[0].data, { k: 1 }, "and still reads JSON");
  assert.deepEqual(fsValidate({ glob: "a/*.json", format: "yaml" }, {}, { hudRoot: "/tmp" }), {
    field: "format",
    reason: "format must be one of json, text",
  });
});

test("titleOf decodes entities, folds whitespace, and is null without a title", () => {
  assert.equal(titleOf("<title>\n  A &amp; B\n</title>"), "A & B");
  assert.equal(titleOf("<TITLE lang=en>Caps</TITLE>"), "Caps");
  assert.equal(titleOf("<title>   </title>"), null);
  assert.equal(titleOf("<p>none</p>"), null);
  assert.equal(titleOf(undefined), null);
});

test("normalize links through the page route and falls back to the file name", () => {
  const item = normalize({ path: "projects/demo/tracker.html", project: "demo", data: { text: page("T"), mtime: "2026-01-02T03:04:05.000Z" } });
  assert.deepEqual(item, {
    path: "projects/demo/tracker.html",
    project: "demo",
    title: "T",
    url: pageUrl("projects/demo/tracker.html"),
    updated: "2026-01-02T03:04:05.000Z",
  });
  assert.equal(item.url, "/api/page?path=projects%2Fdemo%2Ftracker.html");
  assert.equal(normalize({ path: "projects/x/report.html", project: "x", data: { text: "no title" } }).title, "report.html");
  const bad = { path: "projects/x/y.html", project: "x", unreadable: true, error: "EACCES" };
  assert.equal(normalize(bad), bad, "an unreadable row passes through");
  assert.equal(normalize("nope"), null);
  assert.deepEqual([...COLUMNS], ["project", "page", "updated"]);
});

test("compare puts the most recently written page first", () => {
  const items = [
    { path: "b", updated: "2026-01-01T00:00:00Z" },
    { path: "a", updated: "2026-03-01T00:00:00Z" },
    { path: "c", updated: null },
  ];
  assert.deepEqual(items.sort(compare).map((i) => i.path), ["a", "b", "c"]);
});

test("GET /api/card/pages lists the pages the glob names", async (t) => {
  const root = pagesTree(t);
  const hud = await serve(t, root);
  const res = await hud.get("/api/card/pages");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.columns, ["project", "page", "updated"]);
  assert.deepEqual(body.items.map((i) => [i.project, i.title]).sort(), [["demo", "Demo & tracker"], ["other", "report.html"]]);
});

test("GET /api/page serves a page the glob names, sandboxed", async (t) => {
  const root = pagesTree(t);
  const hud = await serve(t, root);
  const res = await hud.get("/api/page?path=" + encodeURIComponent("projects/demo/tracker.html"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.equal(res.headers.get("content-security-policy"), "sandbox allow-scripts");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(await res.text(), /<title>Demo &amp; tracker<\/title>/);
});

test("GET /api/page refuses what no pages card names", async (t) => {
  const root = pagesTree(t);
  const hud = await serve(t, root);
  const get = (rel) => hud.get("/api/page?path=" + encodeURIComponent(rel));
  assert.equal((await get("secrets/elsewhere.html")).status, 404, "outside the glob");
  assert.equal((await get("projects/demo/notes/inner.html")).status, 404, "deeper than the glob");
  assert.equal((await get("projects/other/data.json")).status, 400, "not a page");
  assert.equal((await get("projects/../secrets/elsewhere.html")).status, 404, "a traversal never matches the glob");
  assert.equal((await get("projects/ghost/missing.html")).status, 404, "named by the glob but absent");
  assert.equal((await hud.get("/api/page")).status, 400, "no path");
  assert.equal((await hud.verb("POST", "/api/page?path=projects%2Fdemo%2Ftracker.html")).status, 405, "read only");
});

test("GET /api/page serves nothing when no pages card is configured", async (t) => {
  const root = pagesTree(t);
  fs.writeFileSync(path.join(root, "hud.toml"), "[cards]\n");
  const hud = await serve(t, root);
  assert.equal((await hud.get("/api/page?path=" + encodeURIComponent("projects/demo/tracker.html"))).status, 404);
});
