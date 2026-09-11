#!/usr/bin/env node
// HUD server: serve ui/, project the HUD_ROOT tree as JSON, and project
// the dynamic sources (work-board, digest CLI, peer PRs) as JSON.
//
// Node stdlib only, forever. No npm packages, no build step, no node_modules.
// The one third-party artifact in this tree is ui/marked.min.js, vendored and
// never fetched at runtime.
//
// Three API groups:
//   static   — /api/tree, /api/md, /api/config
//                                          (walk HUD_ROOT, read files)
//   dynamic  — /api/dyn/{board,digest,peers}, POST /api/refresh/peers
//   sessions — /api/sessions               (read `~/.claude`, graft via lectio)
//   loadout  — /api/loadout                (what skills/agents are installed,
//                                           where from, and where that drifts)
//
// Plus the shell routes: /, /ui/*, and the deep links /n/<path> and
// /s/<group>/<id>, which all serve ui/index.html so a bookmarked view loads
// from cold. See the deep-links section for the path-as-slug rule.
//
// The dynamic group is a projection and nothing more: it holds no logic that
// belongs to the upstream service, and every route degrades in one direction —
// live data, else the last snapshot in `$HUD_ROOT/.generated/` marked `stale:true`,
// else a 503 with a JSON body. A source that is down must never produce an
// unhandled rejection, a raw stack, or a dead server.
//
// Endpoints and commands come from `$HUD_ROOT/hud.toml` only. No URL, handle,
// or project name is hardcoded here — a source absent from the config is a
// source (and a panel) that does not exist.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { lectioGraft, listSessions } from "./sessions.mjs";

// ---------------------------------------------------------------- config

export const DEFAULT_PORT = 4870;

export function defaultRoot() {
  return process.env.HUD_ROOT || path.join(os.homedir(), "hud");
}

/** Left-column order. Any other top-level directory is appended alphabetically. */
export const KNOWN_SECTIONS = ["projects", "playbooks", "peers", "inbox", "archive"];

/** Dynamic-source budgets. Every outward call is bounded in time and size. */
export const LIMITS = {
  httpTimeoutMs: 4000,
  cmdTimeoutMs: 8000,
  maxUpstreamBytes: 2 * 1024 * 1024,
  maxCmdBytes: 4 * 1024 * 1024,
  maxPeers: 32,
  maxPrsPerPeer: 20,
  // Rows one sessions response may carry. Bounds the payload; the per-file
  // read is already bounded inside sessions.mjs.
  maxSessions: 200,
};

/**
 * The rolling window `~/.claude` keeps by default. Reported to the client so
 * the panel can say what it is: an operational window, not an archive.
 */
export const SESSIONS_WINDOW_DAYS = 30;

/** Never walked: machinery and vcs. Dot-prefixed names are skipped separately. */
const SKIP_NAMES = new Set(["_hud", ".git"]);

// ------------------------------------------------------- frontmatter parse

const MALFORMED = Symbol("malformed");

/**
 * Lenient YAML-subset frontmatter parser. Deliberately not a YAML
 * implementation: the schema is a handful of optional flat keys (see HUD.md),
 * and a real parser would be a dependency.
 *
 * Supported: `key: value`, quoted strings, `[a, b]` flow arrays, `- item`
 * block arrays, trailing ` # comment`. Values stay strings; dates are not
 * coerced.
 *
 * Anything outside that subset sets `warn` rather than throwing — a note with
 * bad frontmatter must still be listed, never hidden and never fatal.
 *
 * @returns {{data: Record<string, string|string[]>, body: string, warn: boolean}}
 */
export function parseFrontmatter(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!/^---[ \t]*(\r?\n|$)/.test(src)) return { data: {}, body: src, warn: false };

  const lines = src.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // Unterminated block: treat the whole file as body so a `# heading` default
  // is still reachable.
  if (end === -1) return { data: {}, body: src, warn: true };

  const body = lines.slice(end + 1).join("\n");
  const data = {};
  let warn = false;
  let listKey = null;

  for (const raw of lines.slice(1, end)) {
    const line = raw.replace(/\s+$/, "");
    if (line === "" || /^\s*#/.test(line)) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item) {
      if (!listKey) {
        warn = true;
        continue;
      }
      const v = scalar(stripComment(item[1]));
      if (v === MALFORMED) warn = true;
      else data[listKey].push(v);
      continue;
    }

    const kv = /^([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:(.*)$/.exec(line);
    if (!kv) {
      warn = true;
      continue;
    }
    const key = kv[1];
    const rest = kv[2].trim();
    if (rest === "") {
      // Either an empty value or the head of a `- item` block; an array is the
      // useful reading of both.
      listKey = key;
      data[key] = [];
      continue;
    }
    listKey = null;
    const v = parseValue(stripComment(rest));
    if (v === MALFORMED) warn = true;
    else data[key] = v;
  }

  // A partially-parsed map is worse than none: it renders a half-truth. Fall
  // all the way back to filesystem defaults and flag the entry for lint.
  if (warn) return { data: {}, body, warn: true };
  return { data, body, warn: false };
}

function parseValue(v) {
  if (v.startsWith("{")) return MALFORMED; // flow maps are outside the subset
  if (v.startsWith("[")) {
    if (!v.endsWith("]")) return MALFORMED;
    const inner = v.slice(1, -1).trim();
    if (inner === "") return [];
    const parts = inner
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(scalar);
    return parts.some((p) => p === MALFORMED) ? MALFORMED : parts;
  }
  return scalar(v);
}

function scalar(v) {
  const q = v[0];
  if (q === '"' || q === "'") {
    if (v.length > 1 && v.endsWith(q)) return v.slice(1, -1);
    return MALFORMED; // unbalanced quote
  }
  return v;
}

/** Strip a trailing ` # comment`, ignoring `#` inside quotes or brackets. */
function stripComment(s) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === "#" && depth === 0 && i > 0 && /\s/.test(s[i - 1])) return s.slice(0, i).trimEnd();
  }
  return s;
}

// ------------------------------------------------------------- config parse

/** Canonical config, and the pre-migration file still read when it is absent. */
export const CONFIG_TOML = "hud.toml";
export const CONFIG_JSON = "hud.config.json";

const STRING_ESCAPES = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };

/**
 * Lenient TOML-subset parser, and the sibling of `parseFrontmatter` above:
 * node ships no TOML, the config is a handful of tables of flat scalars, and a
 * real parser would be a dependency. Same bargain, same forgiving posture.
 *
 * Supported: `[table]` and `[dotted.table]` headers, `key = "string"`,
 * `key = 123`, `key = true`/`false`, whole-line `#` comments, a trailing
 * `# comment` after a value or a header, blank lines, and whitespace anywhere
 * it is insignificant.
 *
 * Outside the subset — a dotted bare key, an array, an inline table, a float,
 * a date, an unterminated string — the line is skipped and described in
 * `warns`. Never throws. This is the file the user hand-edits, so one bad line
 * must leave every good line around it readable; the alternative is a typo in
 * `ticket_url_template` silently emptying the panel switchboard.
 *
 * @returns {{data: Record<string, unknown>, warns: string[]}}
 */
export function parseToml(text) {
  const src = String(text);
  const lines = (src.charCodeAt(0) === 0xfeff ? src.slice(1) : src).split(/\r?\n/);
  const data = {};
  const warns = [];
  // The table subsequent keys land in. An unusable header parks what follows
  // in a throwaway object rather than leaking it into the preceding table.
  let table = data;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const where = `line ${i + 1}`;
    if (line === "" || line.startsWith("#")) continue;

    const header = /^\[([^[\]]*)\](.*)$/.exec(line);
    if (header) {
      const opened = trailingIsComment(header[2]) ? openTable(data, header[1].trim()) : null;
      if (opened === null) {
        warns.push(`${where}: unusable table header ${line}`);
        table = {};
        continue;
      }
      table = opened;
      continue;
    }

    // Bare keys only, which is also what rejects a dotted `a.b = 1`.
    const kv = /^([A-Za-z0-9_-]+)[ \t]*=(.*)$/.exec(line);
    if (!kv) {
      warns.push(`${where}: not a [table] header or a key = value line`);
      continue;
    }
    const value = tomlValue(kv[2]);
    if (value === MALFORMED) {
      warns.push(`${where}: value of ${kv[1]} is outside the supported subset`);
      continue;
    }
    table[kv[1]] = value;
  }

  return { data, warns };
}

/**
 * Walk, creating as needed, the table an `[a.b.c]` header names.
 *
 * @returns {Record<string, unknown>|null} null when the path is unusable: an
 *   empty or non-bare segment, or a segment already holding a non-table.
 */
function openTable(root, name) {
  if (name === "") return null;
  let cur = root;
  for (const part of name.split(".")) {
    const key = part.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return null;
    if (cur[key] === undefined) cur[key] = {};
    else if (!cur[key] || typeof cur[key] !== "object" || Array.isArray(cur[key])) return null;
    cur = cur[key];
  }
  return cur;
}

function tomlValue(raw) {
  const v = raw.trim();
  if (v === "") return MALFORMED;
  const q = v[0];
  if (q === '"' || q === "'") {
    const str = readTomlString(v, q);
    if (str === null) return MALFORMED;
    return trailingIsComment(str.rest) ? str.value : MALFORMED;
  }
  // Unquoted, so the value is a bare scalar and the first `#` can only open a
  // comment — no quoted `#` to step around, unlike the frontmatter case.
  const hash = v.indexOf("#");
  const bare = (hash === -1 ? v : v.slice(0, hash)).trim();
  if (bare === "true") return true;
  if (bare === "false") return false;
  if (/^[+-]?[0-9]+$/.test(bare)) return Number(bare);
  return MALFORMED;
}

/**
 * Read the single-line string starting at `v[0]`. `"` honours the escapes this
 * config can need; `'` is literal, as TOML specifies.
 *
 * @returns {{value: string, rest: string}|null} null when unterminated.
 */
function readTomlString(v, q) {
  let value = "";
  for (let i = 1; i < v.length; i++) {
    const c = v[i];
    if (q === '"' && c === "\\") {
      const esc = v[i + 1];
      if (esc === undefined) return null;
      value += STRING_ESCAPES[esc] ?? esc;
      i++;
      continue;
    }
    if (c === q) return { value, rest: v.slice(i + 1) };
    value += c;
  }
  return null;
}

function trailingIsComment(rest) {
  const tail = rest.trim();
  return tail === "" || tail.startsWith("#");
}

// -------------------------------------------------------------- tree walk

/** `projects/<p>/CONTEXT.md` → context, `playbooks/` → playbook, `peers/` → peer, else note. */
export function inferType(rel) {
  const parts = rel.split("/");
  if (parts[0] === "projects" && parts.length === 3 && parts[2] === "CONTEXT.md") return "context";
  if (parts[0] === "playbooks") return "playbook";
  if (parts[0] === "peers") return "peer";
  return "note";
}

function firstHeading(body) {
  const m = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body);
  return m ? m[1] : null;
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function asArray(v) {
  if (v === undefined) return undefined;
  const a = Array.isArray(v) ? v : [v];
  return a.length ? a : undefined;
}

/** Walk a directory collecting relative file paths, skipping machinery and dotfiles. */
function walkFiles(root, rel, out) {
  let dirents;
  try {
    dirents = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out; // unreadable dir is not fatal
  }
  for (const d of dirents) {
    if (d.name.startsWith(".") || SKIP_NAMES.has(d.name)) continue;
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) walkFiles(root, childRel, out);
    // Symlinks are neither followed nor listed: cheapest way to keep the walk
    // acyclic and inside the root.
    else if (d.isFile()) out.push(childRel);
  }
  return out;
}

/**
 * Build one entry for a file. Files under any `raw/` directory (Karpathy's
 * immutable layer) and non-markdown files are *listed* — name, path, size —
 * and never opened.
 */
function buildEntry(root, rel) {
  const abs = path.join(root, rel);
  const parts = rel.split("/");
  const name = parts[parts.length - 1];
  const inRaw = parts.slice(0, -1).includes("raw");
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }

  if (inRaw || !name.toLowerCase().endsWith(".md")) {
    const listed = { name, path: rel, size: stat.size, listed: true };
    if (inRaw) listed.raw = true;
    return listed;
  }

  let text = "";
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    // Unreadable markdown still gets an entry; lint can chase it.
    return {
      title: name.replace(/\.md$/i, ""),
      path: rel,
      date: isoDay(stat.mtimeMs),
      type: inferType(rel),
      status: "active",
      warn: true,
    };
  }

  const { data, body, warn } = parseFrontmatter(text);
  const datePrefix = /^(\d{4}-\d{2}-\d{2})/.exec(name);

  const entry = {
    title: single(data.title) || firstHeading(body) || name.replace(/\.md$/i, ""),
    path: rel,
    date: single(data.date) || (datePrefix ? datePrefix[1] : isoDay(stat.mtimeMs)),
    type: single(data.type) || inferType(rel),
    status: single(data.status) || "active",
  };
  if (warn) entry.warn = true;
  const tags = asArray(data.tags);
  const repos = asArray(data.repos);
  const tickets = asArray(data.tickets);
  const gh = single(data.gh);
  if (tags) entry.tags = tags;
  if (repos) entry.repos = repos;
  if (tickets) entry.tickets = tickets;
  if (gh) entry.gh = gh; // seam: the peers panel keys off this
  return entry;
}

function single(v) {
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : undefined;
}

function compareEntries(rankOf) {
  return (a, b) => {
    const ra = rankOf(a.group);
    const rb = rankOf(b.group);
    if (ra !== rb) return ra - rb;
    // A project's CONTEXT.md is its brief; it leads the group.
    const ca = a.type === "context" ? 0 : 1;
    const cb = b.type === "context" ? 0 : 1;
    if (ca !== cb) return ca - cb;
    // Listed-only files (raw drops, html) sort after parsed notes.
    const la = a.listed ? 1 : 0;
    const lb = b.listed ? 1 : 0;
    if (la !== lb) return la - lb;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1; // newest first
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  };
}

function buildSection(root, name) {
  const entries = [];
  for (const rel of walkFiles(root, name, [])) {
    const entry = buildEntry(root, rel);
    if (!entry) continue;
    const parts = rel.split("/");
    // Within projects, the subdirectory *is* the group label (eve.dev's
    // names-derive-from-paths). Zero config: a new dir is a new group.
    if (name === "projects" && parts.length >= 3) entry.group = parts[1];
    entries.push(entry);
  }

  const section = { name, entries };

  if (name === "projects") {
    const statuses = new Map();
    for (const e of entries) {
      if (!e.group) continue;
      if (!statuses.has(e.group)) statuses.set(e.group, "active");
      if (e.type === "context") statuses.set(e.group, e.status || "active");
    }
    const groups = [...statuses.entries()]
      .map(([gname, status]) => ({ name: gname, status }))
      .sort((a, b) => {
        const ra = a.status === "active" ? 0 : 1;
        const rb = b.status === "active" ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
    section.groups = groups;
    const rank = new Map(groups.map((g, i) => [g.name, i]));
    entries.sort(compareEntries((g) => (g === undefined ? -1 : (rank.get(g) ?? groups.length))));
  } else {
    entries.sort(compareEntries(() => 0));
  }

  return section;
}

/**
 * Project HUD_ROOT as `{generated, sections:[{name, entries, groups?}]}`.
 * Sections are the top-level directories: known ones first in KNOWN_SECTIONS
 * order, then anything else alphabetically. Adding a directory adds a section.
 */
export function buildTree(root) {
  let dirents = [];
  try {
    dirents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    dirents = [];
  }
  const dirs = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP_NAMES.has(d.name))
    .map((d) => d.name);
  const ordered = [
    ...KNOWN_SECTIONS.filter((n) => dirs.includes(n)),
    ...dirs.filter((n) => !KNOWN_SECTIONS.includes(n)).sort(),
  ];
  return {
    generated: new Date().toISOString(),
    sections: ordered.map((n) => buildSection(root, n)),
  };
}

// ------------------------------------------------------------ path safety

/**
 * Resolve `rel` under `base`, or null if it escapes. Lexical check first, then
 * a realpath check when the target exists so a symlink can't tunnel out.
 * Both sides are realpath'd, so a symlinked base (macOS /var → /private/var)
 * is not itself an escape.
 */
export function resolveWithin(base, rel) {
  const baseAbs = path.resolve(base);
  const target = path.resolve(baseAbs, rel);
  if (!contains(baseAbs, target)) return null;

  let baseReal = baseAbs;
  try {
    baseReal = fs.realpathSync(baseAbs);
  } catch {
    /* base may not exist yet; lexical check stands */
  }
  let targetReal = target;
  try {
    targetReal = fs.realpathSync(target);
  } catch {
    return target; // missing target: caller turns this into a 404
  }
  return contains(baseReal, targetReal) ? target : null;
}

/**
 * True if `target` is `base` or below it. Compares whole path segments: a
 * directory legitimately named `...` must not read as an escape, which a
 * `startsWith("..")` test gets wrong.
 */
function contains(base, target) {
  const rel = path.relative(base, target);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  return !rel.split(path.sep).includes("..");
}

// ----------------------------------------------------------- dynamic layer

/**
 * Read the config, with the file that was actually used and the lines the
 * parser could not read.
 *
 * `hud.toml` is canonical. `hud.config.json` is read only when no readable
 * `hud.toml` exists, so a tree copied before the migration keeps working
 * without a second config format to maintain — present-and-empty TOML still
 * wins, because "I emptied the config" is an answer, not an absence.
 *
 * A missing or malformed config is an empty config, i.e. no sources, i.e. no
 * panels: the HUD's static layer must not depend on it being present or valid.
 *
 * @returns {{data: Record<string, unknown>, warns: string[], file: string|null}}
 */
export function loadConfigDetail(root) {
  const toml = readIfPresent(path.join(root, CONFIG_TOML));
  if (toml !== null) {
    const { data, warns } = parseToml(toml);
    return { data, warns, file: CONFIG_TOML };
  }
  const json = readIfPresent(path.join(root, CONFIG_JSON));
  if (json === null) return { data: {}, warns: [], file: null };
  try {
    const cfg = JSON.parse(json);
    return {
      data: cfg && typeof cfg === "object" ? cfg : {},
      warns: [],
      file: CONFIG_JSON,
    };
  } catch (err) {
    return { data: {}, warns: [errText(err)], file: CONFIG_JSON };
  }
}

/**
 * The config as the routes want it: just the values. Called per request, so it
 * deliberately logs nothing — `warns` are reported once at startup by the main
 * block, not once per panel refresh.
 */
export function loadConfig(root) {
  return loadConfigDetail(root).data;
}

function readIfPresent(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function sourceOf(cfg, name) {
  const s = cfg.sources && cfg.sources[name];
  return s && typeof s === "object" ? s : null;
}

/**
 * Machine-written snapshots live in the content tree, never beside the
 * machinery: the machinery is public code and the snapshots are cached work
 * data. Dot-prefixed so the tree walker skips it by the existing rule.
 */
export function generatedDir(root) {
  return path.join(root, ".generated");
}

/**
 * @returns {{cached_at: string, data: unknown}|null} the snapshot, or null if
 * absent/unreadable/not a snapshot. Never throws: a corrupt snapshot is the
 * same as no snapshot.
 */
export function readSnapshot(root, name) {
  try {
    const snap = JSON.parse(fs.readFileSync(path.join(generatedDir(root), `${name}.json`), "utf8"));
    if (!snap || typeof snap !== "object" || typeof snap.cached_at !== "string") return null;
    return snap;
  } catch {
    return null;
  }
}

/**
 * Write `{cached_at, data}` to `generated/<name>.json` via a temp file +
 * rename, so a reader never sees a half-written snapshot. A failed write is
 * logged and swallowed: losing the cache must not lose the live response.
 */
export function writeSnapshot(root, name, data) {
  const snap = { cached_at: new Date().toISOString(), data };
  const dir = generatedDir(root);
  const final = path.join(dir, `${name}.json`);
  const tmp = `${final}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
    fs.renameSync(tmp, final);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing further to do */
    }
    process.stderr.write(`hud: could not cache ${name}: ${errText(err)}\n`);
  }
  return snap;
}

function errText(err) {
  if (!err) return "unknown error";
  if (err.code === "ENOENT") return `command not found: ${err.path || err.syscall || "?"}`;
  return err.message || String(err);
}

/**
 * Split a config command string into argv. Handles quoted segments; there is
 * deliberately no shell, no globbing and no substitution, so a command string
 * cannot grow into a shell injection.
 */
export function tokenizeCommand(cmd) {
  const argv = [];
  let cur = "";
  let quote = null;
  let quoted = false;
  for (const ch of String(cmd)) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur !== "" || quoted) argv.push(cur);
      cur = "";
      quoted = false;
      continue;
    }
    cur += ch;
  }
  if (cur !== "" || quoted) argv.push(cur);
  return argv;
}

/** execFile as a promise. Rejects with the error; stdout is capped. */
function run(file, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: opts.timeout,
        maxBuffer: opts.maxBuffer || LIMITS.maxCmdBytes,
        env: opts.env || process.env,
        cwd: opts.cwd,
        windowsHide: true,
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/** GET the configured board URL and parse it as JSON. Throws on any failure. */
async function fetchBoard(url, timeoutMs) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > LIMITS.maxUpstreamBytes) throw new Error("upstream response too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("upstream response is not JSON");
  }
}

/** Keys a digest command may wrap its array in. First match wins. */
const DIGEST_ARRAY_KEYS = ["observations", "items", "lines"];

/**
 * Run the configured digest command and hand back a JSON array of
 * observations. A bare array and a single-key wrapper (`{"observations":
 * [...]}`, which is what the reference digest CLI emits) are both accepted;
 * the panel is given the array either way. Anything else — non-zero exit,
 * missing binary, unparseable or arrayless output — is a failure, which the
 * route turns into stale-or-503.
 */
async function fetchDigest(cmd, opts) {
  const argv = tokenizeCommand(cmd);
  if (!argv.length) throw new Error("digest cmd is empty");
  const stdout = await run(argv[0], argv.slice(1), opts);
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error("digest output is not JSON");
  }
  if (Array.isArray(data)) return data;
  for (const key of DIGEST_ARRAY_KEYS) {
    if (data && Array.isArray(data[key])) return data[key];
  }
  throw new Error("digest output is not a JSON array of observations");
}

/** GitHub login shape. Anything else never reaches an argv. */
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/**
 * Handles come from `peers/*.md` frontmatter (`gh:`), defaulting to the
 * filename — so adding a colleague is dropping a file, never a code change.
 * Files whose handle is not a plausible login are skipped rather than passed
 * to a subprocess.
 */
export function readPeerHandles(root) {
  let dirents = [];
  try {
    dirents = fs.readdirSync(path.join(root, "peers"), { withFileTypes: true });
  } catch {
    return [];
  }
  const peers = [];
  for (const d of dirents) {
    if (!d.isFile() || d.name.startsWith(".") || !d.name.toLowerCase().endsWith(".md")) continue;
    let data = {};
    try {
      data = parseFrontmatter(fs.readFileSync(path.join(root, "peers", d.name), "utf8")).data;
    } catch {
      /* unreadable peer file falls back to its filename */
    }
    const handle = single(data.gh) || d.name.replace(/\.md$/i, "");
    if (!HANDLE_RE.test(handle)) continue;
    const repos = asArray(data.repos);
    peers.push(repos ? { handle, file: `peers/${d.name}`, repos } : { handle, file: `peers/${d.name}` });
  }
  peers.sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
  return peers.slice(0, LIMITS.maxPeers);
}

const PR_FIELDS = "number,title,repository,updatedAt,url";

async function ghSearchPrs(handle, opts) {
  const stdout = await run(
    "gh",
    ["search", "prs", "--author", handle, "--state", "open", "--json", PR_FIELDS],
    opts,
  );
  let prs;
  try {
    prs = JSON.parse(stdout);
  } catch {
    throw new Error("gh output is not JSON");
  }
  if (!Array.isArray(prs)) throw new Error("gh output is not a JSON array");
  return prs.slice(0, LIMITS.maxPrsPerPeer).map((pr) => ({
    number: pr.number,
    title: pr.title,
    repository: repoName(pr.repository),
    updatedAt: pr.updatedAt,
    url: pr.url,
  }));
}

/** `gh` returns repository as an object; the panel wants one string. */
function repoName(repository) {
  if (!repository) return undefined;
  if (typeof repository === "string") return repository;
  return repository.nameWithOwner || repository.name || undefined;
}

/**
 * Refresh `generated/peers.json` from `peers/*.md` + `gh`.
 *
 * Sequential on purpose: one `gh` call at a time keeps the load on a shared
 * rate limit bounded and predictable, and the peer count is small by
 * construction. If *every* handle fails (no `gh` on the machine, no auth) the
 * last snapshot is left exactly as it was — a partial or empty overwrite would
 * destroy the only thing the panel can still show.
 *
 * @returns {Promise<{ok: boolean, wrote: boolean, snapshot: object|null, errors: Array}>}
 */
export async function refreshPeers(root, opts = {}) {
  const handles = readPeerHandles(root);
  const runOpts = {
    env: opts.env || process.env,
    timeout: opts.cmdTimeoutMs || LIMITS.cmdTimeoutMs,
    cwd: opts.cwd,
  };

  if (!handles.length) {
    // No peer files is a legitimate, fully-refreshed empty state.
    const snapshot = { generated_at: new Date().toISOString(), peers: [] };
    return { ok: true, wrote: writePeers(root, snapshot), snapshot, errors: [] };
  }

  const peers = [];
  const errors = [];
  for (const h of handles) {
    try {
      peers.push({ handle: h.handle, prs: await ghSearchPrs(h.handle, runOpts) });
    } catch (err) {
      const error = errText(err);
      errors.push({ handle: h.handle, error });
      peers.push({ handle: h.handle, prs: [], error });
    }
  }

  if (errors.length === handles.length) {
    process.stderr.write(`hud: peers refresh failed (${errors[0].error}); keeping last snapshot\n`);
    return { ok: false, wrote: false, snapshot: null, errors };
  }

  const snapshot = { generated_at: new Date().toISOString(), peers };
  return { ok: errors.length === 0, wrote: writePeers(root, snapshot), snapshot, errors };
}

/**
 * `peers.json` is written in its own documented shape (`{generated_at, peers}`)
 * rather than the `{cached_at, data}` snapshot envelope: it is generated here,
 * not proxied from anywhere, and the design names that shape.
 */
function writePeers(root, snapshot) {
  const dir = generatedDir(root);
  const final = path.join(dir, "peers.json");
  const tmp = `${final}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, final);
    return true;
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing further to do */
    }
    process.stderr.write(`hud: could not write peers.json: ${errText(err)}\n`);
    return false;
  }
}

export function readPeersSnapshot(root) {
  try {
    const snap = JSON.parse(fs.readFileSync(path.join(generatedDir(root), "peers.json"), "utf8"));
    if (!snap || typeof snap !== "object" || !Array.isArray(snap.peers)) return null;
    return snap;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------- sessions layer

/**
 * Expand a leading `~` in a configured path. Nothing else about the string is
 * interpreted — no env vars, no globs — so a config path stays a path.
 */
export function expandHome(p) {
  const s = String(p ?? "");
  if (s === "~") return os.homedir();
  if (s.startsWith("~/")) return path.join(os.homedir(), s.slice(2));
  return s;
}

/**
 * Group rows by slug — the unambiguous identity — labelled with the readable
 * project name. `listSessions` hands rows back newest-first, so each group's
 * sessions already are, and a group is dated by its first row.
 */
export function groupSessions(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.projectSlug)) {
      groups.set(row.projectSlug, {
        project: row.project,
        projectSlug: row.projectSlug,
        sessions: [],
      });
    }
    groups.get(row.projectSlug).sessions.push(row);
  }
  return [...groups.values()].sort((a, b) => {
    const x = a.sessions[0].lastAt ?? "";
    const y = b.sessions[0].lastAt ?? "";
    return x < y ? 1 : x > y ? -1 : 0;
  });
}

/**
 * Whole-panel graft state: `off` (no lectio configured), `unavailable` (the
 * daemon answered for nothing), else `live`. Per-row `graft` stays on the row;
 * this only saves the client from having to reduce over every row to decide
 * whether to grey the column.
 */
function graftState(lectio, rows) {
  if (!lectio) return "off";
  if (!rows.length) return "unavailable"; // nothing was asked, so nothing answered
  return rows.every((r) => r.graft === "unavailable") ? "unavailable" : "live";
}

/**
 * Project `~/.claude` as grouped session rows, optionally grafted.
 *
 * Watch-only: this route is GET, there is no mutating counterpart anywhere in
 * this file, and nothing here writes — not even a snapshot. Sessions are read
 * live from disk on every request, because caching them would make the HUD the
 * second archive the design says it must never become (lectio is the first).
 *
 * Not configured ⇒ 404, not the 503 the proxied sources use: `board` and
 * `digest` have a snapshot tier where "unconfigured" and "down" are worth
 * distinguishing, whereas an absent `sessions` source means the panel does not
 * exist at all. The UI reads that 404 as "render no panel".
 */
async function serveSessions(res, root, url, dyn) {
  const source = sourceOf(loadConfig(root), "sessions");
  const sessionsRoot = source && typeof source.root === "string" && source.root !== ""
    ? expandHome(source.root)
    : null;
  if (!sessionsRoot) {
    return sendJson(res, 404, {
      source: "sessions",
      error: `sessions is not configured in ${CONFIG_TOML}`,
    });
  }

  let rows = listSessions(sessionsRoot);
  const project = url.searchParams.get("project");
  // Filter on either the display label or the slug: the label is what the
  // panel shows, the slug is what identifies a project without ambiguity.
  if (project) rows = rows.filter((r) => r.project === project || r.projectSlug === project);
  const matched = rows.length;
  rows = rows.slice(0, LIMITS.maxSessions);

  const lectio =
    typeof source.lectio === "string" && source.lectio !== "" ? source.lectio : null;
  // `lectioGraft` never throws and never partially fails a row: a daemon that
  // is down, slow, or unauthorized comes back as `graft:"unavailable"`, so the
  // panel stays a 200 with tier 1 intact.
  if (lectio) rows = await lectioGraft(rows, lectio, { timeoutMs: dyn.httpTimeoutMs });

  return sendJson(res, 200, {
    source: "sessions",
    stale: false,
    generated_at: new Date().toISOString(),
    root: sessionsRoot,
    window_days: SESSIONS_WINDOW_DAYS,
    graft: graftState(lectio, rows),
    count: rows.length,
    truncated: matched > rows.length,
    groups: groupSessions(rows),
  });
}

// ----------------------------------------------------------- loadout layer
//
// What this machine has actually *loaded*: the skills and agents reachable
// from the Claude root, where each one really comes from, and the places that
// inventory disagrees with the repositories it is supposed to mirror.
//
// Names and paths only. This layer never opens a file — not a SKILL.md, and
// emphatically not a settings or permissions file. It reads directory entries,
// follows symlinks, and stats. That is the whole vocabulary, and it is what
// keeps a panel about provenance from becoming a config dump.
//
// Nothing about the harness's own resolution order is modelled here. Which
// definition wins when two carry the same name is the harness's business; the
// HUD's business is to say that two exist.

/** Used when `sources.loadout` names no other root. */
export const DEFAULT_CLAUDE_ROOT = "~/.claude";

/**
 * Bounds on the walk. A deep symlink chain, a huge skills directory or a
 * pathological slug must cost a bounded number of syscalls, not hang the
 * request.
 */
export const LOADOUT_LIMITS = {
  maxSymlinkHops: 8,
  maxEntries: 500,
  maxRepos: 64,
  maxRepoSkills: 200,
  slugDecodeSteps: 512,
};

/** Severity per flag, so the panel colours drift without re-deriving the rule. */
const DRIFT_SEVERITY = {
  "broken-symlink": "hot",
  "name-collision": "hot",
  "unlinked-repo-skill": "warn",
  "stale-project-slug": "warn",
};

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function realpathOr(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Directory entry names, dotfiles excluded, sorted. `[]` if unreadable. */
function readdirNames(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => !n.startsWith("."))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Decode a `~/.claude/projects` slug back into the path it was made from.
 *
 * The slug is the path with every `/` replaced by `-`, which is lossy: a
 * directory whose own name contains a hyphen is indistinguishable from two
 * directories. The filesystem breaks the tie — a candidate segment is only
 * taken when it exists — and the longest segment is tried first, so
 * `<...>/a-b` is preferred over `<...>/a/b` when both are real.
 *
 * When no reading exists on disk (the usual case for a slug carried over from
 * another machine) the naive full decode is returned and existence-checked, so
 * the caller gets a concrete path to name in the drift flag rather than null.
 *
 * @param {string} slug
 * @param {{exists?: (p: string) => boolean}} [opts] injectable for tests
 * @returns {{path: string, exists: boolean}}
 */
export function decodeProjectSlug(slug, opts = {}) {
  const exists = opts.exists || isDir;
  const s = String(slug ?? "");
  const absolute = s.startsWith("-");
  const tokens = (absolute ? s.slice(1) : s).split("-");
  const found = walkSlug(absolute ? "/" : "", tokens, 0, exists, {
    left: LOADOUT_LIMITS.slugDecodeSteps,
  });
  if (found !== null) return { path: found, exists: true };
  const naive = (absolute ? "/" : "") + tokens.join("/");
  return { path: naive, exists: exists(naive) };
}

/** Depth-first over separator-vs-hyphen readings, pruned by what is on disk. */
function walkSlug(prefix, tokens, i, exists, budget) {
  if (i >= tokens.length) return prefix === "" ? null : prefix;
  for (let take = tokens.length - i; take >= 1; take--) {
    if (budget.left-- <= 0) return null;
    const seg = tokens.slice(i, i + take).join("-");
    const next = prefix === "" ? seg : prefix === "/" ? `/${seg}` : `${prefix}/${seg}`;
    if (!exists(next)) continue;
    const done = walkSlug(next, tokens, i + take, exists, budget);
    if (done !== null) return done;
  }
  return null;
}

/**
 * Follow `abs` hop by hop, collecting each resolved link target.
 *
 * `chain` is empty for anything that is not a symlink, so a plain directory
 * and a one-hop link are told apart by the chain, not by a separate field. A
 * chain longer than the hop budget is reported as not existing: a loop is
 * indistinguishable from a very deep link, and both are drift.
 */
function resolveChain(abs) {
  const chain = [];
  let cur = abs;
  for (let i = 0; i <= LOADOUT_LIMITS.maxSymlinkHops; i++) {
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return { chain, target: cur, targetExists: false };
    }
    if (!st.isSymbolicLink()) return { chain, target: cur, targetExists: true };
    if (chain.length >= LOADOUT_LIMITS.maxSymlinkHops) break;
    let link;
    try {
      link = fs.readlinkSync(cur);
    } catch {
      return { chain, target: cur, targetExists: false };
    }
    cur = path.resolve(path.dirname(cur), link);
    chain.push(cur);
  }
  return { chain, target: cur, targetExists: false };
}

/**
 * One inventory row per entry in `dir`. `root` is where the entry's bytes
 * really live — the HUD tree, one of the known repositories, a plugin, or
 * nowhere in particular.
 */
function inventoryOf(dir, ctx) {
  let dirents;
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const d of dirents) {
    if (d.name.startsWith(".")) continue;
    const abs = path.join(dir, d.name);
    const { chain, target, targetExists } = resolveChain(abs);
    rows.push({
      name: d.name,
      // Checked symlink-first: a dirent describes the link itself, so a link
      // to a directory answers `isDirectory()` false and would otherwise fall
      // through to "file".
      kind: d.isSymbolicLink() ? "symlink" : d.isDirectory() ? "dir" : "file",
      chain,
      targetExists,
      root: targetExists ? rootOf(target, ctx) : "standalone",
    });
    if (rows.length >= LOADOUT_LIMITS.maxEntries) break;
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows;
}

/**
 * Which tree `target` belongs to. The longest containing repository wins, so a
 * repo nested under a discovered parent directory is named as itself rather
 * than as its parent.
 */
function rootOf(target, ctx) {
  const real = realpathOr(target);
  if (ctx.hudRoot && contains(ctx.hudRoot, real)) return "hud";
  let best = null;
  for (const repo of ctx.repos) {
    if (!contains(repo.path, real)) continue;
    if (!best || repo.path.length > best.path.length) best = repo;
  }
  if (best) return `repo:${best.repo}`;
  if (ctx.pluginsDir && contains(ctx.pluginsDir, real)) return "plugin";
  return "standalone";
}

/**
 * Repositories this machine is known to work in, discovered from filesystem
 * facts alone: every `~/.claude/projects` slug that decodes to a directory
 * that exists, plus the HUD tree. Nothing is configured, and no name is
 * written down anywhere in this file.
 *
 * @returns {{repos: Array<{repo: string, path: string}>, slugs: Array<{slug: string, path: string, exists: boolean}>}}
 */
function discoverRepos(claudeRoot, hudRoot) {
  const slugs = [];
  const byPath = new Map();
  const add = (p) => {
    const real = realpathOr(p);
    if (byPath.has(real) || !isDir(real)) return;
    if (byPath.size >= LOADOUT_LIMITS.maxRepos) return;
    byPath.set(real, { repo: path.basename(real), path: real });
  };

  if (hudRoot) add(hudRoot);
  for (const slug of readdirNames(path.join(claudeRoot, "projects"))) {
    const decoded = decodeProjectSlug(slug);
    slugs.push({ slug, path: decoded.path, exists: decoded.exists });
    if (decoded.exists) add(decoded.path);
  }

  const repos = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  return { repos, slugs };
}

/** The two places a repository keeps skills: `skills/` and `.claude/skills/`. */
const REPO_SKILL_DIRS = ["skills", path.join(".claude", "skills")];

/** `{name, path}` per skill directory a repository carries, deduped by name. */
function repoSkills(repo) {
  const byName = new Map();
  for (const rel of REPO_SKILL_DIRS) {
    const dir = path.join(repo.path, rel);
    for (const name of readdirNames(dir)) {
      if (byName.has(name) || byName.size >= LOADOUT_LIMITS.maxRepoSkills) continue;
      const abs = path.join(dir, name);
      // Follows the link on purpose: a repo's skill may itself be a symlink
      // into another tree, and it is still that repo's skill.
      if (isDir(abs)) byName.set(name, { name, path: abs });
    }
  }
  return [...byName.values()];
}

/** Names only — never contents — of what a repository's `.claude` holds. */
function dotClaudeCarries(repoPath) {
  const dot = path.join(repoPath, ".claude");
  return {
    skills: readdirNames(path.join(dot, "skills")),
    agents: readdirNames(path.join(dot, "agents")),
    settings: readdirNames(dot).filter((n) => /^settings.*\.json$/.test(n)),
  };
}

function driftFlag(flag, fields) {
  return { flag, severity: DRIFT_SEVERITY[flag] || "warn", ...fields };
}

/**
 * Project the Claude root as an inventory plus the ways it has drifted from
 * the repositories behind it.
 *
 * Watch-only, like sessions: read live on every request, cached nowhere, and
 * reachable by no verb but GET.
 *
 * @param {{claudeRoot: string, hudRoot?: string}} opts
 */
export function buildLoadout(opts) {
  const claudeRoot = opts.claudeRoot;
  const hudRoot = opts.hudRoot ? realpathOr(opts.hudRoot) : null;
  const { repos, slugs } = discoverRepos(claudeRoot, hudRoot);
  const ctx = { hudRoot, repos, pluginsDir: realpathOr(path.join(claudeRoot, "plugins")) };

  const skills = inventoryOf(path.join(claudeRoot, "skills"), ctx);
  const agents = inventoryOf(path.join(claudeRoot, "agents"), ctx);
  const drift = [];

  // 1. A link that points at nothing. The harness will not load it, and the
  //    name looks installed until someone follows it.
  for (const [kind, rows] of [
    ["skill", skills],
    ["agent", agents],
  ]) {
    for (const row of rows) {
      if (row.kind === "symlink" && !row.targetExists) {
        drift.push(
          driftFlag("broken-symlink", {
            kind,
            name: row.name,
            target: row.chain.length ? row.chain[row.chain.length - 1] : null,
          }),
        );
      }
    }
  }

  // 2 & 3. Compare each repository's skills against what the Claude root has
  //    under the same name: absent is unlinked, present-but-elsewhere is a
  //    collision — two definitions of one name, and only one of them loads.
  const installed = new Map(
    skills.map((row) => [row.name, realpathOr(path.join(claudeRoot, "skills", row.name))]),
  );
  const repoOut = [];
  for (const repo of repos) {
    const carried = repoSkills(repo);
    for (const skill of carried) {
      const target = installed.get(skill.name);
      if (target === undefined) {
        drift.push(driftFlag("unlinked-repo-skill", { kind: "skill", name: skill.name, repo: repo.repo }));
      } else if (target !== realpathOr(skill.path)) {
        drift.push(
          driftFlag("name-collision", {
            kind: "skill",
            name: skill.name,
            repo: repo.repo,
            installed: target,
            repoPath: skill.path,
          }),
        );
      }
    }
    const hasDotClaude = isDir(path.join(repo.path, ".claude"));
    repoOut.push({
      repo: repo.repo,
      path: repo.path,
      hasDotClaude,
      carries: hasDotClaude
        ? dotClaudeCarries(repo.path)
        : { skills: [], agents: [], settings: [] },
    });
  }

  // 4. A session directory whose project is gone — usually a slug carried over
  //    from an older machine or a deleted checkout.
  for (const s of slugs) {
    if (!s.exists) drift.push(driftFlag("stale-project-slug", { slug: s.slug, path: s.path }));
  }

  return {
    source: "loadout",
    stale: false,
    generated_at: new Date().toISOString(),
    root: claudeRoot,
    drift,
    inventory: { skills, agents },
    repos: repoOut,
  };
}

/**
 * Not configured is *on*: the loadout reads the local filesystem and needs no
 * endpoint, so the default root is enough to make the panel work out of the
 * box. `loadout = false` under `[sources]` is the off switch, and answers
 * 404 — the same panel-off contract `sessions` uses.
 */
function serveLoadout(res, root) {
  const cfg = loadConfig(root);
  const configured = cfg.sources ? cfg.sources.loadout : undefined;
  if (configured === false) {
    return sendJson(res, 404, {
      source: "loadout",
      error: `loadout is switched off in ${CONFIG_TOML}`,
    });
  }
  const source = configured && typeof configured === "object" ? configured : {};
  const claudeRoot = expandHome(
    typeof source.claude_root === "string" && source.claude_root !== ""
      ? source.claude_root
      : DEFAULT_CLAUDE_ROOT,
  );
  return sendJson(res, 200, buildLoadout({ claudeRoot, hudRoot: root }));
}

// -------------------------------------------------------------- deep links
//
// The path *is* the slug. There is no registry mapping pretty names onto
// files: `/n/playbooks/example-playbook` names `playbooks/example-playbook.md`
// because that is where the file lives. A note that moves takes its URL with
// it, and a note that is added needs no registration anywhere.
//
//   /n/<repo-relative entry path>    trailing `.md` optional
//   /s/<group>/<session-id>
//
// Both serve the app shell and nothing else. Which entry, which session, or
// neither is decided in the client against the tree it already fetched — so a
// well-formed link to something that has since been renamed lands in a working
// HUD showing "not found", never on a server error.

const DEEP_LINK_KINDS = { n: "entry", s: "session" };

/**
 * Parse a request target into a deep-link route.
 *
 * `target` is the *raw* request target with percent-encoding intact. Clients
 * that fold `..` away never reach the guard below, but one that spells it
 * `%2e%2e` must not slip past a check made before decoding — so every segment
 * is decoded first and then judged.
 *
 * Pure when `root` is omitted: it reports the path exactly as written. Given a
 * root it applies the one resolution rule — serve `<path>` if that file
 * exists, else `<path>.md` — so `/n/playbooks/example-playbook` finds the
 * markdown file without either side keeping a slug table.
 *
 * `kind:null` means "not a deep link, keep routing"; `kind:'invalid'` means
 * the caller must answer 400 with `reason`.
 *
 * @param {string} target
 * @param {{root?: string}} [opts]
 * @returns {{kind: 'entry'|'session'|'invalid'|null, path?: string,
 *            group?: string, id?: string, reason?: string}}
 */
export function resolveRoute(target, opts = {}) {
  const pathname = String(target ?? "").split(/[?#]/)[0];
  const m = /^\/([ns])\/(.*)$/.exec(pathname);
  if (!m) return { kind: null };
  const kind = DEEP_LINK_KINDS[m[1]];

  const segments = [];
  for (const seg of m[2].split("/")) {
    if (seg === "") return { kind: "invalid", reason: "empty path segment" };
    let decoded;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return { kind: "invalid", reason: "bad path encoding" };
    }
    if (decoded === "." || decoded === "..") {
      return { kind: "invalid", reason: "path escapes HUD_ROOT" };
    }
    // A separator that only appeared after decoding is a segment boundary the
    // split above never saw, so it is refused rather than re-split.
    if (/[/\\\0]/.test(decoded)) return { kind: "invalid", reason: "bad path segment" };
    segments.push(decoded);
  }

  if (kind === "session") {
    if (segments.length !== 2) return { kind: "invalid", reason: "expected /s/<group>/<id>" };
    return { kind: "session", group: segments[0], id: segments[1] };
  }

  const rel = segments.join("/");
  if (opts.root === undefined) return { kind: "entry", path: rel };
  // Realpath containment, same as /api/md: segment checks stop `..`, this
  // stops a symlink inside the root from tunnelling out of it.
  if (resolveWithin(opts.root, rel) === null) {
    return { kind: "invalid", reason: "path escapes HUD_ROOT" };
  }
  return { kind: "entry", path: existingEntry(opts.root, rel) ?? rel };
}

/** `<rel>` if it is a file, else `<rel>.md` if that is, else null. */
function existingEntry(root, rel) {
  for (const candidate of [rel, `${rel}.md`]) {
    const abs = resolveWithin(root, candidate);
    if (abs === null) continue;
    try {
      if (fs.statSync(abs).isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

// ------------------------------------------------------------ http server

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export function contentTypeFor(p) {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";
}

function sendText(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function sendJson(res, code, obj) {
  sendText(res, code, JSON.stringify(obj, null, 2), "application/json; charset=utf-8");
}

function sendFile(res, abs, type) {
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return sendText(res, 404, "not found\n");
  }
  res.writeHead(200, {
    "content-type": type,
    "content-length": buf.length,
    "cache-control": "no-store",
  });
  res.end(buf);
}

/**
 * @param {{root?: string, uiDir?: string, env?: object, httpTimeoutMs?: number,
 *          cmdTimeoutMs?: number}} [opts]
 * @returns {import('node:http').Server & {hudRefreshPeers: () => Promise<object>}}
 */
export function createServer(opts = {}) {
  const root = opts.root || defaultRoot();
  const uiDir = opts.uiDir || path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");
  const dyn = {
    env: opts.env || process.env,
    httpTimeoutMs: opts.httpTimeoutMs || LIMITS.httpTimeoutMs,
    cmdTimeoutMs: opts.cmdTimeoutMs || LIMITS.cmdTimeoutMs,
    // Whether the peers snapshot on disk was produced by a *successful*
    // refresh in this process. Until one lands, the panel is honest about
    // showing a snapshot.
    peersFresh: false,
    inFlight: null,
  };

  const refresh = () => {
    // Collapse concurrent refreshes: the ⟳ button must not fan out into N
    // parallel `gh` storms.
    if (!dyn.inFlight) {
      dyn.inFlight = refreshPeers(root, dyn)
        .then((result) => {
          // Freshness tracks whether a new snapshot landed, not whether every
          // handle succeeded: a partial refresh is fresh data with a reported
          // per-peer error, and only an all-failed refresh leaves stale bytes.
          dyn.peersFresh = result.wrote;
          return result;
        })
        .catch((err) => ({ ok: false, wrote: false, snapshot: null, errors: [{ error: errText(err) }] }))
        .finally(() => {
          dyn.inFlight = null;
        });
    }
    return dyn.inFlight;
  };

  const server = http.createServer((req, res) => {
    let done;
    try {
      done = handle(req, res, root, uiDir, dyn, refresh);
    } catch (err) {
      return fail(res, err);
    }
    // Dynamic routes are async; an upstream that hangs up mid-flight must
    // still land as a JSON error, never an unhandled rejection.
    if (done && typeof done.catch === "function") done.catch((err) => fail(res, err));
  });

  server.hudRefreshPeers = refresh;
  return server;
}

/** A bad note, or a source misbehaving, must never take the HUD down. */
function fail(res, err) {
  process.stderr.write(`hud: request failed: ${errText(err)}\n`);
  if (res.headersSent) return res.end();
  sendJson(res, 500, { error: errText(err) });
}

function handle(req, res, root, uiDir, dyn, refresh) {
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch {
    return sendText(res, 400, "bad request\n");
  }
  const pathname = url.pathname;

  if (req.method === "POST") {
    req.resume(); // drain: nothing here reads a request body
    if (pathname === "/api/refresh/peers") return serveRefreshPeers(res, root, dyn, refresh);
    return sendText(res, 405, "method not allowed\n");
  }
  if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "method not allowed\n");

  if (pathname === "/api/tree") return sendJson(res, 200, buildTree(root));
  if (pathname === "/api/md") return serveMarkdown(res, root, url.searchParams.get("path"));
  // The parsed config. The UI needs `ticket_url_template` and used to read the
  // config's raw bytes through /api/md, which only worked while the file was
  // JSON; the browser has no TOML parser and must not grow a second copy of
  // this one. Exposes nothing new — /api/md still serves the file verbatim.
  if (pathname === "/api/config") return sendJson(res, 200, loadConfig(root));
  if (pathname === "/api/dyn/board") return serveBoard(res, root, dyn);
  if (pathname === "/api/dyn/digest") return serveDigest(res, root, dyn);
  if (pathname === "/api/dyn/peers") return servePeers(res, root, dyn);
  // Sessions is read-only by construction: this is its only route, and the
  // POST arm above has no sessions case, so every mutating verb lands on 405.
  if (pathname === "/api/sessions") return serveSessions(res, root, url, dyn);
  // Same watch-only shape as sessions: one GET route, no POST case above, so
  // every mutating verb lands on the 405 arm.
  if (pathname === "/api/loadout") return serveLoadout(res, root);
  // Matched against the raw target rather than `url.pathname`: the URL parser
  // folds `..` away, and a traversal attempt must be refused outright rather
  // than quietly rewritten into whichever route it normalises to.
  const deep = resolveRoute(req.url, { root });
  if (deep.kind === "invalid") return sendText(res, 400, `${deep.reason}\n`);
  if (deep.kind !== null) return serveStatic(res, uiDir, "index.html");
  if (pathname === "/" || pathname === "/index.html") return serveStatic(res, uiDir, "index.html");
  if (pathname.startsWith("/ui/")) return serveStatic(res, uiDir, pathname.slice("/ui/".length));
  return sendText(res, 404, "not found\n");
}

/**
 * The one degradation ladder every proxied source walks: live ⇒ snapshot
 * (`stale:true`) ⇒ 503 with a JSON body. `data` carries the upstream payload
 * verbatim; `stale` and `cached_at` are the envelope, so the client can tell
 * "now" from "as of" without the server reinterpreting anyone's schema.
 */
async function serveSource(res, root, name, source, produce) {
  if (!source) {
    // Not configured ⇒ the source does not exist ⇒ the panel does not exist.
    // Deliberately not served from a snapshot: `sources` is the switchboard.
    return sendJson(res, 503, { source: name, error: `${name} is not configured in ${CONFIG_TOML}` });
  }
  try {
    const data = await produce();
    const { cached_at } = writeSnapshot(root, name, data);
    return sendJson(res, 200, { source: name, stale: false, cached_at, data });
  } catch (err) {
    const snap = readSnapshot(root, name);
    if (snap) {
      return sendJson(res, 200, {
        source: name,
        stale: true,
        cached_at: snap.cached_at,
        data: snap.data,
        error: errText(err),
      });
    }
    return sendJson(res, 503, { source: name, stale: true, cached_at: null, error: errText(err) });
  }
}

function serveBoard(res, root, dyn) {
  const source = sourceOf(loadConfig(root), "board");
  const url = source && typeof source.url === "string" ? source.url : null;
  return serveSource(res, root, "board", url ? source : null, () =>
    fetchBoard(url, dyn.httpTimeoutMs),
  );
}

function serveDigest(res, root, dyn) {
  const source = sourceOf(loadConfig(root), "digest");
  const cmd = source && typeof source.cmd === "string" ? source.cmd : null;
  return serveSource(res, root, "digest", cmd ? source : null, () =>
    fetchDigest(cmd, { env: dyn.env, timeout: dyn.cmdTimeoutMs }),
  );
}

/**
 * Peers is snapshot-only by design: the read path never shells out, so opening
 * the HUD cannot stall on `gh`. Refresh happens at start and on the ⟳ button.
 */
function servePeers(res, root, dyn) {
  const snap = readPeersSnapshot(root);
  if (!snap) {
    return sendJson(res, 503, {
      source: "peers",
      stale: true,
      cached_at: null,
      error: "no peers snapshot yet",
    });
  }
  return sendJson(res, 200, {
    source: "peers",
    stale: !dyn.peersFresh,
    cached_at: snap.generated_at,
    data: snap,
  });
}

async function serveRefreshPeers(res, root, dyn, refresh) {
  const result = await refresh();
  const snap = readPeersSnapshot(root);
  if (!snap) {
    return sendJson(res, 503, {
      source: "peers",
      stale: true,
      cached_at: null,
      error: result.errors.length ? result.errors[0].error : "no peers snapshot yet",
      errors: result.errors,
    });
  }
  return sendJson(res, 200, {
    source: "peers",
    stale: !dyn.peersFresh,
    cached_at: snap.generated_at,
    refreshed: result.wrote,
    errors: result.errors,
    data: snap,
  });
}

function serveMarkdown(res, root, rel) {
  // `rel` arrives already percent-decoded by URLSearchParams; decoding again
  // would corrupt a filename containing a literal `%`.
  if (rel === null || rel === "") return sendText(res, 400, "missing ?path\n");
  if (rel.includes("\0")) return sendText(res, 400, "bad path\n");

  const abs = resolveWithin(root, rel);
  if (abs === null) return sendText(res, 400, "path escapes HUD_ROOT\n");

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return sendText(res, 404, "not found\n");
  }
  if (!stat.isFile()) return sendText(res, 400, "not a file\n");

  // Exact bytes; the client decides how to render them.
  sendFile(res, abs, "text/plain; charset=utf-8");
}

function serveStatic(res, uiDir, rel) {
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return sendText(res, 400, "bad path encoding\n");
  }
  const abs = resolveWithin(uiDir, decoded);
  if (abs === null) return sendText(res, 400, "path escapes ui dir\n");
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return sendText(res, 404, "not found\n");
  }
  if (!stat.isFile()) return sendText(res, 404, "not found\n");
  sendFile(res, abs, contentTypeFor(abs));
}

// ------------------------------------------------------------------- main

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const root = defaultRoot();
  const port = Number(process.env.HUD_PORT || DEFAULT_PORT);
  // Once, at startup, and only here: the routes reload the config per request,
  // so warning from `loadConfig` would reprint every unreadable line on every
  // panel refresh. A line the parser skipped is still worth saying out loud —
  // the config is hand-edited, and silence would read as "accepted".
  const cfg = loadConfigDetail(root);
  for (const warn of cfg.warns) {
    process.stderr.write(`hud: ${cfg.file}: ${warn}\n`);
  }
  const server = createServer({ root });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`hud: ${root}\nhud: http://127.0.0.1:${port}/\n`);
    // Peers refresh runs after listen and off the request path: a missing or
    // slow `gh` delays the panel, never the HUD.
    server.hudRefreshPeers().then(
      (r) => process.stdout.write(`hud: peers ${r.wrote ? "refreshed" : "unchanged"}\n`),
      () => {},
    );
  });
  server.on("error", (err) => {
    process.stderr.write(`hud: ${err.message}\n`);
    process.exit(1);
  });
}
