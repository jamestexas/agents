import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const state = path.join(here, '..', 'scripts', 'state.mjs');

// Each test gets its own copy of fixtures/good: state.mjs writes into the run.
const copyGood = () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-state-')), 'run');
  fs.cpSync(path.join(here, 'fixtures', 'good'), dir, { recursive: true });
  return dir;
};
// PATH carries no gh, so `init` never reaches the network here: the viewer is
// whatever the test passes, or null. node is spawned by its own path.
const env = { ...process.env, HUD_ROOT: '/hud', PATH: '/nonexistent' };
const run = (dir, args, input) => spawnSync(process.execPath, [state, dir, ...args], { encoding: 'utf8', input, env });
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

test('init writes the HUD schema from target.json and manifest.json', () => {
  const dir = copyGood();
  const r = run(dir, ['init', 'mode=deep']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.deepEqual(Object.keys(s), ['version', 'repo', 'pr', 'title', 'author', 'mode', 'head', 'base', 'phase', 'phases',
    'started', 'ended', 'verdict', 'gates', 'probes', 'findings', 'note', 'posted', 'viewer']);
  assert.equal(s.viewer, null, 'no gh on PATH and no viewer= given');
  assert.equal(s.version, 1);
  assert.equal(s.repo, 'owner/repo');
  assert.equal(s.pr, 1, 'pr is a number so the HUD can build the PR link');
  assert.equal(s.mode, 'deep');
  assert.equal(s.head, 'abc123');
  assert.equal(s.base, 'upstream/main');
  assert.equal(s.phase, 'evidence');
  assert.equal(s.ended, null);
  assert.equal(s.verdict, null);
  assert.deepEqual(s.gates, { ledger: null, triage: null, blocking: null });
  assert.deepEqual(s.probes, { total: 2, ran: 1, failed: 0, unavailable: 1 });
  assert.deepEqual(s.findings, { blocking: 0, non_blocking: 0, question: 0, observation: 0 });
  assert.equal(s.note, null);
  assert.equal(s.posted, null);
  assert.match(s.started, ISO);
  assert.equal(s.title, null, 'no pr-shas.out in the fixture');
  assert.equal(s.author, null);
});

test('init takes title and author from core/pr-shas.out when present', () => {
  const dir = copyGood();
  fs.mkdirSync(path.join(dir, 'evidence', 'probes', 'core'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'probes', 'core', 'pr-shas.out'),
    JSON.stringify({ data: { repository: { pullRequest: { title: 'fix(example): swap parse/verify', author: { login: 'login' } } } } }));
  assert.equal(run(dir, ['init']).status, 0);
  const s = read(dir);
  assert.equal(s.title, 'fix(example): swap parse/verify');
  assert.equal(s.author, 'login');
  assert.equal(s.mode, 'default');
});

test('phase closes the open phase and opens the named one', () => {
  const dir = copyGood();
  run(dir, ['init']);
  assert.equal(run(dir, ['phase', 'questions']).status, 0);
  let s = read(dir);
  assert.equal(s.phase, 'questions');
  assert.match(s.phases.evidence.ended, ISO);
  assert.match(s.phases.questions.started, ISO);
  assert.equal(s.phases.questions.ended, null);
  assert.equal(run(dir, ['phase', 'settle']).status, 0);
  s = read(dir);
  assert.equal(s.phase, 'settle');
  assert.match(s.phases.questions.ended, ISO);
  assert.equal(s.phases.settle.ended, null);
  assert.equal(s.ended, null, 'still running');
});

test('finish re-runs check.mjs, reads the verdict and counts findings', () => {
  const dir = copyGood();
  run(dir, ['init']);
  run(dir, ['phase', 'teach']);
  const r = run(dir, ['finish', 'note=/hud/projects/example/notes/PR-1-swap.md']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.equal(s.phase, 'rendered');
  assert.match(s.ended, ISO);
  assert.match(s.phases.teach.ended, ISO);
  assert.equal(s.verdict, 'REQUEST_CHANGES');
  assert.deepEqual(s.gates, { ledger: 'ok', triage: 'ok', blocking: 'ok' });
  assert.deepEqual(s.findings, { blocking: 1, non_blocking: 0, question: 0, observation: 0 });
  assert.equal(s.note, 'projects/example/notes/PR-1-swap.md', 'absolute note under HUD_ROOT is stored relative');
});

test('finish gates=- parses check.mjs output from stdin; a failing gate is "fail"', () => {
  const dir = copyGood();
  run(dir, ['init']);
  const out = ['ledger: 3 asked, 3 decided+unresolved — ok', 'triage: header says 4 in / 4 out, table has 3 rows',
    'blocking: "x" rests on ASSUMED claim c3', 'blocking: 1 finding(s), evidence-backed — ok', ''].join('\n');
  const r = run(dir, ['finish', 'note=projects/p/notes/PR-1.md', 'gates=-'], out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.deepEqual(s.gates, { ledger: 'ok', triage: 'fail', blocking: 'fail' });
  assert.equal(s.note, 'projects/p/notes/PR-1.md');
});

test('posted records url, state and time, and moves the phase to posted', () => {
  const dir = copyGood();
  run(dir, ['init']);
  run(dir, ['finish', 'note=projects/p/notes/PR-1.md']);
  const r = run(dir, ['posted', 'url=https://github.com/owner/repo/pull/1#pullrequestreview-1', 'state=CHANGES_REQUESTED']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.equal(s.phase, 'posted');
  assert.equal(s.posted.url, 'https://github.com/owner/repo/pull/1#pullrequestreview-1');
  assert.equal(s.posted.state, 'CHANGES_REQUESTED');
  assert.match(s.posted.at, ISO);
});

test('early copies work/early.json into state.early; an absent file is an empty list', () => {
  const dir = copyGood();
  run(dir, ['init']);
  fs.writeFileSync(path.join(dir, 'work', 'early.json'), JSON.stringify([
    { row: 1, title: 'parse before signature check', basis: 'blocking-ran', extra: 'dropped' },
    'not an object',
  ]));
  let r = run(dir, ['early']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(read(dir).early, [{ row: 1, title: 'parse before signature check', basis: 'blocking-ran' }]);
  fs.rmSync(path.join(dir, 'work', 'early.json'));
  r = run(dir, ['early']);
  assert.equal(r.status, 0);
  assert.deepEqual(read(dir).early, []);
  assert.equal(run(dir, ['early', 'x=1']).status, 2, 'early takes no keys');
});

test('an unknown key or op is a usage error, not a silent field', () => {
  const dir = copyGood();
  assert.equal(run(dir, ['init', 'bogus=1']).status, 2);
  assert.equal(run(dir, ['bogus']).status, 2);
  run(dir, ['init']);
  assert.equal(run(dir, ['posted', 'url=u']).status, 2, 'posted needs state=');
  assert.ok(!('bogus' in read(dir)));
});

test('phase before init is an error naming the missing file', () => {
  const dir = copyGood();
  const r = run(dir, ['phase', 'questions']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /state\.json missing or not JSON; run init first/);
});

const withContext = () => {
  const dir = copyGood();
  fs.mkdirSync(path.join(dir, 'evidence', 'pr'), { recursive: true });
  fs.copyFileSync(path.join(here, 'fixtures', 'context', 'pr-context.json'), path.join(dir, 'evidence', 'pr', 'context.json'));
  return dir;
};

test('without pr/context.json there is no review_state key; viewer= is recorded', () => {
  const dir = copyGood();
  assert.equal(run(dir, ['init', 'viewer=me-login']).status, 0);
  const s = read(dir);
  assert.equal(s.viewer, 'me-login');
  assert.ok(!('review_state' in s));
});

test('review_state: authorship, my latest review, latest review per human, bots by flag or login pattern', () => {
  const dir = withContext();
  const r = run(dir, ['init', 'viewer=me-login']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.equal(s.author, 'author-login', 'author falls back to pr/context.json');
  assert.equal(s.title, 'fix(example): swap parse/verify');
  const rs = s.review_state;
  assert.equal(rs.authorship, 'peer');
  assert.deepEqual(rs.mine, { state: 'CHANGES_REQUESTED', at: '2026-10-20T11:00:00Z', head_matches: null });
  assert.deepEqual(rs.humans, [
    { login: 'reviewer-one', state: 'APPROVED', at: '2026-10-21T09:00:00Z' },
    { login: 'reviewer-two', state: 'COMMENTED', at: '2026-10-21T09:30:00Z' },
  ], 'latest per human; the PR author comment is not a review; bots and me excluded');
  assert.deepEqual(rs.bots, [
    { login: 'reviewbot[bot]', state: 'COMMENTED', findings: 0, at: '2026-10-20T10:05:00Z' },
    { login: 'something-app', state: 'COMMENTED', findings: 1, at: '2026-10-20T10:06:00Z' },
  ], 'something-app has no is_bot flag and lands in bots by its login');
});

test('review_state threads: awaiting_me when the author answered on my thread; a thread I am not on counts as unresolved only', () => {
  const dir = withContext();
  run(dir, ['init', 'viewer=me-login']);
  assert.deepEqual(read(dir).review_state.threads, { total: 3, unresolved: 2, awaiting_me: 1, awaiting_author: 0 });
});

test('review_state with an unknown viewer: authorship null, awaiting counts stay at zero', () => {
  const dir = withContext();
  const r = run(dir, ['init']); // no gh on PATH, no viewer= given
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.equal(s.viewer, null);
  assert.equal(s.review_state.authorship, null);
  assert.deepEqual(s.review_state.mine, { state: null, at: null, head_matches: null });
  assert.deepEqual(s.review_state.threads, { total: 3, unresolved: 2, awaiting_me: 0, awaiting_author: 0 });
});

test('own PR: authorship own; finish refreshes review_state and keeps the viewer', () => {
  const dir = withContext();
  run(dir, ['init', 'viewer=author-login']);
  assert.equal(read(dir).review_state.authorship, 'own');
  const r = run(dir, ['finish', 'note=projects/p/notes/PR-1.md']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.equal(s.viewer, 'author-login');
  assert.equal(s.review_state.authorship, 'own');
  assert.equal(s.phase, 'rendered');
});
