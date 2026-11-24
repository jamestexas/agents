// The PR worktree review-evidence.sh checked out for a run is scratch once
// nothing will read it again. The scripts that know that moment call this, so
// removing it is not a step an orchestrator has to remember: left to memory, a
// day of reviews left gigabytes of checkouts behind. review-evidence.sh owns
// the rule for what may be removed (only a PR run's own worktree, never the
// user's repo). A failure is reported and never fails the caller.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const removeRunWorktree = (run) => {
  if (!fs.existsSync(path.join(run, 'evidence', 'git', 'worktree-path'))) return;
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'review-evidence.sh');
  // PATH first; the fixed locations cover a caller that narrowed PATH.
  const bash = ['bash', '/bin/bash', '/usr/bin/bash'].find((b) => !spawnSync(b, ['-c', ':']).error) ?? 'bash';
  const r = spawnSync(bash, [script, '--cleanup', run], { encoding: 'utf8' });
  if (r.error) console.error(`could not run worktree cleanup: ${r.error.message}`);
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (out) console.error(out);
};
