// The `fs` kind: rows are files under a root matched by a segment glob.
//
// This is the reviews layer's walk, moved here so any card can declare one.
// It is deliberately not a globbing library: a pattern is split on `/`, each
// segment is a literal name or a within-segment `*` match, and the walk is
// `readdirSync` plus a per-name test — the same walk the tree uses, so a
// pattern can never reach outside the root it is applied to.

import os from "node:os";
import path from "node:path";

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
 * Read the kind's own fields off a stanza onto the card: `glob`, checked
 * against the walker's subset, and `root`, a leading `~` expanded, defaulting
 * to the HUD root. Returns `{field, reason}` for the field that cannot be
 * honoured, else null.
 */
export function validate(raw, card, ctx) {
  const parsed = parseGlob(raw.glob);
  if (parsed.error) return { field: "glob", reason: parsed.error };
  card.glob = raw.glob;
  card.root = typeof raw.root === "string" && raw.root !== "" ? expandHome(raw.root) : ctx.hudRoot;
  return null;
}
