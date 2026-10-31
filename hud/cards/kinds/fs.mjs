// The `fs` kind: rows are files under a root matched by a segment glob.
//
// This is the reviews layer's walk, moved here so any card can declare one.
// It is deliberately not a globbing library: a pattern is split on `/`, each
// segment is a literal name or a within-segment `*` match, and the walk is
// `readdirSync` plus a per-name test — the same walk the tree uses, so a
// pattern can never reach outside the root it is applied to.
//
// The kind parses and hands over; it does not interpret. A row is the file's
// JSON object under `data`, or `unreadable: true` with the reason, and what
// the page may see of either is the normaliser's decision.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { errText } from "../../errtext.mjs";

/** Names the walk never enters, dot-prefixed or not: the machinery link and the repo. */
export const SKIP_NAMES = new Set(["_hud", ".git"]);

export const LIMITS = Object.freeze({
  // Files the walk looks at before stopping. A tree with more rows than this
  // is an archive, and the HUD is not the tool for one.
  maxScanned: 2000,
  // A state file is a few hundred bytes; one that is not is not a state file.
  maxBytes: 256 * 1024,
  // A `text` row hands over the head of the file, not the file: a generated
  // page can run to megabytes, and what a normaliser reads from it (a title)
  // sits at the top.
  headBytes: 16 * 1024,
});

/** How a matched file becomes a row: parsed as a JSON object, or handed over as the head of its text. */
export const FORMATS = Object.freeze(["json", "text"]);

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
 * Split a glob into segments and refuse what the walker cannot honour: an
 * absolute path, an empty segment, `.` or `..`.
 *
 * @returns {{segments: Array<{literal?: string, re?: RegExp}>}|{error: string}}
 */
export function parseGlob(glob) {
  const s = String(glob ?? "");
  if (s === "" || s.startsWith("/") || /[\\\0]/.test(s)) {
    return { error: "glob must be a relative path" };
  }
  const segments = [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === "." || seg === "..") {
      return { error: "glob must not contain empty, '.' or '..' segments" };
    }
    if (!seg.includes("*")) {
      segments.push({ literal: seg });
      continue;
    }
    const parts = seg.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    segments.push({ re: new RegExp(`^${parts.join("[^/]*")}$`) });
  }
  return { segments };
}

/**
 * Whether a relative path is one the glob names: the same segment rules the
 * walk applies, so a path the walk would never list never matches. Dot-prefixed
 * and skipped names do not match either.
 */
export function matchGlob(segments, rel) {
  const parts = String(rel ?? "").split("/");
  if (parts.length !== segments.length) return false;
  return parts.every((name, i) => {
    if (name === "" || name.startsWith(".") || SKIP_NAMES.has(name)) return false;
    const seg = segments[i];
    return seg.literal !== undefined ? name === seg.literal : seg.re.test(name);
  });
}

/**
 * Every file the glob names, as `{rel, project}` — `project` being the name
 * the first wildcard segment matched, which with the reviews glob is the
 * project directory. Dot-prefixed names and symlinks are skipped, as the tree
 * walk skips them; a directory that cannot be read contributes nothing.
 */
export function walk(root, segments, budget) {
  const out = [];
  const step = (dir, i, project) => {
    const seg = segments[i];
    const last = i === segments.length - 1;
    let dirents;
    try {
      dirents = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (out.length >= budget) return;
      if (d.name.startsWith(".") || SKIP_NAMES.has(d.name)) continue;
      if (seg.literal !== undefined ? d.name !== seg.literal : !seg.re.test(d.name)) continue;
      const childRel = dir ? `${dir}/${d.name}` : d.name;
      const p = project ?? (seg.re ? d.name : null);
      if (last) {
        if (d.isFile()) out.push({ rel: childRel, project: p });
      } else if (d.isDirectory()) {
        step(childRel, i + 1, p);
      }
    }
  };
  step("", 0, null);
  return out;
}

/**
 * One row for one file. A file that is not a JSON object is still a row —
 * `unreadable: true` with the path and the reason — because a run whose state
 * cannot be read is a fact about the tree, not an absence from it.
 */
function readRow(root, rel, project, format = "json") {
  const abs = path.join(root, rel);
  const base = { path: rel, project };
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    return { ...base, unreadable: true, error: errText(err) };
  }
  if (format === "text") return readText(abs, base, stat);
  if (stat.size > LIMITS.maxBytes) {
    return { ...base, unreadable: true, error: `larger than ${LIMITS.maxBytes} bytes` };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (err) {
    return { ...base, unreadable: true, error: errText(err) };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ...base, unreadable: true, error: "not a JSON object" };
  }
  return { ...base, data };
}

/**
 * A `text` row: the file's head as `data.text`, with its size and mtime. The
 * kind does not interpret the text; a normaliser decides what of it to show.
 */
function readText(abs, base, stat) {
  let fd;
  try {
    fd = fs.openSync(abs, "r");
    const buf = Buffer.alloc(Math.min(stat.size, LIMITS.headBytes));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return { ...base, data: { text: buf.subarray(0, n).toString("utf8"), size: stat.size, mtime: stat.mtime.toISOString() } };
  } catch (err) {
    return { ...base, unreadable: true, error: errText(err) };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * The card's rows: every file its glob names under its root, read raw.
 *
 * @param {{root: string, glob: string}} card a card the registry validated
 * @returns {{rows: object[], scanned: number, truncated: boolean}}
 */
export function read(card) {
  const parsed = parseGlob(card.glob);
  if (parsed.error) throw new Error(`glob: ${parsed.error}`);
  const found = walk(card.root, parsed.segments, LIMITS.maxScanned);
  return {
    rows: found.map((f) => readRow(card.root, f.rel, f.project, card.format)),
    scanned: found.length,
    truncated: found.length >= LIMITS.maxScanned,
  };
}

/**
 * Read the kind's own fields off a stanza onto the card: `glob`, checked
 * against the walker's subset, and `root`, a leading `~` expanded, defaulting
 * to the HUD root, and `format`, `json` unless the stanza says `text`.
 * Returns `{field, reason}` for the field that cannot be
 * honoured, else null.
 */
export function validate(raw, card, ctx) {
  const parsed = parseGlob(raw.glob);
  if (parsed.error) return { field: "glob", reason: parsed.error };
  card.glob = raw.glob;
  card.root = typeof raw.root === "string" && raw.root !== "" ? expandHome(raw.root) : ctx.hudRoot;
  // Set only when the stanza names one, so a card that says nothing keeps the
  // exact shape it had before formats existed; reading defaults to JSON.
  if (raw.format !== undefined) {
    if (!FORMATS.includes(raw.format)) return { field: "format", reason: `format must be one of ${FORMATS.join(", ")}` };
    card.format = raw.format;
  }
  return null;
}

/**
 * Whether a path under the card's root could change one of its rows: a file
 * the glob names, or a directory on the way to one — a run directory removed
 * or renamed whole is reported by its own name, not its files'. Judged by the
 * walk's own rules, so a dot-prefixed or skipped name is never a row here
 * either. `rel` is `/`-separated and relative to `card.root`.
 */
export function covers(card, rel) {
  const parsed = parseGlob(card.glob);
  if (parsed.error) return false;
  const names = String(rel ?? "").split("/");
  if (names.length > parsed.segments.length) return false;
  return names.every((name, i) => {
    if (name === "" || name.startsWith(".") || SKIP_NAMES.has(name)) return false;
    const seg = parsed.segments[i];
    return seg.literal !== undefined ? name === seg.literal : seg.re.test(name);
  });
}
