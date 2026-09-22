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
  assert.match(html, /foldNode\(\[gh\],\s*entriesNode\(rows, showStore\)\)/,
    "groups are not built through foldNode");
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
