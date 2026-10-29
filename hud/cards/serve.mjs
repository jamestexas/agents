// Reading a card: the composition every card route and library call share.
//
// A kind reads rows, the card's shape turns each row into an item or rejects
// it, the shape's order sorts them, the card's scope narrows them, and the
// card's joins attach another card's row on the shared key. One path, so the
// old `/api/reviews` and `/api/dyn/board` routes and `/api/card/<name>`
// cannot read the same source two ways.

import { createHash } from "node:crypto";

import { errText } from "../errtext.mjs";
import { DEFAULT_REFRESH_S, KINDS, SHAPES, getCard } from "./registry.mjs";
import { joinRows } from "./join.mjs";

/** Rows one response may carry. The sort needs every item, so the walk is bounded separately. */
export const MAX_ROWS = 200;

/**
 * Items from a kind's rows: normalised, sorted by the shape, scoped.
 *
 * @returns {{items: object[], scanned: number, truncated: boolean, rejected: number}}
 */
function shapeRows(shape, read, ctx, opts) {
  let rejected = 0;
  const items = [];
  for (const row of read.rows ?? []) {
    const item = shape.normalize(row, ctx);
    if (item === null) rejected++;
    else items.push(item);
  }
  if (shape.compare) items.sort(shape.compare);
  const scoped = opts.scope === undefined ? items : items.filter((item) => shape.inScope(item, opts.scope));
  return { items: scoped, scanned: read.scanned ?? items.length + rejected, truncated: read.truncated === true, rejected };
}

function kindOf(card) {
  const kind = KINDS[card.kind];
  if (!kind || !kind.module) throw new Error(`kind "${card.kind}" is not served`);
  return kind;
}

function shapeOf(card) {
  const shape = SHAPES[card.shape];
  if (!shape) throw new Error(`unknown shape "${card.shape}"`);
  return shape;
}

/**
 * Every item of a card whose kind reads synchronously (`fs`), sorted and
 * scoped. The library path: `listReviews` is this over the reviews card.
 *
 * @param {object} card a card the registry validated (or the equivalent literal)
 * @param {{now?: number}} ctx
 * @param {{scope?: string}} [opts] a scope the shape declares; absent means every item
 */
export function collectRows(card, ctx = {}, opts = {}) {
  const now = ctx.now ?? Date.now();
  const read = kindOf(card).module.read(card, { ...ctx, now });
  if (read && typeof read.then === "function") throw new Error(`kind "${card.kind}" reads asynchronously`);
  return shapeRows(shapeOf(card), read, { ...ctx, now }, opts);
}

/** The same, for any kind; `read` is the kind's own answer, carried for the envelope. */
export async function collectRowsAsync(card, ctx = {}, opts = {}) {
  const now = ctx.now ?? Date.now();
  const read = await kindOf(card).module.read(card, { ...ctx, now });
  return { read, ...shapeRows(shapeOf(card), read, { ...ctx, now }, opts) };
}

/**
 * A payload with B's rows joined onto the array it carries — `items`, `prs`,
 * or the payload itself — and any other shape returned untouched. This is the
 * legacy board envelope's join: the upstream's own rows, keyed on the way by
 * the shape's `rowKey` and never rewritten, so the body the old route serves
 * is the bytes the upstream sent plus `review`.
 */
export function joinPayload(payload, bRows, opts) {
  const join = (rows) => joinRows(rows, bRows, opts).rows;
  if (Array.isArray(payload)) return join(payload);
  if (!payload || typeof payload !== "object") return payload;
  for (const k of ["items", "prs"]) {
    if (Array.isArray(payload[k])) {
      const joined = join(payload[k]);
      return joined === payload[k] ? payload : { ...payload, [k]: joined };
    }
  }
  return payload;
}

/**
 * The card's joins, applied to its items and, for the legacy envelope, its
 * payload. Best effort per join: the other card absent, misconfigured, or
 * unreadable leaves A as it came and says so in `joins`. Never applied to a
 * snapshot — what is cached is the upstream's own bytes, and what is joined
 * onto them is read fresh or not at all.
 */
async function applyJoins(card, items, payload, stale, ctx, opts = {}) {
  const joins = {};
  let joinedItems = items;
  let joinedPayload = payload;
  for (const [other, spec] of Object.entries(card.join ?? {})) {
    if (stale) {
      joins[other] = "unavailable: served from snapshot";
      continue;
    }
    const b = getCard(ctx.cards ?? new Map(), other);
    if (!b) {
      joins[other] = `unavailable: no card named "${other}"`;
      continue;
    }
    if (b.error) {
      joins[other] = `unavailable: ${b.error}`;
      continue;
    }
    try {
      const got = await collectRowsAsync(b, ctx);
      if (got.read.rows === undefined) throw new Error(got.read.error ?? "no rows");
      const base = { key: card.key, latest: spec.latest, into: other, project: shapeOf(b).forJoin };
      const onItems = joinRows(joinedItems, got.items, base);
      joinedItems = onItems.rows;
      if (opts.payloadInto) {
        joinedPayload = joinPayload(joinedPayload, got.items, { ...base, into: opts.payloadInto, keyOf: shapeOf(card).rowKey });
      }
      joins[other] = onItems.status;
    } catch (err) {
      joins[other] = `unavailable: ${errText(err)}`;
    }
  }
  return { joins, items: joinedItems, payload: joinedPayload };
}

/**
 * Seconds a page should wait before asking again: the card's own cadence, or
 * the shape's in-flight one while any item is live, whichever is sooner.
 */
function refreshOf(card, shape, items) {
  const own = card.refresh ?? DEFAULT_REFRESH_S;
  if (shape.LIVE_REFRESH_S === undefined || !items.some(shape.isLive)) return own;
  return Math.min(own, shape.LIVE_REFRESH_S);
}

/** Every shape's clock-derived field names; a joined block carries its own shape's. */
const CLOCK_FIELDS = new Set(Object.values(SHAPES).flatMap((shape) => shape.CLOCK_FIELDS ?? []));

/**
 * The card answer's ETag: the sha256 of the body as served, less what moves
 * without the source moving — `generated_at`, and the fields a shape derives
 * from the clock, at any depth. Hashed after normalisation and joins, so a
 * change to a joined card's rows is a change to this card's answer, and so is
 * a config edit to its columns or title.
 */
export function etagOf(body) {
  const { generated_at: _when, ...rest } = body;
  const text = JSON.stringify(rest, (k, v) => (CLOCK_FIELDS.has(k) ? undefined : v));
  return `"${createHash("sha256").update(text).digest("hex")}"`;
}

/**
 * Whether an `If-None-Match` value names `etag`: a list, each entry strong or
 * weak (`W/` is a weak comparison, which is all a GET needs), or `*`.
 */
export function etagMatches(header, etag) {
  if (typeof header !== "string" || header === "") return false;
  return header.split(",").some((part) => {
    const tag = part.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

/**
 * The old routes' answer to "not configured". Reviews never had a snapshot
 * tier, so an absent source was the panel-off 404 sessions and loadout use;
 * the board had one, so "unconfigured" had to be told apart from "no panel"
 * and answered 503. Each alias keeps its own.
 */
const LEGACY_MISSING = Object.freeze({ reviews: 404, board: 503 });

/**
 * The response for one card, as `{status, body}`: pure over its inputs, so
 * the route and the aliases it keeps are envelopes around one answer.
 *
 * Not configured ⇒ 404, the panel-off contract: a card absent from the
 * registry does not exist. Configured and unable to answer — a stanza the
 * registry refused — ⇒ 503 with `misconfigured: <reason>`, because a typo in
 * hud.toml should read as a fault, never as "no rows". A `scope` outside the
 * shape's vocabulary ⇒ 400, not a silent fall-back. An upstream down with no
 * snapshot ⇒ 503 with the reason; with one ⇒ 200, `stale: true`.
 *
 * @param {object|null} card the registry's entry: a card, `{name, error}`, or null
 * @param {{hudRoot: string, configFile: string, now: () => number, cards?: Map, httpTimeoutMs?: number}} ctx
 * @param {{name: string, scope?: string|null, legacy?: string}} opts
 *   `scope` is the query's value (null when absent); `legacy` names the old
 *   source whose envelope to produce instead of the card envelope.
 */
export async function cardResponse(card, ctx, opts) {
  const name = opts.name;
  const legacy = opts.legacy;
  const tag = legacy ? { source: legacy } : { card: name };
  if (!card) {
    const what = legacy ? legacy : `card ${name}`;
    const status = legacy ? (LEGACY_MISSING[legacy] ?? 404) : 404;
    return { status, body: { ...tag, error: `${what} is not configured in ${ctx.configFile}` } };
  }
  if (card.error) {
    return { status: 503, body: { ...tag, error: legacy ? card.error : `misconfigured: ${card.error}` } };
  }

  const shape = shapeOf(card);
  const scopes = shape.SCOPES ?? [];
  // The alias keeps its old default — every run — while the card route
  // defaults to the scope the card declares; the query overrides both. A
  // shape with no scopes has nothing to default to, and its alias ignored the
  // query as the old route did.
  let scope;
  if (scopes.length) scope = opts.scope ?? (legacy ? "all" : card.scope ?? "all");
  else if (!legacy) scope = opts.scope ?? undefined;
  if (scope !== undefined && !scopes.includes(scope)) {
    const error = scopes.length ? `scope must be one of ${scopes.join(", ")}` : `card ${name} has no scopes`;
    return { status: 400, body: { ...tag, error } };
  }

  const now = ctx.now();
  const readCtx = { ...ctx, now };
  const got = await collectRowsAsync(card, readCtx, { scope });
  const { read } = got;
  if (read.rows === undefined) {
    const error = read.error ?? "no rows";
    if (legacy) return { status: 503, body: { source: legacy, stale: true, cached_at: null, error } };
    return { status: 503, body: { card: name, error } };
  }
  const stale = read.stale === true;
  // A joined row lands under the joined card's name; the old board envelope
  // spelt it `review`, singular, and keeps doing so.
  const { joins, items, payload } = await applyJoins(card, got.items, read.payload, stale, readCtx, {
    payloadInto: legacy === "board" ? "review" : undefined,
  });
  const shown = items.slice(0, MAX_ROWS);
  const generated_at = stale ? read.cached_at : new Date(now).toISOString();
  const count = shown.length;
  const cut = got.truncated || shown.length < items.length;

  if (legacy === "board") {
    const body = { source: legacy, stale, cached_at: read.cached_at, data: payload };
    if (stale && read.error) body.error = read.error;
    return { status: 200, body };
  }
  if (legacy) {
    return {
      status: 200,
      body: { source: legacy, stale, generated_at, root: card.root, glob: card.glob, scope, count, truncated: cut, items: shown },
    };
  }
  const body = { card: name, source: card.kind, title: card.title, stale, generated_at, refresh: refreshOf(card, shape, items) };
  if (card.root !== undefined) body.root = card.root;
  body.columns = card.columns;
  body.joins = joins;
  if (shape.meta) body.health = shape.meta(read.payload);
  Object.assign(body, { count, truncated: cut, rejected: got.rejected, items: shown });
  return { status: 200, body, etag: etagOf(body) };
}

/**
 * Serve one card. `ctx.sendJson` is the server's writer, passed in rather
 * than imported so this module never reaches back into the server.
 *
 * A card answer carries its ETag and `no-cache` — keep it, but ask — and an
 * `If-None-Match` naming it is a 304 with no body, so a page polling a card
 * that has not changed costs a hash, not a re-render. The body is still built
 * to be hashed: the source is read either way, and that read is the check.
 * Only a 200 on the card route is conditional; an error is never cached, and
 * the aliases keep the headers they always had.
 */
export async function serveCard(res, ctx, card, opts) {
  const { status, body, etag } = await cardResponse(card, ctx, opts);
  if (etag === undefined) return ctx.sendJson(res, status, body);
  const headers = { etag, "cache-control": "no-cache" };
  if (etagMatches(opts.ifNoneMatch, etag)) {
    res.writeHead(304, headers);
    return res.end();
  }
  return ctx.sendJson(res, status, body, headers);
}
