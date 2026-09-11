// Hermetic tests for the HUD's deep-link routes.
//
// Every case builds its own tmp fixture tree and listens on port 0, so these
// run beside a HUD already serving on its usual port. No fixture carries a
// real person, company, project or note name.
//
// Two things are under test: `resolveRoute`, which decides what a request
// target names, and the routing that turns that decision into a response —
// shell, 400, or 405. The client's copy of the same path rules is extracted
// out of ui/index.html and checked against the server's, so the duplication
// the design accepts cannot silently drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createServer, resolveRoute } from "../server.mjs";

const UI_DIR = path.join(import.meta.dirname, "..", "ui");

/** Build a tmp tree from {relative path: contents}; empty string ⇒ empty file. */
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-routes-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Start the server on an ephemeral port; returns `{port, get, request}`. */
async function serve(t, root) {
  const server = createServer({ root, uiDir: UI_DIR });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    port,
    base,
    get: (p) => fetch(base + p, { cache: "no-store" }),
    request: (p, method) => fetch(base + p, { method, cache: "no-store" }),
  };
}

/**
 * Send a request target verbatim over a socket.
 *
 * Both `fetch` and `curl` fold `..` out of a path before it reaches the wire,
 * so a literal `/n/../../etc/passwd` cannot be tested through either — the
 * server never sees the deep-link prefix. This is how the guard is exercised
 * against the form an attacker would actually construct.
 */
function rawGet(port, target, method = "GET") {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (d) => {
      buf += d;
    });
    socket.on("end", () => resolve(buf));
    socket.on("error", reject);
  });
}

const statusOf = (raw) => Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1]);

/** The shell, recognised by something only the shell has. */
async function assertShell(res, what) {
  assert.equal(res.status, 200, what);
  assert.match(res.headers.get("content-type"), /^text\/html/, what);
  const body = await res.text();
  assert.match(body, /<title>HUD<\/title>/, what);
  return body;
}

const TREE = {
  "playbooks/example-playbook.md": "# Example Playbook\n\nsteps\n",
  "projects/project-a/CONTEXT.md": "---\nstatus: active\n---\n# Project A\n",
  "projects/project-a/2026-01-02-a-decision.md": "# A Decision\n",
  "projects/project-a/raw/drop.txt": "verbatim bytes\n",
  "inbox/a note with spaces.md": "# Spaced\n",
};

// ------------------------------------------------------ required behaviors

test("deep link serves app shell", async (t) => {
  const root = fixture(t, TREE);
  const { get } = await serve(t, root);

  const shell = await assertShell(await get("/"), "/ is the shell");

  for (const p of [
    "/n/playbooks/example-playbook",
    "/n/playbooks/example-playbook.md",
    "/n/projects/project-a/CONTEXT",
    "/n/projects/project-a/2026-01-02-a-decision",
    "/n/projects/project-a/raw/drop.txt",
    "/n/inbox/a%20note%20with%20spaces",
  ]) {
    const body = await assertShell(await get(p), p);
    assert.equal(body, shell, `${p} serves the same bytes as /`);
  }

  // The shell is the shell — a deep link never leaks note content into it.
  const body = await (await get("/n/playbooks/example-playbook")).text();
  assert.ok(!body.includes("# Example Playbook"), "the shell carries no note body");
  assert.ok(!body.includes("steps"), "the shell carries no note body");
});

test("route resolution restores md extension", (t) => {
  const root = fixture(t, TREE);

  // The extensionless slug finds the markdown file.
  assert.deepEqual(resolveRoute("/n/playbooks/example-playbook", { root }), {
    kind: "entry",
    path: "playbooks/example-playbook.md",
  });
  // Spelling the extension out is the same route.
  assert.deepEqual(resolveRoute("/n/playbooks/example-playbook.md", { root }), {
    kind: "entry",
    path: "playbooks/example-playbook.md",
  });
  assert.deepEqual(resolveRoute("/n/projects/project-a/CONTEXT", { root }), {
    kind: "entry",
    path: "projects/project-a/CONTEXT.md",
  });
  // A file that exists under its own name is taken as-is; no .md is invented.
  assert.deepEqual(resolveRoute("/n/projects/project-a/raw/drop.txt", { root }), {
    kind: "entry",
    path: "projects/project-a/raw/drop.txt",
  });
  // Percent-encoding is decoded once, and a query string is not part of the slug.
  assert.deepEqual(resolveRoute("/n/inbox/a%20note%20with%20spaces", { root }), {
    kind: "entry",
    path: "inbox/a note with spaces.md",
  });
  assert.deepEqual(resolveRoute("/n/playbooks/example-playbook?x=1#frag", { root }), {
    kind: "entry",
    path: "playbooks/example-playbook.md",
  });

  // Nothing on disk: the path stands as written and the client says not-found.
  assert.deepEqual(resolveRoute("/n/inbox/never-written", { root }), {
    kind: "entry",
    path: "inbox/never-written",
  });

  // Without a root the resolver is pure — it reports the path as written and
  // touches no filesystem.
  assert.deepEqual(resolveRoute("/n/playbooks/example-playbook"), {
    kind: "entry",
    path: "playbooks/example-playbook",
  });

  // Sessions carry no extension rule: two segments, group then id.
  assert.deepEqual(resolveRoute("/s/project-a-slug/0f1e2d3c", { root }), {
    kind: "session",
    group: "project-a-slug",
    id: "0f1e2d3c",
  });

  // Everything else is not a deep link and must keep routing.
  for (const p of ["/", "/index.html", "/api/tree", "/api/md?path=x", "/ui/marked.min.js", "/n", "/s"]) {
    assert.deepEqual(resolveRoute(p, { root }), { kind: null }, p);
  }
});

test("route traversal rejected", async (t) => {
  const root = fixture(t, TREE);

  // A symlink inside the root that points out of it: the segment checks say
  // nothing about this one, only realpath containment catches it.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hud-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "secret.md"), "# Not In The Root\n");
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(root, "playbooks", "escape.md"));

  const rejected = [
    "/n/../../etc/passwd",
    "/n/..",
    "/n/../secret",
    "/n/%2e%2e/%2e%2e/etc/passwd",
    "/n/%2E%2E/secret",
    "/n/playbooks/../../secret",
    "/n/playbooks/a%2Fb", // a separator that only appears after decoding
    "/n/", // no path at all
    "/n//playbooks/example-playbook", // empty segment
    "/n/./playbooks/example-playbook",
    "/n/playbooks/escape.md", // symlink out of the root
    "/s/../x/y",
    "/s/only-one-segment",
    "/s/a/b/c",
  ];
  for (const p of rejected) {
    const route = resolveRoute(p, { root });
    assert.equal(route.kind, "invalid", `${p} must not resolve (got ${route.kind})`);
    assert.equal(typeof route.reason, "string", `${p} carries a reason`);
    assert.equal(route.path, undefined, `${p} yields no path`);
  }

  // A malformed escape yields no path, not a half-decoded one.
  assert.equal(resolveRoute("/n/%zz", { root }).reason, "bad path encoding");

  const { port, get } = await serve(t, root);

  // Over the wire, sent verbatim. `fetch` normalises both `..` and its
  // percent-encoded spellings out of a path, so neither dot form can be
  // driven through it — a raw socket is what puts the guard under load.
  for (const target of [
    "/n/../../etc/passwd",
    "/n/../secret",
    "/n/%2e%2e/%2e%2e/etc/passwd",
    "/n/playbooks/%2E%2E/%2E%2E/secret",
    "/s/../x/y",
  ]) {
    const raw = await rawGet(port, target);
    assert.equal(statusOf(raw), 400, target);
    assert.ok(!raw.includes("Not In The Root"), "a rejected route reveals no content");
    assert.ok(!raw.includes(root), "a rejected route reveals no filesystem path");
  }

  // `%2f` and a symlink are not dot segments, so these do survive `fetch`.
  for (const p of ["/n/playbooks/a%2Fb", "/n/playbooks/escape.md"]) {
    const res = await get(p);
    assert.equal(res.status, 400, p);
    const body = await res.text();
    assert.match(body, /escapes HUD_ROOT|bad path/, p);
    assert.ok(!body.includes("Not In The Root"), "a rejected route reveals no content");
    assert.ok(!body.includes(root), "a rejected route reveals no filesystem path");
  }

  // The escape does not become reachable through /api/md either.
  const viaApi = await get("/api/md?path=" + encodeURIComponent("playbooks/escape.md"));
  assert.equal(viaApi.status, 400, "/api/md rejects the same symlink");
});

test("unknown deep link serves shell not 500", async (t) => {
  const root = fixture(t, TREE);
  const { get } = await serve(t, root);

  for (const p of [
    "/n/inbox/never-written",
    "/n/projects/project-z/no-such-note",
    "/n/deeply/nested/path/that/is/not/here",
    "/n/playbooks/example-playbook.txt", // right stem, wrong extension
    "/s/no-such-group/no-such-id",
    "/s/project-a-slug/0000-0000",
  ]) {
    await assertShell(await get(p), p);
  }

  // A directory is well-formed too: the client resolves it to nothing and
  // says so, rather than the server deciding it is an error.
  await assertShell(await get("/n/playbooks"), "/n/playbooks (a directory)");
});

// --------------------------------------------------------- adjacent routes

test("non-GET on a deep link is refused", async (t) => {
  const root = fixture(t, TREE);
  const { request } = await serve(t, root);

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const p of ["/n/playbooks/example-playbook", "/s/project-a-slug/0f1e2d3c"]) {
      const res = await request(p, method);
      assert.equal(res.status, 405, `${method} ${p}`);
      assert.equal((await res.text()).trim(), "method not allowed");
    }
  }

  // The watch-only invariant is unchanged: the one POST route still answers,
  // and it is not a content route.
  const refresh = await request("/api/refresh/peers", "POST");
  assert.ok(refresh.status === 200 || refresh.status === 503, "refresh/peers still answers");
});

test("api/md is unchanged by deep-link routing", async (t) => {
  const bytes = "---\ntitle: Example\n---\n\n# Example\n\nbody with a literal % and é\n";
  const root = fixture(t, { ...TREE, "playbooks/example-playbook.md": bytes });
  const { get } = await serve(t, root);

  const res = await get("/api/md?path=" + encodeURIComponent("playbooks/example-playbook.md"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  const served = Buffer.from(await res.arrayBuffer());
  const onDisk = fs.readFileSync(path.join(root, "playbooks/example-playbook.md"));
  assert.equal(Buffer.compare(served, onDisk), 0, "byte-exact");

  // /api/md is still the only way to get the bytes: the deep link is a shell.
  const deep = await (await get("/n/playbooks/example-playbook")).text();
  assert.ok(!deep.includes("body with a literal"), "the deep link serves no content");

  // And its own error contract is untouched.
  assert.equal((await get("/api/md")).status, 400, "missing ?path");
  assert.equal((await get("/api/md?path=inbox/never-written.md")).status, 404);
  assert.equal((await get("/api/md?path=" + encodeURIComponent("../escape.md"))).status, 400);

  // Unrelated routes still answer as before.
  assert.equal((await get("/api/tree")).status, 200);
  assert.equal((await get("/ui/index.html")).status, 200);
  assert.equal((await get("/no/such/route")).status, 404, "a non-deep-link miss is still 404");
});

// ------------------------------------------------- server/client rule parity
//
// The page needs the path rules client-side to read and write `location`
// without a round-trip, so they exist in two places. This extracts the block
// ui/index.html marks with sentinel comments and checks the two agree, which
// is what makes the duplication safe to keep.

/** The `--- route rules ---` block out of the page, as callable functions. */
function clientRouteRules() {
  const html = fs.readFileSync(path.join(UI_DIR, "index.html"), "utf8");
  const m = /\/\/ --- route rules[^\n]*\n([\s\S]*?)\n\s*\/\/ --- end route rules ---/.exec(html);
  assert.ok(m, "ui/index.html still marks its route-rules block");
  const src = m[1];
  for (const name of ["parseRoute", "encodePath", "entryUrl", "sessionUrl"]) {
    assert.match(src, new RegExp(`function ${name}\\b`), `the block still defines ${name}`);
  }
  // Prose in the block mentions the page, so purity is judged on uses of the
  // globals, not on the words appearing anywhere.
  assert.ok(
    !/\b(document|window|navigator|location|history)\s*[.[]/.test(src) && !/\bfetch\s*\(/.test(src),
    "the block stays pure — no DOM, no network",
  );
  return new Function(`${src}\nreturn { parseRoute, entryUrl, sessionUrl };`)();
}

test("client route rules mirror the server's", () => {
  const { parseRoute, entryUrl, sessionUrl } = clientRouteRules();

  // Agreement on what a pathname names. The server is asked without a root so
  // both sides answer the pure question: which kind, and which path as written.
  for (const pathname of [
    "/n/playbooks/example-playbook",
    "/n/playbooks/example-playbook.md",
    "/n/projects/project-a/2026-01-02-a-decision",
    "/n/inbox/a%20note%20with%20spaces",
    "/s/project-a-slug/0f1e2d3c",
    "/",
    "/index.html",
    "/api/tree",
    "/ui/marked.min.js",
  ]) {
    const server = resolveRoute(pathname);
    const client = parseRoute(pathname);
    assert.equal(client.kind, server.kind, pathname);
    assert.equal(client.path, server.path, pathname);
    assert.equal(client.group, server.group, pathname);
    assert.equal(client.id, server.id, pathname);
  }

  // The URLs the page writes are the URLs the server reads back.
  const root = "/tmp/hud-nonexistent-root-for-parity";
  for (const rel of [
    "playbooks/example-playbook.md",
    "projects/project-a/CONTEXT.md",
    "inbox/a note with spaces.md",
    "projects/project-a/raw/drop.txt",
  ]) {
    const url = entryUrl(rel);
    const server = resolveRoute(url, { root });
    assert.equal(server.kind, "entry", url);
    // Nothing exists under that root, so the server reports the slug verbatim
    // — which must be `rel` minus a trailing `.md`.
    assert.equal(server.path, rel.replace(/\.md$/i, ""), url);
    assert.equal(parseRoute(url).path, server.path, url);
  }

  const surl = sessionUrl("project-a-slug", "0f1e2d3c");
  assert.equal(surl, "/s/project-a-slug/0f1e2d3c");
  assert.deepEqual(resolveRoute(surl), { kind: "session", group: "project-a-slug", id: "0f1e2d3c" });
});
