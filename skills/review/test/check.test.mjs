import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { eventId } from '../scripts/runstate.mjs';

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

test('an escaped pipe inside a cell is not a column break in either table', () => {
  const r = run('escaped-pipe');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ledger: 3 asked, 3 decided\+unresolved — ok/);
  assert.match(r.stdout, /triage: 2 in, 2 out — ok/);
});

test('a --fast run fails with a fourth line even though the three gates pass', () => {
  const r = run('fast-run');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ledger: 3 asked, 3 decided\+unresolved — ok/);
  assert.match(r.stdout, /triage: 3 in, 3 out — ok/);
  assert.match(r.stdout, /blocking: 0 finding\(s\), evidence-backed — ok/);
  assert.match(r.stdout, /^fast: PRELIMINARY — not postable$/m);
  assert.equal(r.stdout.trim().split('\n').length, 4, 'exactly four lines');
});

test('a PRELIMINARY summary alone, with no state.json, is enough for the fast line', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-check-')), 'run');
  fs.cpSync(path.join(here, 'fixtures', 'fast-run'), dir, { recursive: true });
  fs.rmSync(path.join(dir, 'state.json'));
  const r = spawnSync('node', [check, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^fast: PRELIMINARY — not postable$/m);
  // and a state.json saying fast is enough on its own, whatever the summary says
  fs.writeFileSync(path.join(dir, 'work', 'summary.md'), '**Verdict** — COMMENT.\n');
  assert.equal(spawnSync('node', [check, dir], { encoding: 'utf8' }).status, 0, 'no fast marker left: postable');
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ mode: 'fast' }));
  const again = spawnSync('node', [check, dir], { encoding: 'utf8' });
  assert.equal(again.status, 1);
  assert.match(again.stdout, /^fast: PRELIMINARY — not postable$/m);
});

test('outputs gate: printed only with events.jsonl; fails when a run phase left no output and was not skipped', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-check-')), 'run');
  fs.cpSync(path.join(here, 'fixtures', 'good'), dir, { recursive: true });
  const check1 = spawnSync('node', [check, dir], { encoding: 'utf8' });
  assert.equal(check1.status, 0, check1.stdout + check1.stderr);
  assert.doesNotMatch(check1.stdout, /^outputs:/m, 'a run with no events.jsonl gets no outputs line');

  const line = (op, data, at) => JSON.stringify({ id: eventId(op, data), at, op, data }) + '\n';
  const log = path.join(dir, 'events.jsonl');
  fs.writeFileSync(log, [
    line('init', { mode: 'default', evidence_started: '2026-01-01T00:00:00.000Z' }, '2026-01-01T00:00:01.000Z'),
    line('phase', { name: 'questions', skipped: [] }, '2026-01-01T00:00:02.000Z'),
    line('output', { phase: 'questions', file: 'work/ledger.md', rows: 3 }, '2026-01-01T00:00:03.000Z'),
    line('phase', { name: 'settle', skipped: [] }, '2026-01-01T00:00:04.000Z'),
  ].join(''));
  const missing = spawnSync('node', [check, dir], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /^outputs: settle has no output and was not skipped$/m);
  assert.match(missing.stdout, /^blocking: .* — ok$/m, 'the other gates still report');

  fs.appendFileSync(log, line('output', { phase: 'settle', file: 'work/candidates.md', rows: 0 }, '2026-01-01T00:00:05.000Z')
    + line('phase', { name: 'teach', skipped: [{ phase: 'refute', reason: 'zero-candidates' }, { phase: 'triage', reason: 'zero-candidates' }] }, '2026-01-01T00:00:06.000Z')
    + line('output', { phase: 'teach', file: 'work/summary.md', rows: 1 }, '2026-01-01T00:00:07.000Z'));
  const ok = spawnSync('node', [check, dir], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /^outputs: 3 phase\(s\) with output, 2 skipped — ok$/m);
});
