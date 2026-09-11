// Hermetic tests for the TOML-subset parser and the config loader.
//
// Every case builds its own tmp HUD_ROOT and writes the config files into it,
// so nothing here reads the real tree or the real `hud.toml`. Fixtures use
// loopback endpoints and generic placeholders — no real person, company, or
// project name appears in this tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CONFIG_JSON,
  CONFIG_TOML,
  createServer,
  loadConfig,
  loadConfigDetail,
  parseToml,
} from "../server.mjs";

/** Build a tmp HUD_ROOT from {relative path: contents}. */
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-config-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("toml sections and scalars parse", () => {
  const { data, warns } = parseToml(
    [
      "peer_pr_lookback_days = 7",
      'ticket_url_template = "https://example.invalid/issue/{id}"',
      "",
      "[sources.board]",
      'url = "http://127.0.0.1:8787/api/board"',
      "",
      "[sources.sessions]",
      'root = "~/.claude"',
      'lectio = "http://127.0.0.1:7533"',
      "",
      "[sources]",
      "loadout = false",
      "",
      "[serve]",
      'host = "127.0.0.1"',
      "port = 4870",
      'label = "local.hud"',
      'hostname = "hud.internal"',
      "retries = -2",
      "verbose = true",
    ].join("\n"),
  );

  assert.deepEqual(warns, []);
  assert.deepEqual(data, {
    peer_pr_lookback_days: 7,
    ticket_url_template: "https://example.invalid/issue/{id}",
    sources: {
      board: { url: "http://127.0.0.1:8787/api/board" },
      sessions: { root: "~/.claude", lectio: "http://127.0.0.1:7533" },
      loadout: false,
    },
    serve: {
      host: "127.0.0.1",
      port: 4870,
      label: "local.hud",
      hostname: "hud.internal",
      retries: -2,
      verbose: true,
    },
  });
  // The scalars are typed, not stringly: install.sh compares the port
  // numerically and the loadout switch is checked against `false`.
  assert.equal(typeof data.serve.port, "number");
  assert.equal(data.sources.loadout, false);
  // Re-entering an existing table adds to it rather than replacing it.
  assert.equal(data.sources.board.url, "http://127.0.0.1:8787/api/board");
});

test("comments and blank lines ignored", () => {
  const { data, warns } = parseToml(
    [
      "# a whole-line comment",
      "   # an indented one",
      "",
      "   ",
      "[serve]   # trailing after a header",
      "port = 4870 # trailing after an integer",
      'label = "local.hud"  # trailing after a string',
      "",
      "# a URL with a fragment: the # is inside the quotes, not a comment",
      'url = "http://127.0.0.1:8787/api/board#frag"',
      "",
      "  host   =   '127.0.0.1'  ",
    ].join("\n"),
  );

  assert.deepEqual(warns, []);
  assert.deepEqual(data, {
    serve: {
      port: 4870,
      label: "local.hud",
      url: "http://127.0.0.1:8787/api/board#frag",
      host: "127.0.0.1",
    },
  });
});

test("malformed line skipped with warning not crash", () => {
  const src = [
    'ticket_url_template = "https://example.invalid/issue/{id}"',
    "this line is not config at all",
    'unterminated = "no closing quote',
    "dotted.key = 1",
    "arrays = [1, 2]",
    "inline = { a = 1 }",
    "float = 1.5",
    "empty =",
    "[[array.of.tables]]",
    "[]",
    "orphan = 2",
    "[serve]",
    "port = 4870",
  ].join("\n");

  const { data, warns } = parseToml(src);

  // Every good line around the damage survives; that is the whole point.
  assert.equal(data.ticket_url_template, "https://example.invalid/issue/{id}");
  assert.deepEqual(data.serve, { port: 4870 });
  // Nothing the parser refused leaked in under any name.
  assert.deepEqual(Object.keys(data), ["ticket_url_template", "serve"]);
  // `orphan` followed an unusable header, so it must not have fallen into the
  // table that happened to precede it.
  assert.equal(data.dotted, undefined);
  assert.equal(data.orphan, undefined);
  assert.equal(data.array, undefined);

  assert.equal(warns.length, 9, warns.join("; "));
  for (const warn of warns) assert.match(warn, /^line \d+: /);
  assert.ok(
    warns.some((w) => w.includes("unterminated")),
    "the warning names the key it dropped",
  );

  // The pathological inputs are answers, not exceptions.
  for (const bad of ["", "﻿[serve]\nport = 1", "=", "[", "[a.]", '"' , "\n\n\n"]) {
    assert.doesNotThrow(() => parseToml(bad));
  }
  assert.deepEqual(parseToml("").data, {});
  // A BOM does not make the first header unreadable.
  assert.deepEqual(parseToml("﻿[serve]\nport = 1").data, { serve: { port: 1 } });
});

test("json fallback used when toml absent", (t) => {
  const json = { sources: { board: { url: "http://127.0.0.1:8787/api/board" } }, serve: { port: 4900 } };
  const root = fixture(t, { [CONFIG_JSON]: JSON.stringify(json, null, 2) });

  const detail = loadConfigDetail(root);
  assert.equal(detail.file, CONFIG_JSON, "a tree copied before the migration still works");
  assert.deepEqual(detail.data, json);
  assert.deepEqual(loadConfig(root), json);

  // No config at all is an empty config, never a throw: the static layer must
  // not depend on this file existing.
  assert.deepEqual(loadConfigDetail(fixture(t, {})), { data: {}, warns: [], file: null });

  // Nor does unparseable JSON take the HUD down.
  const broken = loadConfigDetail(fixture(t, { [CONFIG_JSON]: "{ not json" }));
  assert.deepEqual(broken.data, {});
  assert.equal(broken.warns.length, 1, "the startup log says which file it could not read");
});

test("toml wins when both exist", async (t) => {
  const root = fixture(t, {
    [CONFIG_TOML]: ['ticket_url_template = "https://example.invalid/t/{id}"', "[serve]", "port = 4870"].join("\n"),
    [CONFIG_JSON]: JSON.stringify({
      ticket_url_template: "https://example.org/stale/{id}",
      serve: { port: 9999 },
      sources: { board: { url: "http://127.0.0.1:1/api/board" } },
    }),
  });

  const detail = loadConfigDetail(root);
  assert.equal(detail.file, CONFIG_TOML);
  assert.equal(detail.data.ticket_url_template, "https://example.invalid/t/{id}");
  assert.equal(detail.data.serve.port, 4870);
  // Not merged: the JSON is a fallback, so a key only it carries stays unread.
  // Otherwise deleting a source from hud.toml would not switch its panel off.
  assert.equal(detail.data.sources, undefined);

  // A present-but-empty hud.toml still wins. "I emptied the config" is an
  // answer; falling back to the old file would override it.
  fs.writeFileSync(path.join(root, CONFIG_TOML), "# everything commented out\n");
  assert.deepEqual(loadConfig(root), {});

  // And the served config follows the same file the routes do.
  const server = createServer({ root, uiDir: path.join(import.meta.dirname, "..", "ui") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  fs.writeFileSync(
    path.join(root, CONFIG_TOML),
    'ticket_url_template = "https://example.invalid/t/{id}"\n',
  );
  const res = await fetch(`${base}/api/config`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await res.json(), { ticket_url_template: "https://example.invalid/t/{id}" });

  // Read-only, like every other GET route here.
  assert.equal((await fetch(`${base}/api/config`, { method: "POST" })).status, 405);
});
