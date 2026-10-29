// The `review-state` shape: a review run's `state.json`, as the page may see it.
//
// This is the reviews layer's whitelist, moved here so the registry can name
// it. The file is written by a tool and read by a page; naming the contract
// here is what keeps a key that tool adds tomorrow from reaching the page
// untested. Copy field by field, drop unknown keys at every depth — the rule
// for every normaliser, first written for this one.

import { prUrl } from "../keys.mjs";

/** The columns a card of this shape shows when it declares none. */
export const COLUMNS = Object.freeze([
  "pr",
  "project",
  "mode",
  "phase",
  "phases",
  "verdict",
  "mine",
  "humans",
  "bots",
  "threads",
  "early",
  "gates",
  "unavail",
  "findings",
  "note",
  "posted",
]);

/**
 * `open` is a run still going, or one that has not posted — the rows a board
 * row cannot stand in for. `all` is every run. A row whose state could not be
 * read has no `posted` and stays in view under both.
 */
export const SCOPES = Object.freeze(["open", "all"]);

export function inScope(item, scope) {
  if (scope === "all") return true;
  return item.running === true || item.posted == null;
}

/** The state fields the panel reads, copied by name. */
export const FIELDS = Object.freeze([
  "version",
  "repo",
  "pr",
  "title",
  "author",
  "mode",
  "head",
  "base",
  "phase",
  "phases",
  "started",
  "ended",
  "verdict",
  "gates",
  "probes",
  "findings",
  "note",
  "posted",
  "early",
]);

/**
 * `review_state` — who has reviewed and who is waited on — is the one block
 * the panel reads below the top level, so it is copied field by field too.
 * A value that is not the shape named here is dropped, not passed along:
 * this is the only place the page's trust in the file is decided.
 */
const REVIEW_STATES = new Set(["APPROVED", "COMMENTED", "CHANGES_REQUESTED"]);
const THREAD_COUNTS = ["total", "unresolved", "awaiting_me", "awaiting_author"];

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const strOrNull = (v) => (typeof v === "string" ? v : null);
export const intOrNull = (v) => (Number.isInteger(v) ? v : null);

/** One reviewer entry: a string `login` and `state`, an ISO `at`; bots add `findings`. */
function reviewer(v, withFindings) {
  if (!isObject(v) || typeof v.login !== "string" || v.login === "") return null;
  const out = { login: v.login, state: strOrNull(v.state), at: strOrNull(v.at) };
  if (withFindings) out.findings = intOrNull(v.findings);
  return out;
}

function reviewers(v, withFindings) {
  if (!Array.isArray(v)) return undefined;
  return v.map((e) => reviewer(e, withFindings)).filter(Boolean);
}

/** The block the panel may see, or undefined when the file carries none worth showing. */
export function sanitizeReviewState(v) {
  if (!isObject(v)) return undefined;
  const out = {};
  if (v.authorship === "own" || v.authorship === "peer") out.authorship = v.authorship;
  if (isObject(v.mine)) {
    out.mine = {
      state: REVIEW_STATES.has(v.mine.state) ? v.mine.state : null,
      at: strOrNull(v.mine.at),
      head_matches: typeof v.mine.head_matches === "boolean" ? v.mine.head_matches : null,
    };
  }
  const humans = reviewers(v.humans, false);
  if (humans) out.humans = humans;
  const bots = reviewers(v.bots, true);
  if (bots) out.bots = bots;
  if (isObject(v.threads)) {
    out.threads = {};
    for (const k of THREAD_COUNTS) {
      const n = intOrNull(v.threads[k]);
      if (n !== null) out.threads[k] = n;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * What a row joined onto another card is told about its run, copied by name.
 * The run row is the full contract; a board row's columns are the subset
 * that answers "where is the review and who is waiting", and naming it here
 * keeps the other card from growing a second, untested view of the state
 * file. Every key is present, null when the run has nothing for it, so the
 * shape is fixed.
 */
export function forJoin(item) {
  const probes = isObject(item.probes) ? item.probes : null;
  return {
    phase: strOrNull(item.phase),
    verdict: strOrNull(item.verdict),
    gates: isObject(item.gates) ? item.gates : null,
    probes: { unavailable: probes ? intOrNull(probes.unavailable) : null },
    findings: isObject(item.findings) ? item.findings : null,
    note_url: item.note_url ?? null,
    posted: isObject(item.posted) ? item.posted : null,
    review_state: item.review_state ?? null,
    running: item.running === true,
    elapsed_s: intOrNull(item.elapsed_s),
  };
}

/**
 * The tree route for a note path: `/n/<path>` with the trailing `.md`
 * dropped, which is the rule the UI's `entryUrl` applies. A path the deep-link
 * resolver would refuse is not turned into a link at all.
 */
function noteUrl(note) {
  if (typeof note !== "string" || note === "" || note.startsWith("/")) return null;
  const segments = note.replace(/\.md$/i, "").split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || /[\\\0]/.test(s))) return null;
  return `/n/${segments.map(encodeURIComponent).join("/")}`;
}

/** Whole seconds from `started` to `ended`, or to now while `ended` is null. */
function elapsedSeconds(started, ended, now) {
  const a = Date.parse(started);
  if (Number.isNaN(a)) return null;
  const b = ended == null ? now : Date.parse(ended);
  if (Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

/**
 * `phases` as the panel may see it: `{<name>: {started, ended}}` with each
 * time a string or null. An entry that is not an object, or whose `started`
 * is not a string, is dropped; a block that is not an object is no block.
 */
export function sanitizePhases(v) {
  if (!isObject(v)) return undefined;
  const out = {};
  for (const [name, p] of Object.entries(v)) {
    if (!isObject(p) || typeof p.started !== "string") continue;
    out[name] = { started: p.started, ended: strOrNull(p.ended) };
  }
  return out;
}

/**
 * The early signal as the panel may see it: `{count, items}` where each item
 * is `{row, title, basis}` with an integer row and string title and basis.
 * An entry of another shape is dropped and `count` is what survived, so the
 * number shown is the number of lines the page could show. A value that is
 * not an array is no block.
 */
function sanitizeEarly(v) {
  if (!Array.isArray(v)) return undefined;
  const items = [];
  for (const e of v) {
    if (!isObject(e) || !Number.isInteger(e.row)) continue;
    if (typeof e.title !== "string" || typeof e.basis !== "string") continue;
    items.push({ row: e.row, title: e.title, basis: e.basis });
  }
  return { count: items.length, items };
}

/**
 * Whole seconds per phase, in the file's order: `ended` minus `started`, or
 * now minus `started` for the phase still open. A phase whose times do not
 * parse is left out rather than shown as zero, so a missing number reads as
 * "not timed", never as "instant".
 */
export function phaseSeconds(phases, now) {
  const out = {};
  for (const [name, p] of Object.entries(phases ?? {})) {
    const s = elapsedSeconds(p.started, p.ended, now);
    if (s !== null) out[name] = s;
  }
  return out;
}

/**
 * One item for one row. The item carries the named state fields and the
 * derived ones — `running`, `elapsed_s`, `phase_seconds`, `pr_url`,
 * `note_url` — and nothing else from the file. An unreadable row is the item,
 * as it came: a run whose state cannot be read is shown in place, not
 * rejected, so this shape never returns null.
 *
 * @param {{path: string, project: string|null, data?: object, unreadable?: true, error?: string}} row
 * @param {{now: number}} ctx
 */
export function normalize(row, ctx) {
  if (row.unreadable) return row;
  const now = ctx.now;
  const state = row.data;
  const item = { path: row.path, project: row.project };
  for (const k of FIELDS) if (state[k] !== undefined) item[k] = state[k];
  // `phases` is nested, so like `review_state` it is rebuilt rather than copied.
  const phases = sanitizePhases(state.phases);
  if (phases) item.phases = phases;
  else delete item.phases;
  const early = sanitizeEarly(state.early);
  if (early) item.early = early;
  else delete item.early;
  const rs = sanitizeReviewState(state.review_state);
  if (rs) item.review_state = rs;
  // The contract spells a run that has not finished as `ended: null`.
  item.running = item.ended == null;
  item.elapsed_s = elapsedSeconds(item.started, item.ended, now);
  item.phase_seconds = phaseSeconds(phases, now);
  item.pr_url = prUrl({ repo: item.repo, number: item.pr });
  item.note_url = noteUrl(item.note);
  return item;
}

const startedMs = (item) => {
  const t = Date.parse(item.started);
  return Number.isNaN(t) ? -Infinity : t;
};

/** Running first, then newest `started` first; the path breaks ties so the order is stable. */
export function compare(a, b) {
  const ra = a.running && !a.unreadable ? 0 : 1;
  const rb = b.running && !b.unreadable ? 0 : 1;
  if (ra !== rb) return ra - rb;
  const sa = startedMs(a);
  const sb = startedMs(b);
  if (sa !== sb) return sb - sa;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
