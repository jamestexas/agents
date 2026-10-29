import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASES, eventId, eventKey, fold, checkTransition } from '../scripts/runstate.mjs';

const ev = (op, data, at) => ({ id: eventId(op, data), at, op, data });
const T = (s) => `2026-01-01T00:00:${String(s).padStart(2, '0')}.000Z`;

test('phase order is the documented one', () => {
  assert.deepEqual(PHASES, ['pending', 'evidence', 'questions', 'settle', 'refute', 'triage', 'teach', 'rendered', 'posted']);
});

test('eventId is content-addressed and ignores key order', () => {
  assert.equal(eventId('phase', { name: 'settle' }), eventId('phase', { name: 'settle' }));
  assert.equal(eventId('x', { a: 1, b: 2 }), eventId('x', { b: 2, a: 1 }));
  assert.notEqual(eventId('phase', { name: 'settle' }), eventId('phase', { name: 'refute' }));
  assert.match(eventId('phase', { name: 'settle' }), /^phase\/[0-9a-f]{12}$/);
});

test('fold: pending then evidence then a phase gives the HUD schema', () => {
  const s = fold([
    ev('init-pending', { repo: 'owner/repo', pr: 1, mode: 'default', owner: { session_id: 's', pid: 1, transcript_path: '/t' } }, T(0)),
    ev('init', { title: 't', author: 'a', mode: 'default', head: 'h', base: 'b', probes: { total: 1, ran: 1, failed: 0, unavailable: 0 }, viewer: null, evidence_started: T(1) }, T(5)),
    ev('phase', { name: 'questions', skipped: [] }, T(6)),
  ]);
  assert.equal(s.phase, 'questions');
  assert.equal(s.started, T(0));
  assert.equal(s.ended, null);
  assert.deepEqual(s.phases.pending, { started: T(0), ended: T(1) });
  assert.deepEqual(s.phases.evidence, { started: T(1), ended: T(5) });
  assert.deepEqual(s.phases.questions, { started: T(6), ended: null });
  assert.deepEqual(s.owner, { session_id: 's', pid: 1, transcript_path: '/t' });
  assert.equal(s.head, 'h');
});

test('fold: init with no pending (old orchestrator) starts at evidence', () => {
  const s = fold([ev('init', { title: null, author: null, mode: 'light', head: 'h', base: 'b', probes: { total: 0, ran: 0, failed: 0, unavailable: 0 }, viewer: null, evidence_started: T(1) }, T(5))]);
  assert.equal(s.phase, 'evidence');
  assert.equal(s.started, T(1));
  assert.equal(s.phases.pending, undefined);
  assert.equal(s.owner, undefined);
});

test('fold: skip, output, finish, posted, abandon', () => {
  const base = [
    ev('init', { title: null, author: null, mode: 'default', head: 'h', base: 'b', probes: { total: 0, ran: 0, failed: 0, unavailable: 0 }, viewer: null, evidence_started: T(0) }, T(1)),
    ev('phase', { name: 'settle', skipped: [] }, T(2)),
    ev('output', { phase: 'settle', file: 'work/candidates.md', rows: 0 }, T(3)),
    ev('phase', { name: 'teach', skipped: [{ phase: 'refute', reason: 'zero-candidates' }, { phase: 'triage', reason: 'zero-candidates' }] }, T(4)),
  ];
  const s = fold(base);
  assert.deepEqual(s.outputs, { settle: { file: 'work/candidates.md', rows: 0 } });
  assert.deepEqual(s.skipped, [{ phase: 'refute', reason: 'zero-candidates' }, { phase: 'triage', reason: 'zero-candidates' }]);
  const done = fold([...base, ev('finish', { note: 'n.md', verdict: 'APPROVE', findings: { blocking: 0, non_blocking: 0, question: 0, observation: 0 }, gates: { ledger: 'ok', triage: 'ok', blocking: 'ok' } }, T(9))]);
  assert.equal(done.phase, 'rendered');
  assert.equal(done.ended, T(9));
  assert.equal(done.phases.teach.ended, T(9));
  const gone = fold([...base, ev('abandon', { reason: 'session-ended' }, T(8))]);
  assert.equal(gone.phase, 'abandoned');
  assert.equal(gone.ended, T(8));
  assert.equal(gone.abandoned, 'session-ended');
});

test('checkTransition: forward ok, backward and unknown refused, repeat is a no-op', () => {
  const s = { phase: 'settle', mode: 'default', skipped: [], outputs: {} };
  assert.deepEqual(checkTransition(s, 'refute'), { ok: true, skipped: [] });
  assert.equal(checkTransition(s, 'questions').ok, false);
  assert.equal(checkTransition(s, 'nonsense').ok, false);
  assert.deepEqual(checkTransition(s, 'settle'), { ok: true, noop: true, skipped: [] });
});

test('checkTransition: a jump is allowed only over mode-skippable or zero-candidate phases', () => {
  assert.equal(checkTransition({ phase: 'settle', mode: 'default', skipped: [], outputs: {} }, 'teach').ok, false);
  assert.deepEqual(checkTransition({ phase: 'settle', mode: 'light', skipped: [], outputs: {} }, 'teach').skipped,
    [{ phase: 'refute', reason: 'mode:light' }, { phase: 'triage', reason: 'mode:light' }]);
  assert.deepEqual(checkTransition({ phase: 'settle', mode: 'default', skipped: [], outputs: { settle: { rows: 0 } } }, 'teach').skipped,
    [{ phase: 'refute', reason: 'zero-candidates' }, { phase: 'triage', reason: 'zero-candidates' }]);
  // fast skips refute, triage and teach
  assert.equal(checkTransition({ phase: 'settle', mode: 'fast', skipped: [], outputs: {} }, 'rendered').ok, true);
});

test('checkTransition: refute with zero candidates is refused, pointing at teach', () => {
  const r = checkTransition({ phase: 'settle', mode: 'default', skipped: [], outputs: { settle: { rows: 0 } } }, 'refute');
  assert.equal(r.ok, false);
  assert.match(r.reason, /zero candidates/);
  assert.match(r.reason, /teach/);
});

test('checkTransition: abandoned/failed from any open phase; nothing after a terminal', () => {
  assert.equal(checkTransition({ phase: 'questions', mode: 'default', skipped: [], outputs: {} }, 'abandoned').ok, true);
  assert.equal(checkTransition({ phase: 'abandoned', mode: 'default', skipped: [], outputs: {} }, 'settle').ok, false);
  assert.equal(checkTransition({ phase: 'posted', mode: 'default', skipped: [], outputs: {} }, 'abandoned').ok, false);
});

test('fold: a skip event adds to skipped without moving the phase', () => {
  const s = fold([
    ev('init', { mode: 'fast', evidence_started: T(0) }, T(1)),
    ev('skip', { skipped: [{ phase: 'teach', reason: 'mode:fast' }] }, T(2)),
  ]);
  assert.equal(s.phase, 'evidence');
  assert.deepEqual(s.skipped, [{ phase: 'teach', reason: 'mode:fast' }]);
});

test('eventKey: output is keyed per phase, every other op by its name', () => {
  assert.equal(eventKey('output', { phase: 'settle' }), 'output:settle');
  assert.notEqual(eventKey('output', { phase: 'settle' }), eventKey('output', { phase: 'teach' }));
  assert.equal(eventKey('finish', { verdict: 'APPROVE' }), 'finish');
});
