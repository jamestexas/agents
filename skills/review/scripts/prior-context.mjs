#!/usr/bin/env node
// prior-context.mjs — what an earlier review of this PR concluded and told the
// author, gathered by script so a re-review starts from it instead of from
// memory or this conversation.
//
//   prior-context.mjs <run> head    print the head the last review saw (empty
//                                   when there is none); pass it as --since
//   prior-context.mjs <run> write [--engage]
//                                   copy the last review's findings, posted
//                                   body and verdict into <run>/evidence/prior/
//                                   and print the whole {{THREADS}} list: one
//                                   line per prior finding, legacy artifact,
//                                   thread and review (see below)
//
// Run `head` after `state.mjs init --pending --new` (which archives the ended
// run and appends its history line) and before review-evidence.sh; run `write`
// after review-evidence.sh, since that script owns evidence/.
//
// Two sources, newest first:
//   1. runs/history.jsonl's last line and its archive: the /review run before
//      this one. Its work/findings.json, work/post.md and work/summary.md.
//   2. Legacy artifacts in the PR folder that no history line accounts for:
//      structural-review.md, structural-post.md, and a review.md written before
//      the folder had any /review run. They have no machine-readable findings,
//      so each becomes one row asking whether what it raised still holds.
//
// Threads and reviews come from evidence/pr/context.json. On a first review
// they are listed only under --engage. On a re-review they are always listed,
// cut to what the last run did not already settle: unresolved threads, threads
// resolved with a comment after the last run ended (a resolve is not a fix),
// and reviews submitted after it. Re-listing every past review re-asks settled
// history and spends the readers on it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [run, op, ...flags] = process.argv.slice(2);
const engage = flags.includes('--engage');
if (!run || !['head', 'write'].includes(op)) {
  console.error('usage: prior-context.mjs <run> head | write [--engage]');
  process.exit(2);
}

const tryJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };
const historyFile = path.join(run, 'runs', 'history.jsonl');
const history = fs.existsSync(historyFile)
  ? fs.readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).map(tryJSON).filter((h) => h && typeof h.archive === 'string')
  : [];
const last = history.at(-1) ?? null;

if (op === 'head') {
  if (last?.head) process.stdout.write(`${last.head}\n`);
  process.exit(0);
}

const tarBin = ['tar', '/usr/bin/tar', '/bin/tar'].find((b) => !spawnSync(b, ['--version']).error) ?? 'tar';
const fromArchive = (member) => {
  const r = spawnSync(tarBin, ['-xzOf', path.join(run, last.archive), member], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
};

const out = path.join(run, 'evidence', 'prior');
fs.mkdirSync(out, { recursive: true });
const lines = [];

if (last) {
  const findings = tryJSON(fromArchive('work/findings.json') ?? '') ?? [];
  const post = fromArchive('work/post.md');
  const summary = fromArchive('work/summary.md');
  const meta = { head: last.head ?? null, mode: last.mode ?? null, verdict: last.verdict ?? null, ended: last.ended ?? null, posted: last.posted ?? null, archive: last.archive, findings: findings.length };
  fs.writeFileSync(path.join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'findings.json'), `${JSON.stringify(findings, null, 2)}\n`);
  if (post) fs.writeFileSync(path.join(out, 'post.md'), post);
  if (summary) fs.writeFileSync(path.join(out, 'summary.md'), summary);
  // A finding the author was shown is one they may have answered; one that
  // stayed local can only be fixed or open.
  const told = post ? 'posted' : 'not posted';
  for (const f of findings) {
    lines.push(`- prior finding [${f.tag ?? '?'}] ${f.file_line ?? '?'} — ${String(f.title ?? '').split('\n')[0]} (${told})`);
  }
}

// The PR folder is raw/'s parent. A review.md there belongs to /review once any
// history line exists; before that it is a hand-composed review.
const prDir = path.dirname(path.resolve(run));
const legacy = ['structural-review.md', 'structural-post.md'];
if (history.length === 0) legacy.push('review.md');
for (const name of legacy) {
  const src = path.join(prDir, name);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.join(out, 'legacy'), { recursive: true });
  fs.copyFileSync(src, path.join(out, 'legacy', name));
  lines.push(`- prior review (legacy) evidence/prior/legacy/${name} — does what it raised still hold at this head`);
}

if (lines.length === 0) fs.rmSync(out, { recursive: true, force: true });

const ctx = tryJSON(fs.existsSync(path.join(run, 'evidence', 'pr', 'context.json')) ? fs.readFileSync(path.join(run, 'evidence', 'pr', 'context.json'), 'utf8') : '');
const rereview = history.length > 0 || lines.length > 0;
if (ctx && (engage || rereview)) {
  const since = rereview ? (last?.ended ?? null) : null;
  const after = (at) => since == null || (typeof at === 'string' && at > since);
  const first = (b) => String(b ?? '').split('\n').find((l) => l.trim()) ?? '';
  for (const t of ctx.threads?.items ?? []) {
    const comments = t.comments ?? [];
    const open = t.state === 'unresolved' || t.resolved === false;
    const newlyResolved = !open && since != null && comments.some((c) => after(c.at));
    if (!open && !newlyResolved) continue;
    lines.push(`- thread ${t.path ?? '?'}:${t.line ?? '?'}${newlyResolved ? ' (resolved since the last review)' : ''} — ${first(comments[0]?.body)}`);
  }
  for (const r of ctx.reviews?.items ?? []) {
    if (r.kind !== 'review' || !String(r.body ?? '').trim() || !after(r.at)) continue;
    lines.push(`- review by ${r.author ?? '?'} (${r.state ?? '?'}) — ${first(r.body)}`);
  }
}
process.stdout.write(lines.length ? `${lines.join('\n')}\n` : '');
