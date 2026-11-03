import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedLines, parseSymbols, enclosing, parseHierarchy } from '../scripts/structure-gopls.mjs';
import { problems } from '../scripts/structure-check.mjs';

test('changedLines reads + side ranges; a pure deletion marks where it was', () => {
  const d = '@@ -10,2 +10,3 @@ func a\n@@ -20 +21 @@\n@@ -30,4 +31,0 @@\n';
  assert.deepEqual([...changedLines(d)].sort((a, b) => a - b), [10, 11, 12, 21, 31]);
});

const SYMS = [
  'markSource Function 99:6-99:16',
  'mResults Variable 118:5-118:15',
  '\tHelp Field 119:2-119:6',
  'deleteItem Method 200:28-200:45',
  'dryRunTimeout Constant 239:7-239:25',
  'dryRunDelete Method 245:28-245:40',
].join('\n');

test('parseSymbols keeps top-level symbols of every kind and flags funcs', () => {
  const s = parseSymbols(SYMS);
  assert.deepEqual(s.map((x) => [x.symbol, x.func]), [
    ['markSource', true], ['mResults', false], ['deleteItem', true], ['dryRunTimeout', false], ['dryRunDelete', true],
  ]);
});

test('a line changed in a var block after a func is not that func', () => {
  assert.deepEqual(enclosing(parseSymbols(SYMS), new Set([120])), []);
});

test('a changed line inside a func body is that func', () => {
  assert.deepEqual(enclosing(parseSymbols(SYMS), new Set([210])).map((s) => s.symbol), ['deleteItem']);
});

test('a changed doc comment belongs to the symbol it documents, not the one above', () => {
  const src = Array.from({ length: 250 }, (_, i) => (i + 1 >= 241 && i + 1 <= 244 ? '// dryRunDelete runs the dry run' : 'x := 1'));
  const got = enclosing(parseSymbols(SYMS), new Set([242]), src.join('\n'));
  assert.deepEqual(got.map((s) => s.symbol), ['dryRunDelete']);
});

test('parseHierarchy: call sites for callers, definitions for callees, external outside the tree', () => {
  const out = [
    'caller[0]: ranges 1958:14-31 in /wt/a/e.go from/to function DeleteItem in /wt/a/e.go:1944:28-45',
    'caller[1]: ranges 2007:12-30 in /wt/a/e.go from/to method (failingDeletes).DeleteItem in /wt/a/e_test.go:178:2-20',
    'identifier: function deleteItem in /wt/a/e.go:1982:28-45',
    'callee[0]: ranges 2079:8-19, 2082:8-19 in /wt/a/e.go from/to function WarnContext in /mod/pkg/mod/github.com/x/clog@v1/log.go:38:6-17',
  ].join('\n');
  const rel = (p) => (p.startsWith('/wt/') ? { file: p.slice(4) } : { file: p.replace(/^.*\/pkg\/mod\//, ''), external: true });
  const h = parseHierarchy(out, rel);
  assert.deepEqual(h.callers, [
    { symbol: 'DeleteItem', file: 'a/e.go', line: 1958 },
    { symbol: '(failingDeletes).DeleteItem', file: 'a/e.go', line: 2007 },
  ]);
  assert.deepEqual(h.callees, [{ symbol: 'WarnContext', file: 'github.com/x/clog@v1/log.go', line: 38, external: true }]);
});

test('the contract validator accepts a provider document and names what a bad one lacks', () => {
  const ok = { schema: 'review-structure/1', provider: 'gopls', tier: 'type', at: 'abc', symbols: [
    { symbol: 'f', def: { file: 'a.go', line: 3 }, callers: [{ symbol: 'g', file: 'b.go', line: 9 }], callees: [] },
  ] };
  assert.deepEqual(problems(ok), []);
  const token = { ...ok, provider: 'depgraph', tier: 'token', symbols: [{ ...ok.symbols[0], cross_module_callers: [{ symbol: 'h', file: 'c/x.go', line: null }] }] };
  assert.deepEqual(problems(token), [], 'a token-tier provider may have no line');
  assert.match(problems({ ...ok, schema: 'v0' })[0], /schema/);
  assert.match(problems({ ...ok, symbols: [{ symbol: 'f', def: { file: 'a.go' }, callers: [{ symbol: 'g' }], callees: [] }] })[0], /callers\[0\]/);
});
