import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { parseLocations, parsePatch, overlap, parseAreas } from '../scripts/focus-map.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'scripts', 'focus-map.mjs');
const fixture = path.join(here, 'fixtures', 'focus');
const known = { files: ['svc/provision.go', 'svc/ces.go', 'other/ces.go'], full: new Set(['svc/ces.go']) };

test('locations: a path with lines, a bare name resolved against changed files, and continuations', () => {
  const locs = parseLocations('worktree `svc/provision.go:45-50`; provision.go:80, :85-86 and line 90; ces.go lines 10–12', known);
  assert.deepEqual(locs, [
    { file: 'svc/provision.go', ranges: [[45, 50]] },
    { file: 'svc/provision.go', ranges: [[80, 80], [85, 86]] },
    { file: 'svc/provision.go', ranges: [[90, 90]] },
    // two changed files are named ces.go; the one named in full elsewhere wins
    { file: 'svc/ces.go', ranges: [[10, 12]] },
  ]);
});

test('locations: evidence files are not code, and end a run of continuations', () => {
  assert.deepEqual(parseLocations('`git/diff.patch` :12 `probes/go-graph/build.out` manifest.json', known), []);
});

test('locations: "hunk N" resolves through the named patch, a hunk header through the last path', () => {
  const patches = { diff: parsePatch(fs.readFileSync(path.join(fixture, 'raw/evidence/git/diff.patch'), 'utf8')), 'own-slice': [{ file: 'svc/ces.go', start: 1, end: 9 }] };
  const k = { ...known, patches };
  assert.deepEqual(parseLocations('`git/diff.patch` hunks 1 and 2', k), [
    { file: 'svc/provision.go', ranges: [[40, 44]] },
    { file: 'svc/provision.go', ranges: [[82, 87]] },
  ]);
  assert.deepEqual(parseLocations('`git/own-slice.patch` hunk 1', k), [{ file: 'svc/ces.go', ranges: [[1, 9]] }]);
  assert.deepEqual(parseLocations('svc/ces.go hunk `@@ -335,3 +343,10 @@`', k), [{ file: 'svc/ces.go', ranges: [[343, 352]] }]);
});

test('overlap: lines within slack are strong; a file-level or very wide range is weak', () => {
  const area = [{ file: 'a.go', ranges: [[40, 60]] }];
  assert.equal(overlap([{ file: 'a.go', ranges: [[61, 62]] }], area), 'strong');
  assert.equal(overlap([{ file: 'a.go', ranges: [[70, 72]] }], area), 'weak');
  assert.equal(overlap([{ file: 'a.go', ranges: null }], area), 'weak');
  assert.equal(overlap([{ file: 'a.go', ranges: [[1, 300]] }], area), 'weak');
  assert.equal(overlap([{ file: 'b.go', ranges: [[40, 60]] }], area), null);
});

test('areas: the table under "## Areas" is read; weight is load-bearing or plumbing', () => {
  const areas = parseAreas(fs.readFileSync(path.join(fixture, 'explain.md'), 'utf8'));
  assert.equal(areas.length, 5);
  assert.deepEqual(areas.map((a) => a.weight), ['load-bearing', 'load-bearing', 'load-bearing', 'plumbing', 'plumbing']);
  assert.equal(areas[0].flagged, true);
  assert.equal(parseAreas('# no table here'), null);
});

test('end to end: the grid, the look-here list and the unmapped items', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-focus-')), 'focus.md');
  const r = spawnSync('node', [script, fixture, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /5 areas, 5 review items, 1 load-bearing x open/);
  const md = fs.readFileSync(out, 'utf8');
  const row = (name) => md.split('\n').find((l) => l.startsWith(`| **${name}**`)).split(' | ');
  const [, lbHeld, lbOpen, lbFell] = row('load-bearing');
  // the finding replaces ledger row 1; row 2 settled the sweep through hunk 2
  assert.match(lbFell, /\*\*F1\*\* \[Non-blocking\] Retain misses.*→ A1/);
  assert.doesNotMatch(md, /\*\*r1\*\*/);
  assert.match(lbHeld, /\*\*r2\*\*.*→ A2/);
  assert.match(lbOpen, /A3 Request builders: \*not examined by review\*/);
  const [, plHeld] = row('plumbing / tests');
  assert.match(plHeld, /\*\*r4\*\*.*→ A4/);
  const look = md.split('## Look here first')[1].split('\n## ')[0];
  assert.match(look, /1\. \*\*F1\*\*.*explain-work flagged this area too/);
  assert.match(look, /2\. A3 Request builders .* no review question reached it/);
  assert.match(look, /3\. Outside every area: \*\*r3\*\* \[Unresolved\]/);
  assert.match(md, /## Not mapped to an area[\s\S]*\*\*r3\*\* \[Unresolved\][\s\S]*\(open\)/);
  assert.match(md, /\| A5 Docs \| flagged: .* \| not examined \|/);
});

test('a missing explain.md or Areas table fails with the reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-focus-'));
  let r = spawnSync('node', [script, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no .*explain\.md/);
  fs.writeFileSync(path.join(dir, 'explain.md'), '# nothing\n');
  r = spawnSync('node', [script, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no "## Areas" table/);
});
