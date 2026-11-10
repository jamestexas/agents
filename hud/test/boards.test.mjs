// Hermetic tests for boards.mjs: the hud.board/1 shape, the two projections,
// and the history rule. Every fixture here is synthetic — no person, company
// or project name — and every write goes to a fresh temp root.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BOARD_SCHEMA,
  listBoards,
  mermaidText,
  renderBoardMarkdown,
  renderGraph,
  renderLegend,
  SHAPES,
  statusClass,
  validateBoard,
  writeBoard,
} from "../boards.mjs";

function board(extra = {}) {
  return {
    schema: BOARD_SCHEMA,
    title: "Widgets vs the bar",
    generated: "2026-01-02T03:04:05Z",
    sources: [{ kind: "git", ref: "example/main@abc1234", at: "2026-01-02T03:00:00Z" }],
    columns: [
      { id: "stage", label: "Stage" },
      { id: "prod", label: "Prod" },
    ],
    rows: [
      { id: "w-one", label: "Widget one", status: "In Progress", cells: { stage: { value: "shadow", chip: "shadow", source: "env/a.tf:12" }, prod: { value: "legacy" } } },
      { id: "w-two", label: "Widget two", status: "Done", url: "https://example.invalid/w2", cells: { stage: { value: "ces", url: "https://example.invalid/pr/1" } } },
      { id: "EXT-1", label: "Outside ticket", external: true, status: "Todo" },
    ],
    edges: [
      { from: "w-two", to: "w-one", kind: "dep" },
      { from: "EXT-1", to: "w-one", kind: "inferred", why: 'needs "quotes" | and pipes' },
    ],
    notes: [{ title: "Risks", items: ["one", "two"] }],
    ...extra,
  };
}

test("a well-formed board validates", () => {
  const { ok, errors } = validateBoard(board());
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});

test("validate reports every problem, not the first", () => {
  const doc = board({ schema: "nope", title: "", extra: 1 });
  doc.rows.push({ id: "w-one", label: "dup" });
  doc.edges.push({ from: "w-one", to: "missing", kind: "soft" });
  doc.rows[0].cells.ghost = { value: "x" };
  doc.rows[0].cells.stage.url = "javascript:alert(1)";
  const { ok, errors } = validateBoard(doc);
  assert.equal(ok, false);
  const text = errors.join("\n");
  for (const needle of ["schema must be", "title must be", "extra: unknown key", 'is declared twice', "is not a row id", "kind must be one of", "no such column", "must be an http(s) URL"]) {
    assert.match(text, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing: ${needle}`);
  }
});

test("validate refuses a non-object and an empty row list", () => {
  assert.equal(validateBoard(null).ok, false);
  assert.equal(validateBoard([]).ok, false);
  assert.match(validateBoard(board({ rows: [] })).errors.join("\n"), /rows must be a non-empty list/);
});

test("statusClass maps free text to the five classes", () => {
  assert.equal(statusClass("Done"), "done");
  assert.equal(statusClass("merged 2026-01-01"), "done");
  assert.equal(statusClass("In Review"), "started");
  assert.equal(statusClass("In Progress"), "started");
  assert.equal(statusClass("Blocked on x"), "blocked");
  assert.equal(statusClass("Todo"), "open");
  assert.equal(statusClass(undefined), "open");
  assert.equal(statusClass("Done", true), "external");
});

test("mermaidText strips what breaks a label", () => {
  assert.equal(mermaidText('say "hi" | now'), "say #quot;hi#quot; / now");
  assert.equal(mermaidText("a [b] {c} <d>"), "a (b) (c) ‹d›");
  assert.equal(mermaidText("x".repeat(100), 10).length, 10);
});

test("layout picks the flowchart direction and rejects anything but LR or TD", () => {
  const doc = { schema: "hud.board/1", title: "t", generated: "2026-01-02T03:04:05Z", sources: [], columns: [], rows: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b", kind: "dep" }] };
  assert.ok(renderGraph(doc).startsWith("flowchart LR"));
  assert.ok(renderGraph({ ...doc, layout: "TD" }).startsWith("flowchart TD"));
  assert.equal(validateBoard({ ...doc, layout: "TD" }).ok, true);
  assert.ok(validateBoard({ ...doc, layout: "RL" }).errors.some((m) => m.includes("layout")));
});

test("renderGraph draws dep edges solid, inferred edges dotted with a reason, externals dashed, links as click", () => {
  const g = renderGraph(board());
  assert.match(g, /^flowchart LR/);
  assert.match(g, /n1 --> n0/);
  assert.match(g, /n2 -\.->\|"needs #quot;quotes#quot; \/ and pipes"\| n0/);
  assert.match(g, /n2\["EXT-1<br\/>Outside ticket<br\/>Todo"\]:::external/);
  assert.match(g, /click n1 "https:\/\/example\.invalid\/w2" _blank/);
  assert.match(g, /classDef external/);
  assert.doesNotMatch(g, /classDef blocked/, "unused classes are not emitted");
});

test("a row's shape picks its node brackets; no shape keeps the plain rectangle; an unknown shape is refused", () => {
  const doc = board();
  doc.rows[0].shape = "group";
  doc.rows[1].shape = "gap";
  const g = renderGraph(doc);
  assert.match(g, /n0\(\["w-one<br\/>Widget one<br\/>In Progress"\]\):::started/);
  assert.match(g, /n1\{\{"w-two<br\/>Widget two<br\/>Done"\}\}:::done/);
  assert.match(g, /n2\["EXT-1<br\/>Outside ticket<br\/>Todo"\]:::external/, "no shape, the rectangle as before");
  assert.deepEqual(Object.keys(SHAPES), ["group", "box", "item", "gap"]);
  for (const bad of ["circle", "constructor", 3]) {
    const d = board();
    d.rows[0].shape = bad;
    assert.match(validateBoard(d).errors.join("\n"), /rows\[0\]\.shape must be one of group, box, item, gap/, String(bad));
  }
});

test("the legend samples only the shapes and classes the board uses, in its own block", () => {
  const doc = board();
  doc.rows[0].shape = "item";
  const legend = renderLegend(doc);
  assert.match(legend, /^flowchart LR/);
  assert.match(legend, /s0\("item"\)/);
  assert.ok(!/group|gap/.test(legend), "unused shapes are not sampled");
  for (const c of ["started", "done", "external"]) assert.match(legend, new RegExp(`:::${c}`));
  assert.ok(!/:::(open|blocked)/.test(legend), "unused classes are not sampled");
  assert.match(legend, /^  c0 ~~~ c1 ~~~ c2$/m, "invisible links keep statuses on one line");
  assert.ok(!/s0 ~~~/.test(legend), "a single shape needs no link");
  const md = renderBoardMarkdown(doc);
  assert.equal((md.match(/```mermaid/g) || []).length, 2, "legend and graph are separate blocks");
  assert.ok(md.indexOf(legend) < md.indexOf("flowchart LR\n  n0"), "the legend comes first");
  const plain = board({ rows: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [] });
  assert.equal(renderLegend(plain), "", "one class and no shapes: nothing to explain");
});

test("renderGraph is empty for a single row with no edges", () => {
  assert.equal(renderGraph({ rows: [{ id: "a", label: "A" }], edges: [] }), "");
});

test("renderBoardMarkdown produces frontmatter, graph, table, notes and provenance", () => {
  const md = renderBoardMarkdown({ ...board(), __name: "widgets" });
  // No tags on the board, no tags line: type: board already says what it is.
  assert.match(md, /^---\ntitle: "Widgets vs the bar"\ndate: 2026-01-02\ntype: board\nstatus: active\n---\n/);
  const tagged = renderBoardMarkdown({ ...board(), tags: ["m1"], __name: "widgets" });
  assert.match(tagged, /\nstatus: active\ntags: \["m1"\]\n---\n/, "a board's own topic tags pass through, with no board tag added");
  assert.match(md, /^Generated 2026-01-02 03:04 UTC$/m, "the time is its own line");
  assert.match(md, /^\| Source \| Ref \| As of \|$/m, "the sources are a table");
  assert.match(md, /^\| git \| example\/main@abc1234 \| 2026-01-02 03:00 UTC \|$/m);
  assert.match(md, /^<small>Rendered from `boards\/.+\.json`; edit the producer, not the page\.<\/small>$/m);
  // Only the label links; the status under it stays plain text.
  assert.match(md, /\| \[\*\*Widget two\*\*\]\(https:\/\/example\.invalid\/w2\)<br>`Done` \|/);
  assert.match(md, /boards\/widgets\.json/);
  assert.match(md, /```mermaid\nflowchart LR/);
  assert.match(md, /\| \| Stage \| Prod \|\n\| --- \| --- \| --- \|/);
  assert.match(md, /\| \*\*Widget one\*\*<br>`In Progress` \| `shadow` shadow \| legacy \|/);
  assert.match(md, /\[\*\*Widget two\*\*\]\(https:\/\/example\.invalid\/w2\)<br>`Done` \| \[ces\]\(https:\/\/example\.invalid\/pr\/1\) \|  \|/);
  assert.match(md, /## Risks\n\n- one\n- two/);
  assert.match(md, /## Provenance\n\n- \*\*Widget one\*\* · stage: env\/a\.tf:12/);
});

test("group_by must name a declared column", () => {
  assert.deepEqual(validateBoard(board({ group_by: "stage" })).errors, []);
  for (const bad of ["nope", "", 3]) {
    assert.match(validateBoard(board({ group_by: bad })).errors.join("\n"), /group_by must name a declared column/, JSON.stringify(bad));
  }
});

test("group_by splits the table where the column's value changes, in row order", () => {
  const doc = board({ group_by: "stage" });
  doc.rows[1].cells.stage.value = "shadow";
  doc.rows.push({ id: "w-three", label: "Widget three", cells: { stage: { value: "ces" } } });
  const md = renderBoardMarkdown(doc);
  const heads = [...md.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ["shadow", "(none)", "ces"], "one subheading per run of equal values; a row without the cell is (none)");
  assert.equal((md.match(/^\| \| Stage \| Prod \|$/gm) || []).length, 3, "each group carries its own header row");
  assert.equal(/^### /m.test(renderBoardMarkdown(board())), false, "no group_by, one table");
});

test("renderBoardMarkdown escapes pipes in cells", () => {
  const doc = board();
  doc.rows[0].cells.prod.value = "a | b";
  assert.match(renderBoardMarkdown(doc), /a \\\| b/);
});

test("writeBoard writes json, page and one snapshot; a rerun with the same content adds no snapshot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-boards-"));
  try {
    const first = writeBoard(root, "widgets", "status", board());
    assert.equal(first.json, path.join(root, "projects/widgets/boards/status.json"));
    assert.equal(first.md, path.join(root, "projects/widgets/boards/status.md"));
    assert.match(first.history, /\.history\/status\/20260102-030405Z\.json$/);
    assert.ok(fs.existsSync(first.history));

    const again = writeBoard(root, "widgets", "status", board({ generated: "2026-01-03T00:00:00Z" }));
    assert.equal(again.history, null, "same content, new timestamp: no new snapshot");
    assert.equal(fs.readdirSync(path.dirname(first.history)).length, 1);

    const changed = board({ generated: "2026-01-04T00:00:00Z" });
    changed.rows[0].cells.prod.value = "shadow";
    const third = writeBoard(root, "widgets", "status", changed);
    assert.match(third.history, /20260104-000000Z\.json$/);
    assert.equal(fs.readdirSync(path.dirname(first.history)).length, 2);

    const listed = listBoards(root);
    assert.deepEqual(listed.map((b) => `${b.project}/${b.name}`), ["widgets/status"]);
    assert.equal(listed[0].generated, "2026-01-04T00:00:00Z");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("writeBoard refuses an invalid document and a bad name without writing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-boards-"));
  try {
    assert.throws(() => writeBoard(root, "widgets", "Bad Name", board()), /board name must match/);
    assert.throws(() => writeBoard(root, "widgets", "status", board({ rows: [] })), /is not valid/);
    assert.equal(fs.existsSync(path.join(root, "projects")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
