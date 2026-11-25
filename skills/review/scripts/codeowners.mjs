#!/usr/bin/env node
// codeowners.mjs <CODEOWNERS-file> < changed-files  →  owners.json on stdout
//
// GitHub semantics, approximated with fnmatch (fnmatch.mjs): the LAST matching
// rule wins; a pattern with a leading "/" or containing "/" is anchored at the
// repo root; a bare name matches at any depth; a trailing "/" means the
// directory and everything in it. "**/" crosses directories. The
// approximation is stated in the output (`semantics`) so a reader knows this
// is derived, not GitHub's own answer.
import fs from 'node:fs';
import { fnmatchPath } from './fnmatch.mjs';

const file = process.argv[2];
if (!file) { process.stderr.write('usage: codeowners.mjs <CODEOWNERS> < files\n'); process.exit(1); }

const rules = [];
for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
  const line = raw.replace(/#.*/, '').trim();
  if (!line) continue;
  const [pat, ...owners] = line.split(/\s+/);
  if (owners.length) rules.push([pat, owners]);
}

function expand(pat) {
  // GitHub anchors a pattern at the root when it starts with "/" OR contains
  // a "/" anywhere before a trailing slash; only a bare name floats to any depth.
  const anchored = pat.startsWith('/') || pat.replace(/\/$/, '').includes('/');
  let p = pat.replace(/^\//, '');
  if (p.endsWith('/')) p += '**';
  // A pattern with no trailing slash may name a directory, and GitHub then
  // owns everything under it ("/chainctl" covers chainctl/pkg/x.go). Try that
  // reading too. Anchoring is unchanged, so "/README.md" still does not reach
  // sub/dir/README.md.
  const bases = p.endsWith('**') ? [p] : [p, `${p}/**`];
  const globs = bases.flatMap((b) => (anchored ? [b] : [b, `**/${b}`]));
  // A trailing "**" is only *, so "api/**" alone matches api/x.go but not
  // api/sub/x.go. GitHub matches at any depth; "<glob>/*" restores that, and
  // "**/" recursing covers depth >= 3.
  return [...new Set(globs.flatMap((g) => (g.endsWith('/**') ? [g, `${g}/*`] : [g])))];
}
const expanded = rules.map(([pat]) => expand(pat));

const paths = {};
for (const l of fs.readFileSync(0, 'utf8').split('\n')) {
  const f = l.trim();
  if (!f) continue;
  let hit = null;
  rules.forEach(([pat, owners], i) => {
    if (expanded[i].some((g) => fnmatchPath(g, f))) hit = { owners, rule: pat, rule_index: i };
  });
  paths[f] = hit ?? { owners: [], rule: null, rule_index: null };
}

process.stdout.write(`${JSON.stringify({
  source: file,
  semantics: 'last matching rule wins; rules match at any depth; a path with no trailing slash also covers a directory of that name and its contents; fnmatch FNM_PATHNAME approximation of GitHub CODEOWNERS',
  paths,
  teams: [...new Set(Object.values(paths).flatMap((h) => h.owners))].sort(),
}, null, 2)}\n`);
