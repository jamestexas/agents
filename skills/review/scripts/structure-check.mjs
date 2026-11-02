#!/usr/bin/env node
// structure-check.mjs [file...] — validate review-structure/1 documents
// (docs/structure-providers.md), one per file or stdin. A provider that
// drifts from the contract is caught here, not by a reader that misreads it.
// Exit 1 names the first problem in each bad document.
import fs from 'node:fs';

const isRef = (r) => r && typeof r.symbol === 'string' && typeof r.file === 'string'
  && (r.line === null || Number.isInteger(r.line));

export function problems(doc) {
  const out = [];
  if (!doc || typeof doc !== 'object') return ['not a JSON object'];
  if (doc.schema !== 'review-structure/1') out.push(`schema is ${JSON.stringify(doc.schema)}, want "review-structure/1"`);
  if (typeof doc.provider !== 'string' || !doc.provider) out.push('provider missing');
  if (!['type', 'token', 'module'].includes(doc.tier)) out.push(`tier ${JSON.stringify(doc.tier)} not one of type|token|module`);
  if (!Array.isArray(doc.symbols)) return [...out, 'symbols is not an array'];
  doc.symbols.forEach((s, i) => {
    if (typeof s.symbol !== 'string') out.push(`symbols[${i}].symbol missing`);
    if (!s.def || typeof s.def.file !== 'string') out.push(`symbols[${i}].def.file missing`);
    for (const side of ['callers', 'callees', 'cross_module_callers']) {
      if (s[side] === undefined && side === 'cross_module_callers') continue;
      if (!Array.isArray(s[side])) { out.push(`symbols[${i}].${side} is not an array`); continue; }
      s[side].forEach((r, j) => { if (!isRef(r)) out.push(`symbols[${i}].${side}[${j}] needs symbol, file, line (int or null)`); });
    }
  });
  return out;
}

function main() {
  const inputs = process.argv.slice(2);
  const docs = inputs.length ? inputs.map((f) => [f, fs.readFileSync(f, 'utf8')]) : [['stdin', fs.readFileSync(0, 'utf8')]];
  let bad = 0;
  for (const [name, text] of docs) {
    let doc; try { doc = JSON.parse(text); } catch { console.log(`${name}: not JSON`); bad++; continue; }
    const p = problems(doc);
    if (p.length) { bad++; console.log(`${name}: ${p[0]}${p.length > 1 ? ` (+${p.length - 1} more)` : ''}`); }
    else console.log(`${name}: ok (${doc.provider}, ${doc.tier}, ${doc.symbols.length} symbol(s))`);
  }
  process.exit(bad ? 1 : 0);
}

import { fileURLToPath } from 'node:url';
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main();
