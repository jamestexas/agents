import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'scripts', 'prior-context.mjs');
const run = (dir, op) => spawnSync(process.execPath, [script, dir, op], { encoding: 'utf8' });

// A PR folder (prs/PR-1) with raw/ as the run directory.
const prFolder = () => {
  const pr = fs.mkdtempSync(path.join(os.tmpdir(), 'prior-'));
  const raw = path.join(pr, 'raw');
  fs.mkdirSync(raw);
  return { pr, raw };
};

// Pack an ended run the way state.mjs does: work/ inside a runs/<stamp>.tar.gz,
// one history line naming it.
const archive = (raw, { findings, post, head = 'abc1234', posted = null }) => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-'));
  fs.mkdirSync(path.join(stage, 'work'));
  fs.writeFileSync(path.join(stage, 'work', 'findings.json'), JSON.stringify(findings));
  fs.writeFileSync(path.join(stage, 'work', 'summary.md'), '**Verdict** APPROVE\n');
  if (post) fs.writeFileSync(path.join(stage, 'work', 'post.md'), post);
  fs.mkdirSync(path.join(raw, 'runs'), { recursive: true });
  const name = 'runs/2026-11-24T00-00-00-000Z.tar.gz';
  const r = spawnSync('tar', ['-czf', path.join(raw, name), '-C', stage, 'work']);
  assert.equal(r.status, 0);
  fs.appendFileSync(path.join(raw, 'runs', 'history.jsonl'), `${JSON.stringify({ archive: name, mode: 'deep', verdict: 'APPROVE', head, posted })}\n`);
};

test('head: empty with no history, the last line\'s head otherwise', () => {
  const { raw } = prFolder();
  assert.equal(run(raw, 'head').stdout, '');
  archive(raw, { findings: [], head: 'old0000' });
  archive(raw, { findings: [], head: 'new1111' });
  assert.equal(run(raw, 'head').stdout, 'new1111\n');
});

test('write: a posted run gives prior-finding lines marked posted, and copies post.md and meta', () => {
  const { raw } = prFolder();
  const posted = { url: 'https://example/pull/1#r1', state: 'APPROVED' };
  archive(raw, {
    findings: [{ tag: 'Non-blocking', title: 'cap is per token\nmore', file_line: 'a.md:3' }, { tag: 'Question', title: 'sign-off?', file_line: 'b.md:9' }],
    post: '🤖 body\n',
    posted,
  });
  const r = run(raw, 'write');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout,
    '- prior finding [Non-blocking] a.md:3 — cap is per token (posted)\n'
    + '- prior finding [Question] b.md:9 — sign-off? (posted)\n');
  const prior = path.join(raw, 'evidence', 'prior');
  assert.equal(fs.readFileSync(path.join(prior, 'post.md'), 'utf8'), '🤖 body\n');
  const meta = JSON.parse(fs.readFileSync(path.join(prior, 'meta.json'), 'utf8'));
  assert.deepEqual(meta.posted, posted);
  assert.equal(meta.findings, 2);
});

test('write: an unposted run marks its findings not posted and writes no post.md', () => {
  const { raw } = prFolder();
  archive(raw, { findings: [{ tag: 'Non-blocking', title: 't', file_line: 'x.go:1' }] });
  assert.match(run(raw, 'write').stdout, /\(not posted\)\n$/);
  assert.equal(fs.existsSync(path.join(raw, 'evidence', 'prior', 'post.md')), false);
});

test('write: legacy artifacts become rows; review.md counts as legacy only before any history', () => {
  const { pr, raw } = prFolder();
  fs.writeFileSync(path.join(pr, 'structural-review.md'), '# old\n');
  fs.writeFileSync(path.join(pr, 'review.md'), '# hand review\n');
  const before = run(raw, 'write').stdout;
  assert.match(before, /legacy\/structural-review\.md/);
  assert.match(before, /legacy\/review\.md/);
  assert.ok(fs.existsSync(path.join(raw, 'evidence', 'prior', 'legacy', 'review.md')));

  fs.rmSync(path.join(raw, 'evidence'), { recursive: true });
  archive(raw, { findings: [] });
  const after = run(raw, 'write').stdout;
  assert.match(after, /legacy\/structural-review\.md/);
  assert.doesNotMatch(after, /legacy\/review\.md/, 'once /review has run here, review.md is its own note');
});

test('write: nothing earlier leaves no evidence/prior and prints nothing', () => {
  const { raw } = prFolder();
  const r = run(raw, 'write');
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(path.join(raw, 'evidence', 'prior')), false);
});

test('write: a re-review lists open threads, threads resolved since, and newer reviews only', () => {
  const { raw } = prFolder();
  archive(raw, { findings: [] });
  // archive() records no ended time; give the history line one.
  const hf = path.join(raw, 'runs', 'history.jsonl');
  fs.writeFileSync(hf, fs.readFileSync(hf, 'utf8').replace('"mode"', '"ended":"2026-11-24T05:00:00Z","mode"'));
  fs.mkdirSync(path.join(raw, 'evidence', 'pr'), { recursive: true });
  fs.writeFileSync(path.join(raw, 'evidence', 'pr', 'context.json'), JSON.stringify({
    threads: { items: [
      { path: 'a.go', line: 1, state: 'unresolved', resolved: false, comments: [{ at: '2026-11-20T00:00:00Z', body: 'still open' }] },
      { path: 'b.go', line: 2, state: 'resolved', resolved: true, comments: [{ at: '2026-11-20T00:00:00Z', body: 'moved it' }, { at: '2026-11-24T06:00:00Z', body: 'done' }] },
      { path: 'c.go', line: 3, state: 'resolved', resolved: true, comments: [{ at: '2026-11-20T00:00:00Z', body: 'old and settled' }] },
    ] },
    reviews: { items: [
      { kind: 'review', author: 'old', state: 'COMMENTED', at: '2026-11-20T00:00:00Z', body: 'settled last round' },
      { kind: 'review', author: 'new', state: 'APPROVED', at: '2026-11-24T07:00:00Z', body: 'lgtm\nmore' },
      { kind: 'review', author: 'wrap', state: 'COMMENTED', at: '2026-11-24T07:00:00Z', body: '' },
    ] },
  }));
  assert.equal(run(raw, 'write').stdout,
    '- thread a.go:1 — still open\n'
    + '- thread b.go:2 (resolved since the last review) — moved it\n'
    + '- review by new (APPROVED) — lgtm\n');
});
