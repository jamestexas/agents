// The `work-board` shape: a row of the local work-board service, as the page
// may see it. The board is the upstream's own schema; this is the one place
// that knows its field names. Copy by name, drop the rest, derive the key.

import { prUrl } from "../keys.mjs";

/** The columns a card of this shape shows when it declares none: the row's own facts, then the joined run's. */
export const COLUMNS = Object.freeze(["pr", "title", "why", "verdict", "gates", "note", "posted", "threads"]);

/** The columns a joined review run contributes: what a legacy board is synthesised to join. */
export const REVIEW_COLUMNS = Object.freeze(["verdict", "gates", "note", "posted", "threads"]);

const STRINGS = ["kind", "repo", "title", "state", "reason", "url"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const strOr = (v, fallback) => (typeof v === "string" ? v : fallback);

/**
 * The key a board row is joined on: the PR's canonical URL. A row that says
 * it is not a PR has no key and is never joined, whatever its number.
 */
export function rowKey(row) {
  if (!isObject(row)) return null;
  if (typeof row.kind === "string" && row.kind !== "pr") return null;
  return prUrl(row);
}

/**
 * One item for one row: the string fields the board reads, `number` as an
 * integer, and `pr_url` derived. A row that is not an object is rejected —
 * the upstream's array is trusted to hold rows, not to hold only rows.
 */
export function normalize(row) {
  if (!isObject(row)) return null;
  const out = {};
  for (const k of STRINGS) if (typeof row[k] === "string") out[k] = row[k];
  const n = typeof row.number === "string" && /^\d+$/.test(row.number) ? Number(row.number) : row.number;
  if (Number.isInteger(n)) out.number = n;
  out.pr_url = rowKey(row);
  return out;
}

/**
 * The payload's report on its own health, whitelisted: `tick_status` (either
 * spelling the board has used) and `degradations` as `{source, error}`. The
 * page reads it for the banner — "github: graphql 401" is a diagnostic where
 * "github" is a notice — and nothing else of the payload's top level is
 * served. Null when the payload reports nothing.
 */
export function meta(payload) {
  if (!isObject(payload)) return null;
  const status = strOr(payload.tick_status, strOr(payload.tickStatus, null));
  const degradations = Array.isArray(payload.degradations)
    ? payload.degradations.filter(isObject).map((d) => ({
        source: strOr(d.source, strOr(d.name, "?")),
        error: strOr(d.error, strOr(d.reason, strOr(d.message, ""))),
      }))
    : null;
  if (status === null && degradations === null) return null;
  return { tick_status: status, degradations: degradations ?? [] };
}
