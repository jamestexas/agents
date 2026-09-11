// Hermetic tests for the HUD static layer.
//
// Every case builds its own tmp fixture tree and points the walker/server at
// it. Nothing here reads the real HUD_ROOT, and no fixture carries a real
// person, company, or project name.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  KNOWN_SECTIONS,
  buildTree,
  contentTypeFor,
  createServer,
  inferType,
  parseFrontmatter,
  resolveWithin,
} from "../server.mjs";

/** Build a tmp tree from {relative path: contents}; empty string ⇒ empty file. */
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-test-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Start the server on an ephemeral port; returns a `get(pathAndQuery)` helper. */
async function serve(t, root, uiDir) {
  const server = createServer({ root, uiDir: uiDir || path.join(import.meta.dirname, "..", "ui") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, get: (p) => fetch(base + p, { cache: "no-store" }) };
}

const treeOf = (root) => buildTree(root);
const sectionNames = (tree) => tree.sections.map((s) => s.name);
const section = (tree, name) => tree.sections.find((s) => s.name === name);
const byPath = (tree, name, rel) => section(tree, name).entries.find((e) => e.path === rel);

// ------------------------------------------------------ required behaviors

test("bare md without frontmatter is listed with defaults", (t) => {
  const root = fixture(t, {
    "inbox/2026-01-02-loose-thought.md": "# A Loose Thought\n\nbody text\n",
    "inbox/no-date-no-heading.md": "just prose, no heading\n",
  });

  const tree = buildTree(root);
  const withHeading = byPath(tree, "inbox", "inbox/2026-01-02-loose-thought.md");
  assert.deepEqual(withHeading, {
    title: "A Loose Thought", // first # heading
    path: "inbox/2026-01-02-loose-thought.md",
    date: "2026-01-02", // filename prefix
    type: "note", // inferred from directory
    status: "active", // default
  });
  assert.equal(withHeading.warn, undefined, "a bare file is not a warning");

  const bare = byPath(tree, "inbox", "inbox/no-date-no-heading.md");
  assert.equal(bare.title, "no-date-no-heading", "falls back to filename without .md");
  const mtimeDay = fs
    .statSync(path.join(root, "inbox/no-date-no-heading.md"))
    .mtime.toISOString()
    .slice(0, 10);
  assert.equal(bare.date, mtimeDay, "falls back to mtime day");
  assert.equal(bare.status, "active");
});

test("malformed frontmatter yields warn:true entry, not a crash", (t) => {
  const root = fixture(t, {
    // Unbalanced quote, unclosed flow array, and a keyless line.
    "inbox/2026-03-04-broken.md": [
      "---",
      'title: "never closed',
      "tags: [a, b",
      ": no key here",
      "---",
      "",
      "# Real Heading",
      "",
      "body",
      "",
    ].join("\n"),
    // Frontmatter opener with no closing delimiter at all.
    "inbox/2026-03-05-unterminated.md": "---\ntitle: dangling\nstatus: parked\n\n# Heading\n",
  });

  const tree = buildTree(root);

  const broken = byPath(tree, "inbox", "inbox/2026-03-04-broken.md");
  assert.equal(broken.warn, true);
  assert.equal(broken.title, "Real Heading", "partial frontmatter is discarded; body heading wins");
  assert.equal(broken.date, "2026-03-04");
  assert.equal(broken.status, "active", "defaults, not half-parsed values");
  assert.equal(broken.tags, undefined, "the unclosed array is not half-applied");

  const unterminated = byPath(tree, "inbox", "inbox/2026-03-05-unterminated.md");
  assert.equal(unterminated.warn, true);
  assert.equal(unterminated.status, "active", "`status: parked` inside a broken block is ignored");
  assert.equal(unterminated.title, "Heading");

  // And the parser itself never throws on either shape.
  assert.equal(parseFrontmatter("---\nbad: [\n---\n").warn, true);
  assert.equal(parseFrontmatter("---\nno close\n").warn, true);
});

test("unknown top-level dir becomes a section", (t) => {
  const root = fixture(t, {
    "projects/project-a/CONTEXT.md": "---\nstatus: active\n---\n# Project A\n",
    "reading/2026-02-01-a-paper.md": "# A Paper\n",
    "reading/nested/deeper.md": "# Deeper\n",
  });

  const tree = buildTree(root);
  assert.deepEqual(sectionNames(tree), ["projects", "reading"], "no config needed for `reading`");
  const reading = section(tree, "reading");
  assert.equal(reading.entries.length, 2, "walks nested files too");
  assert.deepEqual(
    reading.entries.map((e) => e.path).sort(),
    ["reading/2026-02-01-a-paper.md", "reading/nested/deeper.md"],
  );
  assert.equal(byPath(tree, "reading", "reading/nested/deeper.md").type, "note");
});

test("api/md serves exact file bytes", async (t) => {
  // No trailing newline, CRLF, tabs, unicode, and a byte sequence that would
  // change under any re-encode.
  const exact = "---\r\ntitle: Ünicode ✓\r\n---\r\n\ttab\tindented — em dash\r\nno trailing newline";
  const root = fixture(t, { "inbox/exact.md": exact });
  const { get } = await serve(t, root);

  const res = await get("/api/md?path=" + encodeURIComponent("inbox/exact.md"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  const body = await res.text();
  assert.equal(body, exact);
  assert.equal(
    Buffer.byteLength(body, "utf8"),
    fs.statSync(path.join(root, "inbox/exact.md")).size,
    "byte length matches the file on disk",
  );

  const missing = await get("/api/md?path=inbox/nope.md");
  assert.equal(missing.status, 404);
  const noParam = await get("/api/md");
  assert.equal(noParam.status, 400);
  const dir = await get("/api/md?path=inbox");
  assert.equal(dir.status, 400, "a directory is not a file");
});

test("path traversal is rejected", async (t) => {
  const root = fixture(t, { "inbox/ok.md": "# ok\n" });
  // A real file outside the root, adjacent to it, to prove the guard bites.
  const outside = path.join(root, "..", path.basename(root) + "-secret.txt");
  fs.writeFileSync(outside, "SECRET\n");
  t.after(() => fs.rmSync(outside, { force: true }));

  const { get } = await serve(t, root);

  const escapes = [
    "../" + path.basename(outside),
    "inbox/../../" + path.basename(outside),
    "..%2F" + path.basename(outside),
    "%2e%2e%2f" + path.basename(outside),
    "/etc/passwd",
  ];
  for (const attempt of escapes) {
    const res = await get("/api/md?path=" + attempt);
    assert.equal(res.status, 400, `expected 400 for ${attempt}`);
    const body = await res.text();
    assert.ok(!body.includes("SECRET"), `leaked contents for ${attempt}`);
  }
  // `....//` is not an escape, just a missing directory — the guard is
  // resolve-and-compare, not a substring blacklist.
  assert.equal((await get("/api/md?path=....//....//etc/passwd")).status, 404);

  // Symlinks do not tunnel out either.
  const link = path.join(root, "inbox", "escape.md");
  fs.symlinkSync(outside, link);
  const viaLink = await get("/api/md?path=inbox/escape.md");
  assert.equal(viaLink.status, 400);

  // The walker ignores symlinks rather than listing an out-of-tree file.
  const tree = buildTree(root);
  assert.deepEqual(
    section(tree, "inbox").entries.map((e) => e.path),
    ["inbox/ok.md"],
  );

  // Unit-level: resolveWithin is the single chokepoint.
  assert.equal(resolveWithin(root, "inbox/ok.md"), path.join(root, "inbox/ok.md"));
  assert.equal(resolveWithin(root, "../" + path.basename(outside)), null);
  assert.equal(resolveWithin(root, "/etc/passwd"), null);
});

test("known sections come first in a fixed order, unknown ones alphabetically", (t) => {
  // Created in deliberately wrong order; output order must not depend on it.
  const root = fixture(t, {
    "zzz-last/a.md": "# a\n",
    "archive/2025-01-01-old.md": "# old\n",
    "middle/b.md": "# b\n",
    "peers/handle-one.md": "---\ngh: handle-one\n---\n# Handle One\n",
    "playbooks/a-process.md": "# A Process\n",
    "inbox/c.md": "# c\n",
    "projects/project-a/CONTEXT.md": "# Project A\n",
    "alpha/d.md": "# d\n",
  });

  const tree = buildTree(root);
  assert.deepEqual(sectionNames(tree), [
    "projects",
    "playbooks",
    "peers",
    "inbox",
    "archive",
    "alpha",
    "middle",
    "zzz-last",
  ]);
  assert.deepEqual(KNOWN_SECTIONS, ["projects", "playbooks", "peers", "inbox", "archive"]);
});

test("raw/ files are listed, never parsed", (t) => {
  const root = fixture(t, {
    // If this were parsed, title would be "SHOULD NOT PARSE".
    "projects/project-a/raw/transcript.md": "---\ntitle: SHOULD NOT PARSE\n---\n# nope\n",
    "projects/project-a/raw/export.html": "<html><body>drop</body></html>",
    "projects/project-a/notes/2026-01-05-a-note.md": "# A Note\n",
  });

  const tree = buildTree(root);
  const drop = byPath(tree, "projects", "projects/project-a/raw/transcript.md");
  assert.deepEqual(drop, {
    name: "transcript.md",
    path: "projects/project-a/raw/transcript.md",
    size: fs.statSync(path.join(root, "projects/project-a/raw/transcript.md")).size,
    listed: true,
    raw: true,
    group: "project-a",
  });
  assert.equal(drop.title, undefined, "no title means the file was never opened");

  const html = byPath(tree, "projects", "projects/project-a/raw/export.html");
  assert.equal(html.listed, true);
  assert.equal(html.raw, true);
  assert.equal(html.size, 30);

  // A sibling note in the same project is still parsed normally.
  const note = byPath(tree, "projects", "projects/project-a/notes/2026-01-05-a-note.md");
  assert.equal(note.title, "A Note");
  assert.equal(note.listed, undefined);
});

// ---------------------------------------------------------- further cases

test("frontmatter subset: strings, arrays, comments, block lists", () => {
  const { data, body, warn } = parseFrontmatter(
    [
      "---",
      "title: A Titled Note   # trailing comment stripped",
      'quoted: "with: a colon"',
      "date: 2026-05-06",
      "type: playbook",
      "status: parked",
      "tags: [one, two, three]",
      "empty: []",
      "repos:",
      "  - owner/one",
      "  - owner/two",
      "# a whole-line comment",
      "---",
      "# Heading",
      "body",
      "",
    ].join("\n"),
  );

  assert.equal(warn, false);
  assert.equal(data.title, "A Titled Note");
  assert.equal(data.quoted, "with: a colon");
  assert.equal(data.date, "2026-05-06");
  assert.equal(data.status, "parked");
  assert.deepEqual(data.tags, ["one", "two", "three"]);
  assert.deepEqual(data.empty, []);
  assert.deepEqual(data.repos, ["owner/one", "owner/two"]);
  assert.equal(body, "# Heading\nbody\n");
});

test("type is inferred from directory, and frontmatter overrides it", (t) => {
  assert.equal(inferType("projects/project-a/CONTEXT.md"), "context");
  assert.equal(inferType("projects/project-a/notes/2026-01-01-x.md"), "note");
  assert.equal(inferType("playbooks/a-process.md"), "playbook");
  assert.equal(inferType("peers/handle-one.md"), "peer");
  assert.equal(inferType("inbox/x.md"), "note");
  assert.equal(inferType("reading/x.md"), "note");

  const root = fixture(t, {
    "inbox/2026-01-01-actually-a-playbook.md": "---\ntype: playbook\ntitle: Overridden\n---\n# X\n",
  });
  const e = byPath(treeOf(root), "inbox", "inbox/2026-01-01-actually-a-playbook.md");
  assert.equal(e.type, "playbook");
  assert.equal(e.title, "Overridden");
});

test("projects group by subdir, active projects first", (t) => {
  const root = fixture(t, {
    "projects/project-z/CONTEXT.md": "---\nstatus: active\n---\n# Project Z\n",
    "projects/project-a/CONTEXT.md": "---\nstatus: active\n---\n# Project A\n",
    "projects/project-m/CONTEXT.md": "---\nstatus: done\n---\n# Project M\n",
    "projects/project-a/notes/2026-01-01-first.md": "# First\n",
    "projects/project-a/notes/2026-06-01-latest.md": "# Latest\n",
  });

  const projects = section(treeOf(root), "projects");
  assert.deepEqual(projects.groups, [
    { name: "project-a", status: "active" },
    { name: "project-z", status: "active" },
    { name: "project-m", status: "done" }, // non-active sinks below active
  ]);

  // Entries are ordered group-by-group, CONTEXT first, then newest note first.
  assert.deepEqual(
    projects.entries.map((e) => e.path),
    [
      "projects/project-a/CONTEXT.md",
      "projects/project-a/notes/2026-06-01-latest.md",
      "projects/project-a/notes/2026-01-01-first.md",
      "projects/project-z/CONTEXT.md",
      "projects/project-m/CONTEXT.md",
    ],
  );
  assert.equal(projects.entries[0].group, "project-a");
  assert.equal(projects.entries[0].type, "context");
});

test("peers frontmatter carries gh, repos and tickets through", (t) => {
  const root = fixture(t, {
    "peers/handle-one.md": "---\ngh: handle-one\nrepos: [owner/one]\n---\n# Handle One\n",
    "projects/project-a/CONTEXT.md":
      "---\nstatus: active\nrepos: [owner/one, owner/two]\ntickets: [ABC-1, ABC-2]\n---\n# Project A\n",
  });
  const t2 = treeOf(root);
  const peer = byPath(t2, "peers", "peers/handle-one.md");
  assert.equal(peer.type, "peer");
  assert.equal(peer.gh, "handle-one");
  assert.deepEqual(peer.repos, ["owner/one"]);

  const ctx = byPath(t2, "projects", "projects/project-a/CONTEXT.md");
  assert.deepEqual(ctx.repos, ["owner/one", "owner/two"]);
  assert.deepEqual(ctx.tickets, ["ABC-1", "ABC-2"]);
});

test("machinery, dotfiles and root files are not sections or entries", (t) => {
  const root = fixture(t, {
    "HUD.md": "# HUD\n",
    "index.md": "# Index\n",
    "hud.config.json": "{}",
    ".gitignore": ".generated\n",
    "inbox/.gitkeep": "",
    "inbox/kept.md": "# Kept\n",
    "_hud/server.mjs": "// machinery\n",
    ".generated/board.json": "{}",
    ".hidden-dir/x.md": "# hidden\n",
  });

  const t2 = treeOf(root);
  assert.deepEqual(sectionNames(t2), ["inbox"], "no _hud, no dotdirs, no section for root files");
  assert.deepEqual(
    section(t2, "inbox").entries.map((e) => e.path),
    ["inbox/kept.md"],
    ".gitkeep is skipped",
  );
});

test("empty tree and empty sections do not throw", (t) => {
  const root = fixture(t, { "inbox/.gitkeep": "", "projects/.gitkeep": "" });
  const t2 = treeOf(root);
  assert.deepEqual(sectionNames(t2), ["projects", "inbox"]);
  assert.deepEqual(section(t2, "projects").entries, []);
  assert.deepEqual(section(t2, "projects").groups, []);
  assert.ok(Date.parse(t2.generated) > 0, "generated is an ISO timestamp");

  // A nonexistent root is an empty HUD, not a crash.
  assert.deepEqual(buildTree(path.join(root, "does-not-exist")).sections, []);
});

test("static routes serve the ui and reject escapes", async (t) => {
  const root = fixture(t, { "inbox/x.md": "# x\n" });
  const { get } = await serve(t, root);

  const index = await get("/");
  assert.equal(index.status, 200);
  assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
  const html = await index.text();
  assert.ok(html.includes('id="panel-board"'), "serves the real index.html");
  assert.ok(html.includes("/ui/marked.min.js"), "references the vendored renderer");
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/.test(html), "no external URLs: must work offline");

  const marked = await get("/ui/marked.min.js");
  assert.equal(marked.status, 200);
  assert.equal(marked.headers.get("content-type"), "text/javascript; charset=utf-8");

  assert.equal((await get("/ui/%2e%2e%2f%2e%2e%2fetc%2fpasswd")).status, 400);
  assert.equal((await get("/ui/nope.js")).status, 404);
  assert.equal((await get("/nope")).status, 404);
  assert.equal(contentTypeFor("a/b.json"), "application/json; charset=utf-8");
});

test("api/tree responds with the documented shape", async (t) => {
  const root = fixture(t, {
    "projects/project-a/CONTEXT.md": "---\nstatus: active\n---\n# Project A\n",
    "inbox/2026-04-04-thing.md": "# Thing\n",
  });
  const { get } = await serve(t, root);

  const res = await get("/api/tree");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  const tree = await res.json();
  assert.deepEqual(sectionNames(tree), ["projects", "inbox"]);
  assert.deepEqual(byPath(tree, "inbox", "inbox/2026-04-04-thing.md"), {
    title: "Thing",
    path: "inbox/2026-04-04-thing.md",
    date: "2026-04-04",
    type: "note",
    status: "active",
  });
});

test("non-GET methods are refused", async (t) => {
  const root = fixture(t, { "inbox/x.md": "# x\n" });
  const { base } = await serve(t, root);
  const res = await fetch(base + "/api/tree", { method: "POST" });
  assert.equal(res.status, 405);
});
