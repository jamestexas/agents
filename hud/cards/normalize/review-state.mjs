// The `review-state` shape: a review run's `state.json`, as the page may see it.
//
// This is the reviews layer's whitelist, moved here so the registry can name
// it. The file is written by a tool and read by a page; naming the contract
// here is what keeps a key that tool adds tomorrow from reaching the page
// untested. Copy field by field, drop unknown keys at every depth — the rule
// for every normaliser, first written for this one.

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
