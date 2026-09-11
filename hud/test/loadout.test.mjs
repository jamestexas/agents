// Hermetic tests for /api/loadout — provenance and drift.
//
// Every case builds its own tmp tree: a `~/.claude`-shaped root, two fixture
// repositories, and a HUD root, all under one mkdtemp directory. Nothing here
// reads the real home directory, so these run beside a HUD already serving on
// its usual port and produce the same result on any machine.
//
// No fixture carries a real person, company, repository or skill name. One
// fixture *does* carry a settings file, on purpose: its values are the canary
// for the "names and paths only" rule, which the last case checks by grepping
// the whole response body for them.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildLoadout, createServer, decodeProjectSlug } from "../server.mjs";

const UI_DIR = path.join(import.meta.dirname, "..", "ui");

/** A value that must never appear in a response, however the panel evolves. */
const SETTINGS_CANARY = "canary-value-must-not-be-served";

/**
 * The whole world for one case.
 *
 * ```
 * <tmp>/claude/{skills,agents,projects}     the `~/.claude` stand-in
 * <tmp>/repo-one/skills/{alpha,delta,epsilon}
 * <tmp>/repo-one/.claude/{skills/zeta, agents/two.md, settings.json}
 * <tmp>/repo-two/skills/beta
 * <tmp>/hud-tree/_hud/skills/beta           the HUD's own canonical skill
 * ```
 *
 * `claude/skills` then links into those: `alpha` one hop into repo-one,
 * `beta` two hops (repo-two, then the HUD tree), `gamma` into nothing, and
 * `delta` is a real directory that shadows repo-one's skill of that name.
 */
function world(t) {
  // Realpath'd so the project slug we synthesise below decodes to the same
  // string the server reports (macOS /var is a symlink to /private/var).
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hud-loadout-")));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const p = (...parts) => path.join(tmp, ...parts);
  const mkdir = (...parts) => {
    fs.mkdirSync(p(...parts), { recursive: true });
    return p(...parts);
  };
  const write = (rel, contents) => {
    fs.mkdirSync(path.dirname(p(rel)), { recursive: true });
    fs.writeFileSync(p(rel), contents);
  };

  for (const rel of [
    "claude/skills",
    "claude/agents",
    "claude/projects",
    "repo-one/skills/alpha",
    "repo-one/skills/delta",
    "repo-one/skills/epsilon",
    "repo-one/.claude/skills/zeta",
    "repo-one/.claude/agents",
    "repo-two/skills/beta",
    "hud-tree/_hud/skills/beta",
  ]) {
    mkdir(rel);
  }

  write("repo-one/skills/alpha/SKILL.md", "# alpha\n");
  write("repo-one/.claude/agents/two.md", "# two\n");
  write("repo-one/.claude/settings.json", JSON.stringify({ env: { TOKEN: SETTINGS_CANARY } }));
  write("claude/settings.json", JSON.stringify({ env: { TOKEN: SETTINGS_CANARY } }));

  // repo-two's `beta` is itself a link into the HUD tree: the two-hop chain.
  fs.symlinkSync(p("hud-tree/_hud/skills/beta"), p("repo-two/skills/beta-link"));
  fs.rmSync(p("repo-two/skills/beta"), { recursive: true });
  fs.renameSync(p("repo-two/skills/beta-link"), p("repo-two/skills/beta"));

  fs.symlinkSync(p("repo-one/skills/alpha"), p("claude/skills/alpha"));
  fs.symlinkSync(p("repo-two/skills/beta"), p("claude/skills/beta"));
  fs.symlinkSync(p("nowhere/gamma"), p("claude/skills/gamma"));
  mkdir("claude/skills/delta"); // a real directory, not a link: the collision
  write("claude/agents/one.md", "# one\n");

  // One slug that decodes to a directory that is really there (which is how
  // repo-one and repo-two become "known"), and one that decodes to nothing.
  const slugFor = (abs) => abs.split("/").join("-");
  fs.mkdirSync(p("claude/projects", slugFor(p("repo-one"))));
  fs.mkdirSync(p("claude/projects", slugFor(p("repo-two"))));
  fs.mkdirSync(p("claude/projects", slugFor(p("repo-of-a-prior-machine"))));

  return {
    tmp,
    p,
    claudeRoot: p("claude"),
    hudRoot: p("hud-tree"),
    staleSlug: slugFor(p("repo-of-a-prior-machine")),
  };
}

/** The loadout as the route would build it. */
function loadout(t) {
  const w = world(t);
  return { w, out: buildLoadout({ claudeRoot: w.claudeRoot, hudRoot: w.hudRoot }) };
}

const skill = (out, name) => out.inventory.skills.find((s) => s.name === name);
const flags = (out, flag) => out.drift.filter((d) => d.flag === flag);

/** Serve a HUD whose root is the fixture HUD tree, with a config on disk. */
async function serve(t, hudRoot, config) {
  if (config !== undefined) {
    fs.writeFileSync(path.join(hudRoot, "hud.config.json"), JSON.stringify(config));
  }
  const server = createServer({ root: hudRoot, uiDir: UI_DIR });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    get: (p) => fetch(base + p, { cache: "no-store" }),
    request: (p, method) => fetch(base + p, { method, cache: "no-store" }),
  };
}

// ------------------------------------------------------ required behaviors

test("symlink provenance resolved", (t) => {
  const { w, out } = loadout(t);

  // One hop: the chain names the repository directory the link points at, and
  // the row is attributed to the repository that owns it.
  assert.deepEqual(skill(out, "alpha"), {
    name: "alpha",
    kind: "symlink",
    chain: [w.p("repo-one/skills/alpha")],
    targetExists: true,
    root: "repo:repo-one",
  });

  // Two hops: every resolved target is listed, in order, and the root is the
  // tree the *last* hop lands in — the HUD's own, not the one in between.
  assert.deepEqual(skill(out, "beta"), {
    name: "beta",
    kind: "symlink",
    chain: [w.p("repo-two/skills/beta"), w.p("hud-tree/_hud/skills/beta")],
    targetExists: true,
    root: "hud",
  });

  // A real directory has no chain at all — that is how the panel tells a
  // linked skill from a locally-authored one.
  assert.deepEqual(skill(out, "delta"), {
    name: "delta",
    kind: "dir",
    chain: [],
    targetExists: true,
    root: "standalone",
  });

  // Agents are inventoried by the same rules; a plain file reads as a file.
  assert.deepEqual(out.inventory.agents, [
    { name: "one.md", kind: "file", chain: [], targetExists: true, root: "standalone" },
  ]);

  // The known repositories are the ones the slugs decoded to, plus the HUD
  // tree, and each reports its `.claude` by name only.
  const one = out.repos.find((r) => r.repo === "repo-one");
  assert.equal(one.hasDotClaude, true);
  assert.deepEqual(one.carries, {
    skills: ["zeta"],
    agents: ["two.md"],
    settings: ["settings.json"],
  });
  const two = out.repos.find((r) => r.repo === "repo-two");
  assert.equal(two.hasDotClaude, false);
  assert.deepEqual(two.carries, { skills: [], agents: [], settings: [] });
  assert.deepEqual(
    out.repos.map((r) => r.repo).sort(),
    ["hud-tree", "repo-one", "repo-two"],
    "discovery is slugs-that-exist plus the HUD tree, and nothing else",
  );
});

test("broken symlink flagged", (t) => {
  const { w, out } = loadout(t);

  assert.deepEqual(skill(out, "gamma"), {
    name: "gamma",
    kind: "symlink",
    chain: [w.p("nowhere/gamma")],
    targetExists: false,
    root: "standalone",
  });

  assert.deepEqual(flags(out, "broken-symlink"), [
    {
      flag: "broken-symlink",
      severity: "hot",
      kind: "skill",
      name: "gamma",
      target: w.p("nowhere/gamma"),
    },
  ]);

  // Repairing it clears the flag: the check reads the filesystem, it does not
  // remember a name.
  fs.mkdirSync(w.p("nowhere/gamma"), { recursive: true });
  const after = buildLoadout({ claudeRoot: w.claudeRoot, hudRoot: w.hudRoot });
  assert.deepEqual(flags(after, "broken-symlink"), []);
  assert.equal(skill(after, "gamma").targetExists, true);
});

test("unlinked repo skill flagged", (t) => {
  const { w, out } = loadout(t);

  // `epsilon` (repo-one/skills) and `zeta` (repo-one/.claude/skills) exist in
  // a known repository and are absent from the Claude root. `alpha`, `beta`
  // and `delta` are all present under their own names, so none is unlinked.
  assert.deepEqual(
    flags(out, "unlinked-repo-skill").map((d) => `${d.repo}/${d.name}`).sort(),
    ["repo-one/epsilon", "repo-one/zeta"],
  );
  assert.equal(flags(out, "unlinked-repo-skill")[0].severity, "warn");

  // Linking one of them clears exactly that flag.
  fs.symlinkSync(w.p("repo-one/skills/epsilon"), w.p("claude/skills/epsilon"));
  const after = buildLoadout({ claudeRoot: w.claudeRoot, hudRoot: w.hudRoot });
  assert.deepEqual(
    flags(after, "unlinked-repo-skill").map((d) => `${d.repo}/${d.name}`),
    ["repo-one/zeta"],
  );
  assert.equal(skill(after, "epsilon").root, "repo:repo-one");
});

test("stale project slug flagged", (t) => {
  const { w, out } = loadout(t);

  // No reading of this slug exists on disk, so the reported path is the naive
  // full decode — every `-` a separator. Crude, and deliberately so: with
  // nothing on disk to break the tie there is no better guess, and the flag's
  // job is to name the slug, not to reconstruct a directory that is gone.
  assert.deepEqual(flags(out, "stale-project-slug"), [
    {
      flag: "stale-project-slug",
      severity: "warn",
      slug: w.staleSlug,
      path: "/" + w.staleSlug.slice(1).split("-").join("/"),
    },
  ]);

  // The two slugs that name real directories are not flagged — the hyphenated
  // segments in the tmp path itself would be decoded wrong by a naive
  // `split("-").join("/")`, so this is the existence-guided decode working.
  assert.equal(flags(out, "stale-project-slug").length, 1);

  // And the decoder in isolation, against an injected filesystem: the longest
  // real segment wins, and an unreadable slug falls back to the naive decode.
  const real = new Set(["/w", "/w/a-b", "/w/a-b/c", "/w/a", "/w/a/b"]);
  assert.deepEqual(decodeProjectSlug("-w-a-b-c", { exists: (p) => real.has(p) }), {
    path: "/w/a-b/c",
    exists: true,
  });
  assert.deepEqual(decodeProjectSlug("-w-a-b", { exists: (p) => real.has(p) }), {
    path: "/w/a-b",
    exists: true,
  });
  assert.deepEqual(decodeProjectSlug("-w-x-y", { exists: (p) => real.has(p) }), {
    path: "/w/x/y",
    exists: false,
  });
});

test("collision flagged", (t) => {
  const { w, out } = loadout(t);

  // `delta` is a directory in the Claude root *and* a directory in repo-one.
  // Two definitions of one name; the HUD says so and says nothing about which
  // one the harness would pick.
  assert.deepEqual(flags(out, "name-collision"), [
    {
      flag: "name-collision",
      severity: "hot",
      kind: "skill",
      name: "delta",
      repo: "repo-one",
      installed: w.p("claude/skills/delta"),
      repoPath: w.p("repo-one/skills/delta"),
    },
  ]);

  // `alpha` resolves *to* repo-one's copy, so a shared name is not a collision
  // when it is the same bytes — that is the whole distinction being drawn.
  assert.ok(
    !flags(out, "name-collision").some((d) => d.name === "alpha"),
    "a link into the repo is provenance, not collision",
  );

  // Replace the shadowing directory with a link to the repo's copy and the
  // collision becomes ordinary provenance.
  fs.rmSync(w.p("claude/skills/delta"), { recursive: true });
  fs.symlinkSync(w.p("repo-one/skills/delta"), w.p("claude/skills/delta"));
  const after = buildLoadout({ claudeRoot: w.claudeRoot, hudRoot: w.hudRoot });
  assert.deepEqual(flags(after, "name-collision"), []);
  assert.equal(skill(after, "delta").root, "repo:repo-one");
});

test("loadout is get only", async (t) => {
  const w = world(t);
  const { get, request } = await serve(t, w.hudRoot, {
    sources: { loadout: { claude_root: w.claudeRoot } },
  });

  const res = await get("/api/loadout");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^application\/json/);
  const body = await res.json();
  assert.equal(body.source, "loadout");
  assert.equal(body.root, w.claudeRoot);
  assert.ok(Array.isArray(body.drift) && Array.isArray(body.inventory.skills));

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = await request("/api/loadout", method);
    assert.equal(r.status, 405, `${method} /api/loadout`);
    assert.equal((await r.text()).trim(), "method not allowed");
  }

  // HEAD is a GET without a body, so it is allowed and must not 405.
  assert.equal((await request("/api/loadout", "HEAD")).status, 200);

  // Nothing was written: the route reads, and reads only.
  assert.ok(!fs.existsSync(path.join(w.hudRoot, ".generated")), "no snapshot is cached");
});

test("no file contents in response", async (t) => {
  const w = world(t);
  const { get } = await serve(t, w.hudRoot, {
    sources: { loadout: { claude_root: w.claudeRoot } },
  });

  const text = await (await get("/api/loadout")).text();

  // Both settings files hold the canary. Neither is opened, so neither value
  // can reach the wire — nor may any key from them.
  assert.ok(!text.includes(SETTINGS_CANARY), "no settings value reaches the response");
  assert.ok(!text.includes('"TOKEN"'), "no settings key reaches the response");
  assert.ok(!text.includes("# alpha"), "no SKILL.md body reaches the response");
  assert.ok(!text.includes("# two"), "no agent body reaches the response");

  // The file that carries the canary is still *named*, which is the contract:
  // names and paths, never contents.
  const body = JSON.parse(text);
  const one = body.repos.find((r) => r.repo === "repo-one");
  assert.deepEqual(one.carries.settings, ["settings.json"]);
});

// --------------------------------------------------------------- the panel
//
// The builders need a DOM, so they are not evaluated here the way the pure
// blocks in routes/ui-meta are. What is checked is the part that can rot
// silently: that the panel is wired into both paint paths, and that the block
// stays watch-only — no link out, no navigation, no request, no handler.

test("loadout panel is wired and watches only", () => {
  const html = fs.readFileSync(path.join(UI_DIR, "index.html"), "utf8");

  for (const id of ["wrap-loadout", "panel-loadout", "stamp-loadout"]) {
    assert.ok(html.includes(`id="${id}"`), `the shell declares ${id}`);
  }

  // Definition, ⟳, first paint. Fewer means a path that never renders it.
  assert.equal(
    (html.match(/loadLoadout/g) || []).length,
    3,
    "loadLoadout is defined, refreshed, and painted",
  );

  const start = html.indexOf("// ------------------------------------------------------ loadout panel");
  const end = html.indexOf("/** @returns the envelope, or null when the source has nothing to show. */");
  assert.ok(start !== -1 && end > start, "the loadout block is still marked");
  const block = html.slice(start, end);

  assert.match(block, /function buildLoadout\b/, "the block still builds the panel");
  assert.ok(!/linkOut\s*\(/.test(block), "the panel links out nowhere");
  assert.ok(!/addEventListener|\.href\s*=|fetch\s*\(|history\./.test(block), "no actions");
  assert.ok(!/https?:\/\//.test(block), "no URLs at all, external or otherwise");
});

// ------------------------------------------------------- panel-off contract

test("loadout off answers 404", async (t) => {
  const w = world(t);
  const { get } = await serve(t, w.hudRoot, { sources: { loadout: false } });

  const res = await get("/api/loadout");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).source, "loadout");
});

test("loadout defaults on when unconfigured", async (t) => {
  const w = world(t);
  // No `loadout` key at all: the panel exists and falls back to the default
  // root, which is the real `~/.claude` — so only the envelope is asserted.
  const { get } = await serve(t, w.hudRoot, { sources: {} });

  const res = await get("/api/loadout");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.root, path.join(os.homedir(), ".claude"));
});
