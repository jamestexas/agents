// Read-many stores: one writable root, N read-only.
//
// The asymmetry under test is write 1:1 / read 1:many. A machine owns exactly
// one store it writes to — `HUD_ROOT`, which the config file deliberately never
// names — and may read from several others.
//
// These tests assert against fixture trees under os.tmpdir() only. No case
// reads a real store, and no fixture carries a real person, company, project or
// note name.
//
// The collision case is written first on purpose: "same path in two stores"
// silently resolving to whichever root was walked last is the defect that would
// never announce itself, and it is indistinguishable from correct behaviour
// unless something asserts the shadowed copy is still reported.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildTree,
  createServer,
  loadConfigDetail,
  readStores,
  WRITABLE_STORE,
} from "../server.mjs";

const UI_DIR = path.join(import.meta.dirname, "..", "ui");

/** Build a tmp tree from {relative path: contents}. */
function tree(t, name, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hud-stores-${name}-`));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A context note. `extra` lands in the frontmatter verbatim. */
function note(title, extra = "") {
  return `---\ntitle: ${title}\ntype: context\nstatus: active\n${extra}---\n\n# ${title}\n`;
}

/** Write a `[read.<name>] path = ...` config into a writable root. */
function withReadStores(root, stores) {
  const body = Object.entries(stores)
    .map(([name, p]) => `[read.${name}]\npath = "${p}"\n`)
    .join("\n");
  fs.writeFileSync(path.join(root, "hud.toml"), body);
}

function entryAt(tree_, section, rel) {
  const s = tree_.sections.find((x) => x.name === section);
  return s ? s.entries.find((e) => e.path === rel) : undefined;
}

// ---------------------------------------------------------------- collision

test("a path in two stores serves the writable copy and reports the shadow", (t) => {
  const readRoot = tree(t, "read", {
    "projects/shared/CONTEXT.md": note("from the read store"),
  });
  const writeRoot = tree(t, "write", {
    "projects/shared/CONTEXT.md": note("from the writable store"),
  });
  withReadStores(writeRoot, { other: readRoot });

  const out = buildTree(writeRoot);
  const rel = "projects/shared/CONTEXT.md";

  const hits = out.sections
    .find((s) => s.name === "projects")
    .entries.filter((e) => e.path === rel);
  assert.equal(hits.length, 1, "the colliding path appears more than once");
  assert.equal(hits[0].title, "from the writable store", "the read store won the collision");
  assert.equal(hits[0].store, WRITABLE_STORE);

  // Losing the shadow entirely is the failure this test exists for: the tree
  // would look correct while a note silently stopped existing.
  assert.ok(Array.isArray(out.shadowed), "tree reports no shadowed list at all");
  const shadow = out.shadowed.find((s) => s.path === rel);
  assert.ok(shadow, `collision at ${rel} was resolved silently`);
  assert.equal(shadow.store, "other", "shadow does not name the store it came from");
  assert.equal(shadow.shadowed_by, WRITABLE_STORE);
});

test("no collision means an empty shadowed list, not a missing one", (t) => {
  const readRoot = tree(t, "read2", { "projects/a/CONTEXT.md": note("a") });
  const writeRoot = tree(t, "write2", { "projects/b/CONTEXT.md": note("b") });
  withReadStores(writeRoot, { other: readRoot });

  const out = buildTree(writeRoot);
  // Absent vs empty is the "found nothing / did not look" distinction.
  assert.deepEqual(out.shadowed, []);
});

// -------------------------------------------------------------------- union

test("entries from every configured store appear in one tree", (t) => {
  const readA = tree(t, "ra", { "projects/alpha/CONTEXT.md": note("alpha") });
  const readB = tree(t, "rb", { "playbooks/beta.md": note("beta") });
  const writeRoot = tree(t, "w", { "projects/gamma/CONTEXT.md": note("gamma") });
  withReadStores(writeRoot, { one: readA, two: readB });

  const out = buildTree(writeRoot);
  assert.ok(entryAt(out, "projects", "projects/gamma/CONTEXT.md"), "writable entry missing");
  assert.ok(entryAt(out, "projects", "projects/alpha/CONTEXT.md"), "read store one missing");
  assert.ok(entryAt(out, "playbooks", "playbooks/beta.md"), "read store two missing");
});

test("a section present in two stores is one section, grouped across both", (t) => {
  const readRoot = tree(t, "rg", {
    "projects/from-read/CONTEXT.md": note("read side"),
  });
  const writeRoot = tree(t, "wg", {
    "projects/from-write/CONTEXT.md": note("write side"),
  });
  withReadStores(writeRoot, { other: readRoot });

  const out = buildTree(writeRoot);
  const projects = out.sections.filter((s) => s.name === "projects");
  assert.equal(projects.length, 1, "projects appeared as more than one section");

  // The load-bearing part: groups are computed after the merge. Computing them
  // per-root would give each store its own group list and this would be 1.
  const names = projects[0].groups.map((g) => g.name).sort();
  assert.deepEqual(names, ["from-read", "from-write"]);
});

// --------------------------------------------------------------- provenance

test("every entry names its store", (t) => {
  const readRoot = tree(t, "rp", { "inbox/x.md": note("x") });
  const writeRoot = tree(t, "wp", { "inbox/y.md": note("y") });
  withReadStores(writeRoot, { other: readRoot });

  const out = buildTree(writeRoot);
  for (const section of out.sections) {
    for (const e of section.entries) {
      assert.ok(typeof e.store === "string" && e.store, `${e.path} has no store`);
    }
  }
  assert.equal(entryAt(out, "inbox", "inbox/y.md").store, WRITABLE_STORE);
  assert.equal(entryAt(out, "inbox", "inbox/x.md").store, "other");
});

// ------------------------------------------------------- authoring contract

test("dropping a file in the writable root still needs no config", (t) => {
  const readRoot = tree(t, "ra2", { "projects/r/CONTEXT.md": note("r") });
  const writeRoot = tree(t, "wa2", {});
  withReadStores(writeRoot, { other: readRoot });

  assert.equal(entryAt(buildTree(writeRoot), "projects", "projects/new/CONTEXT.md"), undefined);

  const abs = path.join(writeRoot, "projects/new/CONTEXT.md");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, note("dropped in"));

  const found = entryAt(buildTree(writeRoot), "projects", "projects/new/CONTEXT.md");
  assert.ok(found, "a file dropped into the writable root did not appear");
  assert.equal(found.store, WRITABLE_STORE);
});

// ---------------------------------------------------------------- isolation

test("a full request sweep leaves every read store byte-identical", async (t) => {
  const readRoot = tree(t, "riso", {
    "projects/p/CONTEXT.md": note("p"),
    "playbooks/q.md": note("q"),
  });
  const writeRoot = tree(t, "wiso", { "projects/w/CONTEXT.md": note("w") });
  withReadStores(writeRoot, { other: readRoot });

  /** Every file in the store with its size and mtime. */
  const snapshot = (root) => {
    const out = new Map();
    const walk = (dir) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, d.name);
        if (d.isDirectory()) walk(abs);
        else if (d.isFile()) {
          const st = fs.statSync(abs);
          out.set(path.relative(root, abs), `${st.size}:${st.mtimeMs}`);
        }
      }
    };
    walk(root);
    return out;
  };

  const before = snapshot(readRoot);

  const server = createServer({ root: writeRoot, uiDir: UI_DIR });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const route of [
    "/",
    "/api/tree",
    "/api/md?path=projects/p/CONTEXT.md",
    "/api/md?path=playbooks/q.md",
    "/api/dyn/peers",
    "/api/sessions",
  ]) {
    await fetch(base + route, { cache: "no-store" });
  }
  // Mutating verbs too: they must be refused rather than reaching a store.
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await fetch(`${base}/api/tree`, { method, cache: "no-store" });
    assert.equal(res.status, 405);
  }

  const after = snapshot(readRoot);
  assert.deepEqual([...after.entries()].sort(), [...before.entries()].sort(),
    "a read-only store changed during a request sweep");
  // `.generated/` must land in the writable root, never in a mounted store.
  assert.ok(!fs.existsSync(path.join(readRoot, ".generated")),
    "the server wrote .generated/ into a read-only store");
});

// --------------------------------------------------------- reachable bytes

test("an entry from a read store is openable, byte for byte", async (t) => {
  const body = note("mounted note", "tags: [one]\n");
  const readRoot = tree(t, "rbytes", { "projects/m/CONTEXT.md": body });
  const writeRoot = tree(t, "wbytes", { "projects/w/CONTEXT.md": note("own") });
  withReadStores(writeRoot, { other: readRoot });

  const server = createServer({ root: writeRoot, uiDir: UI_DIR });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Listing an entry nobody can open would be a worse tree than not listing
  // it: the union would advertise notes that 404.
  const res = await fetch(`${base}/api/md?path=projects/m/CONTEXT.md`, { cache: "no-store" });
  assert.equal(res.status, 200, "a mounted entry advertised by /api/tree could not be opened");
  assert.equal(await res.text(), body, "bytes from the read store differ from disk");

  // Containment still holds per store, so a traversal out of a read store is
  // refused rather than resolved against a different root.
  const esc = await fetch(`${base}/api/md?path=../escape.md`, { cache: "no-store" });
  assert.equal(esc.status, 400);
});

// ------------------------------------------------------------------- config

test("the reserved writable-store name is refused as a read store", (t) => {
  const readRoot = tree(t, "rres", { "inbox/z.md": note("z") });
  const writeRoot = tree(t, "wres", {});
  withReadStores(writeRoot, { [WRITABLE_STORE]: readRoot });

  const { stores, warns } = readStores(writeRoot);
  assert.equal(stores.length, 0, "a store claiming the reserved name was accepted");
  assert.ok(
    warns.some((w) => w.includes(WRITABLE_STORE)),
    `no warning named the reserved store; got ${JSON.stringify(warns)}`,
  );
});

test("an absent read-store path is reported, not silently skipped", (t) => {
  const writeRoot = tree(t, "wabs", { "inbox/a.md": note("a") });
  withReadStores(writeRoot, { gone: path.join(os.tmpdir(), "hud-stores-does-not-exist") });

  const { stores, warns } = readStores(writeRoot);
  assert.equal(stores.length, 0);
  assert.ok(warns.some((w) => w.includes("gone")), "absent store produced no warning");

  // And the tree still builds from the writable root alone.
  assert.ok(entryAt(buildTree(writeRoot), "inbox", "inbox/a.md"));
});

test("an array or array-of-tables in the config warns rather than being accepted", (t) => {
  const root = tree(t, "warr", { "inbox/a.md": note("a") });

  // Both forms are outside the parser's subset. The requirement is that they
  // are *reported*: silently ignoring a store the user believes they declared
  // is the worst of the three outcomes.
  fs.writeFileSync(
    path.join(root, "hud.toml"),
    '[read]\npaths = ["/one", "/two"]\n\n[[read.work]]\npath = "/three"\n',
  );

  const detail = loadConfigDetail(root);
  assert.ok(detail.warns.length >= 2, `expected warnings, got ${JSON.stringify(detail.warns)}`);
  assert.ok(
    detail.warns.some((w) => w.includes("paths")),
    "the array value produced no warning",
  );
  // `[[read.work]]` is line 4. The parser does not echo the offending text, so
  // the line number is what identifies it.
  assert.ok(
    detail.warns.some((w) => w.startsWith("line 4:")),
    `the array-of-tables header on line 4 produced no warning; got ${JSON.stringify(detail.warns)}`,
  );

  // And nothing was silently mounted off the back of it.
  assert.deepEqual(readStores(root).stores, []);
});

test("a read store pointed at a file rather than a directory is ignored with a warning", (t) => {
  const writeRoot = tree(t, "wfile", { "inbox/a.md": note("a"), "notes.md": "# not a store\n" });
  withReadStores(writeRoot, { afile: path.join(writeRoot, "notes.md") });

  // statSync succeeds here, so this is a distinct branch from the absent case:
  // without the isDirectory() check the walk would fail per-section instead of
  // being reported once, and the tree would come back quietly short.
  const { stores, warns } = readStores(writeRoot);
  assert.equal(stores.length, 0, "a file was accepted as a store root");
  assert.ok(
    warns.some((w) => w.includes("afile") && w.includes("not a directory")),
    `no warning said the store was not a directory; got ${JSON.stringify(warns)}`,
  );
  assert.ok(entryAt(buildTree(writeRoot), "inbox", "inbox/a.md"), "the writable tree shrank");
});

test("no read stores configured behaves exactly as a single-store tree", (t) => {
  const writeRoot = tree(t, "wsingle", { "projects/only/CONTEXT.md": note("only") });
  const out = buildTree(writeRoot);
  assert.deepEqual(out.shadowed, []);
  assert.equal(entryAt(out, "projects", "projects/only/CONTEXT.md").store, WRITABLE_STORE);
});

// ------------------------------------------------- the shape a store arrives in
//
// A real mounted store is not a bare section tree: `hud init` gives every store
// `HUD.md`, `index.md`, `log.md`, its own `hud.toml`, an `_hud` symlink to the
// machinery, and section directories that may hold nothing but a `.gitkeep`.
// Every case below is something that shape puts in front of the union, so these
// are regression tests for a store that looks like the ones people actually
// mount rather than like a fixture.

test("a mounted store's own hud.toml is inert: no transitive mounts, no entry", (t) => {
  const thirdRoot = tree(t, "third", { "projects/unreachable/CONTEXT.md": note("third root") });
  const readRoot = tree(t, "rshape", {
    "projects/mounted/CONTEXT.md": note("mounted"),
    // Everything `hud init` puts at the top level of a store it creates.
    "HUD.md": "# contract\n",
    "index.md": "# index\n",
    "log.md": "# log\n",
    // The store's own config, declaring a mount of its own.
    "hud.toml": `ticket_url_template = "https://example.invalid/{id}"\n\n[read.nested]\npath = "${thirdRoot}"\n`,
  });
  const writeRoot = tree(t, "wshape", { "projects/own/CONTEXT.md": note("own") });
  withReadStores(writeRoot, { other: readRoot });

  // Config is read from HUD_ROOT and nowhere else. If the chain recursed,
  // mounting one store would silently import whatever *it* mounts — a tree
  // whose contents depend on a file the machine that mounted it never read.
  assert.deepEqual(readStores(writeRoot).stores.map((s) => s.name), ["other"]);

  const out = buildTree(writeRoot);
  assert.ok(entryAt(out, "projects", "projects/mounted/CONTEXT.md"), "mounted entry missing");
  assert.equal(
    entryAt(out, "projects", "projects/unreachable/CONTEXT.md"),
    undefined,
    "a store mounted by a mounted store's config leaked into the tree",
  );

  // And the top-level files are content of the store, not entries of it: the
  // walk only ever descends into section directories.
  const all = out.sections.flatMap((s) => s.entries).map((e) => e.path);
  for (const rel of ["HUD.md", "index.md", "log.md", "hud.toml"]) {
    assert.ok(!all.includes(rel), `${rel} from a mounted store rendered as an entry`);
  }
});

test("a section holding only a keepfile adds the section, never an entry", (t) => {
  const readRoot = tree(t, "rkeep", {
    // What `hud init` leaves behind: an empty directory cannot survive a clone,
    // so each section gets a dot-prefixed keepfile. The claim being pinned is
    // that the walker's dotfile skip is what makes that safe.
    "peers/.gitkeep": "",
    "inbox/.gitkeep": "",
    "playbooks/real.md": note("real"),
  });
  const writeRoot = tree(t, "wkeep", { "projects/own/CONTEXT.md": note("own") });
  withReadStores(writeRoot, { other: readRoot });

  const out = buildTree(writeRoot);
  const all = out.sections.flatMap((s) => s.entries).map((e) => e.path);
  assert.ok(!all.some((p) => p.endsWith(".gitkeep")), `a keepfile rendered as an entry: ${all}`);
  assert.ok(entryAt(out, "playbooks", "playbooks/real.md"), "a real entry beside keepfiles missing");

  // The section still appears, because sections are the union of top-level
  // directories. An empty section is the honest projection of an empty
  // directory, and it is why `peers` can be present with nothing under it.
  const peers = out.sections.find((s) => s.name === "peers");
  assert.ok(peers, "a keepfile-only section did not appear at all");
  assert.deepEqual(peers.entries, []);
});

test("the _hud machinery link in a mounted store is skipped, not walked", (t) => {
  const machinery = tree(t, "mach", { "docs/SOURCES.md": "# not content\n" });
  const readRoot = tree(t, "rlink", { "projects/mounted/CONTEXT.md": note("mounted") });
  // `_hud` points at a checkout of the machinery, which on a real store is a
  // git repository full of markdown. Walking it would flood the tree.
  fs.symlinkSync(machinery, path.join(readRoot, "_hud"));
  const writeRoot = tree(t, "wlink", {});
  withReadStores(writeRoot, { other: readRoot });

  const out = buildTree(writeRoot);
  assert.ok(!out.sections.some((s) => s.name === "_hud"), "_hud became a section");
  const all = out.sections.flatMap((s) => s.entries).map((e) => e.path);
  assert.ok(!all.some((p) => p.includes("SOURCES.md")), `machinery leaked into the tree: ${all}`);
  assert.ok(entryAt(out, "projects", "projects/mounted/CONTEXT.md"), "mounted entry missing");
});

test("a shadowed entry is reported but its bytes are unreachable by path", async (t) => {
  const rel = "projects/shared/CONTEXT.md";
  const readRoot = tree(t, "rshadow", { [rel]: note("the shadowed copy") });
  const writeRoot = tree(t, "wshadow", { [rel]: note("the served copy") });
  withReadStores(writeRoot, { other: readRoot });

  const out = buildTree(writeRoot);
  assert.equal(out.shadowed.length, 1);

  const server = createServer({ root: writeRoot, uiDir: UI_DIR });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  // `/api/md` resolves in the same writable-first order, so the one path the
  // collision leaves you with serves the winner. There is no second path and
  // no store selector: `shadowed` tells you a copy exists and is the whole of
  // what it can tell you. Documented in docs/SOURCES.md rather than fixed here
  // — adding a store parameter would make every mounted path addressable by a
  // client-supplied root name, which is a containment surface, not a feature.
  const res = await fetch(`${base}/api/md?path=${rel}`, { cache: "no-store" });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /the served copy/, "the shadowed copy was served");
});
