// The `boards` shape: a hud.board/1 JSON in the tree, as a row that opens the
// board's own page. It reads an `fs` card in JSON format. The server renders a
// board from its JSON every time its page is opened, so this card links to the
// page and never to a copy written ahead of time.

import { validateBoard } from "../../boards.mjs";

/** The columns a card of this shape shows when it declares none. */
export const COLUMNS = Object.freeze(["project", "board", "updated"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The board's page: its JSON path without the extension, under /n/. */
export function boardUrl(rel) {
  return "/n/" + String(rel).replace(/\.json$/, "");
}

/**
 * One item for one row: the project, the board's title (its file name when it
 * has none), when its producer ran, how many rows it has, and whether it
 * validates. A board that fails validation is still listed: its page shows the
 * errors, so a broken producer reads as broken rather than as a missing board.
 * An unreadable row is passed through as the kind made it.
 */
export function normalize(row) {
  if (!isObject(row)) return null;
  if (row.unreadable) return row;
  const data = isObject(row.data) ? row.data : {};
  const name = row.path.split("/").pop().replace(/\.json$/, "");
  const { ok, errors } = validateBoard(data);
  return {
    path: row.path,
    project: row.project,
    title: typeof data.title === "string" && data.title.trim() !== "" ? data.title : name,
    url: boardUrl(row.path),
    updated: typeof data.generated === "string" ? data.generated : null,
    rows: Array.isArray(data.rows) ? data.rows.length : 0,
    invalid: !ok,
    errors: errors.length,
  };
}

const updatedMs = (item) => {
  const t = Date.parse(item.updated);
  return Number.isNaN(t) ? -Infinity : t;
};

/** Most recently generated first; the path breaks ties so the order is stable. */
export function compare(a, b) {
  return updatedMs(b) - updatedMs(a) || String(a.path).localeCompare(String(b.path));
}
