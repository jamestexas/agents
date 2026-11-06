import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { lint, tagKey } from "../hud-lint.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fm = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`).join("\n")}\n---\n\n# x\n`;

function tree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-lint-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const FILES = {
  "projects/widget/CONTEXT.md": fm({ status: "active" }),
  "projects/widget/notes/2026-11-01-a.md": fm({ tags: ["widget", "read-path", "review", "abc-12"], tickets: ["ABC-7"] }),
  // The quoted tag in the shape a writer that pre-quotes its value leaves.
  "projects/widget/notes/2026-11-02-b.md": '---\ntags:\n  - Read_Paths\n  - "\\"audit\\""\ntickets: [abc-7]\n---\n\n# b\n',
  "projects/widget/notes/PR-41-first.md": fm({ title: "PR 41 first look" }),
  "projects/widget/notes/PR-41-rereview.md": fm({}),
  "projects/widget/notes/2026-11-03-c.md": fm({ title: '"PR #4242 — follow-up"' }),
  "projects/widget/prs/PR-9/review.md": fm({ tickets: ["ABC-7"] }),
  "projects/widget/prs/PR-9/raw/state.json": "{}",
  "projects/gadget/notes/2026-11-01-d.md": fm({ tags: ["widget"] }),
};

test("tags: a tag that restates the path, a kind, a ticket, or is quoted is reported with its home", (t) => {
  const { tags } = lint(tree(t, FILES));
  const by = Object.fromEntries(tags.findings.map((f) => [f.tag, f]));
  assert.equal(by.widget.rule, "path");
  assert.deepEqual(by.widget.paths, ["projects/widget/notes/2026-11-01-a.md"], "under another project the same word is a topic, not a restatement");
  assert.equal(by.review.rule, "kind");
  assert.equal(by["abc-12"].rule, "ticket");
  assert.match(by["abc-12"].fix, /tickets: \[ABC-12\]/);
  const quoted = tags.findings.find((f) => f.rule === "malformed");
  assert.ok(quoted, "a tag carrying its own quotes is malformed");
  assert.equal(quoted.fix, "rewrite as audit");
  const spelling = tags.findings.find((f) => f.rule === "spelling");
  assert.ok(spelling, "read-path and Read_Paths are one tag spelled two ways");
  assert.match(spelling.fix, /merge into (read-path|Read_Paths)/);
  assert.ok(!tags.strays.some((s) => s.tag === "Read_Paths"), "a tag already reported is not also a stray");
});

test("tagKey folds case, separators and a trailing plural, and leaves short words alone", () => {
  assert.equal(tagKey("Read_Paths"), "read-path");
  assert.equal(tagKey("read path"), "read-path");
  assert.equal(tagKey("ops"), "ops");
});

test("clusters: notes about one PR are proposed into its prs/ folder; a lone note already there is not", (t) => {
  const { clusters } = lint(tree(t, FILES));
  const pr41 = clusters.prs.find((c) => c.pr === 41);
  assert.equal(pr41.target, "projects/widget/prs/PR-41/");
  assert.deepEqual(pr41.move, ["projects/widget/notes/PR-41-first.md", "projects/widget/notes/PR-41-rereview.md"]);
  assert.ok(clusters.prs.some((c) => c.pr === 4242), "a PR named only in the title is still found");
  assert.ok(!clusters.prs.some((c) => c.pr === 9), "PR-9 is already one folder: nothing to propose");
});

test("clusters: a ticket named by several loose notes in one project is one cluster, case-insensitively", (t) => {
  const { clusters } = lint(tree(t, FILES));
  assert.deepEqual(clusters.tickets, [{
    ticket: "ABC-7",
    project: "widget",
    paths: ["projects/widget/notes/2026-11-01-a.md", "projects/widget/notes/2026-11-02-b.md"],
  }], "the note inside prs/PR-9 already has a home and is not counted");
});

test("raw files are not entries: a run's state.json never reaches the report", (t) => {
  const r = lint(tree(t, FILES));
  assert.equal(r.entries, Object.keys(FILES).filter((f) => f.endsWith(".md")).length);
});

test("the CLI writes the markdown report, --json the object, and refuses anything else", (t) => {
  const root = tree(t, FILES);
  const cli = (args) => spawnSync(process.execPath, [path.join(here, "..", "hud-lint.mjs"), ...args], { encoding: "utf8", env: { ...process.env, HUD_ROOT: root } });
  const md = cli([]);
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /^# hud lint — 8 entries/);
  assert.match(md.stdout, /Nothing has been changed/);
  const json = JSON.parse(cli(["--json"]).stdout);
  assert.equal(json.entries, 8);
  const bad = cli(["--fix"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown argument --fix/);
  assert.deepEqual(fs.readdirSync(path.join(root, "projects/widget/notes")).length, 5, "lint writes nothing");
});
