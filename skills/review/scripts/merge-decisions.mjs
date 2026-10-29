#!/usr/bin/env node
// merge-decisions.mjs <run> — the phase-3 merge, as a script so no model does
// arithmetic on tables. Reads the readers' output and writes four things:
//
//   work/ledger.md          every row's Decision filled from work/decisions/*.md
//                           lines `| <row#> | <Decision> |`; a row two readers
//                           answered keeps both answers, prefixed `conflict:`;
//                           a row nobody answered stays empty (gate 1 names it)
//   work/ledger.phase2.bak  the ledger as phase 2 left it, written once
//   work/claims.jsonl       work/claims/*.jsonl concatenated, file order
//   work/candidates.md      `- row N: <text>` for every `→ candidate:` clause
//                           whose text is not empty / none / n/a, ledger order
//
// Cells split on unescaped `|` only (cells.mjs); CRLF decision files are
// tolerated. Re-running is safe: Decision is rebuilt from the decision files
// each time and the backup is never overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { splitCells } from './cells.mjs';

const run = process.argv[2];
if (!run) { console.error('usage: merge-decisions.mjs <run-dir>'); process.exit(2); }
const work = (f) => path.join(run, 'work', f);
const listDir = (d, ext) => (fs.existsSync(work(d)) ? fs.readdirSync(work(d)).filter((f) => f.endsWith(ext)).sort() : []);

const ledgerPath = work('ledger.md');
if (!fs.existsSync(ledgerPath)) { console.error(`merge-decisions: ${ledgerPath} missing`); process.exit(1); }
const ledgerText = fs.readFileSync(ledgerPath, 'utf8');
const bak = work('ledger.phase2.bak');
if (!fs.existsSync(bak)) fs.writeFileSync(bak, ledgerText);

const isRow = (l) => /^\|\s*\d+\s*\|/.test(l);

// row# -> [decision, ...] in file order; a reader who forgot to escape a pipe
// gets the extra cells joined back with an escaped one.
const decisions = new Map();
for (const f of listDir('decisions', '.md')) {
  for (const line of fs.readFileSync(work(path.join('decisions', f)), 'utf8').split('\n')) {
    if (!isRow(line)) continue;
    const c = splitCells(line);
    const n = Number(c[0]);
    const text = c.slice(1).join(' \\| ').trim();
    if (!decisions.has(n)) decisions.set(n, []);
    decisions.get(n).push(text);
  }
}

let filled = 0; let conflicts = 0; const unanswered = []; const seen = new Set();
const lines = ledgerText.split('\n').map((line) => {
  if (!isRow(line)) return line;
  const c = splitCells(line);
  const n = Number(c[0]);
  seen.add(n);
  const ds = decisions.get(n) ?? [];
  if (ds.length === 0) { unanswered.push(n); c[3] = ''; }
  else if (ds.length === 1) { filled++; c[3] = ds[0]; }
  else { filled++; conflicts++; c[3] = `conflict: ${ds.join(' // ')}`; }
  // the ledger has four columns; anything a row carried beyond them is kept
  while (c.length < 4) c.push('');
  return `| ${c.join(' | ')} |`;
});
fs.writeFileSync(ledgerPath, lines.join('\n'));
const stray = [...decisions.keys()].filter((n) => !seen.has(n));

const claimFiles = listDir('claims', '.jsonl');
const claimLines = claimFiles.flatMap((f) => fs.readFileSync(work(path.join('claims', f)), 'utf8').split(/\r?\n/).filter((l) => l.trim()));
fs.writeFileSync(work('claims.jsonl'), claimLines.length ? claimLines.join('\n') + '\n' : '');

// `→ candidate:` clauses, read from each reader's own decision (not the
// merged cell, whose conflict joiner would leak into the text), in ledger
// order. A clause whose text says nothing is a reader slip (the prompt
// forbids it), not a candidate.
const isNothing = (t) => /^(none|n\/a|n-a|na|-)?[.]?$/i.test(t.trim());
const candidates = [];
for (const line of lines) {
  if (!isRow(line)) continue;
  const n = Number(splitCells(line)[0]);
  for (const d of decisions.get(n) ?? []) {
    const m = d.match(/→\s*candidate:\s*(.*)$/);
    if (m && !isNothing(m[1])) candidates.push(`- row ${n}: ${m[1].trim()}`);
  }
}
fs.writeFileSync(work('candidates.md'), candidates.length ? candidates.join('\n') + '\n' : '');

console.log(`decisions: ${filled} row(s) filled from ${listDir('decisions', '.md').length} file(s), ${conflicts} conflict(s), ${unanswered.length} unanswered${unanswered.length ? ` (row ${unanswered.join(', ')})` : ''}${stray.length ? `, ${stray.length} stray (row ${stray.join(', ')} not in ledger)` : ''}`);
console.log(`claims: ${claimLines.length} line(s) from ${claimFiles.length} file(s)`);
console.log(`candidates: ${candidates.length}`);
