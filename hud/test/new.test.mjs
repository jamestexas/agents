// Hermetic tests for `hud new` — the authoring verb, and the contract it
// turns from prose into behaviour.
//
// What is under test is not "does it write a file" but the four things
// skills/hud/SKILL.md §2–§7 asked a caller to remember and get right by hand:
// which of the six shapes goes where, the date prefix and the kebab slug, the
// frontmatter keys legal for that kind, and the two bookkeeping appends owed
// after every write.
//
// Every case runs the real `hud/hud` against its own throwaway tree under
// os.tmpdir(), scaffolded by `hud init --root <tmp>` — HUD_ROOT is set to the
// same place, so a bug that read the environment instead of the resolved root
// still could not reach anyone's notes. The tests also run with cwd set to
// that throwaway tree's parent, because project inference reads the working
// directory; leaving cwd at the repo would make the inference cases depend on
// where the suite was invoked from.
//
// `--date` is passed everywhere a date prefix is involved. A suite that used
// today's date would pass on the day it was written and start asserting
// against a moving filename the next.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildTree, inferType, parseFrontmatter } from "../server.mjs";

const MACHINERY = path.dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const HUD_CLI = path.join(MACHINERY, "hud");

/** Fixed so a filename assertion means the same thing tomorrow. */
const DAY = "2026-04-07";

/**
 * A scaffolded throwaway tree, plus the directory to run from. `hud init`
 * builds it rather than a hand-rolled fixture: the thing `new` appends to has
 * to be the thing `init` actually writes, or the two drift and only the real
 * tree finds out.
 */
function tree(t, name) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `hud-new-${name}-`));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "tree");
  execFileSync("bash", [HUD_CLI, "init", "--root", root, "--yes"], {
    encoding: "utf8",
    cwd: parent,
    env: { ...process.env, HUD_ROOT: root, PATH: offlinePath() },
  });
  return { parent, root };
}

/**
 * `gh` is omitted so init's probe cannot reach out, and git is left real so
 * the scaffold still commits. Built once — it is a few thousand symlinks.
 */
let PATH_SANDBOX = null;
const PATH_DIRS = [];
process.on("exit", () => {
  for (const dir of PATH_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});
function offlinePath() {
  if (PATH_SANDBOX) return PATH_SANDBOX;
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "hud-new-bin-"));
  PATH_DIRS.push(bin);
  PATH_SANDBOX = bin;
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === "gh") continue;
      const dest = path.join(bin, name);
      if (fs.existsSync(dest)) continue;
      try {
        fs.symlinkSync(path.join(dir, name), dest);
      } catch {
        /* unreadable or racing entry — the real PATH entry just stays absent */
      }
    }
  }
  return bin;
}

/** Run `hud new`, returning stdout. Throws on a refusal, as the caller would see. */
function run({ root, cwd }, args, opts = {}) {
  return execFileSync("bash", [HUD_CLI, "new", ...args], {
    encoding: "utf8",
    cwd: cwd || path.dirname(root),
    env: { ...process.env, HUD_ROOT: root, PATH: offlinePath() },
    ...opts,
  });
}

/** Run and capture the refusal instead of throwing: status, stdout, stderr. */
function runFailing(ctx, args, opts = {}) {
  try {
    const stdout = run(ctx, args, opts);
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: err.status,
      stdout: String(err.stdout || ""),
      stderr: String(err.stderr || ""),
    };
  }
}

/** Every file in the tree, path → contents. The before/after of a dry run. */
function snapshot(root) {
  const out = new Map();
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(child);
      else if (d.isFile()) out.set(child, fs.readFileSync(path.join(root, child), "utf8"));
      else out.set(child, "<not a regular file>");
    }
  };
  walk("");
  return out;
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

/** Lines in a bookkeeping file that mention this path. */
function mentions(root, file, rel) {
  return read(root, file)
    .split("\n")
    .filter((line) => line.includes(rel));
}

// --------------------------------------------------------------- 1. paths

// The six shapes of SKILL.md §2–§6, each asserted at the path the docs give
// for it — including the date prefix and the slug derived from the title.
// The slug case is SKILL.md §2's own worked example, article and all:
// "debugging the flaky retry test" is documented as
// `2026-09-10-debugging-flaky-retry-test.md`, so the dropped "the" is part of
// the contract and not a nicety of this implementation.
const KINDS = [
  {
    name: "note",
    args: ["note", "--project", "widget-service", "--title", "debugging the flaky retry test"],
    rel: `projects/widget-service/notes/${DAY}-debugging-flaky-retry-test.md`,
    type: "note",
  },
  {
    name: "inbox",
    args: ["inbox", "--title", "a thought with no home"],
    rel: `inbox/${DAY}-thought-with-no-home.md`,
    type: "note",
  },
  {
    name: "playbook",
    args: ["playbook", "--title", "Rotating the signing key"],
    rel: "playbooks/rotating-signing-key.md",
    type: "playbook",
  },
  {
    name: "context",
    args: ["context", "--project", "widget-service"],
    rel: "projects/widget-service/CONTEXT.md",
    type: "context",
  },
  {
    name: "peer",
    args: ["peer", "--handle", "Octo-Cat"],
    rel: "peers/octo-cat.md",
    type: "peer",
  },
  {
    name: "raw",
    args: [
      "raw",
      "--project",
      "widget-service",
      "--title",
      "session transcript",
      "--ext",
      "txt",
      "--body",
      "an immutable drop",
    ],
    rel: `projects/widget-service/raw/${DAY}-session-transcript.txt`,
    type: null, // not an .md entry, so the tree walker gives it no type
  },
];

for (const kind of KINDS) {
  test(`${kind.name} lands at the documented path, with the derived prefix and slug`, (t) => {
    const ctx = tree(t, kind.name);
    run(ctx, [...kind.args, "--date", DAY]);

    assert.ok(fs.existsSync(path.join(ctx.root, kind.rel)), `expected ${kind.rel}`);
    // The destination is derived, not merely accepted: nothing else appeared.
    const written = [...snapshot(ctx.root).keys()].filter(
      (p) => !["index.md", "log.md"].includes(p) && !p.startsWith("."),
    );
    assert.ok(
      written.includes(kind.rel),
      `wrote ${JSON.stringify(written)} rather than ${kind.rel}`,
    );
    if (kind.type) assert.equal(inferType(kind.rel), kind.type);
  });
}

test("what it writes parses cleanly with the server's own frontmatter parser", (t) => {
  const ctx = tree(t, "parses");
  for (const kind of KINDS) run(ctx, [...kind.args, "--date", DAY]);

  // A verb that writes frontmatter the HUD itself flags is worse than one that
  // writes none: `warn` makes the tree walker throw the whole map away and
  // fall back to filesystem defaults, silently.
  for (const kind of KINDS) {
    const parsed = parseFrontmatter(read(ctx.root, kind.rel));
    assert.equal(parsed.warn, false, `${kind.rel} has frontmatter the HUD cannot read`);
  }
  const listed = buildTree(ctx.root).sections.flatMap((s) => s.entries.map((e) => e.path));
  for (const kind of KINDS) assert.ok(listed.includes(kind.rel), `${kind.rel} is not in the tree`);
});

test("frontmatter carries the keys each kind's section of SKILL.md specifies", (t) => {
  const ctx = tree(t, "frontmatter");

  run(ctx, ["note", "--project", "p", "--title", "a note", "--date", DAY, "--set", "tags=retry"]);
  assert.deepEqual(parseFrontmatter(read(ctx.root, `projects/p/notes/${DAY}-note.md`)).data, {
    title: "a note",
    date: DAY,
    type: "note",
    tags: ["retry"],
  });

  run(ctx, ["playbook", "--title", "rotate", "--date", DAY, "--set", "applies_to=[p, q]"]);
  assert.deepEqual(parseFrontmatter(read(ctx.root, "playbooks/rotate.md")).data, {
    title: "rotate",
    type: "playbook",
    last_verified: DAY,
    applies_to: ["p", "q"],
  });

  run(ctx, ["peer", "--handle", "octo-cat", "--set", "repos=acme/widget"]);
  assert.deepEqual(parseFrontmatter(read(ctx.root, "peers/octo-cat.md")).data, {
    gh: "octo-cat",
    repos: ["acme/widget"],
  });

  // A raw drop is an immutable artifact, not an entry with a schema: the file
  // is exactly what was handed over.
  run(ctx, ["raw", "--project", "p", "--title", "dump", "--date", DAY, "--body", "verbatim"]);
  assert.equal(read(ctx.root, `projects/p/raw/${DAY}-dump.md`), "verbatim\n");
});

test("a context with no --title gets SKILL.md §5's template, not an invented shape", (t) => {
  const ctx = tree(t, "context-template");
  run(ctx, ["context", "--project", "widget-service"]);

  const text = read(ctx.root, "projects/widget-service/CONTEXT.md");
  assert.deepEqual(parseFrontmatter(text).data, { status: "active" });
  for (const heading of ["## Goal", "## State", "## Key paths", "## Decisions"]) {
    assert.ok(text.includes(heading), `CONTEXT.md is missing ${heading}`);
  }
});

// ------------------------------------------------- 2. illegal frontmatter

test("a frontmatter key not legal for the kind is refused, not written", (t) => {
  const ctx = tree(t, "illegal-key");

  // `gh` is real, and legal — on a peer. On a note it is a key the UI will
  // never read, so accepting it would put a dead field in the tree.
  const r = runFailing(ctx, ["note", "--project", "p", "--title", "x", "--set", "gh=octo-cat"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /gh is not a legal frontmatter key for kind note/);
  assert.match(r.stderr, /legal: status, tags, repos, tickets/);
  assert.equal(fs.existsSync(path.join(ctx.root, "projects/p")), false, "it wrote anyway");

  // Same key, legal kind: the refusal is about the pairing, not the key.
  run(ctx, ["peer", "--handle", "octo-cat", "--set", "gh=octo"]);
  assert.equal(parseFrontmatter(read(ctx.root, "peers/octo-cat.md")).data.gh, "octo");
});

test("each kind refuses a key that belongs to a different kind", (t) => {
  const ctx = tree(t, "illegal-matrix");
  const cases = [
    { args: ["note", "--project", "p", "--title", "x"], key: "applies_to=y" },
    { args: ["inbox", "--title", "x"], key: "links=y" },
    { args: ["playbook", "--title", "x"], key: "gh=y" },
    { args: ["context", "--project", "p"], key: "tags=y" },
    { args: ["peer", "--handle", "h"], key: "tickets=y" },
  ];
  for (const c of cases) {
    const r = runFailing(ctx, [...c.args, "--date", DAY, "--set", c.key]);
    assert.notEqual(r.status, 0, `${c.args[0]} accepted ${c.key}`);
    assert.match(r.stderr, /is not a legal frontmatter key for kind/);
  }
  // Nothing in the matrix above wrote an entry.
  const written = [...snapshot(ctx.root).keys()].filter((p) => p.endsWith(".md"));
  assert.deepEqual(written.sort(), ["HUD.md", "index.md", "log.md"]);
});

test("a key the verb derives is refused rather than silently overridden", (t) => {
  const ctx = tree(t, "derived");
  const base = ["note", "--project", "p", "--title", "x", "--date", DAY];

  // `type` disagreeing with the directory renders a lie the tree walker cannot
  // see past; `title`/`date` disagreeing with the filename makes the slug and
  // the prefix a fiction. Overriding either quietly is the failure to avoid.
  assert.match(runFailing(ctx, [...base, "--set", "type=peer"]).stderr, /type is derived/);
  assert.match(runFailing(ctx, [...base, "--set", "title=other"]).stderr, /title is derived/);
  assert.match(runFailing(ctx, [...base, "--set", "date=1999-01-01"]).stderr, /date is derived/);

  // And a raw drop refuses the whole idea rather than a key at a time.
  const raw = runFailing(ctx, ["raw", "--project", "p", "--title", "d", "--body", "b", "--set", "tags=x"]);
  assert.match(raw.stderr, /kind raw carries no frontmatter/);
});

test("a frontmatter value cannot smuggle in a newline", (t) => {
  const ctx = tree(t, "newline");
  const r = runFailing(ctx, [
    "note", "--project", "p", "--title", "x", "--date", DAY,
    "--set", "status=active\n---\nbody",
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot contain a newline/);
});

// ----------------------------------------------------- 3. the two appends

test("both bookkeeping appends happen, and a repeat write adds neither", (t) => {
  const ctx = tree(t, "bookkeeping");
  const rel = `projects/widget-service/notes/${DAY}-retry-flake.md`;
  const args = [
    "note", "--project", "widget-service", "--title", "retry flake",
    "--date", DAY, "--summary", "why the retry test flakes",
  ];

  run(ctx, args);
  assert.deepEqual(mentions(ctx.root, "index.md", rel), [
    `- [retry flake](${rel}) — why the retry test flakes`,
  ]);
  assert.deepEqual(mentions(ctx.root, "log.md", rel), [`- ${DAY}: added note ${rel}`]);

  // The second call is the same request, so the destination is the same file.
  // It is refused — and the refusal is what makes the bookkeeping idempotent:
  // neither catalog nor log grows a duplicate.
  const before = snapshot(ctx.root);
  const again = runFailing(ctx, args);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already exists/);
  assert.deepEqual([...snapshot(ctx.root)], [...before], "a refused write changed the tree");
  assert.equal(mentions(ctx.root, "index.md", rel).length, 1);
  assert.equal(mentions(ctx.root, "log.md", rel).length, 1);
});

test("index.md is a catalog: a path already listed is kept, not listed twice", (t) => {
  const ctx = tree(t, "index-guard");
  const rel = `inbox/${DAY}-hand-catalogued.md`;

  // Index drift in the other direction — a line for a file that is not there
  // yet — is a real state (`hud` lint reports it), and the one that reaches
  // the guard: the file write itself would refuse if the file existed.
  fs.appendFileSync(path.join(ctx.root, "index.md"), `- [by hand](${rel}) — added manually\n`);

  const out = run(ctx, ["inbox", "--title", "hand catalogued", "--date", DAY]);
  assert.match(out, /index\s+kept/);
  assert.equal(mentions(ctx.root, "index.md", rel).length, 1, "the catalog line was duplicated");
  // log.md is append-only history, not a catalog, so it still records the
  // write — and records the kind that was asked for, which is `inbox`.
  assert.deepEqual(mentions(ctx.root, "log.md", rel), [`- ${DAY}: added inbox ${rel}`]);
});

test("an append does not glue itself onto a file with no trailing newline", (t) => {
  const ctx = tree(t, "no-trailing-newline");
  const index = path.join(ctx.root, "index.md");
  fs.writeFileSync(index, "# index\n\n- [earlier](inbox/earlier.md) — no newline after me");

  run(ctx, ["inbox", "--title", "later", "--date", DAY]);
  const lines = read(ctx.root, "index.md").split("\n");
  assert.ok(lines.includes("- [earlier](inbox/earlier.md) — no newline after me"));
  assert.ok(lines.some((l) => l.startsWith(`- [later](inbox/${DAY}-later.md)`)));
});

// ------------------------------------------------- 4. unresolvable project

test("a note whose project cannot be resolved goes to inbox rather than a guess", (t) => {
  const ctx = tree(t, "inbox-fallback");

  // cwd is the throwaway parent, whose basename matches no directory under
  // projects/ — so there is nothing to infer from and nothing to guess at.
  const out = run(ctx, ["note", "--title", "an unrouted observation", "--date", DAY]);
  assert.match(out, /routed\s+no project resolved/);
  assert.ok(fs.existsSync(path.join(ctx.root, `inbox/${DAY}-unrouted-observation.md`)));
  assert.equal(fs.existsSync(path.join(ctx.root, "projects", path.basename(ctx.parent))), false);
});

test("inference matches the working directory only against a project that exists", (t) => {
  const ctx = tree(t, "infer");
  const workdir = path.join(ctx.parent, "widget-service");
  fs.mkdirSync(workdir);

  // The repo name is the same in both halves; only the project directory
  // differs. Inference that created the directory would make the two
  // indistinguishable, which is exactly the guess SKILL.md §2 forbids.
  run(ctx, ["note", "--title", "before", "--date", DAY], { cwd: workdir });
  assert.ok(fs.existsSync(path.join(ctx.root, `inbox/${DAY}-before.md`)), "should have gone to inbox");

  fs.mkdirSync(path.join(ctx.root, "projects/widget-service"), { recursive: true });
  run(ctx, ["note", "--title", "after", "--date", DAY], { cwd: workdir });
  assert.ok(fs.existsSync(path.join(ctx.root, `projects/widget-service/notes/${DAY}-after.md`)));
});

test("a context or a raw drop refuses instead of routing — neither has an unfiled form", (t) => {
  const ctx = tree(t, "no-unfiled-form");
  for (const args of [["context"], ["raw", "--title", "d", "--body", "b"]]) {
    const r = runFailing(ctx, [...args, "--date", DAY]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no project resolved for kind/);
    assert.match(r.stderr, /has no unfiled form/);
  }
  assert.equal(fs.readdirSync(path.join(ctx.root, "inbox")).length, 1, "only .gitkeep expected");
});

// -------------------------------------------------------------- 5. dry run

test("--dry-run prints the whole plan and leaves the tree byte-identical", (t) => {
  const ctx = tree(t, "dry");
  const before = snapshot(ctx.root);

  const dry = run(ctx, [
    "note", "--project", "widget-service", "--title", "planned only",
    "--date", DAY, "--set", "tags=[a, b]", "--dry-run",
  ]);

  // The plan is the whole plan: destination, every frontmatter key, and both
  // bookkeeping lines. A preview that showed less would not be one.
  assert.match(dry, new RegExp(`dest\\s+projects/widget-service/notes/${DAY}-planned-only\\.md`));
  assert.match(dry, /title\s+planned only/);
  assert.match(dry, /tags\s+\[a, b\]/);
  assert.match(dry, /index\s+append\s+- \[planned only\]/);
  assert.match(dry, new RegExp(`log\\s+append\\s+- ${DAY}: added note`));
  assert.match(dry, /nothing was written/);
  assert.deepEqual([...snapshot(ctx.root)], [...before], "--dry-run wrote something");
});

// ----------------------------------------------------------------- 6. json

test("--json emits one parseable document on success", (t) => {
  const ctx = tree(t, "json-ok");
  const rel = `projects/widget-service/notes/${DAY}-json-shape.md`;
  const doc = JSON.parse(
    run(ctx, [
      "note", "--project", "widget-service", "--title", "json shape",
      "--date", DAY, "--json", "--summary", "the shape of the document",
    ]),
  );

  assert.equal(doc.schema, "hud-new/v1");
  assert.equal(doc.outcome, "created");
  assert.equal(doc.dry_run, false);
  assert.equal(doc.kind, "note");
  assert.equal(doc.path, rel);
  // The root is realpath'd by the CLI, the same way `install.sh` resolves it,
  // so on a machine whose tmpdir is a symlink (macOS /var → /private/var) the
  // comparison has to be too.
  assert.equal(doc.absolute, path.join(fs.realpathSync(ctx.root), rel));
  assert.equal(doc.slug, "json-shape");
  assert.equal(doc.date, DAY);
  assert.equal(doc.routed_to_inbox, false);
  assert.deepEqual(doc.frontmatter, { title: "json shape", date: DAY, type: "note" });
  assert.deepEqual(doc.index, {
    file: "index.md",
    action: "append",
    line: `- [json shape](${rel}) — the shape of the document`,
  });
  assert.deepEqual(doc.log, {
    file: "log.md",
    action: "append",
    line: `- ${DAY}: added note ${rel}`,
  });
  assert.equal(doc.reason, null);
});

test("--json emits one parseable document on refusal, with a non-zero exit", (t) => {
  const ctx = tree(t, "json-refusal");
  const r = runFailing(ctx, [
    "note", "--project", "p", "--title", "x", "--date", DAY, "--set", "gh=octo", "--json",
  ]);

  assert.notEqual(r.status, 0, "a refusal must not exit 0");
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.schema, "hud-new/v1");
  assert.equal(doc.outcome, "refused");
  assert.match(doc.reason, /not a legal frontmatter key for kind note/);
  // Nothing was written, and the document says which write did not happen.
  assert.equal(doc.index, null);
  assert.equal(doc.log, null);
  assert.equal(fs.existsSync(path.join(ctx.root, "projects/p")), false);
});

test("--json is honoured even when the invocation itself is what is wrong", (t) => {
  const ctx = tree(t, "json-usage");
  // An agent that asked for JSON and got English on stderr has to parse prose
  // to learn it failed, which is the one thing the flag exists to avoid.
  for (const args of [["gizmo", "--json"], ["note", "--nonsense", "--json"], ["--json"]]) {
    const r = runFailing(ctx, args);
    assert.notEqual(r.status, 0);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.outcome, "refused");
    assert.equal(typeof doc.reason, "string");
  }
});

test("--dry-run --json reports planned, and still writes nothing", (t) => {
  const ctx = tree(t, "json-dry");
  const before = snapshot(ctx.root);
  const doc = JSON.parse(run(ctx, ["peer", "--handle", "octo-cat", "--dry-run", "--json"]));

  assert.equal(doc.outcome, "planned");
  assert.equal(doc.dry_run, true);
  assert.equal(doc.path, "peers/octo-cat.md");
  assert.deepEqual(doc.frontmatter, { gh: "octo-cat" });
  assert.deepEqual([...snapshot(ctx.root)], [...before]);
});

// ------------------------------------------------------- 7. what it refuses

test("it refuses a tree that has not been scaffolded rather than making one", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "hud-new-noroot-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "absent");

  const r = runFailing({ root, cwd: parent }, ["inbox", "--title", "x", "--date", DAY]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not exist — run 'hud init' first/);
  assert.equal(fs.existsSync(root), false, "a write verb must not scaffold a tree");

  // A directory that exists but has no bookkeeping files is the same refusal:
  // the two appends are not optional, so there is nowhere to make them.
  fs.mkdirSync(root);
  const r2 = runFailing({ root, cwd: parent }, ["inbox", "--title", "x", "--date", DAY]);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /index\.md is missing/);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("a flag that means nothing for the kind is refused, not ignored", (t) => {
  const ctx = tree(t, "wrong-flags");
  // Silently dropping --project leaves the caller believing the note is filed
  // under it, and nothing in the output would say otherwise.
  const cases = [
    { args: ["playbook", "--title", "x", "--project", "p"], re: /takes no --project/ },
    { args: ["note", "--project", "p", "--title", "x", "--handle", "h"], re: /takes no --handle/ },
    { args: ["note", "--project", "p", "--title", "x", "--ext", "txt"], re: /takes no --ext/ },
    { args: ["context", "--project", "p", "--slug", "s"], re: /takes no --slug/ },
    { args: ["peer", "--handle", "h", "--slug", "s"], re: /takes no --slug/ },
  ];
  for (const c of cases) {
    const r = runFailing(ctx, [...c.args, "--date", DAY]);
    assert.notEqual(r.status, 0, `${c.args.join(" ")} was accepted`);
    assert.match(r.stderr, c.re);
  }
});

test("it refuses a request with no usable name for the file", (t) => {
  const ctx = tree(t, "no-name");
  assert.match(runFailing(ctx, ["note", "--project", "p"]).stderr, /needs --title/);
  assert.match(runFailing(ctx, ["peer"]).stderr, /needs --handle/);
  assert.match(runFailing(ctx, ["inbox", "--title", "— …"]).stderr, /nothing kebab-cased/);
  assert.match(runFailing(ctx, ["note", "--project", "p", "--title", ""]).stderr, /empty value/);
  assert.match(runFailing(ctx, ["raw", "--project", "p", "--title", "d"]).stderr, /needs --body/);
  assert.match(
    runFailing(ctx, ["note", "--project", "p", "--title", "x", "--date", "7 April"]).stderr,
    /--date wants YYYY-MM-DD/,
  );
});

test("--body-file reads a file, and - reads stdin", (t) => {
  const ctx = tree(t, "body");
  const src = path.join(ctx.parent, "drop.txt");
  fs.writeFileSync(src, "line one\nline two\n");

  run(ctx, ["raw", "--project", "p", "--title", "from file", "--date", DAY, "--body-file", src]);
  assert.equal(read(ctx.root, `projects/p/raw/${DAY}-from-file.md`), "line one\nline two\n");

  run(ctx, ["inbox", "--title", "from stdin", "--date", DAY, "--body-file", "-"], {
    input: "piped body\n",
  });
  const text = read(ctx.root, `inbox/${DAY}-from-stdin.md`);
  assert.equal(parseFrontmatter(text).body.trim(), "piped body");

  const both = runFailing(ctx, [
    "inbox", "--title", "x", "--date", DAY, "--body", "a", "--body-file", src,
  ]);
  assert.match(both.stderr, /two answers to the same question/);
});
