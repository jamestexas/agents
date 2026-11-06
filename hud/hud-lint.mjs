#!/usr/bin/env node
// hud lint [--json] — the report the skill's lint workflow starts from. It
// reads the tree through buildTree, the same reading the HUD page renders, and
// writes nothing: every finding is a proposal the human approves or drops.
//
// Two questions, both about keeping the tree navigable as it grows:
//
//   tags      Is each tag carrying something the entry's path and frontmatter
//             do not already say? A path names the object (project, PR); a
//             field names a fact (status, ticket); a tag is only for a
//             cross-cutting topic a view would filter on. A tag that restates
//             either of the other two drifts from it, and views built on it lie.
//   clusters  Which notes are about one thing and want to be one folder or one
//             note? A PR is the strongest key (it already has a folder, prs/);
//             a ticket named by several notes in one project is the next.
import path from "node:path";
import { buildTree, defaultRoot } from "./server.mjs";

const TICKET = /^[a-z]+-\d+$/i;
// Words that say what an entry is or where it is in its life. Each has a home
// that is not a tag: status, type, the archive/ section, or the prs/ folder.
const KIND_WORDS = new Set(["archive", "archived", "done", "parked", "active", "review", "pr", "pr-body", "note", "notes", "scratch", "draft", "handoff", "board", "raw"]);
const PR_IN_PATH = /(?:^|\/)PR-(\d+)(?=[-./]|$)/;
const PR_IN_TITLE = /\bPR #?(\d{3,})\b/;

/** The authored entries: everything the page opens, nothing it only lists. */
export function entries(root) {
  return buildTree(root).sections.flatMap((s) => s.entries).filter((e) => !e.listed && typeof e.path === "string");
}

const projectOf = (p) => (p.startsWith("projects/") ? p.split("/")[1] : null);
const inPrFolder = (p) => /^projects\/[^/]+\/prs\/PR-\d+\//.test(p);

/** Fold case, separators and a trailing plural, so `Read_Paths` meets `read-path`. */
export function tagKey(t) {
  return String(t).toLowerCase().replace(/[\s_]+/g, "-").replace(/(?<=[a-z]{3})s$/, "");
}

export function lintTags(list) {
  const uses = new Map();
  for (const e of list) for (const t of e.tags ?? []) uses.set(t, [...(uses.get(t) ?? []), e.path]);
  const groups = new Set(list.map((e) => projectOf(e.path)).filter(Boolean));
  const findings = [];
  for (const [tag, paths] of uses) {
    const k = tagKey(tag);
    // A quote inside the value is the writer's quoting surviving the parse:
    // `"audit"` is not `audit` to any filter.
    if (/["']/.test(tag)) findings.push({ tag, rule: "malformed", fix: `rewrite as ${tag.replace(/[\\"']/g, "")}`, paths });
    else if (TICKET.test(tag)) findings.push({ tag, rule: "ticket", fix: `move to tickets: [${tag.toUpperCase()}]`, paths });
    else if (KIND_WORDS.has(k)) findings.push({ tag, rule: "kind", fix: "drop: status, type, archive/ or prs/ already say this", paths });
    else {
      const restating = paths.filter((p) => projectOf(p) === k);
      if (restating.length) findings.push({ tag, rule: "path", fix: "drop where the entry is already under projects/" + k, paths: restating });
    }
  }
  const byKey = new Map();
  for (const tag of uses.keys()) byKey.set(tagKey(tag), [...(byKey.get(tagKey(tag)) ?? []), tag]);
  for (const spellings of byKey.values()) {
    if (spellings.length > 1) {
      const keep = spellings.sort((a, b) => uses.get(b).length - uses.get(a).length)[0];
      findings.push({ tag: spellings.join(", "), rule: "spelling", fix: `merge into ${keep}`, paths: spellings.flatMap((s) => uses.get(s)) });
    }
  }
  const flagged = new Set(findings.flatMap((f) => f.tag.split(", ")));
  const strays = [...uses].filter(([t, p]) => p.length === 1 && !flagged.has(t)).map(([t, p]) => ({ tag: t, path: p[0] }));
  const inventory = [...uses].map(([tag, p]) => ({ tag, count: p.length })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return { inventory, findings, strays, projects: [...groups].sort() };
}

export function lintClusters(list) {
  const byPr = new Map();
  for (const e of list) {
    const project = projectOf(e.path);
    if (!project) continue;
    const n = e.path.match(PR_IN_PATH)?.[1] ?? e.title?.match(PR_IN_TITLE)?.[1];
    if (!n) continue;
    const key = `${project}#${n}`;
    byPr.set(key, [...(byPr.get(key) ?? []), e.path]);
  }
  const prs = [...byPr].map(([key, paths]) => {
    const [project, n] = key.split("#");
    const target = `projects/${project}/prs/PR-${n}/`;
    return { pr: Number(n), project, target, paths: paths.sort(), move: paths.filter((p) => !p.startsWith(target)).sort() };
  }).filter((c) => c.move.length > 0 || c.paths.filter((p) => !inPrFolder(p)).length > 1)
    .sort((a, b) => b.paths.length - a.paths.length || a.pr - b.pr);

  const byTicket = new Map();
  for (const e of list) {
    const project = projectOf(e.path);
    if (!project || inPrFolder(e.path)) continue;
    for (const t of e.tickets ?? []) {
      const key = `${project}#${String(t).toUpperCase()}`;
      byTicket.set(key, [...(byTicket.get(key) ?? []), e.path]);
    }
  }
  const tickets = [...byTicket].filter(([, p]) => p.length > 1).map(([key, paths]) => {
    const [project, ticket] = key.split("#");
    return { ticket, project, paths: paths.sort() };
  }).sort((a, b) => b.paths.length - a.paths.length || a.ticket.localeCompare(b.ticket));
  return { prs, tickets };
}

export function lint(root) {
  const list = entries(root);
  return { root, entries: list.length, tags: lintTags(list), clusters: lintClusters(list) };
}

function markdown(r) {
  const out = [`# hud lint — ${r.entries} entries under ${r.root}`, "", "Nothing has been changed. Each line is a proposal.", ""];
  const t = r.tags;
  out.push(`## Tags (${t.inventory.length} in use)`, "");
  if (!t.findings.length) out.push("No tag restates a path, status, kind or ticket.", "");
  for (const f of t.findings) out.push(`- **${f.tag}** (${f.rule}, ${f.paths.length}) — ${f.fix}`);
  if (t.strays.length) out.push("", `Used once (${t.strays.length}): ${t.strays.map((s) => `\`${s.tag}\``).join(", ")}`);
  out.push("", `## PR clusters (${r.clusters.prs.length})`, "");
  for (const c of r.clusters.prs) {
    out.push(`- **PR-${c.pr}** → \`${c.target}\``);
    for (const p of c.move) out.push(`  - move \`${p}\``);
  }
  out.push("", `## Ticket clusters (${r.clusters.tickets.length})`, "");
  for (const c of r.clusters.tickets) {
    out.push(`- **${c.ticket}** in ${c.project} (${c.paths.length} notes)`);
    for (const p of c.paths) out.push(`  - \`${p}\``);
  }
  return out.join("\n") + "\n";
}

if (import.meta.url === `file://${path.resolve(process.argv[1] ?? "")}`) {
  const args = process.argv.slice(2);
  const bad = args.find((a) => a !== "--json");
  if (bad) {
    console.error(`hud lint: unknown argument ${bad} — use --json or nothing`);
    process.exit(2);
  }
  const report = lint(process.env.HUD_ROOT || defaultRoot());
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : markdown(report));
}
