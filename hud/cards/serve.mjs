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
