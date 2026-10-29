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
// HOME is a temp dir and the Claude Code session variables are dropped, so
// init --pending never reads the real transcript tree; a test that wants an
// owner sets them itself.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-home-'));
const env = { ...process.env, HUD_ROOT: '/hud', PATH: '/nonexistent', HOME: home };
delete env.CLAUDE_CODE_SESSION_ID;
delete env.CLAUDE_PID;
const run = (dir, args, input) => spawnSync(process.execPath, [state, dir, ...args], { encoding: 'utf8', input, env });
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
// Phases only move forward and a default run skips none, so a test that
// finishes walks every phase between evidence and the one it needs, and
// records each phase's output as the orchestrator does.
const DEFAULT_PHASES = ['questions', 'settle', 'refute', 'triage', 'teach'];
const walk = (dir, phases = DEFAULT_PHASES) => {
  for (const p of phases) {
    assert.equal(run(dir, ['phase', p]).status, 0, `phase ${p}`);
    const r = run(dir, ['output', p]);
    assert.equal(r.status, 0, `output ${p}: ${r.stderr}`);
  }
};

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
  walk(dir);
  const r = run(dir, ['finish', 'note=/hud/projects/example/notes/PR-1-swap.md']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.equal(s.phase, 'rendered');
  assert.match(s.ended, ISO);
  assert.match(s.phases.teach.ended, ISO);
  assert.equal(s.verdict, 'REQUEST_CHANGES');
  assert.deepEqual(s.gates, { ledger: 'ok', triage: 'ok', blocking: 'ok', outputs: 'ok' });
  assert.deepEqual(s.findings, { blocking: 1, non_blocking: 0, question: 0, observation: 0 });
  assert.equal(s.note, 'projects/example/notes/PR-1-swap.md', 'absolute note under HUD_ROOT is stored relative');
});

test('finish accepts verdict=PRELIMINARY from a --fast run; the fast line is not a gate', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-state-')), 'run');
  fs.cpSync(path.join(here, 'fixtures', 'fast-run'), dir, { recursive: true });
  assert.equal(run(dir, ['init', 'mode=fast']).status, 0);
  walk(dir, ['questions', 'settle']);
  const r = run(dir, ['finish', 'note=projects/p/notes/PR-1.md']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.equal(s.mode, 'fast');
  assert.equal(s.verdict, 'PRELIMINARY');
  assert.deepEqual(s.gates, { ledger: 'ok', triage: 'ok', blocking: 'ok', outputs: 'ok' }, 'the gates passed; the fast line is check.mjs\'s exit, not a gate');
  assert.deepEqual(s.findings, { blocking: 0, non_blocking: 0, question: 3, observation: 0 });
});

test('finish gates=- parses check.mjs output from stdin; a failing gate is "fail"', () => {
  const dir = copyGood();
  run(dir, ['init']);
  walk(dir);
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
  walk(dir);
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
  assert.match(r.stderr, /no events\.jsonl; run init first/);
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
  walk(dir);
  const r = run(dir, ['finish', 'note=projects/p/notes/PR-1.md']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = read(dir);
  assert.equal(s.viewer, 'author-login');
  assert.equal(s.review_state.authorship, 'own');
  assert.equal(s.phase, 'rendered');
});

const events = (dir) => fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('every op appends one event; state.json is the fold of them', () => {
  const dir = copyGood();
  assert.equal(run(dir, ['init', 'viewer=v']).status, 0);
  assert.equal(run(dir, ['phase', 'questions']).status, 0);
  const evs = events(dir);
  assert.deepEqual(evs.map((e) => e.op), ['init', 'phase']);
  for (const e of evs) { assert.match(e.id, /^[a-z-]+\/[0-9a-f]{12}$/); assert.match(e.at, ISO); }
  assert.equal(read(dir).phase, 'questions');
});

test('replaying an op is a no-op: no new event, identical state.json', () => {
  const dir = copyGood();
  run(dir, ['init', 'viewer=v']);
  run(dir, ['phase', 'questions']);
  const before = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
  assert.equal(run(dir, ['phase', 'questions']).status, 0);
  assert.equal(run(dir, ['init', 'viewer=v']).status, 0, 'the same init again is a replay, not a step back to evidence');
  assert.equal(events(dir).length, 2);
  assert.equal(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), before);
});

test('a backward or unknown phase is refused with the allowed next phases', () => {
  const dir = copyGood();
  run(dir, ['init', 'viewer=v']);
  run(dir, ['phase', 'questions']);
  run(dir, ['phase', 'settle']);
  for (const bad of ['questions', 'setle']) {
    const r = run(dir, ['phase', bad]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /allowed next: refute/);
  }
  assert.equal(events(dir).length, 3, 'a refused transition appends nothing');
});

test('a jump over a phase this mode runs is refused', () => {
  const dir = copyGood();
  run(dir, ['init', 'viewer=v']);
  const r = run(dir, ['phase', 'settle']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /questions has not run/);
});

test('a run from before events.jsonl is still readable and is never rewritten', () => {
  const dir = copyGood();
  const legacy = { version: 1, phase: 'rendered', phases: {}, ended: '2026-01-01T00:00:00Z' };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(legacy));
  const r = run(dir, ['phase', 'posted']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no events\.jsonl/);
  assert.deepEqual(read(dir), legacy);
});

test('a second review in the same run dir: an ended run is set aside, an open one is refused', () => {
  const dir = copyGood();
  run(dir, ['init', 'viewer=v']);
  assert.equal(run(dir, ['init', 'viewer=w']).status, 0, 'still at evidence: a re-init corrects it');
  assert.equal(read(dir).viewer, 'w');
  walk(dir, ['questions']);
  const open = run(dir, ['init', 'viewer=v']);
  assert.notEqual(open.status, 0, 'past evidence, a different init is a step back');
  assert.match(open.stderr, /evidence is behind questions/);
  walk(dir, DEFAULT_PHASES.slice(1));
  run(dir, ['finish', 'note=projects/p/notes/PR-1.md', 'gates=-'], 'ledger: x — ok\n');
  assert.equal(run(dir, ['init', 'viewer=w', 'mode=light']).status, 0);
  const s = read(dir);
  assert.equal(s.phase, 'evidence');
  assert.equal(s.mode, 'light');
  assert.equal(s.ended, null);
  assert.deepEqual(events(dir).map((e) => e.op), ['init']);
  assert.equal(fs.readdirSync(dir).filter((f) => /^events\.superseded-.*\.jsonl$/.test(f)).length, 1);
});

test('init over a state.json from before the log keeps the old file beside the new run', () => {
  const dir = copyGood();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 1, phase: 'rendered' }));
  assert.equal(run(dir, ['init', 'viewer=v']).status, 0);
  assert.equal(read(dir).phase, 'evidence');
  const kept = fs.readdirSync(dir).filter((f) => /^state\.superseded-.*\.json$/.test(f));
  assert.equal(kept.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, kept[0]), 'utf8')).phase, 'rendered');
});

test('init --pending writes a visible pending run with its owner before any evidence exists', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-pending-')), 'run');
  const transcript = path.join(home, '.claude', 'projects', '-some-project', 'sess-1.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, '');
  const e = { ...env, CLAUDE_CODE_SESSION_ID: 'sess-1', CLAUDE_PID: String(process.pid) };
  const r = spawnSync(process.execPath, [state, dir, 'init', '--pending', 'pr=owner/repo#7', 'mode=fast'], { encoding: 'utf8', env: e });
  assert.equal(r.status, 0, r.stderr);
  const s = read(dir);
  assert.equal(s.phase, 'pending');
  assert.equal(s.repo, 'owner/repo');
  assert.equal(s.pr, 7);
  assert.equal(s.mode, 'fast');
  assert.equal(s.owner.session_id, 'sess-1');
  assert.equal(s.owner.pid, process.pid);
  assert.equal(s.owner.transcript_path, transcript, 'found by session id, whatever directory the shell is in');
});

test('init --pending with a session but no transcript on disk records a null transcript_path', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-pending-')), 'run');
  const e = { ...env, CLAUDE_CODE_SESSION_ID: 'sess-none', CLAUDE_PID: String(process.pid) };
  assert.equal(spawnSync(process.execPath, [state, dir, 'init', '--pending', 'pr=owner/repo#7'], { encoding: 'utf8', env: e }).status, 0);
  assert.deepEqual(read(dir).owner, { session_id: 'sess-none', pid: process.pid, transcript_path: null });
});

test('init --pending without a Claude Code session records no owner', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-pending-')), 'run');
  const e = { ...env }; delete e.CLAUDE_CODE_SESSION_ID; delete e.CLAUDE_PID;
  spawnSync(process.execPath, [state, dir, 'init', '--pending', 'pr=owner/repo#7'], { encoding: 'utf8', env: e });
  assert.equal(read(dir).owner, undefined);
});

test('init --pending needs pr=<owner/repo#N>, and a repeat is a replay', () => {
  const dir = copyGood();
  assert.equal(run(dir, ['init', '--pending', 'pr=owner/repo']).status, 2);
  assert.equal(run(dir, ['init', '--pending', 'pr=owner/repo#1']).status, 0);
  assert.equal(run(dir, ['init', '--pending', 'pr=owner/repo#1']).status, 0);
  assert.equal(events(dir).length, 1);
  const other = run(dir, ['init', '--pending', 'pr=owner/repo#2']);
  assert.notEqual(other.status, 0, 'a different run over an open one is refused');
  assert.match(other.stderr, /still open at pending/);
});

test('pending then the evidence init closes pending and keeps the owner', () => {
  const dir = copyGood();
  const e = { ...env, CLAUDE_CODE_SESSION_ID: 'sess-2', CLAUDE_PID: String(process.pid) };
  spawnSync(process.execPath, [state, dir, 'init', '--pending', 'pr=owner/repo#1'], { encoding: 'utf8', env: e });
  assert.equal(run(dir, ['init', 'viewer=v']).status, 0);
  const s = read(dir);
  assert.equal(s.phase, 'evidence');
  assert.notEqual(s.phases.pending.ended, null);
  assert.equal(s.owner.session_id, 'sess-2');
});

test('output counts the phase file itself', () => {
  const dir = copyGood();
  run(dir, ['init', 'viewer=v']);
  run(dir, ['phase', 'questions']);
  assert.equal(run(dir, ['output', 'questions']).status, 0);
  const s = read(dir);
  assert.equal(s.outputs.questions.file, 'work/ledger.md');
  assert.equal(s.outputs.questions.rows, 3, 'fixtures/good has three ledger rows');
  run(dir, ['phase', 'settle']);
  run(dir, ['output', 'settle']);
  run(dir, ['phase', 'refute']);
  run(dir, ['output', 'refute']);
  assert.deepEqual(read(dir).outputs.refute, { file: 'work/refutations.md', rows: 1 }, 'table body rows, not the header');
});

test('output of a missing file or an unknown phase is refused and records nothing', () => {
  const dir = copyGood();
  run(dir, ['init', 'viewer=v']);
  fs.rmSync(path.join(dir, 'work', 'ledger.md'));
  const r = run(dir, ['output', 'questions']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /work\/ledger\.md does not exist/);
  assert.equal(run(dir, ['output', 'evidence']).status, 2);
  assert.deepEqual(events(dir).map((e) => e.op), ['init']);
});

test('zero candidates: refute is refused, teach skips refute and triage by rule', () => {
  const dir = copyGood();
  run(dir, ['init', 'viewer=v']);
  walk(dir, ['questions']);
  run(dir, ['phase', 'settle']);
  fs.writeFileSync(path.join(dir, 'work', 'candidates.md'), '');
  run(dir, ['output', 'settle']);
  const r = run(dir, ['phase', 'refute']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /zero candidates/);
  assert.equal(run(dir, ['phase', 'teach']).status, 0);
  assert.deepEqual(read(dir).skipped.map((x) => x.reason), ['zero-candidates', 'zero-candidates']);
});

test('abandon and fail are terminal', () => {
  const dir = copyGood();
  run(dir, ['init', 'viewer=v']);
  assert.equal(run(dir, ['abandon', 'reason=session-ended']).status, 0);
  const s = read(dir);
  assert.equal(s.phase, 'abandoned');
  assert.equal(s.abandoned, 'session-ended');
  assert.match(s.ended, ISO);
  assert.notEqual(run(dir, ['phase', 'questions']).status, 0);
  assert.equal(run(dir, ['abandon', 'reason=session-ended']).status, 0, 'the same abandon again is a replay');
  const other = copyGood();
  run(other, ['init', 'viewer=v']);
  assert.equal(run(other, ['fail', 'reason=evidence-script']).status, 0);
  assert.equal(read(other).phase, 'failed');
  assert.notEqual(run(other, ['abandon']).status, 0, 'nothing follows a terminal state');
});

test('replaying a whole run reproduces state.json byte for byte', () => {
  const dir = copyGood();
  const gates = ['ledger: 3 asked, 3 decided+unresolved — ok', 'triage: 0 in, 0 out — ok', 'blocking: 0 finding(s), evidence-backed — ok', ''].join('\n');
  const calls = [
    [['init', '--pending', 'pr=owner/repo#1']],
    [['init', 'viewer=v']],
    [['phase', 'questions']],
    [['output', 'questions']],
    [['phase', 'settle']],
    [['output', 'settle']],
    [['phase', 'teach']],
    [['output', 'teach']],
    [['finish', 'note=projects/p/notes/PR-1.md', 'gates=-'], gates],
  ];
  fs.writeFileSync(path.join(dir, 'work', 'candidates.md'), '');
  for (const [args, input] of calls) assert.equal(run(dir, args, input).status, 0, args.join(' '));
  const first = fs.readFileSync(path.join(dir, 'state.json'));
  const lines = events(dir).length;
  const s = read(dir);
  assert.equal(s.phase, 'rendered');
  assert.deepEqual(s.skipped, [{ phase: 'refute', reason: 'zero-candidates' }, { phase: 'triage', reason: 'zero-candidates' }]);

  // Every op but phase is a replay and exits 0. A phase the run has passed
  // is refused as behind it and writes nothing, so the state is unchanged
  // either way.
  for (const [args, input] of calls) {
    const r = run(dir, args, input);
    if (args[0] === 'phase') {
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, /is behind rendered/);
    } else {
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    }
  }
  assert.ok(fs.readFileSync(path.join(dir, 'state.json')).equals(first), 'state.json is byte-identical');
  assert.equal(events(dir).length, lines);
});
