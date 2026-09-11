// Hermetic tests for the mache index projection (hud-index.mjs).
//
// Each case builds its own HUD root under one mkdtemp directory, so nothing
// here reads the real tree and the result is the same on any machine.
//
// No fixture carries a real person, company, repository or project name. Two
// of them are canaries on purpose: the last case greps the schema for every
// fixture name it just indexed, because the schema's whole claim is that node
// names come from data and none of them are written down.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { buildIndex, entryRecords, levelsFor, panelRecords } from "../hud-index.mjs";

const SCHEMA = path.join(import.meta.dirname, "..", "hud-schema.json");

/** A project name that must never appear in the schema, however it evolves. */
const PROJECT_CANARY = "canary-project-must-not-be-hardcoded";
/** Likewise a tag: tag nodes are named from the value, never enumerated. */
const TAG_CANARY = "canary-tag-must-not-be-hardcoded";

/** A HUD root with one project (brief + dated note + raw drop) and a playbook. */
function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-index-"));
  const write = (rel, body) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };

  write(
    `projects/${PROJECT_CANARY}/CONTEXT.md`,
    `---\ntitle: "brief"\ntype: context\nstatus: active\ntags: ["${TAG_CANARY}"]\ntickets: ["AA-1"]\nrepos: ["owner/repo"]\n---\n\n# brief\n`,
  );
  write(
    `projects/${PROJECT_CANARY}/notes/2026-01-02-a-note.md`,
    `---\ntitle: "a note"\ntags: ["${TAG_CANARY}"]\ntickets: ["AA-1"]\n---\n\n# a note\n`,
  );
  write(`projects/${PROJECT_CANARY}/raw/drop.txt`, "immutable drop\n");
  write("playbooks/a-playbook.md", `---\ntitle: "a playbook"\ntype: playbook\n---\n\n# a playbook\n`);
  write("peers/.gitkeep", "");
  write(
    "hud.toml",
    ['[sources.one]', 'url = "http://127.0.0.1:1/x"', "", "[sources.two]", 'cmd = "echo hi"'].join("\n"),
  );
  return root;
}

test("levelsFor splits a path into the four graph levels", () => {
  assert.deepEqual(levelsFor("projects/p/CONTEXT.md"), {
    section: "projects",
    group: "p",
    subgroup: "_",
    slug: "CONTEXT",
  });
  assert.deepEqual(levelsFor("projects/p/notes/2026-01-02-x.md"), {
    section: "projects",
    group: "p",
    subgroup: "notes",
    slug: "2026-01-02-x",
  });
  // A flat section is its own single group, so every section has one.
  assert.deepEqual(levelsFor("playbooks/x.md"), {
    section: "playbooks",
    group: "playbooks",
    subgroup: "_",
    slug: "x",
  });
  // The archive mirrors the live tree, so its depth exceeds the level count.
  // Remaining directories join rather than collapse: two files in different
  // directories must not claim the same node id.
  assert.deepEqual(levelsFor("archive/projects/p/notes/x.md"), {
    section: "archive",
    group: "projects",
    subgroup: "p-notes",
    slug: "x",
  });
  assert.notDeepEqual(
    levelsFor("archive/projects/p/notes/x.md"),
    levelsFor("archive/projects/p/raw/x.md"),
  );
});

test("only non-md and raw files keep their extension in the slug", () => {
  assert.equal(levelsFor("projects/p/raw/run.sh").slug, "run.sh");
  assert.equal(levelsFor("projects/p/notes/x.MD").slug, "x");
});

test("entry records carry the levels and the frontmatter, and omit what is absent", () => {
  const root = fixtureRoot();
  const records = entryRecords({
    sections: [
      {
        name: "projects",
        entries: [
          { path: `projects/${PROJECT_CANARY}/CONTEXT.md`, title: "brief", tags: ["t"], repos: [] },
        ],
      },
    ],
  });
  assert.equal(records.length, 1);
  const { entry } = records[0].record;
  assert.equal(entry.section, "projects");
  assert.equal(entry.group, PROJECT_CANARY);
  assert.equal(entry.slug, "CONTEXT");
  assert.deepEqual(entry.tags, ["t"]);
  // An empty array would materialize an empty directory node; absent selects
  // nothing, which is the honest projection of "this entry has no repos".
  assert.ok(!("repos" in entry), "empty arrays must be dropped, not emitted");
  assert.ok(!("gh" in entry), "absent frontmatter must be dropped, not emitted");
  fs.rmSync(root, { recursive: true, force: true });
});

test("panel records name each configured source by the key that is present", () => {
  const records = panelRecords({ sources: { one: { url: "http://x" }, two: { cmd: "c" } } });
  assert.deepEqual(
    records.map((r) => r.record.panel),
    [
      { name: "one", kind: "url", target: "http://x" },
      { name: "two", kind: "cmd", target: "c" },
    ],
  );
  assert.deepEqual(panelRecords({}), [], "no sources is no panels, not an error");
});

test("buildIndex writes a results table mache can ingest", () => {
  const root = fixtureRoot();
  const { dbPath, records } = buildIndex(root);
  assert.ok(fs.existsSync(dbPath), "index db must exist");
  assert.equal(dbPath, path.join(root, ".generated", "hud-index.db"));

  const db = new DatabaseSync(dbPath);
  const rows = db.prepare("SELECT id, record FROM results ORDER BY id").all();
  db.close();
  assert.equal(rows.length, records.length);

  const parsed = rows.map((r) => ({ id: r.id, ...JSON.parse(r.record) }));
  const entries = parsed.filter((r) => r.entry);
  const panels = parsed.filter((r) => r.panel);
  assert.equal(panels.length, 2);
  // 4 files: brief, note, raw drop, playbook. The .gitkeep is not an entry.
  assert.equal(entries.length, 4);
  assert.ok(
    entries.every((r) => r.entry.section && r.entry.group && r.entry.subgroup && r.entry.slug),
    "every entry must carry all four levels or the schema cannot name its node",
  );
  assert.ok(
    entries.some((r) => r.entry.tags?.includes(TAG_CANARY)),
    "frontmatter tags must reach the records — they are the cross-entry edges",
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("the schema hardcodes no name it could instead template", () => {
  const schema = fs.readFileSync(SCHEMA, "utf8");
  assert.equal(JSON.parse(schema).version, "v1");
  for (const name of [PROJECT_CANARY, TAG_CANARY, "AA-1", "owner/repo", "a-playbook"]) {
    assert.ok(!schema.includes(name), `schema must not name ${name}`);
  }
  // Which only means something if the names it does carry are templates.
  assert.match(schema, /"name": "\{\{\.section\}\}"/);
  assert.match(schema, /"name": "\{\{\.group\}\}"/);
  assert.match(schema, /"name": "\{\{\.slug\}\}"/);
});
