#!/usr/bin/env node
/**
 * hud-index.mjs — project the HUD tree as mache records.
 *
 * mache's tree-sitter selectors see one file at a time and only its basename
 * (`internal/ingest/engine_treesitter.go` passes `filepath.Base`), so a schema
 * over `*.md` cannot recover the directory chain that gives this tree its
 * meaning: section / project / entry. The fix is mache's own documented
 * two-stage idiom (`examples/audit-indexer.py` + `audit-schema.json`) —
 * flatten the tree into records first, then let the schema name nodes from
 * record fields.
 *
 * Output is a SQLite `results(id, record)` table, which is what mache ingests
 * without needing a FUSE mount (a JSON data source can only be mounted, and
 * mounting wants sudo). Every node name in hud-schema.json is a template over
 * the fields written here, so adding a directory or a frontmatter value adds
 * graph structure with no schema edit.
 *
 * Frontmatter is not re-parsed: `buildTree` from server.mjs is the single
 * parse contract, so the graph and the HUD UI cannot disagree about what an
 * entry says.
 *
 *   node hud/hud-index.mjs             # writes $HUD_ROOT/.generated/hud-index.db
 *
 * Respects HUD_ROOT. Writes only inside `$HUD_ROOT/.generated/`, which is
 * machine-written and gitignored — never beside this file, which is public
 * code in a shared repo.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { buildTree, defaultRoot, generatedDir, loadConfig } from "./server.mjs";

/** Sentinel for "this entry sits directly in its group directory". */
const NO_SUBGROUP = "_";

/**
 * Split a repo-relative path into the four graph levels.
 *
 * `section` is the top-level directory. `group` is the next segment when there
 * is one — the HUD's rule that `projects/<project>/` *is* the label — and the
 * section itself for a flat section like `playbooks/`, so every section has at
 * least one group. `subgroup` is whatever directories remain (`notes`, `raw`,
 * or `<project>-notes` under the archive's mirrored tree), joined so that no
 * two files in different directories can claim the same node id.
 */
export function levelsFor(rel) {
  const parts = rel.split("/");
  const file = parts[parts.length - 1];
  const mids = parts.slice(1, -1);
  return {
    section: parts[0],
    group: mids[0] ?? parts[0],
    subgroup: mids.slice(1).join("-") || NO_SUBGROUP,
    slug: file.replace(/\.md$/i, ""),
  };
}

/** Drop undefined and empty-array fields so absent frontmatter selects nothing. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * One record per entry, wrapped as `{entry: …}`. The wrapper is the schema's
 * discriminator: an `$[*].entry` selector skips panel records and vice versa,
 * so one schema covers both record families.
 */
export function entryRecords(tree) {
  const records = [];
  for (const section of tree.sections ?? []) {
    for (const entry of section.entries ?? []) {
      if (!entry.path) continue;
      const levels = levelsFor(entry.path);
      records.push({
        id: `entry:${entry.path}`,
        record: {
          entry: compact({
            ...levels,
            path: entry.path,
            title: entry.title ?? levels.slug,
            date: entry.date,
            type: entry.type,
            status: entry.status,
            tags: entry.tags,
            tickets: entry.tickets,
            repos: entry.repos,
            gh: entry.gh,
            listed: entry.listed ? "true" : undefined,
            warn: entry.warn ? "true" : undefined,
          }),
        },
      });
    }
  }
  return records;
}

/**
 * One record per configured source, wrapped as `{panel: …}`. `hud.toml`'s
 * `[sources.*]` tables are the HUD's panel switchboard, so the panels belong
 * in the same graph as the content they sit beside.
 */
export function panelRecords(config) {
  const sources = config.sources && typeof config.sources === "object" ? config.sources : {};
  return Object.entries(sources).map(([name, source]) => {
    const spec = source && typeof source === "object" ? source : {};
    // The key that is present names the panel's kind: a URL panel, a command
    // panel, or a filesystem-rooted one. No kind list is hardcoded.
    const kind = Object.keys(spec)[0] ?? "unknown";
    return {
      id: `panel:${name}`,
      record: { panel: compact({ name, kind, target: String(spec[kind] ?? "") }) },
    };
  });
}

function write(dbPath, records) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.rmSync(dbPath, { force: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE results (id TEXT PRIMARY KEY, record TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO results (id, record) VALUES (?, ?)");
    for (const r of records) insert.run(r.id, JSON.stringify(r.record));
  } finally {
    db.close();
  }
}

export function buildIndex(root = defaultRoot()) {
  const records = [...entryRecords(buildTree(root)), ...panelRecords(loadConfig(root))];
  const dbPath = path.join(generatedDir(root), "hud-index.db");
  write(dbPath, records);
  return { dbPath, records };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;

if (invokedDirectly) {
  const root = defaultRoot();
  const { dbPath, records } = buildIndex(root);
  const entries = records.filter((r) => r.id.startsWith("entry:")).length;
  process.stdout.write(
    `hud-index: ${dbPath}\nhud-index: ${entries} entries, ${records.length - entries} panels\n`,
  );
}
