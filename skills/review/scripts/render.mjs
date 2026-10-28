#!/usr/bin/env node
// render.mjs <run-dir> --title T --out FILE — assemble the review artifact.
// Open sections come from work/summary.md, findings.json, impact.md. Everything
// else is wrapped in <details> so a human reads a screen and their AI reads
// the rest. It does not judge anything; check.mjs does the gating.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const run = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const title = opt('--title', 'Review');
const outFile = opt('--out', path.join(run, 'work', 'artifact.md'));
const w = (f) => { const p = path.join(run, 'work', f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''; };
const e = (f) => { const p = path.join(run, 'evidence', f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''; };
const details = (summary, body) => body ? `<details><summary>${summary}</summary>\n\n${body}\n\n</details>\n` : `<details><summary>${summary} — not produced</summary>\n\n_absent_\n\n</details>\n`;

const findings = w('findings.json') ? JSON.parse(w('findings.json')) : [];
const findingsMd = findings.length
  ? findings.map((f) => `- [${f.tag}] ${f.title} — \`${f.file_line}\`. Blast: ${f.blast}. Ledger row${(f.rows || []).length > 1 ? 's' : ''} ${(f.rows || []).join(', ')}.`).join('\n')
  : '_none confirmed_';

const manifest = e('manifest.json') ? JSON.parse(e('manifest.json')).probes : [];
const order = { UNAVAILABLE: 0, FAILED: 1, RAN: 2 };
const manifestMd = manifest.length
  ? ['| Probe | Status | Reason / file |', '|---|---|---|',
     ...manifest.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
       .map((p) => `| ${p.name} | ${p.status} | ${p.status === 'RAN' ? `\`${p.file}\`` : p.reason} |`)].join('\n')
  : '';

const claims = w('claims.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const claimsMd = ['RAN', 'READ', 'ASSUMED'].map((k) => {
  const rows = claims.filter((c) => c.class === k);
  return `**${k}** (${rows.length})\n${rows.map((c) => `- ${c.id}: ${c.text} — \`${c.source}\` (row ${c.row})`).join('\n') || '- none'}`;
}).join('\n\n');

const replay = `\`\`\`\n${e('replay.txt')}\n\`\`\`\nmanifest sha256: ${e('manifest.sha256') || 'absent'}`;

const md = [
  `# ${title}`, '',
  w('summary.md'), '',
  '## Confirmed findings', '', findingsMd, '',
  '## Job-level impact', '', w('impact.md') || '_no impact section produced_', '',
  '---', '',
  details('Decision ledger', w('ledger.md')),
  details('Triage', w('triage.md')),
  details('Refutations', w('refutations.md')),
  details('Claims', claims.length ? claimsMd : ''),
  details('Evidence manifest', manifestMd),
  details('Explain', w('teach.md')),
  details('Replay', replay),
].join('\n');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, md);
console.log(outFile);
