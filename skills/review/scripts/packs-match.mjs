#!/usr/bin/env node
// packs-match.mjs <packs.yaml> [<site.yaml> ...] < changed-files  →  packs.json
//
// Later files win per pack NAME (a site file can replace a generic pack whole;
// it cannot partially merge one, which keeps "what ran" readable from one
// file). Output lists every pack (`all`) and the matched subset (`matched`)
// with the glob→file pairs that matched, so the manifest can say why a pack
// ran. `only: true` packs match only when every changed file matches.
//
// Node has no YAML parser, so the pack files are read through yq (mikefarah
// v4, `-o=json`).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fnmatchPath } from './fnmatch.mjs';

const die = (msg) => { process.stderr.write(`${msg}\n`); process.exit(1); };

const args = process.argv.slice(2);
if (!args.length) die('usage: packs-match.mjs <packs.yaml> [more.yaml...] < files');

function loadYaml(f) {
  const r = spawnSync('yq', ['-o=json', '.', f], { encoding: 'utf8' });
  if (r.error) die(`packs-match: cannot run yq (${r.error.code}); it needs mikefarah/yq v4`);
  if (r.status !== 0) die(`${f}: yq: ${r.stderr.trim()}`);
  const out = r.stdout.trim();
  return out === '' ? null : JSON.parse(out);
}

const packs = new Map();
for (const f of args) {
  const doc = loadYaml(f) ?? {};
  for (const [name, body] of Object.entries(doc.packs ?? {})) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) die(`${f}: pack ${name} is not a map`);
    packs.set(name, { ...body, name, source: f });
  }
}
const files = fs.readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);

// A trailing "**" is only * (see fnmatch.mjs), so "env/**" alone would miss
// env/prod/main.tf. Pack authors write the trailing form; match it as they
// mean it while reporting the glob they wrote.
const variants = (glob) => (glob.endsWith('/**') ? [glob, `${glob}/*`] : [glob]);

function hits(pack) {
  const globs = [].concat(pack.match ?? []);
  return files.flatMap((file) => globs
    .filter((g) => variants(g).some((v) => fnmatchPath(v, file)))
    .map((glob) => ({ glob, file })));
}

// YAML `only: 0` or `only: ""` is still "on", as it was under Ruby.
const truthy = (v) => v !== undefined && v !== null && v !== false;

const matched = [...packs.values()].flatMap((p) => {
  const h = hits(p);
  if (!h.length) return [];
  if (truthy(p.only) && new Set(h.map((x) => x.file)).size !== files.length) return [];
  return [{ ...p, by: h }];
});

process.stdout.write(`${JSON.stringify({ files, all: [...packs.values()], matched }, null, 2)}\n`);
