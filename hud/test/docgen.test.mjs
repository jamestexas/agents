// The drift gate: the committed prose still matches the declaration.
//
// This is the test that makes "documented" mean something. Six files restated
// the content-tree contract and they had already drifted — docs/SOURCES.md
// described a `status` value as a fact about entries whose template never
// writes one. Generation alone does not fix that; a generator nobody runs is
// just a seventh copy. Running `check()` here is what turns `node --test
// hud/test/` into the thing that notices.
//
// It runs in-process rather than shelling out to `hud docgen --check`, so a
// failure shows the diff in the test output instead of an exit code.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REGIONS, check, render, renderHudMd } from "../hud-docgen.mjs";
import { KINDS, KIND_NAMES, SECTIONS, pathPattern } from "../hud-contract.mjs";

const MACHINERY = path.dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");

test("every committed doc still matches hud-contract.mjs", () => {
  const { checked, findings } = check();
  // "Nothing drifted" and "nothing was checked" are different claims, so the
  // count is asserted too — a generator that silently stopped covering a file
  // would otherwise pass forever.
  assert.ok(checked.length >= 4, `only ${checked.length} file(s) were checked`);
  assert.deepEqual(
    findings.map((f) => `${f.file}: ${f.reason}\n${f.diff}`),
    [],
    "run `hud docgen --write`, then read what changed",
  );
});

test("the check actually fails when a doc drifts", () => {
  // Otherwise the gate above is a test that only ever passes. Edit inside a
  // marked region in a throwaway copy of the tree and confirm it is caught.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hud-docgen-"));
  try {
    for (const rel of ["docs", "skills/hud", "templates"]) {
      fs.mkdirSync(path.join(dir, rel), { recursive: true });
    }
    for (const rel of ["docs/CLI.md", "docs/SOURCES.md", "skills/hud/SKILL.md", "templates/HUD.md"]) {
      fs.copyFileSync(path.join(MACHINERY, rel), path.join(dir, rel));
    }
    assert.deepEqual(check(dir).findings, [], "the copy should start clean");

    const target = path.join(dir, "docs/CLI.md");
    const text = fs.readFileSync(target, "utf8");
    fs.writeFileSync(target, text.replace("| `peer` |", "| `pier` |"));

    const { findings } = check(dir);
    assert.equal(findings.length, 1, "a doctored table was not caught");
    assert.equal(findings[0].file, "docs/CLI.md");
    assert.equal(findings[0].reason, "drifted");
    assert.match(findings[0].diff, /pier/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing generated file is reported, not skipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hud-docgen-gone-"));
  try {
    const { findings } = check(dir);
    assert.ok(findings.length >= 1);
    assert.ok(findings.every((f) => f.reason === "missing"));
    assert.ok(findings.some((f) => f.file === "templates/HUD.md"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every region renders from the declaration alone", () => {
  // No file reads, no environment: a region has to be a pure function of the
  // declaration, or `--write` and `--check` can disagree about what a file
  // should contain.
  for (const name of Object.keys(REGIONS)) {
    const once = render(name);
    assert.equal(typeof once, "string");
    assert.ok(once.trim().length > 0, `${name} rendered nothing`);
    assert.equal(render(name), once, `${name} is not deterministic`);
  }
});

test("a marker naming a region that does not exist is an error, not a silent skip", () => {
  assert.throws(() => render("no-such-region"), /no renderer for region/);
});

test("the generated HUD.md states every kind and every section", () => {
  // This is the copy that SHIPS — `hud init` writes it into every tree — so a
  // kind missing from it is a kind a future agent will not know exists.
  const text = renderHudMd();
  for (const kind of KIND_NAMES) {
    assert.ok(text.includes(`\`${kind}\``), `HUD.md never mentions kind ${kind}`);
    assert.ok(text.includes(pathPattern(kind)), `HUD.md never gives ${kind} a destination`);
  }
  for (const section of SECTIONS) assert.ok(text.includes(`\`${section}\``), `no ${section}`);
  for (const kind of KIND_NAMES) {
    for (const key of KINDS[kind].settable) {
      assert.ok(text.includes(`\`${key}\``), `HUD.md never mentions the ${key} key`);
    }
  }
});

test("the shipped HUD.md template is what the generator would write", () => {
  // `hud init` cats this file rather than holding a heredoc, so this is the
  // assertion that the scaffolded tree and the declaration cannot diverge.
  const shipped = fs.readFileSync(path.join(MACHINERY, "templates/HUD.md"), "utf8");
  assert.equal(shipped, `${renderHudMd().replace(/\n+$/, "")}\n`);
});

test("no generated table ships an empty flow collection", () => {
  // The templates used to carry `tags: []`, contradicting the prose directly
  // above them. Regenerating from the declaration must not reintroduce it.
  for (const name of Object.keys(REGIONS)) {
    assert.doesNotMatch(render(name), /^\s*\w+: \[\]\s*$/m, `${name} emits an empty collection`);
  }
  assert.doesNotMatch(renderHudMd(), /^\s*\w+: \[\]\s*$/m);
});
