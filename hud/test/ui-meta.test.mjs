// Hermetic tests for the entry viewer's frontmatter stripping.
//
// parseEntryMeta lives inline in ui/index.html (a browser-only file with no
// module exports), so these tests extract its source by name and evaluate it
// in isolation via `Function`, the same trick routes.test.mjs uses for the
// route-rule block it shares with server.mjs. No fixture here carries a real
// person, company, or project name.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(
  path.join(import.meta.dirname, "..", "ui", "index.html"),
  "utf8",
);

/** Extract a function's source from `function <name>` to its end marker. */
function extractFunction(source, name) {
  const startMarker = `function ${name}(`;
  const endMarker = `// ${name}:end`;
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `${startMarker} not found in ui/index.html`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `${endMarker} not found in ui/index.html`);
  return source.slice(start, end);
}

const parseEntryMetaSrc = extractFunction(html, "parseEntryMeta");
// eslint-disable-next-line no-new-func
const parseEntryMeta = new Function(`${parseEntryMetaSrc}\nreturn parseEntryMeta;`)();

test("harness sanity: extraction pulled a real function, not a stub", () => {
  // If this fails, every case below is exercising nothing.
  assert.equal(typeof parseEntryMeta, "function");
});

test("strips normal frontmatter", () => {
  const md = [
    "---",
    "title: Example Note",
    "type: playbook",
    "status: active",
    "date: 2026-03-01",
    "tags: [foo, bar]",
    "---",
    "# Example Note",
    "",
    "Body text here.",
    "",
  ].join("\n");

  const { meta, body } = parseEntryMeta(md);
  assert.deepEqual(meta, {
    title: "Example Note",
    type: "playbook",
    status: "active",
    date: "2026-03-01",
    tags: ["foo", "bar"],
  });
  assert.equal(body, "# Example Note\n\nBody text here.\n");
  assert.ok(!body.includes("---"), "the fence itself is gone from the body");
});

test("no frontmatter unchanged", () => {
  const md = "# Just a note\n\nNo frontmatter at all, plain prose with a colon: like this.\n";
  const { meta, body } = parseEntryMeta(md);
  assert.equal(meta, null);
  assert.equal(body, md);
});

test("unclosed block not stripped", () => {
  const md = [
    "---",
    "title: Broken",
    "there is no closing fence below this line",
    "",
    "more prose that looks like it could be body",
    "",
  ].join("\n");

  const { meta, body } = parseEntryMeta(md);
  assert.equal(meta, null, "an unterminated block must not be treated as frontmatter");
  assert.equal(body, md, "body is the entire original text, fence line included");
});

test("keys parsed", () => {
  const md = [
    "---",
    'title: "Quoted Title"',
    "type: note",
    "tickets:",
    "  - ABC-123",
    "  - DEF-456",
    "repos: ['one', \"two\"]",
    "---",
    "Body.",
    "",
  ].join("\n");

  const { meta, body } = parseEntryMeta(md);
  assert.deepEqual(meta, {
    title: "Quoted Title",
    type: "note",
    tickets: ["ABC-123", "DEF-456"],
    repos: ["one", "two"],
  });
  assert.equal(body, "Body.\n");
});

test("leading hr not eaten", () => {
  // Opens and closes with a "---" line, same as real frontmatter, but no
  // line between the fences parses as `key: value` — a document that
  // legitimately starts with a markdown horizontal rule must not be eaten.
  const md = [
    "---",
    "This is ordinary prose sitting right after a horizontal rule.",
    "It does not look like frontmatter, no colons-as-keys here.",
    "---",
    "",
    "More content below the second rule.",
    "",
  ].join("\n");

  const { meta, body } = parseEntryMeta(md);
  assert.equal(meta, null, "no key: value line inside means this was never frontmatter");
  assert.equal(body, md, "the whole document, both rules included, is returned unchanged");
});

// --------------------------------------------------- store provenance wiring

// `entryNode` badges a mounted entry only when `renderTree` tells it to, and
// that flag is threaded through `entriesNode` to four call sites. There is no
// DOM here to render against — the UI is dependency-free and there is no jsdom
// — so this asserts the wiring at the source level instead.
//
// It is not decoration: writing this caught a real miss. The `loose` branch
// (ungrouped entries inside `projects`) was calling `entriesNode(loose)` with
// no flag, so those entries would never have shown provenance while every
// other branch did. A source check is the only thing that would have found it.

test("every entriesNode call site forwards the store flag", () => {
  const calls = [...html.matchAll(/entriesNode\(([^;]*?)\)\s*\)?\s*;/g)].map((m) => m[0]);
  assert.ok(calls.length >= 3, `expected the known call sites, found ${calls.length}`);
  for (const call of calls) {
    assert.match(
      call,
      /,\s*showStore\s*\)/,
      `an entriesNode call omits showStore, so those entries can never badge: ${call.trim()}`,
    );
  }
});

test("the shadowed notice reads from tree.shadowed and tolerates its absence", () => {
  // An older server, or a hand-written fixture, may not carry the key at all.
  // Rendering must degrade to "no notice" rather than throwing on .length.
  assert.match(html, /Array\.isArray\(tree\.shadowed\)/,
    "the shadowed notice does not guard against a missing key");
  assert.match(html, /shadowed_by/, "the notice never names what shadowed a note");
});

test("provenance is conditional, so a single-store tree renders as before", () => {
  // The badge must be gated on more than one contributing store. Dropping the
  // gate would put a chip on every entry of every existing single-store HUD.
  assert.match(html, /contributing\.size > 1/, "provenance is not gated on multiple stores");
  assert.match(html, /e\.store !== "local"/, "the writable store is badged, which is noise");
});

// ------------------------------------------------------ collapsible groups

// Project groups render as native <details>. Same constraint as the store
// badge: no DOM to assert against, so these check the wiring at the source.

test("every project group is wrapped in a fold, not appended bare", () => {
  // The bare-heading append this replaced is the regression to guard: it would
  // render identically to the reader while silently losing the disclosure.
  assert.doesNotMatch(
    html,
    /listView\.appendChild\(gh\)/,
    "a group heading is appended directly, so that group cannot collapse",
  );
  // Asserts the property — the heading goes into a fold — not the exact body
  // expression. The first version of this test pinned
  // `foldNode([gh], entriesNode(rows, showStore))` and broke the moment the
  // body gained a tail fold, which is a test coupled to an implementation
  // rather than to the behaviour it claims to protect.
  assert.match(html, /foldNode\(\[gh\],/, "groups are not built through foldNode");
});

test("the default open state is derived from status, not hardcoded", () => {
  // `fold.open = true` for everything would bury a finished project's entries
  // under the live ones, which is the whole reason the fold exists.
  assert.match(html, /\(g\.status \|\| "active"\) === "active"/,
    "the default is not derived from group status");
});

test("fold state is persisted, and storage failure falls back to the default", () => {
  assert.match(html, /localStorage\.getItem\(key\)/, "fold state is never read back");
  assert.match(html, /localStorage\.setItem\(key/, "fold state is never written");
  // A browser with storage disabled must still render. Both accessors are
  // wrapped, and the read returns null so the status default applies.
  const reader = html.slice(html.indexOf("function foldState("), html.indexOf("function setFoldState("));
  assert.match(reader, /try \{/, "foldState does not guard against storage throwing");
  assert.match(reader, /return null/, "foldState has no null fallback for the caller's default");
  const writer = html.slice(html.indexOf("function setFoldState("));
  assert.match(writer.slice(0, 400), /try \{/, "setFoldState does not guard against storage throwing");
});

test("the fold key namespaces section and group, so names cannot collide", () => {
  // `projects/hud` and a future `playbooks/hud` are different folds.
  assert.match(html, /"hud\.fold\." \+ section\.name \+ "\/" \+ g\.name/,
    "the fold key does not include both section and group");
});

test("the group heading renders the date the server sorted on", () => {
  // Half of "the order looks arbitrary" was that the order was invisible, not
  // that it was wrong. Showing the key is what makes the sequence explicable
  // without reading server.mjs.
  assert.match(html, /node\("span", "gdate", g\.date\)/, "the group heading omits its warmth date");
  assert.match(html, /h3\.group \.gdate \{/, "the gdate chip has no styling of its own");
});

test("a group's tail is separated from what can still need the reader", () => {
  // `done`/`parked` notes and never-parsed `raw/` files are provenance. Left
  // inline they made the largest group 19 rows to find 6.
  assert.match(html, /function isTail\(e\)/, "no tail predicate exists");
  assert.match(html, /e\.listed === true \|\| \(e\.status && e\.status !== "active"\)/,
    "the tail predicate does not cover both finished and unparsed entries");
  assert.match(html, /rows\.filter\(\(e\) => !isTail\(e\)\)/, "live entries are not filtered out of the tail");
  assert.match(html, /rows\.filter\(isTail\)/, "the tail is never collected");
});

test("the tail fold is closed by default and remembered apart from its group", () => {
  // Expanding a project is a different intent from digging through its
  // finished work, so one choice must not imply the other.
  const fn = html.slice(html.indexOf("function tailFold("), html.indexOf("function renderTree("));
  assert.match(fn, /"hud\.tail\." \+ sectionName \+ "\/" \+ groupName/,
    "the tail fold does not have its own namespaced key");
  assert.match(fn, /saved === null \? false : saved/, "the tail fold does not default closed");
  // A shut fold still has to say what it is hiding.
  assert.match(fn, /n \+ " " \+ k/, "the tail summary does not report its composition");
});

test("the raw/file chip is gone, since .meta already shows a size", () => {
  // Half the collision the owner reported: `raw` and `done` were pixel-
  // identical chips. The size in .meta is the same signal, unduplicated.
  assert.doesNotMatch(html, /e\.raw \? "raw" : "file"/, "the redundant raw/file chip is back");
  assert.match(html, /e\.listed \? fmtSize\(e\.size\) : e\.date/,
    "the size fallback that replaces the chip is missing");
});

// ------------------------------------------------------------------ the dial

// The dial is the one element whose entire job is the stated goal — "what
// needs me". It used to encode freshness in colour and the count in text, so
// `needs-you: 0` and `needs-you: 7` rendered in the same green: the page's
// only green, which reads all-clear. Every other defect in this UI costs the
// reader scan time; this one could tell them the wrong thing.

test("dial colour is driven by the count, not by staleness", () => {
  const fn = html.slice(html.indexOf("function setDial("), html.indexOf("function setDial(") + 1600);
  assert.match(fn, /data-count", n > 0 \? "some" : "none"/,
    "the dial does not set its state from the count");
  assert.doesNotMatch(fn, /data-state", env\.stale/,
    "staleness is still driving the dial's colour attribute");
  assert.match(fn, /classList\.toggle\("stale", Boolean\(env\.stale\)\)/,
    "staleness is not expressed as a composable class");
});

test("the three dial answers are visually distinct, and unknown is quietest", () => {
  // "some", "none" and "I don't know" must not pair up. The first version of
  // this fix left the glow on the base rule, which made the unknown state and
  // the needs-you state render identically — trading one collision for another.
  const rule = (sel) => {
    const i = html.indexOf(sel);
    assert.ok(i > 0, `no rule for ${sel}`);
    return html.slice(i, html.indexOf("}", i));
  };
  assert.match(rule(".dial {"), /color: var\(--muted\)/, "the unknown state is not the quiet one");
  assert.doesNotMatch(rule(".dial {"), /text-shadow/, "the unknown state still glows");
  assert.match(rule('.dial[data-count="none"]'), /var\(--green\)/);
  assert.match(rule('.dial[data-count="some"]'), /var\(--accent\)/);
  assert.match(rule('.dial[data-count="some"]'), /text-shadow/, "needs-you does not carry the emphasis");
});

test("staleness composes with any count rather than replacing it", () => {
  // A stale zero must not read as a confident zero, so the treatment layers on
  // top of the colour instead of overwriting it — the same idiom .panel.stale
  // already uses, so the page has one way of saying "not now".
  const stale = html.slice(html.indexOf(".dial.stale"), html.indexOf("}", html.indexOf(".dial.stale")));
  assert.doesNotMatch(stale, /color:/, "the stale treatment overwrites the count colour");
  assert.match(stale, /dashed/, "the stale treatment does not use the page's existing non-colour idiom");
  // And an unavailable board clears the count rather than implying zero.
  const unavailable = html.slice(html.indexOf("work-board unavailable") - 400, html.indexOf("work-board unavailable"));
  assert.match(unavailable, /removeAttribute\("data-count"\)/, "an unavailable board leaves a stale count attribute");
});

// -------------------------------------------------------------- section folds

test("sections are folds, and every body append targets the section body", () => {
  // The regression to guard is subtle: leave one append pointing at listView
  // and that part of the section renders outside its own fold, so collapsing
  // the section leaves an orphan behind.
  assert.match(html, /foldNode\(\[h\], sbody\)/, "sections are not built through foldNode");
  const loop = html.slice(
    html.indexOf('const sbody = document.createElement("div")'),
    html.indexOf("// The last tree fetched"),
  );
  const strays = [...loop.matchAll(/listView\.appendChild\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(strays, ["sfold"],
    `only the section fold itself may attach to the column; found: ${strays.join(", ")}`);
});

test("archive and empty sections default shut; the rest open", () => {
  // archive is the one section that can never need the reader, and an empty
  // section has nothing to reveal — its count already says so in the summary.
  assert.match(
    html,
    /section\.entries\.length === 0 \|\| section\.name === "archive"/,
    "the shut-by-default rule does not cover both empty sections and archive",
  );
  assert.match(html, /sfold\.open = ssaved === null \? !shut : ssaved/,
    "a remembered choice does not override the default");
});

test("section fold state is namespaced apart from groups and tails", () => {
  // Three fold levels share one storage namespace; a section called the same
  // thing as a group must not inherit its state.
  for (const prefix of ['"hud.section." + section.name', '"hud.fold." + section.name', '"hud.tail." + sectionName']) {
    assert.ok(html.includes(prefix), `missing distinct key prefix: ${prefix}`);
  }
});

test("the section heading's block margin moves to the wrapper", () => {
  // Inside a <summary> the h2's own margin pushes the caret out of line, and
  // `:first-child` can no longer match it because the column's first child is
  // now the <details>.
  assert.match(html, /details\.section-fold > summary h2\.section \{\s*margin: 0;/,
    "the heading keeps its block margin inside the summary");
  assert.match(html, /details\.section-fold:first-child \{/,
    "the first-child spacing was not moved to the wrapper");
});

// --------------------------------------------------------------- annotation

// "No data is missable or unannotated." Every element that carries a fact
// should say what the fact is; containers and the decorative caret need not.

test("the section sentence is visible, not hover-only", () => {
  // Hover alone leaves it undiscoverable — a reader has to suspect there is
  // something to hover before they hover. So it is both.
  assert.match(html, /node\("div", "about", section\.about\)/, "the section sentence is never rendered as text");
  assert.match(html, /h\.title = section\.about/, "the section heading carries no tooltip");
  assert.match(html, /\.about \{/, "the section sentence has no styling of its own");
});

test("every data-bearing element in an entry row is annotated", () => {
  const fn = html.slice(html.indexOf("function entryNode("), html.indexOf("function entriesNode("));
  // store, warn, status, meta, and the row's own path.
  const titles = (fn.match(/\.title\s*=/g) || []).length;
  assert.ok(titles >= 5, `only ${titles} annotated elements in entryNode; expected every fact to carry one`);
  // Matches the property, not the expression: the previous version pinned
  // `b.title = e.path` and broke when the brief gained a prefix.
  assert.match(fn, /b\.title =[\s\S]{0,140}e\.path/, "the row does not say what it opens");
  // Three assertions, because each catches a different break. Both branch
  // texts must exist, AND the condition must be a bare ternary on `e.listed`:
  // asserting only `meta.title = e.listed` still matched a mutation to
  // `e.listed && false`, which collapsed both meanings into one while leaving
  // both strings in the file.
  //
  // The honest limit of source-level testing: this pins the shape, not the
  // evaluation. A condition that is a ternary on `e.listed` but semantically
  // wrong would pass. Closing that needs a DOM, and the UI has no jsdom by
  // design.
  assert.match(fn, /meta\.title = e\.listed\s*\n?\s*\?/,
    "the meta title is no longer a direct ternary on e.listed");
  assert.match(fn, /never parsed, so there is no date to show/, "the meta slot does not explain a size");
  assert.match(fn, /its filename prefix, or its mtime/, "the meta slot does not explain a date");
});

test("the status chip says which of its two meanings applies", () => {
  // The field means project lifecycle on a brief and "about finished work" on
  // a note — and the note template does not define it at all. A single tooltip
  // for both would restate the collision instead of explaining it.
  const fn = html.slice(html.indexOf("function entryNode("), html.indexOf("function entriesNode("));
  assert.match(fn, /e\.type === "context"/, "the status tooltip does not branch on entry type");
  assert.match(fn, /notes have no status by default/, "the tooltip does not admit notes have no status");
});

test("counts, group headings and the tail line are annotated", () => {
  assert.match(html, /count\.title =/, "the section count is bare");
  assert.match(html, /gcount\.title =/, "the group count is bare");
  assert.match(html, /gh\.title =/, "the group heading is bare");
  assert.match(html, /summary\.title =/, "the tail summary is bare");
  assert.match(html, /e\.title = "nothing filed here yet/, "the empty state is bare");
});

test("the project brief carries weight the notes under it do not", () => {
  // It is the entry a reader wants first on a cold project, and it looked
  // identical to its notes — distinguished only by sorting first, which is
  // invisible. Emphasis, not another chip: the direction here was fewer chips.
  assert.match(html, /if \(e\.type === "context"\) title\.classList\.add\("brief"\)/,
    "the brief gets no distinguishing class");
  const rule = html.slice(html.indexOf(".entry .title.brief"), html.indexOf("}", html.indexOf(".entry .title.brief")));
  assert.match(rule, /var\(--fg\)/, "the brief does not take the foreground colour");
  assert.match(rule, /font-weight: 600/, "the brief is not weighted");
  assert.doesNotMatch(html, /"badge brief"|brief.*badge/, "the brief was given a chip instead of weight");
});

test("a chip that links looks different from one that does not", () => {
  // `.badge` is 0-1-0 and `a` is 0-0-1, so a linked ticket chip rendered in the
  // same muted grey as an inert one — the single place in this design where an
  // affordance was invisible.
  const i = html.indexOf("a.badge {");
  assert.ok(i > 0, "no a.badge rule: linked chips still inherit .badge's muted colour");
  const rule = html.slice(i, html.indexOf("}", i));
  assert.match(rule, /var\(--accent\)/, "a linked chip does not take the link colour");
  assert.match(rule, /border-color: currentColor/, "a linked chip's border still reads as inert");
  // No order assertion: `a.badge` is 0-1-1 and `.badge` is 0-1-0, so it wins
  // on specificity wherever it sits. (The first version of this test asserted
  // it had to come later in the sheet, which was wrong — cascade order only
  // decides ties, and this is not one.) What matters is that the selector is
  // more specific than the rule it is overriding:
  assert.ok(
    html.includes("a.badge {") && html.includes("      .badge {"),
    "both rules must exist for the override to mean anything",
  );
});
