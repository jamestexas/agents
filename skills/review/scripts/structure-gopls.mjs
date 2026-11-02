#!/usr/bin/env node
// structure-gopls.mjs — the default structural provider for Go. A pack probe:
// reads WORKTREE, MERGE_BASE, HEAD and FILES from the environment and prints
// one review-structure/1 document (docs/structure-providers.md) on stdout.
//
// Changed functions come from the diff and `gopls symbols`: a changed line
// belongs to the nearest function or method whose name starts at or above it
// in the same file. gopls reports a symbol's name position, not its body
// extent, and Go bodies do not interleave, so the nearest preceding func is
// the enclosing one. Each changed function then gets `gopls call_hierarchy`
// at its name: callers with their call sites, callees with their definitions.
// Paths are relative to the worktree; anything outside it is `external`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `+start,count` of each hunk in `git diff -U0`; count 0 is a pure deletion,
// which still marks the line it was removed at.
export function changedLines(diff) {
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]); const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count === 0) lines.add(start);
    for (let i = 0; i < count; i++) lines.add(start + i);
  }
  return lines;
}

// `gopls symbols` lines: `name Kind L:C-L:C`. Nested members (fields) are
// indented and dropped. Every top-level symbol is kept, because a var, const
// or type is a boundary too: a line changed in a var block after a function
// is not that function's. Only funcs and methods are reported (`func: true`).
export function parseSymbols(out) {
  const syms = [];
  for (const l of out.split('\n')) {
    const m = l.match(/^(\S+) (\S+) (\d+):(\d+)-\d+:\d+$/);
    if (m) syms.push({ symbol: m[1], line: Number(m[3]), col: Number(m[4]), func: m[2] === 'Function' || m[2] === 'Method' });
  }
  return syms.sort((a, b) => a.line - b.line);
}

// `src` is the file's text at head, so a changed doc comment goes to the
// symbol it documents: a line inside an unbroken `//` block that runs down to
// a symbol's line belongs to that symbol, not to the one above it.
export function enclosing(syms, changed, src = '') {
  const text = src.split('\n');
  const isComment = (n) => /^\s*\/\//.test(text[n - 1] ?? '');
  const hit = new Map();
  for (const line of changed) {
    let owner = null; let next = null;
    for (const s of syms) { if (s.line <= line) owner = s; else { next = s; break; } }
    if (next && isComment(line)) {
      let n = line;
      while (n < next.line && isComment(n)) n++;
      if (n === next.line) owner = next;
    }
    if (owner?.func) hit.set(owner.symbol, owner);
  }
  return [...hit.values()];
}

// `caller[0]: ranges 1958:14-31 in /abs/a.go from/to function DeleteItem in /abs/a.go:1944:28-45`
export function parseHierarchy(out, rel) {
  const callers = []; const callees = [];
  for (const l of out.split('\n')) {
    const m = l.match(/^(caller|callee)\[\d+\]: ranges (\d+):\d+-\d+.*? in (\S+) from\/to (?:\S+ )?(\S+) in (\S+):(\d+):\d+-\d+$/);
    if (!m) continue;
    const [, side, atLine, atFile, name, defFile, defLine] = m;
    if (side === 'caller') {
      const f = rel(atFile);
      callers.push({ symbol: name, file: f.file, line: Number(atLine), ...(f.external ? { external: true } : {}) });
    } else {
      const f = rel(defFile);
      callees.push({ symbol: name, file: f.file, line: Number(defLine), ...(f.external ? { external: true } : {}) });
    }
  }
  return { callers, callees };
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90_000 });

function main() {
  const { WORKTREE: wt, MERGE_BASE: mb, HEAD: head, FILES: files } = process.env;
  if (!wt || !mb || !files) { console.error('structure-gopls: needs WORKTREE, MERGE_BASE, FILES'); process.exit(2); }
  try { run('gopls', ['version'], wt); } catch { console.error('missing binary: gopls'); process.exit(127); }
  const root = fs.realpathSync(wt);
  const rel = (p) => {
    const abs = fs.existsSync(p) ? fs.realpathSync(p) : p;
    return abs.startsWith(root + path.sep) ? { file: abs.slice(root.length + 1) } : { file: abs.replace(/^.*\/pkg\/mod\//, ''), external: true };
  };
  const goFiles = fs.readFileSync(files, 'utf8').split('\n').filter((f) => f.endsWith('.go') && fs.existsSync(path.join(wt, f)));
  const symbols = []; const skipped = [];
  const cap = Number(process.env.STRUCTURE_MAX_SYMBOLS || 40);
  // gopls resolves a file through its own module, so it runs from the nearest
  // go.mod above the file; a multi-module repo has no module at its root.
  const moduleOf = (f) => {
    let d = path.dirname(f);
    while (d !== '.' && !fs.existsSync(path.join(wt, d, 'go.mod'))) d = path.dirname(d);
    return d;
  };
  for (const f of goFiles) {
    const mod = moduleOf(f); const cwd = path.join(wt, mod);
    const inMod = mod === '.' ? f : path.relative(mod, f);
    let syms; let diff;
    try { diff = run('git', ['diff', '-U0', mb, head || 'HEAD', '--', f], wt); syms = parseSymbols(run('gopls', ['symbols', inMod], cwd)); }
    catch { skipped.push({ file: f, reason: 'gopls symbols failed' }); continue; }
    for (const s of enclosing(syms, changedLines(diff), fs.readFileSync(path.join(wt, f), 'utf8'))) {
      if (symbols.length >= cap) { skipped.push({ file: f, symbol: s.symbol, reason: `over STRUCTURE_MAX_SYMBOLS=${cap}` }); continue; }
      let h = { callers: [], callees: [] };
      try { h = parseHierarchy(run('gopls', ['call_hierarchy', `${inMod}:${s.line}:${s.col}`], cwd), rel); }
      catch { skipped.push({ file: f, symbol: s.symbol, reason: 'gopls call_hierarchy failed' }); }
      symbols.push({ symbol: s.symbol, def: { file: f, line: s.line }, ...h });
    }
  }
  const doc = { schema: 'review-structure/1', provider: 'gopls', tier: 'type', at: head || null, symbols, ...(skipped.length ? { skipped } : {}) };
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main();
