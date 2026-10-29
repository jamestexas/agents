// Reading a card: the composition every card route and library call share.
//
// A kind reads rows, the card's shape turns each row into an item or rejects
// it, the shape's order sorts them, and the card's scope narrows them. One
// path, so the old `/api/reviews` route and `/api/card/reviews` cannot read
// the same file two ways.

import { KINDS, SHAPES } from "./registry.mjs";

/** Rows one response may carry. The sort needs every item, so the walk is bounded separately. */
export const MAX_ROWS = 200;

/**
 * Every item of a card, sorted and scoped.
 *
 * @param {object} card a card the registry validated (or the equivalent literal)
 * @param {{now?: number}} ctx
 * @param {{scope?: string}} [opts] a scope the shape declares; absent means every item
 * @returns {{items: object[], scanned: number, truncated: boolean, rejected: number}}
 *   `rejected` counts rows the shape refused; `truncated` says the kind
 *   stopped reading before the end.
 */
export function collectRows(card, ctx = {}, opts = {}) {
  const kind = KINDS[card.kind];
  if (!kind || !kind.module) throw new Error(`kind "${card.kind}" is not served`);
  const shape = SHAPES[card.shape];
  if (!shape) throw new Error(`unknown shape "${card.shape}"`);
  const now = ctx.now ?? Date.now();

  const { rows, scanned, truncated } = kind.module.read(card, { ...ctx, now });
  let rejected = 0;
  const items = [];
  for (const row of rows) {
    const item = shape.normalize(row, { ...ctx, now });
    if (item === null) rejected++;
    else items.push(item);
  }
  if (shape.compare) items.sort(shape.compare);
  const scoped = opts.scope === undefined ? items : items.filter((item) => shape.inScope(item, opts.scope));
  return { items: scoped, scanned, truncated, rejected };
}

/**
 * The response for one card, as `{status, body}`: pure, so the route and the
 * alias it keeps are two envelopes around one answer.
 *
 * Not configured ⇒ 404, the panel-off contract: a card absent from the
 * registry does not exist. Configured and unable to answer — a stanza the
 * registry refused — ⇒ 503 with `misconfigured: <reason>`, because a typo in
 * hud.toml should read as a fault, never as "no rows". A `scope` outside the
 * shape's vocabulary ⇒ 400, not a silent fall-back.
 *
 * @param {object|null} card the registry's entry: a card, `{name, error}`, or null
 * @param {{hudRoot: string, configFile: string, now: () => number}} ctx
 * @param {{name: string, scope?: string|null, legacy?: string}} opts
 *   `scope` is the query's value (null when absent); `legacy` names the old
 *   source whose envelope to produce instead of the card envelope.
 */
export function cardResponse(card, ctx, opts) {
  const name = opts.name;
  const legacy = opts.legacy;
  const tag = legacy ? { source: legacy } : { card: name };
  if (!card) {
    const what = legacy ? legacy : `card ${name}`;
    return { status: 404, body: { ...tag, error: `${what} is not configured in ${ctx.configFile}` } };
  }
  if (card.error) {
    return { status: 503, body: { ...tag, error: legacy ? card.error : `misconfigured: ${card.error}` } };
  }

  const shape = SHAPES[card.shape];
  const scopes = shape.SCOPES ?? [];
  // The alias keeps its old default — every run — while the card route
  // defaults to the scope the card declares; the query overrides both.
  const scope = opts.scope ?? (legacy ? "all" : card.scope ?? (scopes.length ? "all" : undefined));
  if (scope !== undefined && !scopes.includes(scope)) {
    const error = scopes.length ? `scope must be one of ${scopes.join(", ")}` : `card ${name} has no scopes`;
    return { status: 400, body: { ...tag, error } };
  }

  const { items, truncated, rejected } = collectRows(card, { now: ctx.now() }, { scope });
  const shown = items.slice(0, MAX_ROWS);
  const generated_at = new Date().toISOString();
  const count = shown.length;
  const cut = truncated || shown.length < items.length;
  if (legacy) {
    return {
      status: 200,
      body: { source: legacy, stale: false, generated_at, root: card.root, glob: card.glob, scope, count, truncated: cut, items: shown },
    };
  }
  const body = { card: name, source: card.kind, stale: false, generated_at };
  if (card.root !== undefined) body.root = card.root;
  Object.assign(body, { columns: card.columns, joins: {}, count, truncated: cut, rejected, items: shown });
  return { status: 200, body };
}

/**
 * Serve one card. `ctx.sendJson` is the server's writer, passed in rather
 * than imported so this module never reaches back into the server.
 */
export function serveCard(res, ctx, card, opts) {
  const { status, body } = cardResponse(card, ctx, opts);
  return ctx.sendJson(res, status, body);
}
