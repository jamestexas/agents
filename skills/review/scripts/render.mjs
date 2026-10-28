#!/usr/bin/env node
// render.mjs <run-dir> --title T --out FILE — assemble the review artifact.
// Open sections come from work/summary.md, findings.json, impact.md. Everything
// else is wrapped in <details> so a human reads a screen and their AI reads
// the rest. It does not judge anything; check.mjs does the gating. A phase
// file that is missing or not parseable becomes a labelled empty section, never
// a crash. Without --out the artifact lands in <run>/work/artifact.md.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const run = args[0];
if (!run || run.startsWith('--')) { console.error('usage: render.mjs <run-dir> [--title T] [--out FILE]'); process.exit(2); }
const opt = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const title = opt('--title', 'Review');
const outFile = opt('--out', path.join(run, 'work', 'artifact.md'));
const w = (f) => { const p = path.join(run, 'work', f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''; };
// The artifact's only H1 is --title. A phase file that opens with its own H1
// (teach.md forbids it, but a model may still write one) loses that one line.
const noH1 = (s) => s.replace(/^# [^\n]*\n+/, '');
const e = (f) => { const p = path.join(run, 'evidence', f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''; };
const tryJSON = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
// '' = file absent, undefined = present but not parseable, otherwise the body.
const details = (summary, body) => {
  if (body === undefined) return `<details><summary>${summary} — not parseable</summary>\n\n_absent_\n\n</details>\n`;
  if (!body) return `<details><summary>${summary} — not produced</summary>\n\n_absent_\n\n</details>\n`;
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>\n`;
};

const findings = w('findings.json') ? tryJSON(w('findings.json')) : [];
const findingLine = (f) => {
  const rows = f.rows || [];
  const rowNote = rows.length ? ` Ledger row${rows.length > 1 ? 's' : ''} ${rows.join(', ')}.` : '';
  return `- [${f.tag}] ${f.title} — \`${f.file_line ?? '?'}\`. Blast: ${f.blast}.${rowNote}`;
};
const findingsMd = !Array.isArray(findings) ? '_findings.json not parseable_'
  : findings.length ? findings.map(findingLine).join('\n') : '_none confirmed_';

const manifestDoc = e('manifest.json') ? tryJSON(e('manifest.json')) : { probes: [] };
const manifest = Array.isArray(manifestDoc?.probes) ? manifestDoc.probes : undefined;
const order = { UNAVAILABLE: 0, FAILED: 1, RAN: 2 };
const manifestMd = manifest === undefined ? undefined : manifest.length
  ? ['| Probe | Status | Reason / file |', '|---|---|---|',
     ...manifest.sort((a, b) => (order[a.status] ?? 99) - (order[b.status] ?? 99) || a.name.localeCompare(b.name))
       .map((p) => `| ${p.name} | ${p.status} | ${p.status === 'RAN' ? `\`${p.file}\`` : p.reason} |`)].join('\n')
  : '';

const claimLines = w('claims.jsonl').split('\n').filter(Boolean).map(tryJSON);
const claims = claimLines.includes(undefined) ? undefined : claimLines;
const claimsMd = claims === undefined ? undefined : !claims.length ? '' : ['RAN', 'READ', 'ASSUMED'].map((k) => {
  const rows = claims.filter((c) => c.class === k);
  return `**${k}** (${rows.length})\n${rows.map((c) => `- ${c.id}: ${c.text} — \`${c.source}\` (row ${c.row})`).join('\n') || '- none'}`;
}).join('\n\n');

const replay = `\`\`\`\n${e('replay.txt')}\n\`\`\`\nmanifest sha256: ${e('manifest.sha256') || 'absent'}`;

const md = [
  `# ${title}`, '',
  noH1(w('summary.md')), '',
  '## Confirmed findings', '', findingsMd, '',
  '## Job-level impact', '', noH1(w('impact.md')) || '_no impact section produced_', '',
  '---', '',
  details('Decision ledger', w('ledger.md')),
  details('Triage', w('triage.md')),
  details('Refutations', w('refutations.md')),
  details('Claims', claimsMd),
  details('Evidence manifest', manifestMd),
  details('Explain', w('teach.md')),
  details('Replay', replay),
].join('\n');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, md);
console.log(outFile);
