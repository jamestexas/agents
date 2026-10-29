#!/usr/bin/env node
// abandon-session.mjs — Claude Code SessionEnd hook. A /review run records the
// session that owns it; when that session ends with the run still open,
// nothing else will ever close it, so this appends `abandon` through
// state.mjs (still the one writer). Rosary's equivalent is marking an
// un-closed dispatch abandoned on restart. Install on SessionEnd only: Stop
// fires at the end of every turn and would abandon live runs.
// Only runs under $HUD_ROOT/projects/*/raw/ are swept; a /tmp/review run has
// no HUD row to mislead.
// It must never fail the session, so every error exits 0.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const session = input.session_id;
  const root = process.env.HUD_ROOT || path.join(os.homedir(), 'hud');
  const projects = path.join(root, 'projects');
  if (session && fs.existsSync(projects)) {
    const state = path.join(path.dirname(fileURLToPath(import.meta.url)), 'state.mjs');
    for (const p of fs.readdirSync(projects)) {
      const raw = path.join(projects, p, 'raw');
      if (!fs.existsSync(raw)) continue;
      for (const r of fs.readdirSync(raw)) {
        const dir = path.join(raw, r);
        let s;
        try { s = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch { continue; }
        if (s?.owner?.session_id === session && s.ended == null && fs.existsSync(path.join(dir, 'events.jsonl'))) {
          spawnSync(process.execPath, [state, dir, 'abandon', 'reason=session-ended'], { stdio: 'ignore' });
        }
      }
    }
  }
} catch { /* a hook that throws would surface in the user's session */ }
process.exit(0);
