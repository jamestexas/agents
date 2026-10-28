#!/usr/bin/env node
// state.mjs <run> <op> [k=v ...] — the one writer of <run>/state.json, the
// file the HUD reviews panel reads. Each phase of /review calls it once, so a
// panel can show where a run is without opening the work files. Nothing here
// judges the review; check.mjs does that, and `finish` only records its
// verdict per gate.
//
//   init   mode=<light|default|deep> [viewer=<login>]
//          evidence/target.json + evidence/manifest.json (+ core/pr-shas.out,
//          pr/context.json for title and author) -> a fresh state.json.
//          viewer is the operator's login (`gh api user` when not given);
//          with pr/context.json present, init and finish also write
//          review_state: who has reviewed, and who is waiting on whom.
//   phase  <name>        close the open phase, open <name>
//   finish note=<rel> [gates=-]
//          ended=now, phase "rendered", verdict from work/summary.md, finding
//          counts from work/findings.json, gates from check.mjs output: read
//          from stdin when gates=- (pipe `check.mjs <run> | state.mjs ...`),
//          otherwise check.mjs is re-run here. Explicit rather than "stdin if
//          not a TTY", so a harness with an open-but-silent stdin cannot hang.
//   posted url=<u> state=<s>   phase "posted"
//
// The schema is the HUD's contract (hud/server.mjs REVIEW_FIELDS):
//   {version, repo, pr, title, author, mode, head, base, phase,
//    phases{<name>:{started,ended}}, started, ended, verdict,
//    gates{ledger,triage,blocking}, probes{total,ran,failed,unavailable},
//    findings{blocking,non_blocking,question,observation}, note,
//    posted{url,state,at}|null}
// plus two keys the HUD ignores today: viewer, and (only when
// evidence/pr/context.json exists) review_state:
//   {authorship: own|peer|null, mine{state,at,head_matches},
//    humans[{login,state,at}], bots[{login,state,findings,at}],
//    threads{total,unresolved,awaiting_me,awaiting_author}}
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [run, op, ...rest] = process.argv.slice(2);
const usage = () => { console.error('usage: state.mjs <run> init|phase <name>|finish|posted [k=v ...]'); process.exit(2); };
if (!run || !op) usage();

const statePath = path.join(run, 'state.json');
const ev = (f) => path.join(run, 'evidence', f);
const work = (f) => path.join(run, 'work', f);
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const jsonIf = (p) => { const t = readIf(p); if (t === null) return null; try { return JSON.parse(t); } catch { return null; } };
const now = () => new Date().toISOString();

// k=v arguments; a key the op does not know is a typo, not an extension.
const kv = (allowed) => {
  const out = {};
  for (const a of rest) {
    const i = a.indexOf('=');
    if (i === -1) { console.error(`state.mjs: expected k=v, got ${a}`); process.exit(2); }
    const k = a.slice(0, i);
    if (!allowed.includes(k)) { console.error(`state.mjs ${op}: unknown key ${k}`); process.exit(2); }
    out[k] = a.slice(i + 1);
  }
  return out;
};

const load = () => {
  const s = jsonIf(statePath);
  if (!s) { console.error(`state.mjs: ${statePath} missing or not JSON; run init first`); process.exit(1); }
  return s;
};
const save = (s) => {
  const tmp = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
  fs.renameSync(tmp, statePath);
};
// Close whichever phase is still open before another starts; a phase that
// was never opened (a skipped --light stage) has nothing to close.
const closeOpen = (s, at) => {
  for (const p of Object.values(s.phases)) if (p.ended === null) p.ended = at;
};

const ops = {
  init() {
    const { mode = 'default', viewer: viewerArg } = kv(['mode', 'viewer']);
    const target = jsonIf(ev('target.json'));
    if (!target) { console.error(`state.mjs init: ${ev('target.json')} missing or not JSON`); process.exit(1); }
    const manifest = jsonIf(ev('manifest.json'));
    const probes = Array.isArray(manifest?.probes) ? manifest.probes : [];
    const count = (st) => probes.filter((p) => p.status === st).length;
    const shas = jsonIf(ev('probes/core/pr-shas.out'))?.data?.repository?.pullRequest ?? null;
    const context = jsonIf(ev('pr/context.json'));
    const ctx = context?.pr ?? null;
    const viewer = viewerArg ?? ghViewer();
    const prNum = /^\d+$/.test(String(target.pr ?? '')) ? Number(target.pr) : null;
    // Evidence ran before init; its span is the manifest's, not "now".
    const starts = probes.map((p) => p.started).filter((t) => t && !Number.isNaN(Date.parse(t))).sort();
    const at = now();
    const started = starts[0] ?? at;
    save({
      version: 1,
      repo: target.repo ?? null,
      pr: prNum,
      title: shas?.title ?? ctx?.title ?? null,
      author: shas?.author?.login ?? ctx?.author ?? null,
      mode,
      head: target.head ?? null,
      base: target.base ?? null,
      phase: 'evidence',
      phases: { evidence: { started, ended: at } },
      started,
      ended: null,
      verdict: null,
      gates: { ledger: null, triage: null, blocking: null },
      probes: { total: probes.length, ran: count('RAN'), failed: count('FAILED'), unavailable: count('UNAVAILABLE') },
      findings: { blocking: 0, non_blocking: 0, question: 0, observation: 0 },
      note: null,
      posted: null,
      viewer,
      ...(context ? { review_state: reviewState(context, viewer, target.head ?? null) } : {}),
    });
  },

  phase() {
    const name = rest.shift();
    if (!name || name.includes('=')) usage();
    kv([]);
    const s = load();
    const at = now();
    closeOpen(s, at);
    s.phases[name] = { started: at, ended: null };
    s.phase = name;
    save(s);
  },

  finish() {
    const args = kv(['note', 'gates']);
    const s = load();
    const at = now();
    closeOpen(s, at);
    s.ended = at;
    s.phase = 'rendered';
    if (args.note !== undefined) s.note = relNote(args.note);
    const summary = readIf(work('summary.md')) ?? '';
    const v = summary.match(/\*\*Verdict\*\*[^A-Z]*(APPROVE|REQUEST_CHANGES|COMMENT)\b/);
    s.verdict = v ? v[1] : null;
    s.findings = countFindings(jsonIf(work('findings.json')));
    s.gates = parseGates(args.gates === '-' ? fs.readFileSync(0, 'utf8') : runCheck());
    const context = jsonIf(ev('pr/context.json'));
    if (context) s.review_state = reviewState(context, s.viewer ?? null, s.head ?? null);
    save(s);
  },

  posted() {
    const args = kv(['url', 'state']);
    if (!args.url || !args.state) { console.error('state.mjs posted: need url= and state='); process.exit(2); }
    const s = load();
    const at = now();
    closeOpen(s, at);
    s.phase = 'posted';
    s.posted = { url: args.url, state: args.state, at };
    save(s);
  },
};

// The HUD links a note by its path under HUD_ROOT and refuses an absolute
// one; an absolute path under the HUD tree is relativised, anything else is
// kept as given so a scratch-path run still records where its note went.
function relNote(p) {
  if (!path.isAbsolute(p)) return p;
  const hud = process.env.HUD_ROOT || path.join(os.homedir(), 'hud');
  const rel = path.relative(hud, p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
}

function countFindings(findings) {
  const c = { blocking: 0, non_blocking: 0, question: 0, observation: 0 };
  if (!Array.isArray(findings)) return c;
  const key = { Blocking: 'blocking', 'Non-blocking': 'non_blocking', Question: 'question', Observation: 'observation' };
  for (const f of findings) if (key[f?.tag]) c[key[f.tag]]++;
  return c;
}

// check.mjs prints one line per gate: `<gate>: <detail> — ok` on a pass and
// `<gate>: <reason>` on a failure. A gate that printed nothing stays null.
function parseGates(text) {
  const g = { ledger: null, triage: null, blocking: null };
  for (const line of String(text).split('\n')) {
    const m = line.match(/^(ledger|triage|blocking):\s*(.*)$/);
    if (!m) continue;
    const ok = /— ok\s*$/.test(m[2]);
    // Several lines may name one gate (gate 3 reports per finding); one
    // failure makes the gate fail.
    g[m[1]] = ok && g[m[1]] !== 'fail' ? 'ok' : 'fail';
  }
  return g;
}

// The operator's login; null when gh is absent or not logged in, which makes
// authorship and the awaiting counts unknowable rather than wrong.
function ghViewer() {
  const r = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' });
  const login = (r.stdout ?? '').trim();
  return r.status === 0 && login ? login : null;
}

// A reviewer is a bot by what it is, not what it is called: pr-context.sh's
// `is_bot` covers GitHub's Bot type and a named list, but an app-installed
// reviewer posts as an ordinary User whose login only carries the install
// suffix (`-app`), so the flag alone misses it. The pattern is the second net.
const BOT_LOGIN_RE = /(-app$|\[bot\]$|^(reviewbot|autorev|depthfirst|github-actions|dependabot)\b)/i;
const isBot = (item) => item?.is_bot === true || BOT_LOGIN_RE.test(item?.author ?? '');

// Who has said what, and who the open threads wait on. Reads pr-context.sh's
// shape: reviews.items[{kind: review|comment, author, is_bot, state, at}],
// threads.items[{state: resolved|unresolved, participants, comments[{author, at}]}].
function reviewState(context, viewer, head) {
  const author = context.pr?.author ?? null;
  const reviews = Array.isArray(context.reviews?.items) ? context.reviews.items : [];
  const threads = Array.isArray(context.threads?.items) ? context.threads.items : [];
  const threadsKnown = ['ok', 'empty'].includes(context.threads?.status);
  const byAt = (a, b) => String(a.at ?? '').localeCompare(String(b.at ?? ''));
  // latest item per login, in the order each login first appears
  const latest = (items) => {
    const m = new Map();
    for (const it of [...items].sort(byAt)) m.set(it.author, it);
    return [...m.values()];
  };
  const submitted = reviews.filter((r) => r.kind === 'review');
  const mineLatest = viewer ? latest(submitted.filter((r) => r.author === viewer))[0] : undefined;
  const humans = latest(submitted.filter((r) => !isBot(r) && r.author !== viewer))
    .map((r) => ({ login: r.author, state: r.state ?? null, at: r.at ?? null }));
  const bots = latest(reviews.filter(isBot)).map((r) => ({
    login: r.author,
    state: r.state ?? null,
    // a bot's findings are the inline threads it opened; unknown when the
    // thread query did not run
    findings: threadsKnown ? threads.filter((t) => t.comments?.[0]?.author === r.author).length : null,
    at: r.at ?? null,
  }));
  const t = { total: threads.length, unresolved: 0, awaiting_me: 0, awaiting_author: 0 };
  for (const th of threads) {
    if (th.state !== 'unresolved') continue;
    t.unresolved++;
    if (!viewer) continue; // cannot tell whose turn it is
    const last = th.comments?.at(-1)?.author;
    const participated = (th.participants ?? []).includes(viewer);
    if (participated && last !== viewer) t.awaiting_me++;
    else if (last === viewer || (last !== undefined && last !== author)) t.awaiting_author++;
  }
  return {
    authorship: viewer && author ? (viewer === author ? 'own' : 'peer') : null,
    mine: {
      state: mineLatest?.state ?? null,
      at: mineLatest?.at ?? null,
      head_matches: mineLatest?.commit && head ? mineLatest.commit === head : null,
    },
    humans,
    bots,
    threads: t,
  };
}

function runCheck() {
  const check = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check.mjs');
  const r = spawnSync(process.execPath, [check, run], { encoding: 'utf8' });
  return r.stdout ?? '';
}

if (!ops[op]) usage();
ops[op]();
console.log(statePath);
