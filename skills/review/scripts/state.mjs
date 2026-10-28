#!/usr/bin/env node
// state.mjs <run> <op> [k=v ...] — the one writer of <run>/state.json, the
// file the HUD reviews panel reads. Each phase of /review calls it once, so a
// panel can show where a run is without opening the work files. Nothing here
// judges the review; check.mjs does that, and `finish` only records its
// verdict per gate.
//
//   init   mode=<light|default|deep>
//          evidence/target.json + evidence/manifest.json (+ core/pr-shas.out,
//          pr/context.json for title and author) -> a fresh state.json
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
    const { mode = 'default' } = kv(['mode']);
    const target = jsonIf(ev('target.json'));
    if (!target) { console.error(`state.mjs init: ${ev('target.json')} missing or not JSON`); process.exit(1); }
    const manifest = jsonIf(ev('manifest.json'));
    const probes = Array.isArray(manifest?.probes) ? manifest.probes : [];
    const count = (st) => probes.filter((p) => p.status === st).length;
    const shas = jsonIf(ev('probes/core/pr-shas.out'))?.data?.repository?.pullRequest ?? null;
    const ctx = jsonIf(ev('pr/context.json'))?.pr ?? null;
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

function runCheck() {
  const check = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check.mjs');
  const r = spawnSync(process.execPath, [check, run], { encoding: 'utf8' });
  return r.stdout ?? '';
}

if (!ops[op]) usage();
ops[op]();
console.log(statePath);
