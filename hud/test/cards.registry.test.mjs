// The card registry: `[cards.*]` and `[layout]` from the parsed config, with a
// legacy `[sources.*]` config synthesised into the same cards so nobody has to
// rewrite hud.toml on day one.
//
// Everything here is a pure function of a config object — no server, no tree.
// The TOML cases go through `parseToml` so the shape the docs show is the
// shape that is tested; the JSON cases pass the object straight in.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseToml } from "../server.mjs";
import {
  DEFAULT_LAYOUT_ORDER,
  KINDS,
  getCard,
  loadCards,
  synthesizeLegacy,
} from "../cards/registry.mjs";

const HUD_ROOT = "/tmp/hud-cards-registry-root";
const ENV = { hudRoot: HUD_ROOT };

/** The reviews card exactly as the plan's TOML spells it. */
const REVIEWS_TOML = `
[cards.reviews]
kind    = "fs"
glob    = "projects/*/raw/PR-*/state.json"
shape   = "review-state"
key     = "pr_url"
title   = "Review runs"
scope   = "open"
columns = ["pr", "project", "mode", "phase", "phases", "verdict", "mine", "humans", "bots", "threads", "early", "gates", "unavail", "findings", "note", "posted"]
`;

const REVIEWS_CARD = {
  name: "reviews",
  kind: "fs",
  glob: "projects/*/raw/PR-*/state.json",
  root: HUD_ROOT,
  shape: "review-state",
  key: "pr_url",
  title: "Review runs",
  scope: "open",
  columns: [
    "pr", "project", "mode", "phase", "phases", "verdict", "mine", "humans", "bots",
    "threads", "early", "gates", "unavail", "findings", "note", "posted",
  ],
};

function fromToml(text) {
  const { data, warns } = parseToml(text);
  assert.deepEqual(warns, [], "the fixture TOML is inside the parser's subset");
  return loadCards(data, ENV);
}

// --------------------------------------------------------------- (a) parse

test("[cards.reviews] with kind fs parses to the card the plan names", () => {
  const { cards, errors } = fromToml(REVIEWS_TOML);
  assert.deepEqual(errors, []);
  assert.deepEqual([...cards.keys()], ["reviews"]);
  assert.deepEqual(cards.get("reviews"), REVIEWS_CARD);
  assert.deepEqual(getCard(cards, "reviews"), REVIEWS_CARD);
  assert.equal(getCard(cards, "board"), null, "an undeclared card is null, not undefined");
});

test("`source` is accepted as the design doc's spelling of `kind`", () => {
  const { cards } = fromToml(REVIEWS_TOML.replace('kind    = "fs"', 'source  = "fs"'));
  assert.equal(cards.get("reviews").kind, "fs");
  assert.equal("source" in cards.get("reviews"), false, "the card carries one name for it");
});

test("title defaults to the name, columns to the shape's, root to the HUD root", () => {
  const { cards } = fromToml('[cards.runs]\nkind = "fs"\nglob = "a/*/state.json"\nshape = "review-state"\n');
  const card = cards.get("runs");
  assert.equal(card.title, "runs");
  assert.deepEqual(card.columns, REVIEWS_CARD.columns, "review-state knows its own columns");
  assert.equal(card.root, HUD_ROOT);
  assert.equal(card.scope, undefined, "no scope declared means none");
  assert.equal(card.key, undefined);
});

test("an fs card's root is honoured, with a leading ~ expanded", () => {
  const { cards } = fromToml('[cards.runs]\nkind = "fs"\nroot = "~/elsewhere"\nglob = "a/*/x.json"\nshape = "review-state"\n');
  assert.ok(!cards.get("runs").root.startsWith("~"), "~ is expanded");
  assert.ok(cards.get("runs").root.endsWith("/elsewhere"));
});

// ------------------------------------------------------- (b) unknown kind

test("an unknown kind is one misconfigured card, not a broken registry", () => {
  const { cards, errors } = fromToml(`${REVIEWS_TOML}\n[cards.odd]\nkind = "carrier-pigeon"\n`);
  assert.deepEqual(cards.get("reviews"), REVIEWS_CARD, "the good card is unaffected");
  const odd = cards.get("odd");
  assert.equal(odd.name, "odd");
  assert.match(odd.error, /unknown kind "carrier-pigeon"/);
  assert.deepEqual(Object.keys(odd).sort(), ["error", "name"], "an error entry carries nothing else");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /cards\.odd: unknown kind/);
});

test("a kind the design names but this release does not serve is told apart from a typo", () => {
  // The plan marks these "next": declaring one is not a typo, so the error
  // says "not served yet" rather than "unknown", and a required field is
  // still checked so the stanza is right when the kind lands.
  for (const kind of ["http", "cmd", "prometheus", "mcp"]) {
    assert.equal(KINDS[kind].status, "next", kind);
  }
  assert.equal(KINDS.fs.status, "now");
  const { cards } = fromToml('[cards.board]\nkind = "http"\nurl = "http://127.0.0.1:2000/board"\n');
  assert.match(cards.get("board").error, /kind "http" is not served yet/);
  const noUrl = fromToml('[cards.board]\nkind = "http"\n');
  assert.match(noUrl.cards.get("board").error, /url/, "the missing field is named first");
});

test("a card name that cannot be a route segment is refused", () => {
  const { cards, errors } = loadCards({ cards: { "../x": { kind: "fs", glob: "a/*", shape: "review-state" } } }, ENV);
  assert.equal(cards.size, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /name/);
});

// ------------------------------------------------- (c) required fields

test("an fs card needs a glob the walker can honour and a shape the registry knows", () => {
  const cases = [
    ['[cards.a]\nkind = "fs"\nshape = "review-state"\n', /glob/],
    ['[cards.a]\nkind = "fs"\nglob = ""\nshape = "review-state"\n', /glob/],
    ['[cards.a]\nkind = "fs"\nglob = "../x/*.json"\nshape = "review-state"\n', /cards\.a\.glob in hud\.toml: glob must/],
    ['[cards.a]\nkind = "fs"\nglob = "/abs/*.json"\nshape = "review-state"\n', /glob must be a relative path/],
    ['[cards.a]\nkind = "fs"\nglob = "a/*/x.json"\n', /shape/],
    ['[cards.a]\nkind = "fs"\nglob = "a/*/x.json"\nshape = "mystery"\n', /unknown shape "mystery"/],
    ['[cards.a]\nkind = "fs"\nglob = "a/*/x.json"\nshape = "review-state"\nscope = "posted"\n', /scope must be one of open, all/],
    ['[cards.a]\nkind = "fs"\nglob = "a/*/x.json"\nshape = "review-state"\ncolumns = "pr"\n', /columns must be a list of strings/],
  ];
  for (const [toml, re] of cases) {
    const { cards, errors } = fromToml(toml);
    assert.match(cards.get("a").error, re, toml);
    assert.equal(errors.length, 1, toml);
  }
  const noKind = fromToml('[cards.a]\nglob = "a/*/x.json"\n');
  assert.match(noKind.cards.get("a").error, /kind/);
});

test("a cards entry that is not a table is an error entry too", () => {
  const { cards } = loadCards({ cards: { a: "fs", b: 3, c: null } }, ENV);
  for (const name of ["a", "b", "c"]) assert.match(cards.get(name).error, /not a table/);
});

// ------------------------------------------------- (d) legacy synthesis

test("no [cards] but [sources.reviews] synthesises the reviews card the TOML above declares", () => {
  const legacy = loadCards({ sources: { reviews: {} } }, ENV);
  assert.deepEqual(legacy.errors, []);
  assert.deepEqual([...legacy.cards.keys()], ["reviews"]);
  assert.deepEqual(legacy.cards.get("reviews"), REVIEWS_CARD, "identical to the declared form");

  // The legacy keys map onto the card's.
  const tuned = loadCards({ sources: { reviews: { root: "/elsewhere", glob: "runs/*/PR-*/state.json" } } }, ENV);
  assert.equal(tuned.cards.get("reviews").root, "/elsewhere");
  assert.equal(tuned.cards.get("reviews").glob, "runs/*/PR-*/state.json");
  assert.equal(loadCards({ sources: { reviews: { root: "~/x" } } }, ENV).cards.get("reviews").root.endsWith("/x"), true);
  // An empty string is the same as absent, as the old route treated it.
  assert.deepEqual(loadCards({ sources: { reviews: { root: "", glob: "" } } }, ENV).cards.get("reviews"), REVIEWS_CARD);

  // A glob the walker refuses is a misconfigured card, worded as the old
  // route worded it, so the alias keeps answering 503 with that reason.
  const bad = loadCards({ sources: { reviews: { glob: "../x/*.json" } } }, ENV);
  assert.match(bad.cards.get("reviews").error, /reviews\.glob in hud\.toml/);
});

test("legacy synthesis is only for sources this release serves as cards", () => {
  // The board is the next card; until its kind is served, a legacy board
  // source stays on its old route and synthesises nothing here.
  const { cards, errors } = loadCards({ sources: { board: { url: "http://127.0.0.1:1/b" } } }, ENV);
  assert.equal(cards.size, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(synthesizeLegacy({ sources: { board: { url: "http://127.0.0.1:1/b" }, reviews: {} } }), {
    reviews: { kind: "fs", glob: "projects/*/raw/PR-*/state.json", shape: "review-state", key: "pr_url", title: "Review runs", scope: "open" },
  });
  assert.deepEqual(synthesizeLegacy({}), {});
  assert.deepEqual(synthesizeLegacy({ sources: { reviews: "yes" } }), {}, "a source that is not a table is not a source");
});

test("a [cards] table present means [sources.*] is not synthesised", () => {
  const { cards } = loadCards({ cards: {}, sources: { reviews: {} } }, ENV);
  assert.equal(cards.size, 0, "an empty [cards] is an answer: no cards");
  const both = loadCards({ cards: { runs: { kind: "fs", glob: "a/*/x.json", shape: "review-state" } }, sources: { reviews: {} } }, ENV);
  assert.deepEqual([...both.cards.keys()], ["runs"]);
});

// ----------------------------------------------------------- (e) layout

test("[layout].order is parsed, and the default order stands in when it is absent", () => {
  const { layout } = fromToml(`${REVIEWS_TOML}\n[layout]\norder = ["board", "reviews"]\n`);
  assert.deepEqual(layout, { order: ["board", "reviews"] });
  assert.deepEqual(fromToml(REVIEWS_TOML).layout, { order: DEFAULT_LAYOUT_ORDER });
  assert.deepEqual(DEFAULT_LAYOUT_ORDER, ["reviews", "board", "digest", "sessions", "loadout", "peers"]);

  // An order that is not a list of strings is reported and the default used,
  // rather than a half-parsed order silently hiding panels.
  const odd = loadCards({ layout: { order: ["reviews", 3] } }, ENV);
  assert.deepEqual(odd.layout, { order: DEFAULT_LAYOUT_ORDER });
  assert.equal(odd.errors.length, 1);
  assert.match(odd.errors[0], /layout\.order/);
});

// ------------------------------------------------------------- (f) JSON

test("the JSON config form is accepted with the same keys", () => {
  const json = {
    cards: {
      reviews: {
        kind: "fs",
        glob: "projects/*/raw/PR-*/state.json",
        shape: "review-state",
        key: "pr_url",
        title: "Review runs",
        scope: "open",
        columns: REVIEWS_CARD.columns,
      },
    },
    layout: { order: ["reviews"] },
  };
  const { cards, layout, errors } = loadCards(json, ENV);
  assert.deepEqual(errors, []);
  assert.deepEqual(cards.get("reviews"), REVIEWS_CARD);
  assert.deepEqual(layout, { order: ["reviews"] });
  assert.equal("columns" in json.cards.reviews, true, "the input is not mutated");
});

test("an empty or missing config is no cards and the default layout", () => {
  for (const cfg of [{}, null, undefined, { cards: null }, { sources: null }]) {
    const { cards, layout, errors } = loadCards(cfg, ENV);
    assert.equal(cards.size, 0);
    assert.deepEqual(layout, { order: DEFAULT_LAYOUT_ORDER });
    assert.deepEqual(errors, []);
  }
});

// ------------------------------------------------ the TOML arrays it needs

test("the TOML subset carries single-line arrays of its scalars", () => {
  const { data, warns } = parseToml(
    [
      'strings = ["a", "b", "c"]',
      "ints = [1, 2, 3]",
      "bools = [true, false]",
      "empty = []",
      'trailing = ["x", "y",]   # a trailing comma and a comment',
      'brackety = ["a]", "[b", "c,d"]',
      "spaced = [ 1 ,  2 ]",
    ].join("\n"),
  );
  assert.deepEqual(warns, []);
  assert.deepEqual(data, {
    strings: ["a", "b", "c"],
    ints: [1, 2, 3],
    bools: [true, false],
    empty: [],
    trailing: ["x", "y"],
    brackety: ["a]", "[b", "c,d"],
    spaced: [1, 2],
  });
});

test("an array outside the subset is skipped like any other bad line", () => {
  const { data, warns } = parseToml(
    [
      "nested = [[1], 2]",
      "tables = [{ a = 1 }]",
      "floats = [1.5]",
      'open = ["a", "b"',
      'junk = ["a"] trailing',
      "multiline = [",
      'ok = ["still", "read"]',
    ].join("\n"),
  );
  assert.deepEqual(Object.keys(data), ["ok"]);
  assert.equal(warns.length, 6, warns.join("; "));
});
