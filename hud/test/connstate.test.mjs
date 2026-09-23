// Hermetic tests for the "this page is not showing live data" banner.
//
// Per-panel staleness is deliberately quiet — dashed and dimmed — which is
// right for one panel and wrong for the whole page. These cases pin the two
// things that quietness let through: a page where every panel was a snapshot
// still read as current at a glance, and a payload that identified itself as
// a sample rendered exactly like real work.
//
// paintConnState and ago live inline in ui/index.html (a browser-only file
// with no module exports), so their source is extracted by name and evaluated
// via `Function`, the same trick ui-meta.test.mjs uses. No fixture here
// carries a real person, company, or project name.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(
  path.join(import.meta.dirname, "..", "ui", "index.html"),
  "utf8",
);

function extractFunction(source, name) {
  const startMarker = `function ${name}(`;
  const endMarker = `// ${name}:end`;
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `${startMarker} not found in ui/index.html`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `${endMarker} not found in ui/index.html`);
  return source.slice(start, end);
}

// Extracted, not restated. A copy here would keep passing after someone
// changed the real ordering, which is the exact failure these tests exist to
// prevent elsewhere.
const CONN_RANK = (() => {
  const m = html.match(/const CONN_RANK = (\{[^}]*\});/);
  assert.ok(m, "CONN_RANK literal not found in ui/index.html");
  return new Function(`return ${m[1]};`)();
})();

test("harness sanity: the ranking came from the page, and orders as documented", () => {
  assert.ok(CONN_RANK.example > CONN_RANK.absent);
  assert.ok(CONN_RANK.absent > CONN_RANK.stale);
  assert.ok(CONN_RANK.stale > CONN_RANK.live);
});

/** Build paintConnState over a fake bar element and a fresh state map. */
function harness(entries) {
  const bar = {
    className: "",
    hidden: false,
    textContent: "",
    title: "",
    removeAttribute() {
      this.title = "";
    },
  };
  const state = new Map(entries);
  const src = extractFunction(html, "paintConnState");
  const paint = new Function(
    "el",
    "CONN_RANK",
    "SOURCE_STATE",
    `${src}\nreturn paintConnState;`,
  )(() => bar, CONN_RANK, state);
  paint();
  return bar;
}

test("harness sanity: extraction pulled a real function, not a stub", () => {
  const bar = harness([["board", "stale"]]);
  // If extraction silently produced a no-op, nothing below proves anything.
  assert.notEqual(bar.textContent, "");
});

test("every source live renders nothing at all", () => {
  const bar = harness([
    ["board", "live"],
    ["digest", "live"],
  ]);
  assert.equal(bar.hidden, true);
  assert.equal(bar.textContent, "");
  // The banner's presence has to mean something, so "all good" is silence.
  assert.equal(bar.className, "live");
});

test("an unconfigured source is absent from the map and raises nothing", () => {
  // A source nobody configured is not a fault. Only sources that are
  // configured and failing to answer should reach the map at all.
  const bar = harness([["board", "live"]]);
  assert.equal(bar.hidden, true);
});

test("a snapshot says NOT LIVE and names the source", () => {
  const bar = harness([
    ["board", "stale"],
    ["digest", "live"],
  ]);
  assert.equal(bar.hidden, false);
  assert.equal(bar.className, "stale");
  assert.match(bar.textContent, /NOT LIVE/);
  assert.match(bar.textContent, /board/);
  assert.doesNotMatch(bar.textContent, /digest/);
});

test("a configured source answering nothing says NOT CONNECTED", () => {
  const bar = harness([["board", "absent"]]);
  assert.equal(bar.className, "absent");
  assert.match(bar.textContent, /NOT CONNECTED/);
});

test("worst state wins, and only the worst sources are named", () => {
  // Reporting the mildest state of several would understate the page.
  const bar = harness([
    ["board", "absent"],
    ["digest", "stale"],
    ["peers", "live"],
  ]);
  assert.equal(bar.className, "absent");
  assert.match(bar.textContent, /board/);
  assert.doesNotMatch(bar.textContent, /digest/);
});

test("example data outranks staleness and says so unmistakably", () => {
  // Stale real data is true about the past; example data is true about
  // nothing, and would stay false however fresh it became.
  const bar = harness([
    ["board", "example"],
    ["digest", "absent"],
  ]);
  assert.equal(bar.className, "example");
  assert.match(bar.textContent, /EXAMPLE DATA/);
  assert.match(bar.textContent, /Nothing here is real/);
  assert.match(bar.title, /tickStatus/);
});

test("the banner clears when sources recover", () => {
  // A latched warning is its own kind of lie.
  const bar = harness([["board", "stale"]]);
  assert.equal(bar.hidden, false);
  const recovered = harness([["board", "live"]]);
  assert.equal(recovered.hidden, true);
  assert.equal(recovered.textContent, "");
});

// --- the relative-time half -------------------------------------------------

/** Build `ago` with RENDER_STALE forced either way. */
function agoWith(stale) {
  const src = extractFunction(html, "ago");
  return new Function(
    "RENDER_STALE",
    "fmtTime",
    `${src}\nreturn ago;`,
  )(stale, (iso) => "AT:" + iso);
}

test("a live source still gets a relative time", () => {
  const ago = agoWith(false);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60000).toISOString();
  assert.equal(ago(tenMinutesAgo), "10m ago");
});

test("a snapshot never renders a relative time", () => {
  // This is the defect the banner was prompted by: a board captured days
  // earlier rendered its stand-up as "in 30m", which is not stale, it is
  // wrong. A relative time is a claim about now, so a snapshot cannot make
  // one — it can only state the instant.
  const ago = agoWith(true);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60000).toISOString();
  const out = ago(tenMinutesAgo);
  assert.equal(out, "AT:" + tenMinutesAgo);
  assert.doesNotMatch(out, /ago|just now/);
});

test("an unparseable timestamp stays empty either way", () => {
  assert.equal(agoWith(false)("not-a-date"), "");
  assert.equal(agoWith(true)("not-a-date"), "");
});
