import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const check = path.join(here, '..', 'scripts', 'check.mjs');
const run = (fixture) => spawnSync('node', [check, path.join(here, 'fixtures', fixture)], { encoding: 'utf8' });

test('good fixture passes all three gates', () => {
  const r = run('good');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ledger: 3 asked, 3 decided\+unresolved — ok/);
  assert.match(r.stdout, /triage: 3 in, 3 out — ok/);
  assert.match(r.stdout, /blocking: 1 finding\(s\), evidence-backed — ok/);
});

test('a hanging ledger row fails gate 1 and names the row', () => {
  const r = run('bad-ledger');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ledger: .*row 2 has no decision/);
});

test('a Blocking finding on an ASSUMED claim fails gate 3', () => {
  const r = run('bad-blocking');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocking: "deploy order unsafe" rests on ASSUMED claim c3/);
});

test('a footer that disagrees with the table fails gate 1; the other gates still report', () => {
  const r = run('bad-footer');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ledger: footer says 4 asked, table has 3 rows/);
  assert.match(r.stdout, /triage: 3 in, 3 out — ok/);
  assert.match(r.stdout, /blocking: 1 finding\(s\), evidence-backed — ok/);
});

test('a Blocking finding citing an unknown claim id fails gate 3', () => {
  const r = run('bad-dangling-claim');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocking: "parse before signature check" cites unknown claim c99/);
});

test('gate 2 counts only the triage table, not a second numbered table in the file', () => {
  const r = run('two-tables');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /triage: 3 in, 3 out — ok/);
});

test('a ledger where every row is unresolved fails gate 1 even though the counts reconcile', () => {
  const r = run('all-unresolved');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ledger: all 3 rows unresolved — nothing settled, not postable/);
});

test('"unresolved" inside a decided cell does not make the row unresolved', () => {
  const r = run('unresolved-wording');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ledger: 3 asked, 3 decided\+unresolved — ok/);
});

test('a Blocking finding attached to an unresolved ledger row fails gate 3', () => {
  const r = run('bad-unresolved-row');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocking: "parse before signature check" rests on unresolved ledger row 2/);
});

test('a Blocking finding with no ledger rows fails gate 3', () => {
  const r = run('bad-no-row');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocking: "parse before signature check" cites no ledger row/);
});

test('a Blocking finding citing a row the ledger does not have fails gate 3', () => {
  const r = run('bad-unknown-row');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocking: "parse before signature check" cites unknown ledger row 9/);
});

test('a broken claims.jsonl line is reported by line number, not as a stack trace', () => {
  const r = run('bad-json');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocking: work\/claims\.jsonl line 2 is not JSON/);
  assert.doesNotMatch(r.stderr, /SyntaxError/);
});

test('a findings.json that is not JSON is reported as such', () => {
  const r = run('bad-json-findings');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /blocking: work\/findings\.json is not JSON/);
  assert.doesNotMatch(r.stderr, /SyntaxError/);
});
