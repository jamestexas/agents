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
  const { cards, errors, warnings } = fromToml(REVIEWS_TOML);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [], "the canonical spelling has nothing to say");
  assert.deepEqual([...cards.keys()], ["reviews"]);
  assert.deepEqual(cards.get("reviews"), REVIEWS_CARD);
  assert.deepEqual(getCard(cards, "reviews"), REVIEWS_CARD);
  assert.equal(getCard(cards, "board"), null, "an undeclared card is null, not undefined");
});

test("`source` is accepted as the design doc's spelling of `kind`, with one warning so configs converge", () => {
  const { cards, errors, warnings } = fromToml(REVIEWS_TOML.replace('kind    = "fs"', 'source  = "fs"'));
  assert.equal(cards.get("reviews").kind, "fs");
  assert.equal("source" in cards.get("reviews"), false, "the card carries one name for it");
  assert.deepEqual(errors, [], "a warning, not a fault: the card is served");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^cards\.reviews: `source` is read as `kind`; spell it `kind = "fs"`$/);
  // `kind` present wins silently, whatever `source` says.
  const both = loadCards({ cards: { a: { kind: "fs", source: "http", glob: "a/*", shape: "review-state" } } }, ENV);
  assert.equal(both.cards.get("a").kind, "fs");
  assert.deepEqual(both.warnings, []);
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
  for (const kind of ["cmd", "prometheus", "mcp"]) {
    assert.equal(KINDS[kind].status, "next", kind);
  }
  assert.equal(KINDS.fs.status, "now");
  assert.equal(KINDS.http.status, "now");
  const { cards } = fromToml('[cards.digest]\nkind = "cmd"\ncmd = "example-digest --since 24h"\n');
  assert.match(cards.get("digest").error, /kind "cmd" is not served yet/);
  const noCmd = fromToml('[cards.digest]\nkind = "cmd"\n');
  assert.match(noCmd.cards.get("digest").error, /cmd/, "the missing field is named first");
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

test("legacy synthesis covers only the sources this release serves as cards", () => {
  // digest, sessions, loadout and peers stay on their own routes until their
  // kinds land; nothing is synthesised for them, and nothing is an error.
  const { cards, errors } = loadCards(
    { sources: { digest: { cmd: "example-digest" }, sessions: { root: "/x" }, loadout: { claude_root: "/y" } } },
    ENV,
  );
  assert.equal(cards.size, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(synthesizeLegacy({}), {});
  assert.deepEqual(synthesizeLegacy({ sources: { reviews: "yes", board: "no" } }), {}, "a source that is not a table is not a source");
  assert.deepEqual(synthesizeLegacy({ sources: { reviews: {} } }), {
    reviews: { kind: "fs", glob: "projects/*/raw/PR-*/state.json", shape: "review-state", key: "pr_url", title: "Review runs", scope: "open" },
  });
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

// ------------------------------------------------- http, joins, the board

const BOARD_TOML = `
[cards.reviews]
kind    = "fs"
glob    = "projects/*/raw/PR-*/state.json"
shape   = "review-state"
key     = "pr_url"
title   = "Review runs"
scope   = "open"

[cards.board]
kind    = "http"
url     = "http://127.0.0.1:2000/board"
shape   = "work-board"
key     = "pr_url"
title   = "My PRs"
columns = ["pr", "title", "why", "verdict", "gates", "note", "posted", "threads"]

[cards.board.join.reviews]
columns = ["verdict", "gates", "note", "posted", "threads"]
latest  = "started"
`;

const BOARD_CARD = {
  name: "board",
  kind: "http",
  url: "http://127.0.0.1:2000/board",
  shape: "work-board",
  key: "pr_url",
  title: "My PRs",
  columns: ["pr", "title", "why", "verdict", "gates", "note", "posted", "threads"],
  join: { reviews: { columns: ["verdict", "gates", "note", "posted", "threads"], latest: "started" } },
};

test("[cards.board] with kind http and a join on reviews parses to the card the plan names", () => {
  const { cards, errors, warnings } = fromToml(BOARD_TOML);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(KINDS.http.status, "now");
  assert.deepEqual(cards.get("board"), BOARD_CARD);
  assert.equal(cards.get("reviews").error, undefined);
});

test("an http card needs an absolute http(s) url; a work-board card defaults its columns", () => {
  for (const [toml, re] of [
    ['[cards.b]\nkind = "http"\nshape = "work-board"\n', /http needs url/],
    ['[cards.b]\nkind = "http"\nurl = "127.0.0.1:2000/board"\nshape = "work-board"\n', /cards\.b\.url in hud\.toml: url must be an absolute http\(s\) URL/],
    ['[cards.b]\nkind = "http"\nurl = "ftp://127.0.0.1/board"\nshape = "work-board"\n', /absolute http\(s\) URL/],
    ['[cards.b]\nkind = "http"\nurl = "http://127.0.0.1:2000/board"\n', /shape is required/],
  ]) {
    assert.match(fromToml(toml).cards.get("b").error, re, toml);
  }
  const { cards } = fromToml('[cards.b]\nkind = "http"\nurl = "http://127.0.0.1:2000/board"\nshape = "work-board"\n');
  assert.deepEqual(cards.get("b").columns, BOARD_CARD.columns);
  assert.equal("join" in cards.get("b"), false, "no join declared, no join key");
});

test("a join must name a declared card, other than itself, with the same key", () => {
  const base = BOARD_TOML.replace(/\[cards\.board\.join\.reviews\][^]*$/, "");
  const cases = [
    [`${base}[cards.board.join.digest]\nlatest = "started"\n`, /join\.digest: no card named "digest"/],
    [`${base}[cards.board.join.board]\n`, /join\.board: a card cannot join itself/],
    [`${base.replace('key     = "pr_url"\ntitle   = "Review runs"', 'key = "sha"\ntitle = "Review runs"')}[cards.board.join.reviews]\n`, /join\.reviews: keys differ \(pr_url vs sha\)/],
    [`${base.replace('key     = "pr_url"\ntitle   = "My PRs"', 'title = "My PRs"')}[cards.board.join.reviews]\n`, /join\.reviews: the card declares no key/],
    [`${base}[cards.board.join.reviews]\ncolumns = "verdict"\n`, /join\.reviews: columns must be a list of strings/],
    [`${base}[cards.board.join.reviews]\nlatest = 3\n`, /join\.reviews: latest must be a string/],
  ];
  for (const [toml, re] of cases) {
    const { cards, errors } = fromToml(toml);
    assert.match(cards.get("board").error, re, toml);
    assert.equal(errors.length, 1, toml);
    assert.equal(cards.get("reviews").error, undefined, "the joined card is unaffected");
  }
  // A join onto a card that is itself misconfigured is declared fine: it is
  // the join that goes unavailable at serve time, not the card.
  const onBroken = fromToml(BOARD_TOML.replace('glob    = "projects/*/raw/PR-*/state.json"', 'glob = "../x"'));
  assert.equal(onBroken.cards.get("board").error, undefined);
  assert.ok(onBroken.cards.get("reviews").error);
  // Optional parts default: no columns, no latest.
  const bare = fromToml(`${base}[cards.board.join.reviews]\n`);
  assert.deepEqual(bare.cards.get("board").join, { reviews: {} });
});

test("legacy [sources.board] with a url synthesises the board card, joined on reviews when that is on too", () => {
  const both = loadCards({ sources: { board: { url: "http://127.0.0.1:2000/board" }, reviews: {} } }, ENV);
  assert.deepEqual(both.errors, []);
  assert.deepEqual([...both.cards.keys()], ["reviews", "board"]);
  assert.deepEqual(both.cards.get("board"), BOARD_CARD, "identical to the declared form");

  const alone = loadCards({ sources: { board: { url: "http://127.0.0.1:2000/board" } } }, ENV);
  assert.deepEqual([...alone.cards.keys()], ["board"]);
  assert.equal("join" in alone.cards.get("board"), false, "nothing to join onto");

  // A board table with no url is what the old route treated as unconfigured:
  // no card, so the alias keeps answering "not configured".
  assert.equal(loadCards({ sources: { board: {} } }, ENV).cards.size, 0);
  assert.equal(loadCards({ sources: { board: { url: "" } } }, ENV).cards.size, 0);
  assert.deepEqual(synthesizeLegacy({ sources: { board: { url: "http://127.0.0.1:1/b" }, reviews: {} } }).board, {
    kind: "http",
    url: "http://127.0.0.1:1/b",
    shape: "work-board",
    key: "pr_url",
    title: "My PRs",
    join: { reviews: { columns: ["verdict", "gates", "note", "posted", "threads"], latest: "started" } },
  });
});
