// Hermetic end-to-end test for the onboarding path: a tree that `hud init`
// just made must actually serve.
//
// This closes a seam the other two gates leave open. `init.test.mjs` runs the
// real CLI but stops at "the config it wrote parses with no warnings" — it
// never starts a server. `smoke.sh` starts a real server and asserts real
// values come back, but only against an already-populated tree, and its
// assertions are sized for one (32 notes, a migration manifest, real sessions).
// So `hud init` could scaffold a tree the server chokes on — a renamed section
// directory, a `hud.toml` key the server rejects, a layout that yields no
// entries — and both suites would stay green while a new user's first
// `hud start` served them nothing.
//
// The order here is the order a new user experiences: init, start, render,
// values, then the authoring contract ("drop a .md, refresh, it's there")
// against a tree nobody hand-built.
//
// Detection is deliberately NOT sandboxed. `init`'s probes are all local
// (`command -v`, a loopback curl, a directory test), and which sources this
// machine happens to have installed is not what is under test — that the
// result is servable either way is. So every assertion below is on the
// contract, never on a detection outcome, and the suite is valid on a machine
// with all the sources and on one with none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createServer, CONFIG_TOML, KNOWN_SECTIONS } from "../server.mjs";

const MACHINERY = path.join(import.meta.dirname, "..");
const HUD_CLI = path.join(MACHINERY, "hud");
const UI_DIR = path.join(MACHINERY, "ui");

/**
 * Run the real `hud init --yes` into a throwaway root and serve that root.
 *
 * The root is a *child* of the mkdtemp dir: `init` refuses to scaffold over an
 * existing non-empty directory, and this is also the shape a real user types
 * (`hud init --root ~/hud`, a path that does not exist yet).
 */
async function initAndServe(t, name) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `hud-bootstrap-${name}-`));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "hud");

  const initOut = execFileSync("bash", [HUD_CLI, "init", "--root", root, "--yes"], {
    encoding: "utf8",
    env: { ...process.env, HUD_ROOT: root },
  });

  const server = createServer({ root, uiDir: UI_DIR });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    root,
    initOut,
    base,
    get: (p) => fetch(base + p, { cache: "no-store" }),
    request: (p, method) => fetch(base + p, { method, cache: "no-store" }),
  };
}

test("a freshly initialised tree serves its shell", async (t) => {
  const hud = await initAndServe(t, "shell");

  // The config the server reads is the one init wrote — not a fixture.
  assert.ok(fs.existsSync(path.join(hud.root, CONFIG_TOML)), `init left no ${CONFIG_TOML}`);

  const res = await hud.get("/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  const body = await res.text();
  // A shell that renders is more than a stub: it carries the mount point the
  // client script hangs the tree off. Asserting only on 200 would pass on an
  // empty file.
  assert.ok(body.length > 1000, `shell suspiciously small (${body.length} bytes)`);
  assert.match(body, /<script/, "shell served no script — nothing would ever render");
});

test("a freshly initialised tree reports every section and no entries", async (t) => {
  const hud = await initAndServe(t, "tree");

  const res = await hud.get("/api/tree");
  assert.equal(res.status, 200);
  const tree = await res.json();

  assert.ok(typeof tree.generated === "string" && tree.generated, "no generated timestamp");
  assert.ok(Array.isArray(tree.sections), "sections is not an array");

  // Assert against the *filesystem*, not against the server's own constant.
  //
  // The obvious version of this check — compare the served section names to
  // the imported `KNOWN_SECTIONS` — is a tautology, and provably so: the CLI
  // does not keep its own copy of the list, it imports it out of `server.mjs`
  // at runtime (`emit("known.sections", m.KNOWN_SECTIONS)`) and scaffolds
  // whatever that says. One constant, no second list to drift from, nothing
  // for that comparison to catch. Mutating the CLI's hardcoded fallback list
  // leaves this suite green, because the fallback is dead while the import
  // works.
  //
  // What can actually break is the scaffolding step: `install_dir` not running,
  // writing to the wrong parent, or creating a file where a directory belongs.
  // The server only serves a section whose directory exists, so requiring a
  // real directory on disk for every served section — and for every name the
  // server would accept — is the falsifiable form.
  for (const name of KNOWN_SECTIONS) {
    const abs = path.join(hud.root, name);
    assert.ok(fs.existsSync(abs), `init scaffolded no '${name}' directory`);
    assert.ok(fs.statSync(abs).isDirectory(), `'${name}' exists but is not a directory`);
  }
  assert.deepEqual(
    tree.sections.map((s) => s.name).sort(),
    [...KNOWN_SECTIONS].sort(),
    "a section exists on disk but is not being served (or vice versa)",
  );

  // A fresh tree has real directories holding only `.gitkeep`. Zero entries is
  // the correct answer, and it proves the placeholder is not being served as a
  // note — a new user must not open the HUD to five bogus rows.
  for (const section of tree.sections) {
    assert.deepEqual(section.entries, [], `fresh section '${section.name}' served entries`);
  }
});

test("dropping a note into a freshly initialised tree serves it, byte for byte", async (t) => {
  const hud = await initAndServe(t, "authoring");

  // The authoring contract, on a tree nobody hand-built: write a .md, refresh,
  // it is there. No index to rebuild, no command to run.
  const rel = "projects/example-project/CONTEXT.md";
  const contents = [
    "---",
    "title: Example project",
    "date: 2026-01-01",
    "status: active",
    "tags: [alpha, beta]",
    "---",
    "",
    "# Example project",
    "",
    "Body text with a trailing newline.",
    "",
  ].join("\n");
  const abs = path.join(hud.root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);

  const tree = await (await hud.get("/api/tree")).json();
  const projects = tree.sections.find((s) => s.name === "projects");
  assert.ok(projects, "no projects section");
  const entry = projects.entries.find((e) => e.path === rel);
  assert.ok(entry, `note dropped at ${rel} never appeared in /api/tree`);

  // Frontmatter is parsed, not echoed — the fields the UI sorts and filters on.
  assert.equal(entry.title, "Example project");
  assert.equal(entry.date, "2026-01-01");
  assert.equal(entry.status, "active");
  assert.deepEqual(entry.tags, ["alpha", "beta"]);

  // And the bytes served are the bytes on disk. This is the same parity check
  // smoke.sh makes against the real tree, made here against init's own.
  const md = await hud.get(`/api/md?path=${encodeURIComponent(rel)}`);
  assert.equal(md.status, 200);
  assert.equal(await md.text(), contents, "/api/md bytes differ from the file on disk");
});

test("every dynamic panel answers with JSON on a fresh tree, never a 500", async (t) => {
  const hud = await initAndServe(t, "dyn");

  // A fresh tree has no `.generated/` snapshots and, depending on the machine,
  // may have no upstreams configured at all. The contract is that each route
  // still answers in its documented envelope: 200 with data (live or stale),
  // 503 with a reason, or 404 for a source that is not configured — and never
  // a crash, a 500, or a non-JSON body. This is the invariant that keeps one
  // dead upstream from taking the HUD down.
  for (const route of ["/api/dyn/board", "/api/dyn/digest", "/api/dyn/peers", "/api/sessions"]) {
    const res = await hud.get(route);
    assert.ok(
      [200, 404, 503].includes(res.status),
      `${route} answered ${res.status}; expected one of 200, 404, 503`,
    );
    assert.match(
      res.headers.get("content-type") || "",
      /application\/json/,
      `${route} answered ${res.status} with a non-JSON body`,
    );
    const body = await res.json();
    assert.ok(body && typeof body === "object", `${route} body is not an object`);
    assert.ok(typeof body.source === "string" && body.source, `${route} body names no source`);
    if (res.status === 200) {
      assert.equal(typeof body.stale, "boolean", `${route} 200 without a boolean stale flag`);
    } else {
      assert.ok(typeof body.error === "string" && body.error, `${route} ${res.status} with no reason`);
    }
  }

  // Still serving after every degraded path was exercised.
  assert.equal((await hud.get("/api/tree")).status, 200, "server stopped serving after dyn probes");
});

test("a freshly initialised tree is watch-only", async (t) => {
  const hud = await initAndServe(t, "watchonly");

  // The watch-only invariant is a property of the machinery, but a new user
  // inherits it only if it holds on the tree they were just handed. Content
  // routes refuse every mutating method.
  for (const route of ["/api/tree", "/api/md?path=index.md", "/"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await hud.request(route, method);
      assert.equal(res.status, 405, `${method} ${route} was not refused`);
    }
  }

  assert.equal((await hud.get("/api/tree")).status, 200, "server stopped serving after method probes");
});
