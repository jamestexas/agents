// The card registry: what `[cards.*]` and `[layout]` in hud.toml declare,
// checked once per request into cards the server can serve and the UI can
// render. A card is a declared source (`kind` plus the fields that kind needs)
// and a presentation (`title`, `columns`, an optional `key` and `scope`).
//
// Validation is per card: one stanza that cannot be honoured becomes an
// `{name, error}` entry — served as 503 "misconfigured: <reason>" and rendered
// red — and every other card is unaffected. A registry that refused the whole
// config over one typo would turn a misspelt kind into a blank page.
//
// A config with no `[cards]` table but legacy `[sources.*]` tables is
// synthesised into the same cards, so a tree configured before cards existed
// renders exactly what it rendered then, through the one code path.

import * as fsKind from "./kinds/fs.mjs";
import * as reviewState from "./normalize/review-state.mjs";

export { expandHome } from "./kinds/fs.mjs";

/** The panel order when `[layout].order` is absent: today's aside, top to bottom. */
export const DEFAULT_LAYOUT_ORDER = Object.freeze([
  "reviews",
  "board",
  "digest",
  "sessions",
  "loadout",
  "peers",
]);

/** Where a run's `state.json` is looked for when a legacy `[sources.reviews]` names no glob. */
export const DEFAULT_REVIEWS_GLOB = "projects/*/raw/PR-*/state.json";

/**
 * Every kind the design names. `status: "now"` kinds have a module that reads
 * rows; `"next"` kinds are declared so that a stanza for one is told apart
 * from a typo — its required field is still checked, and the error says the
 * kind is not served yet rather than unknown. `reads` and `degraded` are
 * rendered into docs/CARDS.md by hud-docgen, so the table there cannot drift
 * from this declaration.
 */
export const KINDS = Object.freeze({
  fs: Object.freeze({
    status: "now",
    required: ["glob", "shape"],
    module: fsKind,
    reads: "files under a root matched by a segment glob (`*` within one segment)",
    rows: "one row per file; a file that is not a JSON object is one `unreadable` row",
    degraded: "bad glob → misconfigured; absent root → an empty card",
  }),
  http: Object.freeze({
    status: "next",
    required: ["url"],
    reads: "one GET of a loopback URL, JSON",
    rows: "the array the response carries (`items`, `prs`, or the top-level array)",
    degraded: "non-2xx, timeout, bad JSON → last snapshot with `stale`, else 503 with the reason",
  }),
  cmd: Object.freeze({
    status: "next",
    required: ["cmd"],
    reads: "argv, no shell",
    rows: "one JSON object per line, or one JSON array",
    degraded: "non-zero exit, bad JSON → 503 with the first stderr line",
  }),
  prometheus: Object.freeze({
    status: "next",
    required: ["query"],
    reads: "one PromQL instant or range query, bearer token from a `token_cmd`",
    rows: "one row per series (labels + value)",
    degraded: "token command non-zero or 401 → 503 with the reason; query parse error → 503 with the API's text",
  }),
  mcp: Object.freeze({
    status: "next",
    required: ["server", "tool"],
    reads: "one read-only tool call on an MCP server already configured for this machine",
    rows: "the array in the tool's structured result, or one row per text item",
    degraded: "server absent from config → card off; connect failure or tool error → 503 with the first error line",
  }),
});

/**
 * Every normaliser, by the `shape` a card names. A normaliser is the one
 * place that knows a source's field names; it also declares the card's
 * default columns and, when the shape has one, its scope vocabulary.
 */
export const SHAPES = Object.freeze({ "review-state": reviewState });

const NAME_RE = /^[A-Za-z0-9_-]+$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v) => (typeof v === "string" && v !== "" ? v : undefined);
const isStringList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s !== "");

/**
 * The cards a config declares, or — when it has no `[cards]` table — the
 * cards its legacy `[sources.*]` tables stand for.
 *
 * @param {unknown} cfg the parsed config (`loadConfig`'s value)
 * @param {{hudRoot: string, configFile?: string}} env
 * @returns {{cards: Map<string, object>, layout: {order: string[]}, errors: string[]}}
 *   `cards` holds a card per name, or `{name, error}` for one that cannot be
 *   served; `errors` repeats every such reason so `hud status` can list them.
 */
export function loadCards(cfg, env = {}) {
  const conf = isObject(cfg) ? cfg : {};
  const hudRoot = String(env.hudRoot ?? "");
  const configFile = env.configFile ?? "hud.toml";
  const cards = new Map();
  const errors = [];

  // `[cards]` present — even empty — is the answer; `[sources.*]` is read only
  // in its absence, so a tree that has moved to cards is not also haunted by
  // the sources it left behind.
  const legacy = !isObject(conf.cards);
  const declared = legacy ? synthesizeLegacy(conf) : conf.cards;
  for (const [name, raw] of Object.entries(declared)) {
    const where = legacy ? `sources.${name}` : `cards.${name}`;
    if (!NAME_RE.test(name)) {
      errors.push(`${where}: name must be letters, digits, '_' or '-'`);
      continue;
    }
    const built = buildCard(name, raw, { hudRoot, configFile, where });
    if (built.error) {
      errors.push(built.error);
      cards.set(name, { name, error: built.error });
    } else {
      cards.set(name, built.card);
    }
  }

  return { cards, layout: loadLayout(conf.layout, errors), errors };
}

/** The card by name, or null: a route asks this, and null is "404". */
export function getCard(cards, name) {
  return cards.get(name) ?? null;
}

/**
 * The `[cards.*]` stanzas a legacy `[sources.*]` config stands for. Only the
 * sources whose kind this release serves as a card are synthesised; the rest
 * stay on their own routes until their kind lands, so a legacy config never
 * gains a card that answers "not served yet".
 */
export function synthesizeLegacy(cfg) {
  const sources = isObject(cfg) && isObject(cfg.sources) ? cfg.sources : {};
  const out = {};
  if (isObject(sources.reviews)) {
    const reviews = sources.reviews;
    out.reviews = {
      kind: "fs",
      glob: nonEmpty(reviews.glob) ?? DEFAULT_REVIEWS_GLOB,
      shape: "review-state",
      key: "pr_url",
      title: "Review runs",
      scope: "open",
    };
    if (nonEmpty(reviews.root)) out.reviews.root = reviews.root;
  }
  // `sources.board` → `[cards.board]` (kind http, shape work-board, joined on
  // reviews) belongs with the http kind: synthesising it before that kind is
  // served would turn a working board route into a misconfigured card.
  return out;
}

/**
 * One stanza into one card. Checks run in the order a reader fixes them: the
 * kind, the field the kind cannot do without, whether the kind is served at
 * all, then the presentation and the kind's own reading of its fields.
 *
 * @returns {{card: object}|{error: string}}
 */
function buildCard(name, raw, ctx) {
  const fail = (reason) => ({ error: `${ctx.where}: ${reason}` });
  const failField = (field, reason) => ({ error: `${ctx.where}.${field} in ${ctx.configFile}: ${reason}` });
  if (!isObject(raw)) return fail("not a table");

  // `kind` is the plan's spelling; the design doc wrote `source` for the same
  // key, so a stanza copied from it is not a stanza that fails.
  const kind = raw.kind ?? raw.source;
  if (nonEmpty(kind) === undefined) return fail("kind is required");
  const spec = KINDS[kind];
  if (!spec) return fail(`unknown kind "${kind}"`);
  for (const field of spec.required) {
    if (nonEmpty(raw[field]) === undefined) return fail(`${kind} needs ${field}`);
  }
  if (spec.status !== "now") return fail(`kind "${kind}" is not served yet`);

  const card = { name, kind };

  if (raw.title !== undefined && nonEmpty(raw.title) === undefined) return fail("title must be a string");
  card.title = raw.title ?? name;

  const shape = SHAPES[raw.shape];
  if (!shape) return fail(`unknown shape "${raw.shape}"`);
  card.shape = raw.shape;

  if (raw.key !== undefined) {
    if (nonEmpty(raw.key) === undefined) return fail("key must be a string");
    card.key = raw.key;
  }

  if (raw.scope !== undefined) {
    const scopes = shape.SCOPES ?? [];
    if (!scopes.includes(raw.scope)) {
      return fail(scopes.length ? `scope must be one of ${scopes.join(", ")}` : `shape "${raw.shape}" has no scopes`);
    }
    card.scope = raw.scope;
  }

  if (raw.columns !== undefined && !isStringList(raw.columns)) return fail("columns must be a list of strings");
  card.columns = [...(raw.columns ?? shape.COLUMNS ?? [])];

  const err = spec.module.validate(raw, card, ctx);
  if (err) return failField(err.field, err.reason);
  return { card };
}

function loadLayout(raw, errors) {
  const order = isObject(raw) ? raw.order : undefined;
  if (order === undefined) return { order: [...DEFAULT_LAYOUT_ORDER] };
  if (!isStringList(order)) {
    errors.push("layout.order: must be a list of card names");
    return { order: [...DEFAULT_LAYOUT_ORDER] };
  }
  return { order: [...order] };
}
