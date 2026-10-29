#!/usr/bin/env node
// early-signal.mjs <run> — after the phase-3 merge, name the candidates that
// already rest on hard evidence, before refute and triage have run. Two
// shapes qualify, each with a `basis` the reader of the list can check:
//
//   probe-failed:<probe>  a claim on the candidate's row is RAN and its source
//                         is a probe the manifest marks FAILED (a build or vet
//                         that did not pass is a fact, not an opinion)
//   blocking-ran          the reader tagged the candidate `[Blocking]` and at
//                         least one RAN claim sits on its row
//
// A candidate on an Unresolved row never qualifies: gate 3 would demote it
// anyway. Writes work/early.json (the list render.mjs reads) and
// work/early.md (the same list for a human), then records it in state.json
// through state.mjs, which stays the one writer of that file. Nothing here
// is posted, and candidates.md is untouched: refute and triage see the same
// list they would have seen without this script.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitCells } from './cells.mjs';

const run = process.argv[2];
if (!run) { console.error('usage: early-signal.mjs <run-dir>'); process.exit(2); }
const work = (f) => path.join(run, 'work', f);
const ev = (f) => path.join(run, 'evidence', f);
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const jsonIf = (p) => { const t = readIf(p); if (t === null) return null; try { return JSON.parse(t); } catch { return null; } };

const ledgerText = readIf(work('ledger.md'));
if (ledgerText === null) { console.error(`early-signal: ${work('ledger.md')} missing`); process.exit(1); }
const candidatesText = readIf(work('candidates.md'));
if (candidatesText === null) { console.error(`early-signal: ${work('candidates.md')} missing; run merge-decisions first`); process.exit(1); }

// row# -> Decision cell
const isRow = (l) => /^\|\s*\d+\s*\|/.test(l);
const decisions = new Map();
for (const line of ledgerText.split('\n')) {
  if (!isRow(line)) continue;
  const c = splitCells(line);
  decisions.set(Number(c[0]), c[3] ?? '');
}
const isUnresolved = (cell) => /^\*{0,2}unresolved\b/i.test(cell);

// claims by row; a line that is not JSON is skipped here, gate 3 names it
const claimsByRow = new Map();
for (const line of (readIf(work('claims.jsonl')) ?? '').split('\n')) {
  if (!line.trim()) continue;
  let c; try { c = JSON.parse(line); } catch { continue; }
  const n = Number(c?.row);
  if (!claimsByRow.has(n)) claimsByRow.set(n, []);
  claimsByRow.get(n).push(c);
}

// FAILED probes; a claim names one by its output file, its err file, or
// `probes/<name>` — the three spellings readers use for the same thing
const manifest = jsonIf(ev('manifest.json'));
const failed = (Array.isArray(manifest?.probes) ? manifest.probes : []).filter((p) => p?.status === 'FAILED');
const namesProbe = (source, p) => {
  const s = String(source ?? '');
  return [p.file, p.err, `probes/${p.name}`].filter(Boolean).some((k) => s.includes(k));
};

const early = [];
for (const line of candidatesText.split('\n')) {
  const m = line.match(/^-\s*row\s+(\d+):\s*(.*)$/);
  if (!m) continue;
  const row = Number(m[1]);
  const text = m[2].trim();
  if (!decisions.has(row) || isUnresolved(decisions.get(row))) continue;
  const blocking = /^\[blocking\]\s*/i.test(text);
  const title = text.replace(/^\[blocking\]\s*/i, '').trim();
  const ran = (claimsByRow.get(row) ?? []).filter((c) => c.class === 'RAN');
  let basis = null;
  for (const c of ran) {
    const p = failed.find((probe) => namesProbe(c.source, probe));
    if (p) { basis = `probe-failed:${p.name}`; break; }
  }
  if (!basis && blocking && ran.length) basis = 'blocking-ran';
  if (basis) early.push({ row, title, basis });
}

fs.writeFileSync(work('early.json'), JSON.stringify(early, null, 2) + '\n');
const md = early.length
  ? [`## Early signal — ${early.length} unrefuted at phase 3`, '',
     ...early.map((e) => `- row ${e.row}: ${e.title} — ${e.basis} (unrefuted at phase 3)`), ''].join('\n')
  : '## Early signal — none at phase 3\n';
fs.writeFileSync(work('early.md'), md);

// state.json is the HUD's file and state.mjs its one writer; a run with no
// state file (a fixture, a replay of work files alone) still gets early.*
const state = path.join(path.dirname(fileURLToPath(import.meta.url)), 'state.mjs');
const r = spawnSync(process.execPath, [state, run, 'early'], { encoding: 'utf8' });
if (r.status !== 0) console.error(`early-signal: state.json not updated: ${(r.stderr ?? '').trim()}`);

console.log(`early: ${early.length}${early.length ? ` (row ${early.map((e) => e.row).join(', ')})` : ''}`);
