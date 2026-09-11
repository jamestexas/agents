// Hermetic tests for the entry viewer's mermaid handling.
//
// The two functions under test live inline in ui/index.html — a browser-only
// file with no module exports — so their source is extracted by name and
// evaluated with `Function`, the same trick ui-meta.test.mjs uses for
// parseEntryMeta and routes.test.mjs uses for the shared route block.
//
// mermaid itself is never loaded here. What these cases pin down is the part
// that is ours: the fence-to-container translation, and what the viewer does
// when a render succeeds, fails, or cannot happen at all. All three are stated
// in terms of a `render` that resolves or rejects, so a stub is not a dodge —
// it is the whole interface. That the real mermaid draws an SVG through this
// path is a browser fact, checked live rather than here.
//
// No fixture below carries a real person, company, or project name.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const UI_DIR = path.join(import.meta.dirname, "..", "ui");
const html = fs.readFileSync(path.join(UI_DIR, "index.html"), "utf8");

/**
 * Extract a function's source from its declaration to its end marker. Same
 * shape as ui-meta.test.mjs, with one addition: the slice starts at `async`
 * when the declaration carries it, since dropping that keyword turns an
 * `await` in the body into a syntax error rather than a test failure.
 */
function extractFunction(source, name) {
  const startMarker = `function ${name}(`;
  const endMarker = `// ${name}:end`;
  let start = source.indexOf(startMarker);
  assert.ok(start !== -1, `${startMarker} not found in ui/index.html`);
  if (source.slice(start - 6, start) === "async ") start -= 6;
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `${endMarker} not found in ui/index.html`);
  return source.slice(start, end);
}

function liftFunction(name) {
  const src = extractFunction(html, name);
  // eslint-disable-next-line no-new-func
  return new Function(`${src}\nreturn ${name};`)();
}

const mermaidCodeToken = liftFunction("mermaidCodeToken");
const renderMermaidBlocks = liftFunction("renderMermaidBlocks");

// --- the smallest DOM the render pass actually touches -------------------

/**
 * One `.mermaid-block` as `mermaidCodeToken` builds it: a container holding a
 * code element, with the source reachable through `textContent` exactly as a
 * browser would un-escape it.
 */
function fakeBlock(source) {
  return {
    attrs: { "data-mermaid": "pending" },
    // A container whose innerHTML was never assigned still shows the code
    // block it was built with — that is what "degraded" means on screen.
    innerHTML: null,
    bound: [],
    querySelector: (sel) => (sel === "code" ? { textContent: source } : null),
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
  };
}

function fakeRoot(blocks) {
  return {
    querySelectorAll(sel) {
      return sel.includes("pending")
        ? blocks.filter((b) => b.attrs["data-mermaid"] === "pending")
        : blocks.slice();
    },
  };
}

/** A mermaid stand-in whose every render resolves with the given svg. */
function stubMermaid(svg) {
  const calls = [];
  return {
    calls,
    render(id, src) {
      calls.push({ id, src });
      return Promise.resolve({
        svg,
        bindFunctions: (element) => element.bound.push(id),
      });
    },
  };
}

test("harness sanity: extraction pulled real functions, not stubs", () => {
  // If this fails, every case below is exercising nothing.
  assert.equal(typeof mermaidCodeToken, "function");
  assert.equal(typeof renderMermaidBlocks, "function");
});

test("mermaid block renders as diagram container", async () => {
  const source = 'flowchart TD\n  A["a & b"] --> B';
  const out = mermaidCodeToken({ type: "code", lang: "mermaid", text: source });

  assert.match(out, /<div class="mermaid-block" data-mermaid="pending">/);
  assert.match(out, /<pre><code class="language-mermaid">/);
  // The source is html-escaped and carried in full: it is both what mermaid
  // parses and what the reader sees if mermaid never gets to it.
  assert.ok(out.includes("A[&quot;a &amp; b&quot;] --&gt; B"), `source not escaped in: ${out}`);
  assert.ok(!out.includes("-->"), "a raw arrow would close the surrounding markup");

  const block = fakeBlock(source);
  const mermaid = stubMermaid("<svg id='drawn'></svg>");
  await renderMermaidBlocks(fakeRoot([block]), mermaid);

  assert.equal(mermaid.calls.length, 1, "the pending block was handed to mermaid");
  assert.equal(mermaid.calls[0].src, source, "mermaid parses the source, not the escaped html");
  assert.ok(mermaid.calls[0].id, "render needs a dom id");
  assert.equal(block.innerHTML, "<svg id='drawn'></svg>", "the svg replaced the code block");
  assert.equal(block.attrs["data-mermaid"], "rendered");
  assert.deepEqual(block.bound, [mermaid.calls[0].id], "click directives were bound to the block");

  // A second pass finds nothing: `rendered` is no longer pending, so
  // reopening an entry cannot draw the same diagram twice.
  await renderMermaidBlocks(fakeRoot([block]), mermaid);
  assert.equal(mermaid.calls.length, 1);
});

test("invalid mermaid degrades to code block", async () => {
  const bad = "flowchart TD\n  this is not a diagram (((";
  const good = "flowchart TD\n  A --> B";

  // The container mermaid will reject already holds the code block, so the
  // degrade path is not a fallback that has to be built — it is what is
  // already on screen when the render does not happen.
  const rendered = mermaidCodeToken({ type: "code", lang: "mermaid", text: bad });
  assert.ok(rendered.includes("<code class=\"language-mermaid\">"), rendered);

  const badBlock = fakeBlock(bad);
  const goodBlock = fakeBlock(good);
  const mermaid = {
    calls: [],
    render(id, src) {
      this.calls.push(src);
      if (src === bad) return Promise.reject(new Error("Parse error on line 2"));
      return Promise.resolve({ svg: "<svg></svg>" });
    },
  };

  await renderMermaidBlocks(fakeRoot([badBlock, goodBlock]), mermaid);

  assert.equal(badBlock.innerHTML, null, "a rejected render leaves the code block standing");
  assert.equal(badBlock.attrs["data-mermaid"], "error");
  // One bad diagram costs that diagram and nothing else on the entry.
  assert.deepEqual(mermaid.calls, [bad, good], "the failure did not abort the pass");
  assert.equal(goodBlock.innerHTML, "<svg></svg>");
  assert.equal(goodBlock.attrs["data-mermaid"], "rendered");

  // mermaid missing entirely — the script failed to load, or an older cached
  // page — is the same degrade, not a thrown error mid-entry.
  const orphan = fakeBlock(good);
  await renderMermaidBlocks(fakeRoot([orphan]), undefined);
  await renderMermaidBlocks(fakeRoot([orphan]), {});
  assert.equal(orphan.innerHTML, null);
  assert.equal(orphan.attrs["data-mermaid"], "pending");

  // Neither is an empty fence: nothing to parse, nothing to report.
  const blank = fakeBlock("   \n  ");
  const unused = stubMermaid("<svg></svg>");
  await renderMermaidBlocks(fakeRoot([blank]), unused);
  assert.equal(unused.calls.length, 0);
  assert.equal(blank.attrs["data-mermaid"], "pending");
});

test("non-mermaid fences untouched", () => {
  // `false` is marked's "use your own renderer" — so escaping, the
  // `language-` class, and every other fence on the page are unaffected.
  for (const lang of ["", "js", "bash", "json", "mermaidjs", "not-mermaid", "md"]) {
    assert.equal(
      mermaidCodeToken({ type: "code", lang, text: "A --> B" }),
      false,
      `lang ${JSON.stringify(lang)} must fall through to the default renderer`,
    );
  }
  assert.equal(mermaidCodeToken({ type: "code", text: "x" }), false, "no info string");
  assert.equal(mermaidCodeToken(undefined), false, "no token");

  // What does match: the bare language, any case, and an info string that
  // carries more than the language.
  for (const lang of ["mermaid", "Mermaid", "MERMAID", " mermaid ", "mermaid title=x"]) {
    assert.match(
      String(mermaidCodeToken({ type: "code", lang, text: "A --> B" })),
      /class="mermaid-block"/,
      `lang ${JSON.stringify(lang)} is a mermaid fence`,
    );
  }
});

test("the mermaid renderer is vendored and click directives stay links", () => {
  // Same precedent as marked: downloaded once, committed, never fetched. The
  // zero-external-URL assertion in static.test.mjs is the other half of this.
  assert.match(html, /<script src="\/ui\/mermaid\.min\.js"><\/script>/);
  const vendored = path.join(UI_DIR, "mermaid.min.js");
  assert.ok(fs.existsSync(vendored), "ui/mermaid.min.js is not committed");
  const bundle = fs.readFileSync(vendored, "utf8");
  assert.ok(bundle.length > 500_000, "that is too small to be the mermaid bundle");
  assert.match(bundle, /globalThis\["mermaid"\]\s*=/, "the bundle must publish a mermaid global");
  // A bundle that reaches for a chunk at runtime would need the network.
  assert.ok(!/\bimport\(/.test(bundle), "the bundle must be self-contained, not code-split");

  // `strict` would drop the click directives the system map is built on;
  // `loose` would also let a diagram name a JS callback. `antiscript` is the
  // weakest setting that keeps clicks, and it sanitizes every href — so a
  // click can be a same-origin /n/ link and not much else.
  assert.match(html, /securityLevel:\s*"antiscript"/);
  assert.ok(!/securityLevel:\s*"loose"/.test(html), "loose would permit callback clicks");
  assert.match(html, /startOnLoad:\s*false/, "rendering is driven from openDoc");
  assert.match(html, /suppressErrorRendering:\s*true/, "a parse error must not draw over the code");
});
