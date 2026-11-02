import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { assess } from '../scripts/freshness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'scripts', 'freshness.mjs');

const SNAP = '2026-01-01T10:00:00Z';
const ctx = (extra = {}) => ({ generated_at: SNAP, reviews: { items: [] }, threads: { items: [] }, ...extra });
const base = (over = {}) => ({
  origTarget: { head: 'aaa' }, recheckTarget: { head: 'aaa' },
  origContext: ctx(), recheckContext: ctx(),
  checks: [{ name: 'unit', state: 'SUCCESS' }], checksStatus: 'RAN', viewer: 'me', ...over,
});

test('a quiet, green, unmoved PR leaves the verdict uncapped', () => {
  const r = assess(base());
  assert.equal(r.head.moved, false);
  assert.equal(r.verdict_cap, null);
  assert.deepEqual(r.activity, []);
});

test('a PR merged after the snapshot is not postable, though its head and checks are unchanged', () => {
  const r = assess(base({ prState: 'MERGED' }));
  assert.equal(r.head.moved, false);
  assert.equal(r.verdict_cap, null);
  assert.equal(r.state.open, false);
  assert.equal(r.postable, false);
  assert.equal(assess(base({ prState: 'OPEN' })).postable, true);
  assert.equal(assess(base()).postable, true, 'no pr-shas: state unchecked, not treated as closed');
});

test('a check that turned red after the snapshot caps the verdict at COMMENT', () => {
  const r = assess(base({ checks: [{ name: 'unit', state: 'SUCCESS' }, { name: 'presubmit', state: 'FAILURE' }] }));
  assert.deepEqual(r.checks.failing, ['presubmit']);
  assert.equal(r.verdict_cap, 'COMMENT');
});

test('a pending check, an unknown state, or an unavailable checks probe all cap the verdict', () => {
  assert.equal(assess(base({ checks: [{ name: 'x', state: 'IN_PROGRESS' }] })).verdict_cap, 'COMMENT');
  assert.deepEqual(assess(base({ checks: [{ name: 'x', state: 'SOMETHING_NEW' }] })).checks.pending, ['x']);
  assert.equal(assess(base({ checksStatus: 'UNAVAILABLE', checks: undefined })).verdict_cap, 'COMMENT');
});

test('reviews and thread comments after the snapshot are listed; older ones and the viewer\'s own are not', () => {
  const recheckContext = ctx({
    reviews: { items: [
      { kind: 'review', author: 'other', at: '2026-01-01T09:00:00Z', body: 'old' },
      { kind: 'review', author: 'other', at: '2026-01-01T11:00:00Z', body: 'new review\nmore' },
      { kind: 'comment', author: 'me', at: '2026-01-01T12:00:00Z', body: 'my own' },
    ] },
    threads: { items: [{ path: 'a.go', line: 7, comments: [
      { author: 'bot', at: '2026-01-01T10:30:00Z', body: 'inline' },
    ] }] },
  });
  const r = assess(base({ recheckContext }));
  assert.deepEqual(r.activity.map((a) => [a.kind, a.author, a.where, a.text]), [
    ['thread', 'bot', 'a.go:7', 'inline'],
    ['review', 'other', null, 'new review'],
  ]);
});

test('the CLI exits 1 when the head moved, and writes freshness.json either way', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  const mk = (dir, head, checks) => {
    fs.mkdirSync(path.join(dir, 'evidence', 'pr'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'evidence', 'probes', 'core'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'evidence', 'target.json'), JSON.stringify({ head }));
    fs.writeFileSync(path.join(dir, 'evidence', 'pr', 'context.json'), JSON.stringify(ctx()));
    fs.writeFileSync(path.join(dir, 'evidence', 'manifest.json'), JSON.stringify({ probes: [{ name: 'core/pr-checks', status: 'RAN' }] }));
    fs.writeFileSync(path.join(dir, 'evidence', 'probes', 'core', 'pr-checks.out'), JSON.stringify(checks));
  };
  const run = path.join(tmp, 'run'); const recheck = path.join(tmp, 'recheck');
  mk(run, 'aaa', []);
  mk(recheck, 'bbb', [{ name: 'unit', state: 'SUCCESS' }]);
  const moved = spawnSync('node', [script, run, recheck], { encoding: 'utf8' });
  assert.equal(moved.status, 1, moved.stdout + moved.stderr);
  assert.match(moved.stdout, /head: moved aaa → bbb/);
  assert.ok(fs.existsSync(path.join(run, 'work', 'freshness.json')));

  mk(recheck, 'aaa', [{ name: 'unit', state: 'SUCCESS' }]);
  fs.writeFileSync(path.join(recheck, 'evidence', 'probes', 'core', 'pr-shas.out'), JSON.stringify({ data: { repository: { pullRequest: { state: 'MERGED' } } } }));
  const merged = spawnSync('node', [script, run, recheck], { encoding: 'utf8' });
  assert.equal(merged.status, 1, merged.stdout + merged.stderr);
  assert.match(merged.stdout, /state: MERGED — nothing to post/);
  fs.rmSync(path.join(recheck, 'evidence', 'probes', 'core', 'pr-shas.out'));

  mk(recheck, 'aaa', [{ name: 'unit', state: 'FAILURE' }]);
  const red = spawnSync('node', [script, run, recheck], { encoding: 'utf8' });
  assert.equal(red.status, 0, red.stdout + red.stderr);
  assert.match(red.stdout, /checks: 1 failing \(unit\), 0 pending — verdict capped at COMMENT/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(run, 'work', 'freshness.json'), 'utf8')).verdict_cap, 'COMMENT');
  fs.rmSync(tmp, { recursive: true, force: true });
});
