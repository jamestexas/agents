#!/usr/bin/env node
// check.mjs <run-dir> — the three arithmetic gates from the spec. Exit 0 means
// the artifact may be posted. Every failure names the row or finding, so a
// reader can fix the one thing instead of re-running the review. Each gate
// reports on its own, so one failure does not hide what the others found.
//
//   1. ledger:   footer "Questions asked: N." == table rows; no empty
//                Decision; not every row Unresolved (that settles nothing)
//   2. triage:   header "N candidates in, N dispositions out" == rows of the
//                table under that header (other tables in the file are ignored)
//   3. blocking: every [Blocking] finding cites >=1 RAN/READ claim, 0 ASSUMED,
//                no claim id missing from claims.jsonl, and >=1 ledger row that
//                exists and is not Unresolved (an unresolved row demotes the
//                finding to a Question)
import fs from 'node:fs';
import path from 'node:path';

const run = process.argv[2];
if (!run) { console.error('usage: check.mjs <run-dir>'); process.exit(2); }
const work = (f) => path.join(run, 'work', f);
const read = (f) => fs.existsSync(work(f)) ? fs.readFileSync(work(f), 'utf8') : null;
const tryJSON = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

const isRow = (l) => /^\|\s*\d+\s*\|/.test(l);
const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
// Every numbered table row in a document.
const tableRows = (md) => md.split('\n').filter(isRow).map(cells);
// Numbered rows of the first table after the line matching `header`: skip to
// the first `|` line, then stop at the first line that is not part of it.
const tableAfter = (md, header) => {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => header.test(l));
  if (start === -1) return [];
  const rows = [];
  let inTable = false;
  for (const l of lines.slice(start + 1)) {
    const isTableLine = l.startsWith('|');
    if (inTable && !isTableLine) break;
    if (isTableLine) { inTable = true; if (isRow(l)) rows.push(cells(l)); }
  }
  return rows;
};
// Leading "Unresolved", optionally bold; a decided cell may mention the word.
const isUnresolved = (cell) => /^\*{0,2}unresolved\b/i.test(cell);

const results = [];
const gate = (name, body) => {
  let ok = true;
  const fail = (m) => { ok = false; console.log(`${name}: ${m}`); };
  const pass = (m) => console.log(`${name}: ${m} — ok`);
  body(fail, pass);
  results.push(ok);
  return ok;
};

// Parsed once; gate 1 judges it, gate 3 checks finding rows against it.
// null = no usable table (file missing or no numbered rows).
const ledgerText = read('ledger.md');
const ledgerRows = ledgerText === null ? null : tableRows(ledgerText);
const ledger = ledgerRows && ledgerRows.length ? ledgerRows : null;

gate('ledger', (fail, pass) => {
  if (ledgerText === null) return fail('work/ledger.md missing');
  const rows = ledgerRows;
  const footer = ledgerText.match(/Questions asked:\s*(\d+)\./);
  if (!footer) return fail('footer "Questions asked: N." missing');
  const asked = Number(footer[1]);
  if (asked !== rows.length) return fail(`footer says ${asked} asked, table has ${rows.length} rows`);
  if (rows.length === 0) return fail('table has no rows');
  const empty = rows.filter((r) => !r[3]);
  if (empty.length) return fail(`row ${empty.map((r) => r[0]).join(', ')} has no decision`);
  const unresolved = rows.filter((r) => isUnresolved(r[3]));
  if (unresolved.length === rows.length) return fail(`all ${rows.length} rows unresolved — nothing settled, not postable`);
  pass(`${asked} asked, ${rows.length} decided+unresolved`);
});

gate('triage', (fail, pass) => {
  const triage = read('triage.md');
  if (triage === null) return fail('work/triage.md missing');
  const header = /(\d+) candidates in, (\d+) dispositions out/;
  const m = triage.match(header);
  if (!m) return fail('header "N candidates in, N dispositions out" missing');
  const rows = tableAfter(triage, header);
  if (Number(m[1]) !== rows.length || Number(m[2]) !== rows.length) return fail(`header says ${m[1]} in / ${m[2]} out, table has ${rows.length} rows`);
  pass(`${m[1]} in, ${rows.length} out`);
});

gate('blocking', (fail, pass) => {
  const claimsRaw = read('claims.jsonl');
  const findingsRaw = read('findings.json');
  if (claimsRaw === null || findingsRaw === null) return fail('work/claims.jsonl or work/findings.json missing');
  const claims = new Map();
  const claimLines = claimsRaw.split('\n');
  for (let i = 0; i < claimLines.length; i++) {
    if (!claimLines[i].trim()) continue;
    const c = tryJSON(claimLines[i]);
    if (c === undefined) return fail(`work/claims.jsonl line ${i + 1} is not JSON`);
    claims.set(c.id, c);
  }
  const findings = tryJSON(findingsRaw);
  if (findings === undefined) return fail('work/findings.json is not JSON');
  if (!Array.isArray(findings)) return fail('work/findings.json is not a JSON array');
  const blocking = findings.filter((f) => f.tag === 'Blocking');
  let bad = false;
  if (blocking.length && ledger === null) { bad = true; fail('ledger unavailable for row check'); }
  for (const f of blocking) {
    const rows = f.rows || [];
    if (!rows.length) { bad = true; fail(`"${f.title}" cites no ledger row`); }
    else if (ledger !== null) {
      const byId = new Map(ledger.map((r) => [Number(r[0]), r]));
      const unknown = rows.filter((n) => !byId.has(Number(n)));
      const unresolved = rows.filter((n) => byId.has(Number(n)) && isUnresolved(byId.get(Number(n))[3]));
      if (unknown.length) { bad = true; fail(`"${f.title}" cites unknown ledger row ${unknown.join(', ')}`); }
      if (unresolved.length) { bad = true; fail(`"${f.title}" rests on unresolved ledger row ${unresolved.join(', ')}`); }
    }
    const ids = f.claims || [];
    const unknownClaims = ids.filter((id) => !claims.has(id));
    const cs = ids.filter((id) => claims.has(id)).map((id) => claims.get(id));
    const assumed = cs.filter((c) => c.class === 'ASSUMED');
    const backed = cs.some((c) => c.class === 'RAN' || c.class === 'READ');
    if (unknownClaims.length) { bad = true; fail(`"${f.title}" cites unknown claim ${unknownClaims.join(', ')}`); }
    if (assumed.length) { bad = true; fail(`"${f.title}" rests on ASSUMED claim ${assumed.map((c) => c.id).join(', ')}`); }
    else if (!backed) { bad = true; fail(`"${f.title}" cites no RAN/READ claim`); }
  }
  if (!bad) pass(`${blocking.length} finding(s), evidence-backed`);
});

process.exit(results.every(Boolean) ? 0 : 1);
