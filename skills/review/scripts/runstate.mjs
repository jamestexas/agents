// runstate.mjs — the run's state model, with no I/O.
// events.jsonl is the truth and state.json is fold(events): the same split
// rosary keeps between its append-only run events and the status derived
// from them. Every function here is pure, so the fold can be replayed and
// tested without a run directory.
import { createHash } from 'node:crypto';

export const PHASES = Object.freeze(['pending', 'evidence', 'questions', 'settle', 'refute', 'triage', 'teach', 'rendered', 'posted']);
export const TERMINAL = Object.freeze(['abandoned', 'failed']);
// Phases a mode does not run. A jump over them is legal and recorded as a skip.
const MODE_SKIPS = { light: ['refute', 'triage'], fast: ['refute', 'triage', 'teach'] };
const ZERO_SKIPS = ['refute', 'triage'];

const canonical = (v) => (Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);

/** `<op>/<12 hex>` over the op and its data; timestamps are never part of data. */
export function eventId(op, data) {
  return `${op}/${createHash('sha256').update(JSON.stringify([op, canonical(data ?? {})])).digest('hex').slice(0, 12)}`;
}

/**
 * Events that overwrite the same slot of state share a key. A call is a
 * replay when the latest event under its key has its id; an id seen only
 * further back is a change back to an earlier value, not a replay.
 */
export function eventKey(op, data) {
  return op === 'output' ? `output:${data?.phase}` : op;
}

const blank = () => ({
  version: 1, repo: null, pr: null, title: null, author: null, mode: 'default', head: null, base: null,
  phase: null, phases: {}, started: null, ended: null, verdict: null,
  gates: { ledger: null, triage: null, blocking: null },
  probes: { total: 0, ran: 0, failed: 0, unavailable: 0 },
  findings: { blocking: 0, non_blocking: 0, question: 0, observation: 0 },
  note: null, posted: null, viewer: null,
});
const closeOpen = (s, at) => { for (const p of Object.values(s.phases)) if (p.ended === null) p.ended = at; };
const open = (s, name, at) => { closeOpen(s, at); s.phases[name] = { started: at, ended: null }; s.phase = name; };
const addSkipped = (s, list) => { if (list?.length) s.skipped = [...(s.skipped ?? []), ...list]; };

const apply = {
  'init-pending'(s, d, at) {
    Object.assign(s, { repo: d.repo ?? null, pr: d.pr ?? null, mode: d.mode ?? 'default', started: at });
    if (d.owner) s.owner = d.owner;
    open(s, 'pending', at);
  },
  init(s, d, at) {
    for (const k of ['title', 'author', 'mode', 'head', 'base', 'probes', 'viewer']) if (d[k] !== undefined) s[k] = d[k];
    if (d.repo !== undefined && s.repo === null) s.repo = d.repo;
    if (d.pr !== undefined && s.pr === null) s.pr = d.pr;
    if (d.review_state) s.review_state = d.review_state;
    const ev = d.evidence_started ?? at;
    if (s.started === null) s.started = ev;
    closeOpen(s, ev);
    s.phases.evidence = { started: ev, ended: at };
    s.phase = 'evidence';
  },
  phase(s, d, at) {
    addSkipped(s, d.skipped);
    open(s, d.name, at);
  },
  // Phases a jump straight to finish passed over; finish's own data stays
  // free of them, so a re-run finish with the same result is a replay.
  skip(s, d) { addSkipped(s, d.skipped); },
  output(s, d) { s.outputs = { ...(s.outputs ?? {}), [d.phase]: { file: d.file, rows: d.rows } }; },
  early(s, d) { s.early = d.early; },
  finish(s, d, at) {
    closeOpen(s, at);
    s.ended = at; s.phase = 'rendered';
    for (const k of ['note', 'verdict', 'findings', 'gates']) if (d[k] !== undefined) s[k] = d[k];
    if (d.review_state) s.review_state = d.review_state;
  },
  posted(s, d, at) { closeOpen(s, at); s.phase = 'posted'; s.posted = { url: d.url, state: d.state, at }; },
  abandon(s, d, at) { closeOpen(s, at); s.phase = 'abandoned'; s.ended = at; s.abandoned = d.reason ?? 'unknown'; },
  fail(s, d, at) { closeOpen(s, at); s.phase = 'failed'; s.ended = at; s.failed = d.reason ?? 'unknown'; },
};

/** state.json is this, over every event in file order. An unknown op is ignored, not fatal. */
export function fold(events) {
  const s = blank();
  for (const e of events) apply[e.op]?.(s, e.data ?? {}, e.at);
  return s;
}

/**
 * May the run move from s.phase to `target`? Returns {ok, skipped, noop?, reason?}.
 * Forward only; a jump is legal only over phases this mode skips, or over
 * refute+triage when settle recorded zero candidates.
 */
export function checkTransition(s, target) {
  const allowed = () => PHASES.slice(PHASES.indexOf(s.phase) + 1).concat(TERMINAL).join(', ');
  if (TERMINAL.includes(s.phase) || s.phase === 'posted') return { ok: false, skipped: [], reason: `run is ${s.phase}; nothing follows it` };
  if (TERMINAL.includes(target)) return { ok: true, skipped: [] };
  const from = PHASES.indexOf(s.phase ?? 'pending');
  const to = PHASES.indexOf(target);
  if (to === -1) return { ok: false, skipped: [], reason: `unknown phase ${target}; allowed next: ${allowed()}` };
  if (to === from) return { ok: true, noop: true, skipped: [] };
  if (to < from) return { ok: false, skipped: [], reason: `${target} is behind ${s.phase}; allowed next: ${allowed()}` };
  const zero = s.outputs?.settle?.rows === 0;
  if (zero && ZERO_SKIPS.includes(target)) {
    return { ok: false, skipped: [], reason: `zero candidates after settle: go to teach (refute and triage are skipped by rule)` };
  }
  const already = new Set((s.skipped ?? []).map((x) => x.phase));
  const skipped = [];
  for (const p of PHASES.slice(from + 1, to)) {
    if (already.has(p)) continue;
    if (MODE_SKIPS[s.mode]?.includes(p)) skipped.push({ phase: p, reason: `mode:${s.mode}` });
    else if (zero && ZERO_SKIPS.includes(p)) skipped.push({ phase: p, reason: 'zero-candidates' });
    else return { ok: false, skipped: [], reason: `cannot jump ${s.phase} → ${target}: ${p} has not run; allowed next: ${allowed()}` };
  }
  return { ok: true, skipped };
}
