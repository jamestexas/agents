// The join: attach to each row of card A the row of card B that carries the
// same key, under one field named for B.
//
// Best effort by contract. B rows that are not a list, a key or field name
// that is empty, A rows that are not a list — each returns A as it came with
// a `status` that says why, because a join that cannot happen must never turn
// A's answer into a fault. Nothing here reads a file or a socket: both sides
// arrive as rows, and the caller decides what B unreachable means.

/**
 * @param {unknown} aRows
 * @param {unknown} bRows
 * @param {{
 *   key: string,
 *   into: string,
 *   latest?: string,
 *   keyOf?: (row: object) => string|null,
 *   project?: (row: object) => object,
 * }} opts
 *   `key` is the derived field both sides carry; `keyOf` overrides how A's is
 *   read when A's rows do not carry it (the legacy board payload, keyed on the
 *   way and never written). `latest` names the field that decides between
 *   several B rows with one key — newest by `Date.parse` wins, ties and
 *   unparseable values keep the first seen; without it the first seen wins.
 *   `project` is B's shape's whitelist of what a joined row may carry.
 * @returns {{rows: unknown, status: string}} `status` is `ok` or
 *   `unavailable: <reason>`; `rows` is a new array when anything was joined
 *   and the input itself when nothing was.
 */
export function joinRows(aRows, bRows, opts = {}) {
  const { key, into, latest, keyOf, project } = opts;
  if (!Array.isArray(aRows)) return { rows: aRows, status: "unavailable: rows are not a list" };
  if (typeof key !== "string" || key === "") return { rows: aRows, status: "unavailable: no key to join on" };
  if (typeof into !== "string" || into === "") return { rows: aRows, status: "unavailable: no field to join into" };
  if (!Array.isArray(bRows)) return { rows: aRows, status: "unavailable: joined rows are not a list" };

  const byKey = indexLatest(bRows, key, latest);
  if (!byKey.size) return { rows: aRows, status: "ok" };

  const read = keyOf ?? ((row) => row[key]);
  const rows = aRows.map((row) => {
    if (!isObject(row)) return row;
    const k = read(row);
    if (typeof k !== "string" || k === "") return row;
    const match = byKey.get(k);
    if (!match) return row;
    return { ...row, [into]: project ? project(match) : match };
  });
  return { rows, status: "ok" };
}

/** One B row per key: the newest by `latest`, else the first seen. */
function indexLatest(bRows, key, latest) {
  const byKey = new Map();
  for (const row of bRows) {
    if (!isObject(row) || typeof row[key] !== "string" || row[key] === "") continue;
    const have = byKey.get(row[key]);
    if (!have) {
      byKey.set(row[key], row);
      continue;
    }
    if (latest && stamp(row[latest]) > stamp(have[latest])) byKey.set(row[key], row);
  }
  return byKey;
}

const stamp = (v) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
