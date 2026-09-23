// Tests for hud-contract.mjs — the declaration the write path, the read path
// and the doc generator all read.
//
// These run entirely in-process: no tree, no shell, no subprocess. That is the
// point of the declaration being data rather than logic entangled with a CLI,
// and it is what makes the properties below cheap enough to assert
// exhaustively over every kind rather than on a hand-picked two.
//
// The load-bearing one is the ROUND TRIP. The write path composes a path from
// intent and the read path decomposes meaning back out of a path; today those
// rules live in two files and agree only by coincidence. If they can disagree,
// an entry can be written as one type and read back as another and nothing
// detects it. Proving compose/decompose are inverses is what lets the read
// path adopt this grammar later as a swap rather than as a new idea.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOOKKEEPING,
  CONTAINERS,
  CONTAINER_ROLES,
  DEPTH,
  FIELDS,
  KINDS,
  KIND_NAMES,
  SECTIONS,
  SECTION_ABOUT,
  SERIALIZATION,
  SLUG,
  composePath,
  composeSegments,
  decomposePath,
  hasDatePrefix,
  keyLegality,
  matchSegments,
  normalizeDate,
  pathPattern,
  pathVars,
  renderFrontmatter,
  rest,
} from "../hud-contract.mjs";
import { inferType, KNOWN_SECTIONS, SECTION_ABOUT as SERVER_ABOUT } from "../server.mjs";
import { kebab, slugify } from "../hud-new.mjs";

/** A filled-in variable set for any kind, from its own declared needs. */
function varsFor(kind, over = {}) {
  const base = {
    project: "widget-service",
    slug: "flaky-retry-test",
    handle: "octo-cat",
    date: "2026-04-07",
    ext: "txt",
  };
  const out = {};
  for (const name of pathVars(kind)) out[name] = base[name];
  return { ...out, ...over };
}

// ------------------------------------------------------------ round trip

test("compose and decompose are inverses, for every kind", () => {
  for (const kind of KIND_NAMES) {
    const vars = varsFor(kind);
    const rel = composePath(kind, vars);
    const back = decomposePath(rel);
    assert.ok(back, `${kind}: ${rel} decomposed to nothing`);
    assert.equal(back.kind, kind, `${rel} read back as ${back.kind}`);
    assert.deepEqual(back.vars, vars, `${kind}: variables did not survive the round trip`);
    assert.equal(composePath(back.kind, back.vars), rel, `${kind}: recompose differs`);
  }
});

test("no two kinds claim the same path", () => {
  // Ambiguity here is the failure the grammar exists to prevent: a path that
  // two kinds both match is a path whose type depends on iteration order.
  const seen = new Map();
  for (const kind of KIND_NAMES) {
    const rel = composePath(kind, varsFor(kind));
    assert.equal(seen.get(rel), undefined, `${kind} and ${seen.get(rel)} both produce ${rel}`);
    seen.set(rel, kind);
  }
});

test("decompose agrees with the reader's inferType on every composed path", () => {
  // The seam handed to the read-path bead: before `inferType` is replaced by
  // this grammar, the grammar has to already agree with it. `inbox` and `note`
  // are both `type: note` to the reader — the kind is the WRITE intent, the
  // type is what the tree renders.
  const expected = { note: "note", inbox: "note", playbook: "playbook", context: "context", peer: "peer", raw: "note" };
  for (const kind of KIND_NAMES) {
    const rel = composePath(kind, varsFor(kind));
    assert.equal(inferType(rel), expected[kind], `${rel}: reader and declaration disagree`);
  }
});

test("decompose is strict about depth, and says so rather than absorbing", () => {
  // The reader currently absorbs extra directories into the group, which is
  // recorded in DEPTH.overflow as the known-wrong answer. This function does
  // not reimplement that leniency — a third policy is what the declaration
  // exists to prevent.
  assert.equal(DEPTH.overflow, "absorb");
  assert.equal(DEPTH.overflowIsCorrect, false);
  assert.equal(decomposePath("projects/p/notes/deeper/2026-04-07-x.md"), null);
  assert.equal(decomposePath("projects/p/sub/CONTEXT.md"), null);
  assert.equal(decomposePath("projects/p/notes/no-date-prefix.md"), null);
  assert.equal(decomposePath("/absolute/path.md"), null);
  assert.equal(decomposePath("projects/../escaped/x.md"), null);
});

test("decompose is total: a clean null, never a confidently wrong answer", () => {
  // Whatever this returns for input it cannot parse is what the nesting bead
  // inherits, so a plausible-but-wrong answer is worse than a refusal. Walked
  // well past any depth a kind produces today.
  let deep = "projects/p/notes";
  for (let i = 0; i < 12; i++) {
    deep += "/level";
    const rel = `${deep}/2026-04-07-x.md`;
    const got = decomposePath(rel);
    assert.equal(got, null, `${rel} decomposed to ${JSON.stringify(got)} instead of refusing`);
  }
  for (const weird of ["", "x", "notes/", "/", "..", "projects", "peers/a/b.md", "PEERS/x.md"]) {
    const got = decomposePath(weird);
    assert.equal(got, null, `${JSON.stringify(weird)} decomposed to ${JSON.stringify(got)}`);
  }
  // Every non-null answer recomposes to exactly the path it came from. That is
  // the property that makes "not null" trustworthy rather than merely present.
  for (const kind of KIND_NAMES) {
    const rel = composePath(kind, varsFor(kind));
    const got = decomposePath(rel);
    assert.equal(composePath(got.kind, got.vars), rel);
  }
});

test("the grammar can express arbitrary depth, though no kind uses it yet", () => {
  // The slot, not the behaviour. Nesting will be HONOURED rather than
  // absorbed, and a grammar that describes three levels but not four has the
  // same latent bug `parts.length === 3` has — correct until someone makes a
  // directory. Proving compose/decompose handle a variadic segment now is what
  // makes flipping DEPTH.overflow a declaration edit instead of a rewrite.
  assert.equal(
    KIND_NAMES.some((k) => KINDS[k].segments.some((s) => s.rest)),
    false,
    "a kind started using the variadic segment — that is agents-c4ba4e's change, not this one",
  );

  const nested = Object.freeze([
    { lit: "projects" },
    { var: "project" },
    { lit: "notes" },
    rest("subpath"),
    { file: { prefix: "date", stem: "slug", ext: "md" } },
  ]);
  for (const depth of [1, 2, 5, 11]) {
    const subpath = Array.from({ length: depth }, (_, i) => `level${i + 1}`);
    const vars = { project: "widget-service", subpath, date: "2026-04-07", slug: "x" };
    const rel = composeSegments(nested, vars);
    assert.equal(rel, `projects/widget-service/notes/${subpath.join("/")}/2026-04-07-x.md`);
    assert.deepEqual(matchSegments(nested, rel.split("/")), vars, `depth ${depth} did not round-trip`);
  }
  // Variadic means one or more, not zero: a path with nothing in the slot is
  // a different shape and must not silently match.
  assert.equal(matchSegments(nested, "projects/p/notes/2026-04-07-x.md".split("/")), null);
  assert.throws(
    () => composeSegments(nested, { project: "p", subpath: [], date: "2026-04-07", slug: "x" }),
    /non-empty/,
  );
  assert.throws(
    () => composeSegments(nested, { project: "p", subpath: ["../up"], date: "2026-04-07", slug: "x" }),
    /not a/,
  );
});

test("the container roles distinguish never-heard-of-it from ignored-on-purpose", () => {
  // `notes` has no reader meaning by ACCIDENT — it appears nowhere in
  // server.mjs. `inert` would declare that accident as a decision. Keeping
  // the two values apart is what lets the generated prose say which is which.
  assert.equal(CONTAINERS.notes.role, "unknown");
  assert.equal(CONTAINERS.raw.role, "display");
  assert.notEqual(CONTAINER_ROLES.unknown, CONTAINER_ROLES.inert);
  for (const [name, c] of Object.entries(CONTAINERS)) {
    assert.ok(CONTAINER_ROLES[c.role], `${name} has role ${c.role}, which is not a declared role`);
  }
  // The claim behind `unknown`, asserted rather than trusted: an entry inside
  // the container and one beside it read identically to the reader.
  assert.equal(inferType("projects/p/notes/2026-04-07-x.md"), inferType("projects/p/2026-04-07-x.md"));
});

test("compose refuses a component that did not come from the normalizer", () => {
  // Containment is by construction: every component goes through `kebab`,
  // which leaves only the declared alphabet. This asserts the construction
  // rather than trusting it, so an edit to the normalizer cannot quietly make
  // an escape reachable.
  assert.throws(() => composePath("note", varsFor("note", { project: "../etc" })), /not a/);
  assert.throws(() => composePath("note", varsFor("note", { slug: "Has Spaces" })), /not a/);
  assert.throws(() => composePath("note", varsFor("note", { date: "7 April" })), /not a/);
  assert.throws(() => composePath("peer", { handle: "" }), /missing/);
});

// ------------------------------------------------------------ path facts

test("the date prefix is read off the grammar, not declared twice", () => {
  assert.deepEqual(
    KIND_NAMES.filter(hasDatePrefix).sort(),
    ["inbox", "note", "raw"],
    "a kind gained or lost a date prefix",
  );
  for (const kind of KIND_NAMES) {
    assert.equal(hasDatePrefix(kind), pathPattern(kind).includes("<date>-"));
  }
});

test("every kind's first segment is a declared section", () => {
  for (const kind of KIND_NAMES) {
    const top = pathPattern(kind).split("/")[0];
    assert.ok(SECTIONS.includes(top), `${kind} lands in ${top}, which is not a known section`);
  }
});

test("the containers are exactly the literal segments inside projects", () => {
  const literals = new Set();
  for (const kind of KIND_NAMES) {
    const segs = KINDS[kind].segments;
    if (segs[0].lit !== "projects") continue;
    for (const seg of segs.slice(1)) if (seg.lit) literals.add(seg.lit);
  }
  assert.deepEqual([...literals].sort(), Object.keys(CONTAINERS).sort());
});

// -------------------------------------------------------- the two halves

test("readDefault and emit are different questions, and status proves it", () => {
  // The drift this file exists to make impossible: `status` has a
  // readDefault, so docs described it as an entry fact — but only the project
  // brief ever writes one. A single `default` field would reproduce that.
  assert.equal(FIELDS.status.readDefault, "active");
  const emitters = KIND_NAMES.filter((k) => KINDS[k].emit.some((r) => r.key === "status"));
  assert.deepEqual(emitters, ["context"], "who writes `status` changed");
});

test("every emitted and settable key is in the field vocabulary", () => {
  for (const kind of KIND_NAMES) {
    for (const rule of KINDS[kind].emit) {
      assert.ok(FIELDS[rule.key], `${kind} emits ${rule.key}, which no field declares`);
    }
    for (const key of KINDS[kind].settable) {
      assert.ok(FIELDS[key], `${kind} accepts ${key}, which no field declares`);
    }
  }
});

test("key legality answers from a closed set of reasons", () => {
  assert.deepEqual(keyLegality("peer", "gh"), { ok: true, reason: "ok" });
  assert.deepEqual(keyLegality("note", "gh"), { ok: false, reason: "illegal" });
  assert.deepEqual(keyLegality("note", "type"), { ok: false, reason: "derived" });
  assert.deepEqual(keyLegality("raw", "title"), { ok: false, reason: "none" });
  assert.deepEqual(keyLegality("note", "nonsense"), { ok: false, reason: "unknown" });
});

// ------------------------------------------------------ date normalization

test("a full timestamp and a bare day normalize to the same value", () => {
  // Not an editor concern. Entries are compared date-first as strings, so
  // `2026-04-07T00:00:00` sorts ahead of `2026-04-07` — a tree holding one
  // mixed value already orders wrong with nothing external involved.
  assert.equal(normalizeDate("2026-04-07"), "2026-04-07");
  assert.equal(normalizeDate("2026-04-07T00:00:00"), "2026-04-07");
  assert.equal(normalizeDate("2026-04-07T13:45:10Z"), "2026-04-07");
  assert.equal(normalizeDate("2026-04-07T13:45:10+02:00"), "2026-04-07");
  assert.equal(normalizeDate("2026-04-07 09:00:00"), "2026-04-07");

  const day = "2026-04-07";
  const stamp = "2026-04-07T00:00:00";
  assert.ok(stamp > day, "the premise: lexically, a timestamp outranks its own day");
  assert.equal(normalizeDate(stamp) > normalizeDate(day), false, "normalizing must remove that");

  // A lenient parser must not eat a value it did not understand.
  assert.equal(normalizeDate("someday"), "someday");
  assert.equal(normalizeDate(undefined), undefined);
});

// ---------------------------------------------------------- serialization

test("lists render as block sequences and empties are omitted entirely", () => {
  assert.equal(SERIALIZATION.sequences, "block");
  assert.equal(SERIALIZATION.omitEmptyCollections, true);
  assert.equal(
    renderFrontmatter([["tags", ["retry", "flaky"]]]),
    "---\ntags:\n  - retry\n  - flaky\n---\n",
  );
  // `tags: []` is the form the templates used to ship, contradicting the prose
  // three lines above them. YAML has no block spelling of an empty sequence,
  // so omission is the only shape with no second representation to drift into.
  assert.equal(renderFrontmatter([["tags", []]]), "");
  assert.equal(renderFrontmatter([["title", "x"], ["tags", []]]), "---\ntitle: x\n---\n");
  assert.equal(renderFrontmatter([]), "", "no keys means no delimiters, not an empty block");
});

test("scalars are quoted only where bare would be misread", () => {
  assert.equal(renderFrontmatter([["title", "plain words"]]), "---\ntitle: plain words\n---\n");
  // A leading bracket is a flow array to the HUD's parser, and ` #` is a
  // comment; both change what is read back, so both earn quotes.
  assert.match(renderFrontmatter([["title", "[not a list]"]]), /title: "\[not a list\]"/);
  assert.match(renderFrontmatter([["title", "issue #12"]]), /title: "issue #12"/);
  assert.match(renderFrontmatter([["title", ' padded ']]), /title: " padded "/);
});

// -------------------------------------------------------------- the slug

test("the slug follows the declared rule, including the documented example", () => {
  // SKILL.md's own worked example drops an article, so that is contract.
  assert.equal(slugify("debugging the flaky retry test"), "debugging-flaky-retry-test");
  assert.equal(slugify("A Note About An Issue"), "note-about-issue");
  assert.match(slugify("Rotating the signing key"), new RegExp(SLUG.pattern));
  // A title that is nothing but articles still has to produce something.
  assert.equal(slugify("the the"), "the-the");
  assert.equal(slugify("—— …"), "");
  // The bound is a token boundary, never mid-word.
  const long = slugify("alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima");
  assert.ok(long.length <= SLUG.maxLength, `slug is ${long.length} chars`);
  assert.match(long, new RegExp(SLUG.pattern));
});

test("kebab leaves only the declared alphabet", () => {
  for (const input of ["../../etc/passwd", "Octo-Cat", "a b  c", "Ünïcodé", "$HOME"]) {
    const out = kebab(input);
    if (out !== "") assert.match(out, new RegExp(SLUG.pattern), `kebab(${input}) = ${out}`);
  }
});

// ------------------------------------------------ one source, two readers

test("the server takes its section vocabulary from the declaration", () => {
  // Not a DRY assertion: the section list is half of what an entry means, and
  // a reader and a writer that each own a copy is how they come to disagree.
  assert.deepEqual(KNOWN_SECTIONS, SECTIONS);
  assert.deepEqual(SERVER_ABOUT, SECTION_ABOUT);
  for (const s of SECTIONS) assert.equal(typeof SECTION_ABOUT[s], "string");
});

test("the bookkeeping line formats name only variables the writer has", () => {
  const known = new Set(["title", "path", "summary", "date", "kind"]);
  for (const b of [BOOKKEEPING.index, BOOKKEEPING.log]) {
    for (const m of b.line.matchAll(/\{(\w+)\}/g)) {
      assert.ok(known.has(m[1]), `${b.file} line wants {${m[1]}}, which nothing supplies`);
    }
  }
  assert.equal(BOOKKEEPING.index.semantics, "catalog");
  assert.equal(BOOKKEEPING.log.semantics, "append-only");
});
