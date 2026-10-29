// The one renderer. The page needs a DOM to run, so what is checked here is
// the part that can rot silently: that every card renders through
// `renderCard`, that the table's columns come from the response and its
// headings from the cell registry, that panel order comes from the layout,
// and that every "do" in the block is a link — out to GitHub, or into the
// tree — never a request. The old per-panel builders are asserted gone, so
// a second rendering path cannot grow back unnoticed.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { COLUMNS as REVIEW_COLUMNS } from "../cards/normalize/review-state.mjs";
import { COLUMNS as BOARD_COLUMNS } from "../cards/normalize/work-board.mjs";

const html = fs.readFileSync(path.join(import.meta.dirname, "..", "ui", "index.html"), "utf8");

const between = (start, end) => {
  const a = html.indexOf(start);
  assert.ok(a !== -1, `missing ${start}`);
  const b = html.indexOf(end, a);
  assert.ok(b !== -1, `missing ${end} after ${start}`);
  return html.slice(a, b);
};

const CARDS_BLOCK = between("// ------------------------------------------------------------- cards", "// ------------------------------------------------------ loadout panel");
const LOADERS = between("async function loadCards()", "/** ⟳ :");

test("the shell keeps its two card panels, reviews first, each with a title the renderer may set", () => {
  for (const id of ["wrap-reviews", "panel-reviews", "stamp-reviews", "wrap-board", "panel-board", "stamp-board"]) {
    assert.ok(html.includes(`id="${id}"`), `the shell declares ${id}`);
  }
  assert.match(html, /<h2><span class="title">Review runs<\/span><span class="sub">in flight or not yet posted<\/span><span class="stamp"/);
  assert.match(html, /<h2><span class="title">My PRs<\/span><span class="stamp"/);
  assert.match(html, /id="wrap-reviews" data-source="reviews" data-card="reviews"/);
  assert.match(html, /id="wrap-board" data-source="board" data-card="board"/);

  // Reviews is the first panel in the aside: today's order, the fallback
  // when the layout names none.
  const aside = html.slice(html.indexOf("<aside>"), html.indexOf("</aside>"));
  const firstPanel = aside.indexOf('class="panel"');
  assert.ok(aside.slice(firstPanel, aside.indexOf(">", firstPanel)).includes('id="wrap-reviews"'));
  for (const id of ["wrap-board", "wrap-digest", "wrap-sessions", "wrap-loadout", "wrap-peers"]) {
    assert.ok(aside.indexOf(`id="${id}"`) > aside.indexOf('id="wrap-reviews"'), `${id} comes after reviews`);
  }

  // Panel bodies scroll inside the panel; the heading stays put.
  const bodyAt = html.indexOf(".panel > .body {");
  const bodyRule = html.slice(bodyAt, html.indexOf("}", bodyAt));
  assert.match(bodyRule, /max-height:\s*\d+vh/);
  assert.match(bodyRule, /overflow:\s*auto/);
  assert.match(html, /#wrap-reviews > \.body \{\s*max-height:\s*\d+vh/, "the reviews body is sized separately");
});

test("one renderer: renderCard is defined once and is the only thing that draws a card", () => {
  assert.equal((html.match(/function renderCard\(/g) || []).length, 1);
  // Defined, called for a vanished card, called for a loaded card. Fewer
  // means a path that never renders.
  assert.equal((html.match(/renderCard\(/g) || []).length, 3);
  assert.match(LOADERS, /renderCard\(resp, wrap\)/, "loadCard renders through it");
  assert.match(LOADERS, /renderCard\(null, wrap\)/, "a card whose stanza is gone is hidden through it");
  for (const gone of ["loadBoard", "loadReviews", "buildBoard", "buildReviews", "BOARD_COLUMNS", "REVIEW_COLUMNS", "boardItems", "reviewRow(", "reviewStateCells"]) {
    assert.ok(!html.includes(gone), `${gone} is still in the page: a second rendering path`);
  }
});

test("columns come from the response, headings and cells from the registry", () => {
  const render = between("function renderCard(", "async function loadCards()");
  assert.match(render, /Array\.isArray\(resp\.columns\) \? resp\.columns : \[\]/, "the column ids are the server's");
  assert.match(render, /CELLS\[id\] \? \[id, CELLS\[id\]\[0\], CELLS\[id\]\[1\]\] : \[id, id, id\]/, "headings from the registry, the id itself for an unknown column");
  assert.match(render, /gridNode\(headings/, "the same grid the two tables shared");
  assert.match(CARDS_BLOCK, /else cell\(tr, r\[id\], id\)/, "an unknown column renders the row's field as text");

  // Every column the two shapes declare has an entry, so neither table lost a cell.
  const registry = between("const CELLS = {", "/** The text an empty card shows");
  for (const id of new Set([...REVIEW_COLUMNS, ...BOARD_COLUMNS])) {
    assert.match(registry, new RegExp(`^\\s{8}${id}: \\["`, "m"), `no cell for column ${id}`);
  }
  // The shared cells are one piece of code, reading the joined block.
  for (const fn of ["verdictCell", "gatesNode", "noteCell", "postedCell", "threadsCell"]) {
    assert.equal((CARDS_BLOCK.match(new RegExp(`function ${fn}\\(`, "g")) || []).length, 1, `${fn} is defined once`);
    assert.match(registry, new RegExp(`\\b${fn}\\(`), `${fn} is drawn through the registry`);
  }
  assert.match(CARDS_BLOCK, /function joinedReader\(resp\)/);
  assert.match(CARDS_BLOCK, /Object\.keys\(resp\.joins\)/, "which block a shared cell reads follows the response's joins");
  assert.match(registry, /threadsCell\(tr, j && j\.review_state \? j\.review_state\.threads : undefined, j !== r\)/, "the board's brief thread count is the joined case of the same cell");
  // Where the time went, the early signal, and the median line still render.
  assert.match(CARDS_BLOCK, /function phasesCell\b/);
  assert.match(CARDS_BLOCK, /phase_seconds/);
  assert.match(CARDS_BLOCK, /ended == null/, "the open phase is told apart by its missing end");
  assert.match(CARDS_BLOCK, /function earlyCell\b/);
  assert.match(CARDS_BLOCK, /r\.running && r\.early/, "a finished row shows nothing here");
  assert.match(CARDS_BLOCK, /function phaseMedians\b/);
  assert.match(CARDS_BLOCK, /median per phase across /);
  assert.match(CARDS_BLOCK, /\.toFixed\(1\)/, "minutes to one decimal");
  assert.match(CARDS_BLOCK, /unreadable/, "unreadable rows are rendered in place");
  assert.match(CARDS_BLOCK, /\.running\b/, "running rows are distinguished");
  // A --fast run's PRELIMINARY verdict is muted and says why.
  const verdictFn = CARDS_BLOCK.slice(CARDS_BLOCK.indexOf("function verdictCell("), CARDS_BLOCK.indexOf("function noteCell("));
  assert.match(verdictFn, /verdict === "PRELIMINARY" \? "fast run, unrefuted"/);
  const cssAt = html.indexOf(".prgrid .v-preliminary {");
  assert.ok(cssAt !== -1);
  assert.match(html.slice(cssAt, html.indexOf("}", cssAt)), /color:\s*var\(--muted\)/);
});

test("panel order comes from the layout, falling back to today's order", () => {
  assert.match(LOADERS, /fetch\("\/api\/cards"/, "the list of cards and the layout come from one route");
  assert.match(LOADERS, /body\.layout && Array\.isArray\(body\.layout\.order\) \? body\.layout\.order : \[\]/);
  const order = between("function orderPanels(order)", "/**\n       * One card.");
  assert.match(order, /order\.map\(\(name\) => el\("wrap-" \+ name\)\)/, "named panels first, in the layout's order");
  assert.match(order, /\[\.\.\.named, \.\.\.rest\]/, "the rest keep their place after them");
  // A card the shell has no panel for gets one: config plus a normaliser,
  // no UI change.
  const ensure = between("function ensurePanel(name)", "/** Panels the layout names");
  assert.match(ensure, /wrap\.id = "wrap-" \+ name/);
  assert.match(ensure, /node\("span", "title", name\)/);
  assert.match(ensure, /node\("span", "stamp"\)/);
  assert.match(ensure, /node\("div", "body"\)/);
  assert.match(ensure, /document\.querySelector\("aside"\)\.appendChild\(wrap\)/);
});

test("the loader treats 404 as panel-off and anything else as a fault worth the banner", () => {
  const load = between("async function loadCard(name)", "/** ⟳ :");
  assert.match(load, /fetch\("\/api\/card\/" \+ encodeURIComponent\(name\)/);
  assert.match(load, /res\.status === 404/);
  assert.match(load, /SOURCE_STATE\.delete\(name\)/);
  assert.match(load, /noteSource\(name, "absent", resp\.error\)/, "a 503 is attributed, not hidden");
  assert.match(load, /payloadHealth\(body\.health\)/, "the payload's self-report outranks its age");
  assert.match(load, /noteSource\(name, body\.stale \? "stale" : "live"\)/);
  assert.match(load, /if \(name === "board"\) setDial\(/, "the dial still reads the board");

  // The misconfigured body: the reason, in place of rows, in the warning colour.
  const render = between("function renderCard(", "async function loadCards()");
  assert.match(render, /node\("div", "empty misconfigured", resp\.error\)/);
  const cssAt = html.indexOf(".panel .misconfigured {");
  assert.ok(cssAt !== -1, "the misconfigured state has a style");
  assert.match(html.slice(cssAt, html.indexOf("}", cssAt)), /color:\s*var\(--accent\)/);
  // Stale: greyed, stamped with the snapshot's age, relative times suppressed.
  assert.match(render, /mount\.classList\.toggle\("stale", !!resp\.stale\)/);
  assert.match(render, /"as of " \+ fmtTime\(resp\.generated_at\)/);
  assert.match(render, /RENDER_STALE = !!resp\.stale/);
  // Joins that could not be applied are said under the table, not hidden.
  assert.match(render, /status !== "ok"/);
});

test("the dial counts needs-you from the card's items", () => {
  const fn = html.slice(html.indexOf("function setDial("), html.indexOf("function setDial(") + 1600);
  assert.match(fn, /Array\.isArray\(env\.items\) \? env\.items : \[\]/);
  assert.match(fn, /i\.state === "needs_you"/);
  assert.match(fn, /fmtTime\(env\.generated_at\)/, "a stale dial names the snapshot's age");
});

test("the cards block only links: no request, no verb, no URL of its own", () => {
  assert.ok(!/fetch\s*\(/.test(CARDS_BLOCK), "the renderer makes no request");
  assert.ok(!/method:/.test(CARDS_BLOCK), "no verb but the page's GETs");
  assert.ok(!/https?:\/\//.test(CARDS_BLOCK), "no URL is hardcoded; every link comes from the payload");
  assert.match(CARDS_BLOCK, /a\.href = url/, "the note link is a real href");
  assert.match(CARDS_BLOCK, /parseRoute\(url\)/, "and it opens through the same route rule a tree click uses");
  assert.match(CARDS_BLOCK, /linkOut\(/, "links out go through linkOut");
  assert.ok(!/method:/.test(LOADERS), "the loaders issue no verb either");
});

test("refresh and first paint load the cards through one path", () => {
  const refresh = between("async function refreshAll()", "el(\"back\")");
  assert.match(refresh, /loadCards\(\)/);
  assert.ok(!/loadBoard|loadReviews/.test(refresh));
  const paint = html.slice(html.indexOf("// First paint:"), html.lastIndexOf("</script>"));
  assert.match(paint, /loadCards\(\);/);
  assert.equal((html.match(/loadCards\(\)/g) || []).length, 3, "defined, refreshed, painted");
});
