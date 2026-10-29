import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const state = path.join(here, '..', 'scripts', 'state.mjs');
const hook = path.join(here, '..', 'scripts', 'abandon-session.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-home-'));

const mkRun = (root, rel, session) => {
  const dir = path.join(root, rel);
  const env = { ...process.env, HOME: home, PATH: '/nonexistent', CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: '1' };
  const r = spawnSync(process.execPath, [state, dir, 'init', '--pending', 'pr=owner/repo#1'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return dir;
};
const phase = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).phase;
const runHook = (input, hudRoot) => spawnSync(process.execPath, [hook], { input, env: { ...process.env, HOME: home, HUD_ROOT: hudRoot }, encoding: 'utf8' });

test('abandons only the open runs the ended session owns', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-hud-'));
  const mine = mkRun(root, 'projects/p/raw/PR-1', 'sess-A');
  const other = mkRun(root, 'projects/p/raw/PR-2', 'sess-B');
  const r = runHook(JSON.stringify({ session_id: 'sess-A', hook_event_name: 'SessionEnd' }), root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(phase(mine), 'abandoned');
  assert.equal(phase(other), 'pending');
});

test('a run of the session that already ended is left alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-hud-'));
  const done = mkRun(root, 'projects/p/raw/PR-3', 'sess-C');
  assert.equal(spawnSync(process.execPath, [state, done, 'fail', 'reason=x'], { env: { ...process.env, HOME: home } }).status, 0);
  const before = fs.readFileSync(path.join(done, 'events.jsonl'), 'utf8');
  assert.equal(runHook(JSON.stringify({ session_id: 'sess-C' }), root).status, 0);
  assert.equal(phase(done), 'failed');
  assert.equal(fs.readFileSync(path.join(done, 'events.jsonl'), 'utf8'), before);
});

test('never fails the session: bad stdin or no HUD_ROOT exits 0', () => {
  for (const input of ['', 'not json', '{}']) {
    const r = runHook(input, '/nonexistent');
    assert.equal(r.status, 0);
  }
});
