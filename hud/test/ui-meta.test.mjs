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
