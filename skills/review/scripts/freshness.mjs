#!/usr/bin/env node
// freshness.mjs <run> <recheck-run> — phase 7's look at the live PR, after
// the artifact is rendered and before anything is posted. The artifact was
// computed from a snapshot; three things move under it while the review runs,
// and each one changes what may be posted:
//
//   state     the PR is no longer open (merged or closed): there is nothing
//             left to review, and a merged PR keeps its head and its green
//             checks, so the other axes cannot catch it. Exit 1; do not post.
//   head      the PR head sha moved: the review is of a commit that is no
//             longer the PR. Exit 1; re-review, do not post.
//   checks    a check is failing or still pending in the recheck snapshot (or
//             the checks probe was UNAVAILABLE): the verdict is capped at
//             COMMENT. An approval on a red or unfinished PR asserts something
//             the review did not see. Unknown states count as pending.
//   activity  reviews, PR comments, or thread comments posted since the
//             original snapshot by anyone but the viewer: each must be read
//             before posting, and a finding it already raises is referenced,
//             not repeated.
//
// Writes <run>/work/freshness.json and prints one line per axis plus one per
// new activity item. Exit 0 unless the PR is not open, the head moved, or an
// input is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAILING = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

const firstLine = (s) => String(s ?? '').split('\n').find((l) => l.trim())?.trim().slice(0, 120) ?? '';

export function assess({ origTarget, origContext, recheckTarget, recheckContext, checks, checksStatus, viewer, prState }) {
  const then = origTarget?.head ?? null;
  const now = recheckTarget?.head ?? null;
  const head = { then, now, moved: Boolean(then && now && then !== now) };
  // Unknown (no pr-shas) is not treated as closed: the head check still runs,
  // and a missing state is printed so the operator sees it was not checked.
  const state = { value: prState ?? null, open: prState == null || String(prState).toUpperCase() === 'OPEN' };

  const failing = []; const pending = [];
  if (checksStatus === 'RAN' && Array.isArray(checks)) {
    for (const c of checks) {
      const st = String(c.state ?? '').toUpperCase();
      if (FAILING.has(st)) failing.push(c.name);
      else if (!PASSING.has(st)) pending.push(c.name);
    }
  }
  const checksOut = { status: checksStatus ?? 'UNAVAILABLE', failing, pending };

  const since = origContext?.generated_at ?? null;
  const newer = (at) => since === null || (at && at > since);
  const notViewer = (a) => !viewer || a !== viewer;
  const activity = [];
  for (const r of recheckContext?.reviews?.items ?? []) {
    if (newer(r.at) && notViewer(r.author)) activity.push({ kind: r.kind ?? 'review', author: r.author, at: r.at, where: null, text: firstLine(r.body) });
  }
  for (const t of recheckContext?.threads?.items ?? []) {
    for (const c of t.comments ?? []) {
      if (newer(c.at) && notViewer(c.author)) activity.push({ kind: 'thread', author: c.author, at: c.at, where: `${t.path}:${t.line}`, text: firstLine(c.body) });
    }
  }
  activity.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const capped = checksOut.status !== 'RAN' || failing.length > 0 || pending.length > 0;
  return { since, state, head, checks: checksOut, activity, verdict_cap: capped ? 'COMMENT' : null, postable: state.open && !head.moved };
}

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return undefined; } };

function main() {
  const [run, recheck] = process.argv.slice(2);
  if (!run || !recheck) { console.error('usage: freshness.mjs <run-dir> <recheck-run-dir>'); process.exit(2); }
  const ev = (r, f) => path.join(r, 'evidence', f);
  const origTarget = readJSON(ev(run, 'target.json'));
  const recheckTarget = readJSON(ev(recheck, 'target.json'));
  if (!origTarget || !recheckTarget) { console.error('freshness: target.json missing in the run or the recheck'); process.exit(1); }
  const manifest = readJSON(ev(recheck, 'manifest.json'));
  const checksProbe = manifest?.probes?.find((p) => p.name === 'core/pr-checks');
  const result = assess({
    origTarget, recheckTarget,
    origContext: readJSON(ev(run, 'pr/context.json')),
    recheckContext: readJSON(ev(recheck, 'pr/context.json')),
    checks: readJSON(ev(recheck, 'probes/core/pr-checks.out')),
    checksStatus: checksProbe?.status,
    viewer: readJSON(path.join(run, 'state.json'))?.viewer ?? null,
    prState: readJSON(ev(recheck, 'probes/core/pr-shas.out'))?.data?.repository?.pullRequest?.state ?? null,
  });
  fs.mkdirSync(path.join(run, 'work'), { recursive: true });
  fs.writeFileSync(path.join(run, 'work', 'freshness.json'), JSON.stringify(result, null, 2) + '\n');

  const { state, head, checks, activity } = result;
  if (state.value === null) console.log('state: not checked (no pr-shas in the recheck)');
  else console.log(state.open ? 'state: OPEN — ok' : `state: ${state.value} — nothing to post`);
  console.log(head.moved ? `head: moved ${head.then} → ${head.now} — re-review, do not post` : `head: unchanged ${head.now} — ok`);
  if (checks.status !== 'RAN') console.log(`checks: ${checks.status} — verdict capped at COMMENT`);
  else if (checks.failing.length || checks.pending.length) {
    console.log(`checks: ${checks.failing.length} failing${checks.failing.length ? ` (${checks.failing.join(', ')})` : ''}, ${checks.pending.length} pending${checks.pending.length ? ` (${checks.pending.join(', ')})` : ''} — verdict capped at COMMENT`);
  } else console.log('checks: all passing — ok');
  console.log(`activity: ${activity.length} new item(s) since ${result.since ?? 'the snapshot'}${activity.length ? ' — read each before posting' : ' — ok'}`);
  for (const a of activity) console.log(`  - ${a.at} ${a.kind} ${a.author}${a.where ? ` ${a.where}` : ''}: ${a.text}`);
  process.exit(result.postable ? 0 : 1);
}

// Run as a script, not when imported by a test. Real paths, because the skill
// is normally reached through a symlink.
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main();
