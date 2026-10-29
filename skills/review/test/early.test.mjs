import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const early = path.join(here, '..', 'scripts', 'early-signal.mjs');
const state = path.join(here, '..', 'scripts', 'state.mjs');
const render = path.join(here, '..', 'scripts', 'render.mjs');

// The script writes into the run, so each test gets a copy of its fixture.
const copy = (name) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-early-')), 'run');
  fs.cpSync(path.join(here, 'fixtures', name), dir, { recursive: true });
  return dir;
};
const env = { ...process.env, HUD_ROOT: '/hud', PATH: '/nonexistent' };
const run = (dir) => spawnSync(process.execPath, [early, dir], { encoding: 'utf8', env });
const w = (dir, f) => fs.readFileSync(path.join(dir, 'work', f), 'utf8');

test('a RAN claim on a FAILED probe, or a [Blocking] tag with a RAN claim, surfaces; READ-only and Unresolved rows do not', () => {
  const dir = copy('early-probe-failed');
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(w(dir, 'early.json')), [
    { row: 1, title: 'build broken by new import', basis: 'probe-failed:go-graph/build' },
    { row: 3, title: 'signature verified after parse', basis: 'blocking-ran' },
  ]);
  // row 4 has only a READ claim and no tag; row 5 is tagged and cites the
  // failed probe but its ledger row is Unresolved, which gate 3 would demote
  assert.equal(w(dir, 'early.md'),
    '## Early signal — 2 unrefuted at phase 3\n\n' +
    '- row 1: build broken by new import — probe-failed:go-graph/build (unrefuted at phase 3)\n' +
    '- row 3: signature verified after parse — blocking-ran (unrefuted at phase 3)\n');
  assert.match(r.stdout, /^early: 2 \(row 1, 3\)$/m);
  // candidates.md is not the script's to change
  assert.equal(w(dir, 'candidates.md'), fs.readFileSync(path.join(here, 'fixtures', 'early-probe-failed', 'work', 'candidates.md'), 'utf8'));
});

test('without a state.json the files are still written and the script says the state was not updated', () => {
  const dir = copy('early-probe-failed');
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'state.json')));
  assert.match(r.stderr, /state\.json not updated/);
});

test('with a state.json from init, the list lands in state.early', () => {
  const dir = copy('early-probe-failed');
  assert.equal(spawnSync(process.execPath, [state, dir, 'init'], { encoding: 'utf8', env }).status, 0);
  assert.ok(!('early' in JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))), 'no early key before phase 3');
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.deepEqual(s.early, [
    { row: 1, title: 'build broken by new import', basis: 'probe-failed:go-graph/build' },
    { row: 3, title: 'signature verified after parse', basis: 'blocking-ran' },
  ]);
  assert.equal(s.phase, 'evidence', 'early does not move the phase');
});

test('nothing with hard evidence: an empty list, and the markdown says none', () => {
  const dir = copy('early-none');
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(w(dir, 'early.json')), []);
  assert.equal(w(dir, 'early.md'), '## Early signal — none at phase 3\n');
  assert.match(r.stdout, /^early: 0$/m);
});

test('render opens an "Early signal (unrefuted)" section after Confirmed findings only when the list is non-empty', () => {
  const some = copy('early-probe-failed');
  run(some);
  const out = path.join(some, 'artifact.md');
  const r = spawnSync('node', [render, some, '--title', 'PR 2 — build and ordering', '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(out, 'utf8');
  const i = (s) => { const k = md.indexOf(s); assert.notEqual(k, -1, `missing ${s}`); return k; };
  assert.ok(i('## Confirmed findings') < i('## Early signal (unrefuted)'));
  assert.ok(i('## Early signal (unrefuted)') < i('## Job-level impact'));
  assert.match(md, /^- row 1: build broken by new import — probe-failed:go-graph\/build \(unrefuted at phase 3\)$/m);
  assert.match(md, /^- row 3: signature verified after parse — blocking-ran \(unrefuted at phase 3\)$/m);
  assert.ok(i('## Early signal (unrefuted)') < i('<details>'), 'the section is open, not folded');

  const none = copy('early-none');
  run(none);
  const out2 = path.join(none, 'artifact.md');
  assert.equal(spawnSync('node', [render, none, '--out', out2], { encoding: 'utf8' }).status, 0);
  assert.doesNotMatch(fs.readFileSync(out2, 'utf8'), /Early signal/);

  // a run that never produced early.json (the good fixture) has no section either
  const out3 = path.join(none, 'good.md');
  assert.equal(spawnSync('node', [render, path.join(here, 'fixtures', 'good'), '--out', out3], { encoding: 'utf8' }).status, 0);
  assert.doesNotMatch(fs.readFileSync(out3, 'utf8'), /Early signal/);
});

test('missing candidates.md is an error naming the merge; missing run dir is a usage error', () => {
  const dir = copy('early-none');
  fs.rmSync(path.join(dir, 'work', 'candidates.md'));
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /candidates\.md missing; run merge-decisions first/);
  const u = spawnSync(process.execPath, [early], { encoding: 'utf8' });
  assert.equal(u.status, 2);
  assert.match(u.stderr, /usage: early-signal\.mjs/);
});
