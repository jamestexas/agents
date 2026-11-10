#!/usr/bin/env node
// Boards: one generic status document, two projections.
//
// A board is a JSON file under `projects/<project>/boards/<name>.json` in the
// shape `hud.board/1` below. It is the agent projection: any session reads it
// and has every value with where it came from. `render` writes the human
// projection beside it, `<name>.md`, a page the HUD already knows how to show
// (a mermaid graph for the rows and edges, a table for the columns, the
// provenance underneath), and keeps every generation under
// `boards/.history/<name>/` so the record is durable; the dot keeps the
// snapshots out of the tree reader's entry list while git still keeps them. Nothing here knows what
// a row is: a writer, a ticket, a bead, a service. Producers do; this file
// only checks the shape and draws it.
//
//   node boards.mjs validate <file.json>
//   node boards.mjs render <project>/<name> [--from <file.json>] [--root <HUD_ROOT>]
//   node boards.mjs list [--root <HUD_ROOT>]
//
// Stdlib only, like the rest of the machinery.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BOARD_SCHEMA = "hud.board/1";
export const EDGE_KINDS = Object.freeze(["dep", "inferred"]);

const TOP_KEYS = new Set(["schema", "title", "generated", "sources", "columns", "rows", "edges", "notes", "tags", "layout", "group_by"]);
// Graph directions mermaid accepts for a flowchart. LR suits a short chain; a
// graph with many parallel branches reads better top-down.
export const LAYOUTS = Object.freeze(["LR", "TD"]);
const ROW_KEYS = new Set(["id", "label", "sub", "status", "external", "url", "cells", "shape"]);
// A row's node shape in the graph, and its mermaid brackets. No shape keeps
// the plain rectangle every board drew before shapes existed.
export const SHAPES = Object.freeze({
  group: ["([", "])"],
  box: ["[", "]"],
  item: ["(", ")"],
  gap: ["{{", "}}"],
});
const CELL_KEYS = new Set(["value", "chip", "source", "url"]);
const EDGE_KEYS = new Set(["from", "to", "kind", "why"]);
const NOTE_KEYS = new Set(["title", "items"]);
const SOURCE_KEYS = new Set(["kind", "ref", "at"]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

// ---------------------------------------------------------------- validate

/**
 * Check a parsed document against `hud.board/1`. Returns every problem found,
 * not the first, so a producer fixes its output in one pass. A document that
 * passes has only known keys at every depth: the page never renders a field
 * nobody declared.
 * @param {unknown} doc
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateBoard(doc) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, errors: ["document is not an object"] };
  unknownKeys(doc, TOP_KEYS, "", err);
  if (doc.schema !== BOARD_SCHEMA) err(`schema must be "${BOARD_SCHEMA}", got ${JSON.stringify(doc.schema)}`);
  if (!isNonEmptyString(doc.title)) err("title must be a non-empty string");
  if (!isNonEmptyString(doc.generated) || Number.isNaN(Date.parse(doc.generated))) err("generated must be an ISO-8601 timestamp");
  if (doc.tags !== undefined && !(Array.isArray(doc.tags) && doc.tags.every(isNonEmptyString))) err("tags must be a list of strings");
  if (doc.layout !== undefined && !LAYOUTS.includes(doc.layout)) err(`layout must be one of ${LAYOUTS.join(", ")}`);

  const sources = doc.sources ?? [];
  if (!Array.isArray(sources)) err("sources must be a list");
  else sources.forEach((s, i) => {
    if (!s || typeof s !== "object") return err(`sources[${i}] is not an object`);
    unknownKeys(s, SOURCE_KEYS, `sources[${i}].`, err);
    if (!isNonEmptyString(s.kind)) err(`sources[${i}].kind must be a non-empty string`);
    if (!isNonEmptyString(s.ref)) err(`sources[${i}].ref must be a non-empty string`);
    if (s.at !== undefined && (typeof s.at !== "string" || Number.isNaN(Date.parse(s.at)))) err(`sources[${i}].at must be an ISO-8601 timestamp`);
  });

  const columns = doc.columns ?? [];
  const colIds = new Set();
  if (!Array.isArray(columns)) err("columns must be a list");
  else columns.forEach((c, i) => {
    if (!c || typeof c !== "object") return err(`columns[${i}] is not an object`);
    unknownKeys(c, new Set(["id", "label"]), `columns[${i}].`, err);
    if (!isNonEmptyString(c.id) || !ID_RE.test(c.id)) err(`columns[${i}].id must match ${ID_RE}`);
    else if (colIds.has(c.id)) err(`columns[${i}].id "${c.id}" is declared twice`);
    else colIds.add(c.id);
    if (!isNonEmptyString(c.label)) err(`columns[${i}].label must be a non-empty string`);
  });

  // group_by names a column; the table is split wherever that column's value
  // changes between consecutive rows, so the producer decides the order.
  if (doc.group_by !== undefined && !(isNonEmptyString(doc.group_by) && colIds.has(doc.group_by))) {
    err(`group_by must name a declared column, got ${JSON.stringify(doc.group_by)}`);
  }

  const rows = doc.rows;
  const rowIds = new Set();
  if (!Array.isArray(rows) || rows.length === 0) err("rows must be a non-empty list");
  else rows.forEach((r, i) => {
    if (!r || typeof r !== "object") return err(`rows[${i}] is not an object`);
    unknownKeys(r, ROW_KEYS, `rows[${i}].`, err);
    if (!isNonEmptyString(r.id) || !ID_RE.test(r.id)) err(`rows[${i}].id must match ${ID_RE}`);
    else if (rowIds.has(r.id)) err(`rows[${i}].id "${r.id}" is declared twice`);
    else rowIds.add(r.id);
    if (!isNonEmptyString(r.label)) err(`rows[${i}].label must be a non-empty string`);
    for (const k of ["sub", "status"]) if (r[k] !== undefined && typeof r[k] !== "string") err(`rows[${i}].${k} must be a string`);
    if (r.external !== undefined && typeof r.external !== "boolean") err(`rows[${i}].external must be a boolean`);
    if (r.shape !== undefined && !Object.hasOwn(SHAPES, r.shape)) err(`rows[${i}].shape must be one of ${Object.keys(SHAPES).join(", ")}`);
    if (r.url !== undefined && !isHttpUrl(r.url)) err(`rows[${i}].url must be an http(s) URL`);
    const cells = r.cells ?? {};
    if (!cells || typeof cells !== "object" || Array.isArray(cells)) err(`rows[${i}].cells must be an object keyed by column id`);
    else for (const [cid, cell] of Object.entries(cells)) {
      if (!colIds.has(cid)) err(`rows[${i}].cells.${cid}: no such column`);
      if (!cell || typeof cell !== "object" || Array.isArray(cell)) { err(`rows[${i}].cells.${cid} is not an object`); continue; }
      unknownKeys(cell, CELL_KEYS, `rows[${i}].cells.${cid}.`, err);
      const v = cell.value;
      if (!(v === null || ["string", "number", "boolean"].includes(typeof v))) err(`rows[${i}].cells.${cid}.value must be a string, number, boolean or null`);
      for (const k of ["chip", "source"]) if (cell[k] !== undefined && typeof cell[k] !== "string") err(`rows[${i}].cells.${cid}.${k} must be a string`);
      if (cell.url !== undefined && !isHttpUrl(cell.url)) err(`rows[${i}].cells.${cid}.url must be an http(s) URL`);
    }
  });

  const edges = doc.edges ?? [];
  if (!Array.isArray(edges)) err("edges must be a list");
  else edges.forEach((e, i) => {
    if (!e || typeof e !== "object") return err(`edges[${i}] is not an object`);
    unknownKeys(e, EDGE_KEYS, `edges[${i}].`, err);
    for (const end of ["from", "to"]) if (!rowIds.has(e[end])) err(`edges[${i}].${end} ${JSON.stringify(e[end])} is not a row id`);
    if (!EDGE_KINDS.includes(e.kind)) err(`edges[${i}].kind must be one of ${EDGE_KINDS.join(", ")}`);
    if (e.why !== undefined && typeof e.why !== "string") err(`edges[${i}].why must be a string`);
  });

  const notes = doc.notes ?? [];
  if (!Array.isArray(notes)) err("notes must be a list");
  else notes.forEach((n, i) => {
    if (!n || typeof n !== "object") return err(`notes[${i}] is not an object`);
    unknownKeys(n, NOTE_KEYS, `notes[${i}].`, err);
    if (!isNonEmptyString(n.title)) err(`notes[${i}].title must be a non-empty string`);
    if (!Array.isArray(n.items) || !n.items.every(isNonEmptyString)) err(`notes[${i}].items must be a list of strings`);
  });

  return { ok: errors.length === 0, errors };
}

function unknownKeys(obj, allowed, prefix, err) {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) err(`${prefix}${k}: unknown key`);
}
const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
function isHttpUrl(v) {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ render

/** How a free-text status is drawn: the class a node and a chip get. */
export function statusClass(status, external = false) {
  if (external) return "external";
  const s = String(status ?? "").toLowerCase();
  if (/\b(done|complete|completed|merged|closed|shipped)\b/.test(s)) return "done";
  if (/\bblock/.test(s)) return "blocked";
  if (/\b(progress|review|started|running|active|open pr)\b/.test(s)) return "started";
  return "open";
}

const MERMAID_CLASSES = {
  done: "classDef done stroke:#72f1b8,color:#9aa0b4",
  started: "classDef started stroke:#36f9f6",
  blocked: "classDef blocked stroke:#fe4450,stroke-dasharray:4 3",
  open: "classDef open stroke:#f97e72",
  external: "classDef external stroke:#9aa0b4,stroke-dasharray:2 3",
};

/** Mermaid node labels and edge labels: no quotes, no pipes, no newlines. */
export function mermaidText(s, max = 80) {
  let t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length > max) t = `${t.slice(0, max - 1)}…`;
  return t.replace(/"/g, "#quot;").replace(/\|/g, "/").replace(/[\[\]{}()<>]/g, (c) => ({ "[": "(", "]": ")", "{": "(", "}": ")", "(": "(", ")": ")", "<": "‹", ">": "›" })[c]);
}

/** Markdown table cells: no pipes, no newlines. */
function tableText(s) {
  return String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/**
 * The mermaid graph for a board: every row is a node (external rows drawn
 * dashed), `dep` edges solid, `inferred` edges dotted with their reason as
 * the label, and a `click` link for a row that has a URL. Returns "" when
 * there is nothing to draw: a board with one row and no edges is a table.
 */
const SHAPE_LABELS = Object.freeze({ group: "group", box: "box", item: "item", gap: "gap (no ticket)" });

/**
 * A key for the graph: one sample node per shape the board uses, then one per
 * status class it uses, in a block of its own so it cannot change the main
 * graph's layout. Empty when the board uses neither a shape nor more than the
 * one default class.
 */
export function renderLegend(doc) {
  const rows = doc.rows ?? [];
  const shapes = Object.keys(SHAPES).filter((k) => rows.some((r) => r.shape === k));
  const classes = Object.keys(MERMAID_CLASSES).filter((c) => rows.some((r) => statusClass(r.status, r.external) === c));
  if (shapes.length === 0 && classes.length < 2) return "";
  const lines = ["flowchart LR"];
  shapes.forEach((k, i) => {
    const [open, close] = SHAPES[k];
    lines.push(`  s${i}${open}"${SHAPE_LABELS[k]}"${close}`);
  });
  classes.forEach((c, i) => lines.push(`  c${i}["${c === "external" ? "outside this board" : c}"]:::${c}`));
  // Unlinked nodes stack in a column even under LR; invisible links keep
  // shapes on one line and statuses on another, short enough to read fitted.
  for (const ids of [shapes.map((_, i) => `s${i}`), classes.map((_, i) => `c${i}`)]) {
    if (ids.length > 1) lines.push(`  ${ids.join(" ~~~ ")}`);
  }
  for (const c of classes) lines.push(`  ${MERMAID_CLASSES[c]}`);
  return lines.join("\n");
}

export function renderGraph(doc) {
  const rows = doc.rows ?? [];
  const edges = doc.edges ?? [];
  if (edges.length === 0 && rows.length < 2) return "";
  const idOf = new Map(rows.map((r, i) => [r.id, `n${i}`]));
  const lines = [`flowchart ${doc.layout ?? "LR"}`];
  const used = new Set();
  for (const r of rows) {
    const cls = statusClass(r.status, r.external);
    used.add(cls);
    const label = [mermaidText(r.label, 60), r.status ? mermaidText(r.status, 30) : null].filter(Boolean).join("<br/>");
    const [open, close] = SHAPES[r.shape] ?? SHAPES.box;
    lines.push(`  ${idOf.get(r.id)}${open}"${mermaidText(r.id, 40)}<br/>${label}"${close}:::${cls}`);
  }
  for (const e of edges) {
    const a = idOf.get(e.from);
    const b = idOf.get(e.to);
    if (!a || !b) continue;
    if (e.kind === "inferred") lines.push(e.why ? `  ${a} -.->|"${mermaidText(e.why, 70)}"| ${b}` : `  ${a} -.-> ${b}`);
    else lines.push(`  ${a} --> ${b}`);
  }
  for (const r of rows) if (r.url) lines.push(`  click ${idOf.get(r.id)} "${r.url}" _blank`);
  for (const cls of used) lines.push(`  ${MERMAID_CLASSES[cls]}`);
  return lines.join("\n");
}

const GRAPH_KEY = "Solid edges are declared dependencies; dotted edges are inferred, with the reason on the edge. Dashed nodes are outside this board.";

/** A table's header and rows, for the given rows. Only a row's label links. */
function tableLines(doc, rows, out) {
  const columns = doc.columns ?? [];
  if (!columns.length) return;
  out.push(`| | ${columns.map((c) => tableText(c.label)).join(" | ")} |`);
  out.push(`| --- | ${columns.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    const label = `**${tableText(r.label)}**`;
    const head = `${r.url ? `[${label}](${r.url})` : label}${r.sub ? `<br><small>${tableText(r.sub)}</small>` : ""}${r.status ? `<br>\`${tableText(r.status)}\`` : ""}`;
    const cells = columns.map((c) => {
      const cell = (r.cells ?? {})[c.id];
      if (!cell) return "";
      const v = cell.value === null || cell.value === undefined ? "" : tableText(cell.value);
      const shown = cell.chip ? `\`${tableText(cell.chip)}\` ${v}`.trim() : v;
      return cell.url ? `[${shown || cell.url}](${cell.url})` : shown;
    });
    out.push(`| ${head} | ${cells.join(" | ")} |`);
  }
}

/**
 * A board's rows split into groups by `group_by`: one group per run of equal
 * values, in row order. A row with no value for the column is `(none)`. Each
 * group gets an anchor id that is stable for its position and value.
 */
export function groupsOf(doc) {
  const valueOf = (r) => {
    const v = ((r.cells ?? {})[doc.group_by] ?? {}).value;
    return v === null || v === undefined || v === "" ? "(none)" : String(v);
  };
  const groups = [];
  for (const r of doc.rows ?? []) {
    const v = valueOf(r);
    if (!groups.length || groups[groups.length - 1].value !== v) {
      const slug = v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "group";
      groups.push({ value: v, id: `group-${groups.length + 1}-${slug}`, rows: [] });
    }
    groups[groups.length - 1].rows.push(r);
  }
  return groups;
}

/** The status class a group is drawn with: blocked wins, then open work, then done. */
function groupClass(rows) {
  const cls = rows.map((r) => statusClass(r.status, r.external));
  if (cls.includes("blocked")) return "blocked";
  if (cls.every((c) => c === "done" || c === "external")) return "done";
  if (cls.includes("started")) return "started";
  return "open";
}

/**
 * The overview: one node per group, labelled with its size and status mix,
 * and the edges between groups folded into one per pair, labelled with how
 * many there are. Clicking a group opens its section on the page.
 */
export function renderOverview(doc, groups) {
  const edges = doc.edges ?? [];
  const groupOfRow = new Map();
  groups.forEach((g, i) => g.rows.forEach((r) => groupOfRow.set(r.id, i)));
  const lines = [`flowchart ${doc.layout ?? "LR"}`];
  const used = new Set();
  groups.forEach((g, i) => {
    const counts = {};
    for (const r of g.rows) counts[statusClass(r.status, r.external)] = (counts[statusClass(r.status, r.external)] ?? 0) + 1;
    const mix = ["done", "started", "blocked", "open"].filter((c) => counts[c]).map((c) => `${counts[c]} ${c}`).join(" · ");
    const cls = groupClass(g.rows);
    used.add(cls);
    lines.push(`  g${i}(["${mermaidText(g.value, 60)}<br/>${g.rows.length} rows${mix ? ` · ${mix}` : ""}"]):::${cls}`);
  });
  const pairs = new Map();
  for (const e of edges) {
    const a = groupOfRow.get(e.from);
    const b = groupOfRow.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const key = `${a}>${b}`;
    const p = pairs.get(key) ?? { a, b, n: 0, dep: false };
    p.n += 1;
    p.dep ||= e.kind === "dep";
    pairs.set(key, p);
  }
  for (const { a, b, n, dep } of pairs.values()) lines.push(dep ? `  g${a} -->|"${n}"| g${b}` : `  g${a} -.->|"${n}"| g${b}`);
  groups.forEach((g, i) => lines.push(`  click g${i} "#${g.id}"`));
  for (const cls of used) lines.push(`  ${MERMAID_CLASSES[cls]}`);
  return lines.join("\n");
}

/**
 * One group's graph: its rows, the edges among them, and for an edge that
 * leaves the group a dashed stub naming the row at the other end, which opens
 * that row's group when clicked.
 */
export function renderGroupGraph(doc, groups, index) {
  const g = groups[index];
  const groupOfRow = new Map();
  groups.forEach((gg, i) => gg.rows.forEach((r) => groupOfRow.set(r.id, i)));
  const sub = { ...doc, rows: g.rows, edges: (doc.edges ?? []).filter((e) => groupOfRow.get(e.from) === index && groupOfRow.get(e.to) === index) };
  const body = renderGraph(sub);
  const lines = body ? body.split("\n") : [`flowchart ${doc.layout ?? "LR"}`];
  // renderGraph draws nothing for one row with no edges; a section still
  // shows its row, so it is drawn here, before any stub links to it.
  if (!body && g.rows.length === 1) {
    const r = g.rows[0];
    const cls = statusClass(r.status, r.external);
    const [open, close] = SHAPES[r.shape] ?? SHAPES.box;
    lines.push(`  n0${open}"${mermaidText(r.id, 40)}<br/>${mermaidText(r.label, 60)}"${close}:::${cls}`, `  ${MERMAID_CLASSES[cls]}`);
    if (r.url) lines.push(`  click n0 "${r.url}" _blank`);
  }
  const idOf = new Map(g.rows.map((r, i) => [r.id, `n${i}`]));
  const stubs = new Map();
  const stubOf = (rowId) => {
    if (!stubs.has(rowId)) {
      const other = groups[groupOfRow.get(rowId)];
      const sid = `x${stubs.size}`;
      stubs.set(rowId, sid);
      lines.push(`  ${sid}["${mermaidText(rowId, 40)}<br/>in ${mermaidText(other.value, 40)}"]:::external`);
      lines.push(`  click ${sid} "#${other.id}"`);
    }
    return stubs.get(rowId);
  };
  for (const e of doc.edges ?? []) {
    const fa = groupOfRow.get(e.from) === index;
    const ta = groupOfRow.get(e.to) === index;
    if (fa === ta) continue;
    if (groupOfRow.get(e.from) === undefined || groupOfRow.get(e.to) === undefined) continue;
    const a = fa ? idOf.get(e.from) : stubOf(e.from);
    const b = ta ? idOf.get(e.to) : stubOf(e.to);
    lines.push(e.kind === "inferred" ? `  ${a} -.-> ${b}` : `  ${a} --> ${b}`);
  }
  if (stubs.size && !lines.some((l) => l.startsWith("  classDef external"))) lines.push(`  ${MERMAID_CLASSES.external}`);
  return lines.join("\n");
}

/**
 * The grouped page: an overview of the groups, then one section per group
 * holding its graph and its rows of the table. The first section starts open
 * and the rest collapsed; the page draws a section's graph when it is first
 * opened, since a closed section has no size to lay a graph out in.
 */
function renderGrouped(doc, out) {
  const groups = groupsOf(doc);
  const label = ((doc.columns ?? []).find((c) => c.id === doc.group_by) ?? {}).label ?? doc.group_by;
  out.push("## Graph", "", `One node per ${tableText(label).toLowerCase()}; a number on an edge is how many dependencies cross between them. Click a node to open its section below. ${GRAPH_KEY}`, "");
  const legend = renderLegend(doc);
  if (legend) out.push("```mermaid", legend, "```", "");
  out.push("```mermaid", renderOverview(doc, groups), "```", "");
  out.push(`## By ${tableText(label)}`, "");
  groups.forEach((g, i) => {
    out.push(`<details class="board-group" id="${g.id}"${i === 0 ? " open" : ""}>`);
    out.push(`<summary>${escapeHtml(g.value)} · ${g.rows.length} ${g.rows.length === 1 ? "row" : "rows"}</summary>`, "");
    out.push("```mermaid", renderGroupGraph(doc, groups, i), "```", "");
    tableLines(doc, g.rows, out);
    out.push("", "</details>", "");
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The page. Frontmatter the tree reader understands, then the graph, the
 * table, the notes and the provenance: every cell that named a source is
 * listed under its row, so a number on the page can be traced without
 * opening the JSON.
 * @param {object} doc a board that passed validateBoard
 */
export function renderBoardMarkdown(doc) {
  const day = doc.generated.slice(0, 10);
  // type: board already says what this page is; tags are topics only.
  const tags = doc.tags ?? [];
  const out = [];
  out.push("---");
  out.push(`title: ${yamlString(doc.title)}`);
  out.push(`date: ${day}`);
  out.push("type: board");
  out.push("status: active");
  if (tags.length) out.push(`tags: [${tags.map(yamlString).join(", ")}]`);
  out.push("---");
  out.push("");
  out.push(`# ${doc.title}`);
  out.push("");
  const stamp = (t) => `${new Date(t).toISOString().replace("T", " ").slice(0, 16)} UTC`;
  out.push(`Generated ${stamp(doc.generated)}`, "");
  const sources = doc.sources ?? [];
  if (sources.length) {
    out.push("| Source | Ref | As of |", "| --- | --- | --- |");
    for (const s of sources) out.push(`| ${tableText(s.kind)} | ${tableText(s.ref)} | ${s.at ? stamp(s.at) : ""} |`);
    out.push("");
  }
  out.push(`<small>Rendered from \`boards/${slugOf(doc)}.json\`; edit the producer, not the page.</small>`, "");

  if (doc.group_by) renderGrouped(doc, out);
  else {
    const graph = renderGraph(doc);
    if (graph) {
      out.push("## Graph", "", GRAPH_KEY, "");
      const legend = renderLegend(doc);
      if (legend) out.push("```mermaid", legend, "```", "");
      out.push("```mermaid", graph, "```", "");
    }
    const columns = doc.columns ?? [];
    if (columns.length) {
      out.push("## Table", "");
      tableLines(doc, doc.rows, out);
      out.push("");
    }
  }

  for (const n of doc.notes ?? []) {
    out.push(`## ${n.title}`, "");
    for (const item of n.items) out.push(`- ${item}`);
    out.push("");
  }

  const prov = [];
  for (const r of doc.rows) {
    const parts = Object.entries(r.cells ?? {}).filter(([, c]) => c && c.source).map(([cid, c]) => `${cid}: ${c.source}`);
    if (parts.length) prov.push(`- **${r.label}** · ${parts.join(" · ")}`);
  }
  if (prov.length) out.push("## Provenance", "", ...prov, "");

  return out.join("\n");
}

function yamlString(s) {
  return JSON.stringify(String(s));
}
function slugOf(doc) {
  return doc.__name ?? "<name>";
}

// ------------------------------------------------------------------- write

/** `$HUD_ROOT`, else `~/hud`. */
export function hudRoot(explicit) {
  return explicit || process.env.HUD_ROOT || path.join(os.homedir(), "hud");
}

/**
 * Write a board's three artifacts: the JSON (the record), the page beside it,
 * and a history snapshot named by the generation time. A snapshot identical
 * to the newest one already kept is not written again, so a producer that
 * re-runs on unchanged inputs leaves one entry, not one per run.
 * @returns {{json: string, md: string, history: string|null}}
 */
export function writeBoard(root, project, name, doc) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) throw new Error(`project must be a kebab-case slug, got ${JSON.stringify(project)}`);
  if (!NAME_RE.test(name)) throw new Error(`board name must match ${NAME_RE}, got ${JSON.stringify(name)}`);
  const { ok, errors } = validateBoard(doc);
  if (!ok) throw new Error(`board ${project}/${name} is not valid:\n  ${errors.join("\n  ")}`);
  const dir = path.join(root, "projects", project, "boards");
  const histDir = path.join(dir, ".history", name);
  fs.mkdirSync(histDir, { recursive: true });
  const json = JSON.stringify(doc, null, 1) + "\n";
  const jsonPath = path.join(dir, `${name}.json`);
  const mdPath = path.join(dir, `${name}.md`);
  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(mdPath, renderBoardMarkdown({ ...doc, __name: name }));
  const stamp = doc.generated.replace(/[-:]/g, "").replace(/\.\d+/, "").replace("T", "-").replace(/Z$|[+]0000$/, "Z");
  const histPath = path.join(histDir, `${stamp}.json`);
  const latest = fs.readdirSync(histDir).filter((f) => f.endsWith(".json")).sort().pop();
  const same = latest && stripGenerated(fs.readFileSync(path.join(histDir, latest), "utf8")) === stripGenerated(json);
  if (!same) fs.writeFileSync(histPath, json);
  return { json: jsonPath, md: mdPath, history: same ? null : histPath };
}

/** Two generations differ only if something other than the timestamp did. */
function stripGenerated(text) {
  try {
    const d = JSON.parse(text);
    delete d.generated;
    return JSON.stringify(d);
  } catch {
    return text;
  }
}

/** Every board under the root: `project/name` with its generation time. */
export function listBoards(root) {
  const out = [];
  const projects = path.join(root, "projects");
  let dirs = [];
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out;
  }
  for (const p of dirs) {
    const dir = path.join(projects, p, "boards");
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const f of files) {
      let generated = null;
      let title = null;
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        generated = d.generated ?? null;
        title = d.title ?? null;
      } catch {
        // listed, not opened: a broken board is still a board on disk
      }
      out.push({ project: p, name: f.replace(/\.json$/, ""), title, generated, path: path.relative(root, path.join(dir, f)) });
    }
  }
  return out.sort((a, b) => `${a.project}/${a.name}`.localeCompare(`${b.project}/${b.name}`));
}

// --------------------------------------------------------------------- cli

function usage(code) {
  const text = `usage:
  hud board validate <file.json>
  hud board render <project>/<name> [--from <file.json>] [--root <HUD_ROOT>]
  hud board list [--root <HUD_ROOT>]

A board is a hud.board/1 JSON document (see docs/BOARDS.md). render writes
projects/<project>/boards/<name>.json, .md and a .history snapshot.
`;
  (code ? process.stderr : process.stdout).write(text);
  process.exit(code);
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined) usage(1);
  args.splice(i, 2);
  return v;
}

function main(argv) {
  const args = [...argv];
  const verb = args.shift();
  if (!verb || verb === "-h" || verb === "--help") usage(verb ? 0 : 1);
  const root = hudRoot(flag(args, "--root"));
  if (verb === "validate") {
    const file = args[0] || usage(1);
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    const { ok, errors } = validateBoard(doc);
    if (ok) { process.stdout.write(`ok: ${file}\n`); return; }
    process.stderr.write(`${file}:\n  ${errors.join("\n  ")}\n`);
    process.exit(1);
  }
  if (verb === "render") {
    const from = flag(args, "--from");
    const target = args[0] || usage(1);
    const m = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/.exec(target);
    if (!m) usage(1);
    const [, project, name] = m;
    const src = from || path.join(root, "projects", project, "boards", `${name}.json`);
    const doc = JSON.parse(fs.readFileSync(src, "utf8"));
    const out = writeBoard(root, project, name, doc);
    process.stdout.write(`wrote ${path.relative(root, out.md)} and ${path.relative(root, out.json)}${out.history ? ` (+ ${path.relative(root, out.history)})` : " (unchanged, no new snapshot)"}\n`);
    return;
  }
  if (verb === "list") {
    for (const b of listBoards(root)) process.stdout.write(`${b.project}/${b.name}\t${b.generated ?? "?"}\t${b.title ?? ""}\n`);
    return;
  }
  usage(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`hud board: ${err.message}\n`);
    process.exit(1);
  }
}
