import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { splitCells } from '../scripts/cells.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const merge = path.join(here, '..', 'scripts', 'merge-decisions.mjs');

// The script writes into the run, so each test gets a copy of fixtures/merge.
// The `probes` reader's files are rewritten with CRLF here rather than stored
// that way: git normalises line endings on checkout, so a CRLF fixture would
// quietly become LF and the tolerance would go untested.
const copyFixture = () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-merge-')), 'run');
  fs.cpSync(path.join(here, 'fixtures', 'merge'), dir, { recursive: true });
  for (const f of ['decisions/probes.md', 'claims/probes.jsonl']) {
    const p = path.join(dir, 'work', f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
  return dir;
};
const run = (dir) => spawnSync('node', [merge, dir], { encoding: 'utf8' });
const w = (dir, f) => fs.readFileSync(path.join(dir, 'work', f), 'utf8');
const rows = (md) => md.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).map(splitCells);

test('splitCells treats \\| as a pipe inside the cell and keeps the escape', () => {
  assert.deepEqual(splitCells('| 3 | Does `a \\| b` split? | `parser.go:12` | |'), ['3', 'Does `a \\| b` split?', '`parser.go:12`', '']);
  assert.deepEqual(splitCells('| 1 | plain |\r'), ['1', 'plain']);
  assert.deepEqual(splitCells('| 1 | no closing pipe'), ['1', 'no closing pipe']);
});

test('fills Decision from two decision files, flags the row both answered, leaves the unanswered row empty', () => {
  const dir = copyFixture();
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const led = rows(w(dir, 'ledger.md'));
  assert.equal(led.length, 4);
  assert.match(led[0][3], /^No — `parse\(\)` runs first/);
  assert.match(led[1][3], /^\*\*Unresolved\*\* — `probes\/deploy\/staging\.out` UNAVAILABLE$/, 'CRLF decision file is read cleanly');
  assert.match(led[2][3], /^conflict: Yes — `parser\.go:12` splits on `\\\|` only.* \/\/ No — `parser\.go:12` splits on every `\\\|`/);
  assert.equal(led[3][3], '', 'row 4 was answered by nobody and stays empty for gate 1 to name');
  // the escaped pipe in the question column survives the rewrite
  assert.equal(led[2][1], 'Does `a \\| b` in the flag parser still split on the pipe?');
  assert.match(r.stdout, /decisions: 3 row\(s\) filled from 2 file\(s\), 1 conflict\(s\), 1 unanswered \(row 4\)/);
});

test('backs the phase-2 ledger up once and never overwrites it', () => {
  const dir = copyFixture();
  const original = w(dir, 'ledger.md');
  run(dir);
  assert.equal(w(dir, 'ledger.phase2.bak'), original);
  const merged = w(dir, 'ledger.md');
  assert.notEqual(merged, original);
  const r2 = run(dir);
  assert.equal(r2.status, 0);
  assert.equal(w(dir, 'ledger.phase2.bak'), original, 'second run keeps the phase-2 backup');
  assert.equal(w(dir, 'ledger.md'), merged, 'second run is idempotent');
});

test('concatenates claims files in name order and tolerates CRLF', () => {
  const dir = copyFixture();
  const r = run(dir);
  const lines = w(dir, 'claims.jsonl').split('\n').filter(Boolean);
  assert.deepEqual(lines.map((l) => JSON.parse(l).id), ['git-1', 'git-2', 'probes-1', 'probes-2']);
  assert.ok(!w(dir, 'claims.jsonl').includes('\r'));
  assert.match(r.stdout, /claims: 4 line\(s\) from 2 file\(s\)/);
});

test('collects → candidate: clauses in ledger order and drops none / n/a / empty', () => {
  const dir = copyFixture();
  const r = run(dir);
  assert.equal(w(dir, 'candidates.md'),
    '- row 1: signature verified after parse\n- row 3: escaped pipe still splits\n');
  assert.match(r.stdout, /candidates: 2/);
});

test('a decision row the ledger does not have is reported as stray, not merged', () => {
  const dir = copyFixture();
  fs.appendFileSync(path.join(dir, 'work', 'decisions', 'git.md'), '| 9 | Yes — nothing to see. |\n');
  const r = run(dir);
  assert.equal(r.status, 0);
  assert.equal(rows(w(dir, 'ledger.md')).length, 4);
  assert.match(r.stdout, /1 stray \(row 9 not in ledger\)/);
});

test('missing run dir argument is a usage error', () => {
  const r = spawnSync('node', [merge], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: merge-decisions\.mjs/);
});
