import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const render = path.join(here, '..', 'scripts', 'render.mjs');

test('renders open sections first and the rest inside <details>', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-')), 'artifact.md');
  const r = spawnSync('node', [render, path.join(here, 'fixtures', 'good'), '--title', 'PR 1 — swap parse/verify', '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(out, 'utf8');
  const i = (s) => { const k = md.indexOf(s); assert.notEqual(k, -1, `missing ${s}`); return k; };
  assert.ok(i('# PR 1 — swap parse/verify') < i('**TL;DR**'));
  assert.ok(i('**TL;DR**') < i('## Confirmed findings'));
  assert.ok(i('## Confirmed findings') < i('## Job-level impact'));
  assert.ok(i('## Job-level impact') < i('<details><summary>Decision ledger'));
  // UNAVAILABLE probes are listed first in the manifest section
  const man = md.slice(i('<details><summary>Evidence manifest'));
  assert.ok(man.indexOf('deploy/staging') < man.indexOf('core/diff'));
  assert.match(md, /\[Blocking\] parse before signature check — `handler\.go:88`/);
  assert.match(md, /review-evidence\.sh --pr owner\/repo#1/);
  assert.match(md, /manifest sha256: deadbeef/);
  // no bead ids or shas in the open part (work-marker rule)
  const open = md.slice(0, i('<details>'));
  assert.doesNotMatch(open, /abc123/);
});

test('unparseable claims or findings become a message in the artifact, not a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-'));
  const a = spawnSync('node', [render, path.join(here, 'fixtures', 'bad-json'), '--out', path.join(dir, 'a.md')], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), /<details><summary>Claims — not parseable<\/summary>/);
  const b = spawnSync('node', [render, path.join(here, 'fixtures', 'bad-json-findings'), '--out', path.join(dir, 'b.md')], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'b.md'), 'utf8'), /_findings\.json not parseable_/);
});

test('one H1 per artifact: a leading H1 in summary.md or impact.md is dropped', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-')), 'artifact.md');
  const r = spawnSync('node', [render, path.join(here, 'fixtures', 'leading-h1'), '--title', 'PR 1 — swap parse/verify', '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(out, 'utf8');
  const h1s = md.split('\n').filter((l) => /^# /.test(l));
  assert.deepEqual(h1s, ['# PR 1 — swap parse/verify']);
  // the body under the dropped heading survives
  assert.match(md, /\*\*TL;DR\*\* — Moves parsing/);
  assert.match(md, /## Job-level impact\n\n- Deploy: staging state unknown/);
});

test('missing run dir argument is a usage error', () => {
  const r = spawnSync('node', [render], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: render\.mjs/);
});

const renderPolish = () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-')), 'artifact.md');
  const r = spawnSync('node', [render, path.join(here, 'fixtures', 'render-polish'), '--title', 'PR 1 — swap parse/verify', '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return fs.readFileSync(out, 'utf8');
};

test('a leading H1 in triage, refutations or teach is dropped inside <details> too', () => {
  const md = renderPolish();
  const h1s = md.split('\n').filter((l) => /^# /.test(l));
  assert.deepEqual(h1s, ['# PR 1 — swap parse/verify']);
  // the bodies under the dropped headings survive
  assert.match(md, /<details><summary>Triage<\/summary>\n\n## Triage — 2 candidates in/);
  assert.match(md, /<details><summary>Refutations<\/summary>\n\n\| Finding \| Verdict \| Why \|/);
  assert.match(md, /<details><summary>Explain<\/summary>\n\nPeer's work\./);
});

test('a blast that already ends with a period is not given a second one', () => {
  const md = renderPolish();
  assert.match(md, /Blast: every inbound webhook\. Ledger row 1\./);
  assert.doesNotMatch(md, /webhook\.\./);
  assert.match(md, /Blast: one deploy window\. Ledger row 2\./, 'a blast without a period still gets one');
});

test('a finding whose claims include an ASSUMED id is marked (assumed) after its rows', () => {
  const md = renderPolish();
  assert.match(md, /\[Question\] rolling deploy reads the new column — `migrate\.sql:3`\. Blast: one deploy window\. Ledger row 2\. \(assumed\)/);
  assert.match(md, /\[Blocking\] parse before signature check — `handler\.go:88`\. Blast: every inbound webhook\. Ledger row 1\.\n/, 'a RAN/READ-backed finding carries no marker');
});
