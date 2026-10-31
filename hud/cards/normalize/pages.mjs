// The `pages` shape: a generated HTML page in the tree (a tracker, a report,
// a dashboard someone's script writes), as a row the page can link to. It
// reads an `fs` card with `format = "text"`: the head of each file, never
// the whole page, and nothing of it but its <title>.
//
// The link goes to /api/page, which serves the file only while a pages card's
// glob still names it, so this card's config is also that route's allow-list.

/** The columns a card of this shape shows when it declares none. */
export const COLUMNS = Object.freeze(["project", "page", "updated"]);

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A page's title: its <title> text, entities decoded and whitespace folded; null when it has none. */
export function titleOf(text) {
  const m = typeof text === "string" ? TITLE_RE.exec(text) : null;
  if (!m) return null;
  const t = m[1].replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e]).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/** The URL the page is served from: the route, never the file's own path. */
export function pageUrl(rel) {
  return "/api/page?path=" + encodeURIComponent(rel);
}

/**
 * One item for one row: the project, the page's title (its file name when it
 * has none), when it was last written, and its link. An unreadable row is
 * passed through as the kind made it, so the card can say which file failed.
 */
export function normalize(row) {
  if (!isObject(row)) return null;
  if (row.unreadable) return row;
  const data = isObject(row.data) ? row.data : {};
  const name = row.path.split("/").pop();
  return {
    path: row.path,
    project: row.project,
    title: titleOf(data.text) ?? name,
    url: pageUrl(row.path),
    updated: typeof data.mtime === "string" ? data.mtime : null,
  };
}

const updatedMs = (item) => {
  const t = Date.parse(item.updated);
  return Number.isNaN(t) ? -Infinity : t;
};

/** Most recently written first; the path breaks ties so the order is stable. */
export function compare(a, b) {
  return updatedMs(b) - updatedMs(a) || String(a.path).localeCompare(String(b.path));
}
