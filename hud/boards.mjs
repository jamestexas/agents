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

const TOP_KEYS = new Set(["schema", "title", "generated", "sources", "columns", "rows", "edges", "notes", "tags"]);
const ROW_KEYS = new Set(["id", "label", "sub", "status", "external", "url", "cells"]);
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
export function renderGraph(doc) {
  const rows = doc.rows ?? [];
  const edges = doc.edges ?? [];
  if (edges.length === 0 && rows.length < 2) return "";
  const idOf = new Map(rows.map((r, i) => [r.id, `n${i}`]));
  const lines = ["flowchart LR"];
  const used = new Set();
  for (const r of rows) {
    const cls = statusClass(r.status, r.external);
    used.add(cls);
    const label = [mermaidText(r.label, 60), r.status ? mermaidText(r.status, 30) : null].filter(Boolean).join("<br/>");
    lines.push(`  ${idOf.get(r.id)}["${mermaidText(r.id, 40)}<br/>${label}"]:::${cls}`);
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

/**
 * The page. Frontmatter the tree reader understands, then the graph, the
 * table, the notes and the provenance: every cell that named a source is
 * listed under its row, so a number on the page can be traced without
 * opening the JSON.
 * @param {object} doc a board that passed validateBoard
 */
export function renderBoardMarkdown(doc) {
  const day = doc.generated.slice(0, 10);
  const tags = ["board", ...(doc.tags ?? [])];
  const out = [];
  out.push("---");
  out.push(`title: ${yamlString(doc.title)}`);
  out.push(`date: ${day}`);
  out.push("type: board");
  out.push("status: active");
  out.push(`tags: [${tags.map(yamlString).join(", ")}]`);
  out.push("---");
  out.push("");
  out.push(`# ${doc.title}`);
  out.push("");
  const gen = `${new Date(doc.generated).toISOString().replace("T", " ").slice(0, 19)} UTC`;
  const srcs = (doc.sources ?? []).map((s) => `${s.kind}: ${s.ref}${s.at ? ` (${s.at.slice(0, 16).replace("T", " ")})` : ""}`);
  out.push(`Generated ${gen}${srcs.length ? ` from ${srcs.join("; ")}` : ""}. This page is rendered from \`boards/${slugOf(doc)}.json\`; edit the producer, not the page.`);
  out.push("");

  const graph = renderGraph(doc);
  if (graph) {
    out.push("## Graph", "", "Solid edges are declared dependencies; dotted edges are inferred, with the reason on the edge. Dashed nodes are outside this board.", "", "```mermaid", graph, "```", "");
  }

  const columns = doc.columns ?? [];
  if (columns.length) {
    out.push("## Table", "");
    out.push(`| | ${columns.map((c) => tableText(c.label)).join(" | ")} |`);
    out.push(`| --- | ${columns.map(() => "---").join(" | ")} |`);
    for (const r of doc.rows) {
      const head = `**${tableText(r.label)}**${r.sub ? `<br><small>${tableText(r.sub)}</small>` : ""}${r.status ? `<br>\`${tableText(r.status)}\`` : ""}`;
      const cells = columns.map((c) => {
        const cell = (r.cells ?? {})[c.id];
        if (!cell) return "";
        const v = cell.value === null || cell.value === undefined ? "" : tableText(cell.value);
        const shown = cell.chip ? `\`${tableText(cell.chip)}\` ${v}`.trim() : v;
        return cell.url ? `[${shown || cell.url}](${cell.url})` : shown;
      });
      out.push(`| ${r.url ? `[${head}](${r.url})` : head} | ${cells.join(" | ")} |`);
    }
    out.push("");
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
