// Hermetic tests for `hud sync` and the backup line of `hud status`: local-only
// by default, push and cmd only when [backup] says so, and hud.local.toml as
// the never-committed place to say it.
//
// Every case runs the real `hud/hud` against its own throwaway tree under
// os.tmpdir(), with HUD_ROOT pointed there. git runs with the global and system
// config switched off, so a machine configured to sign commits (or to anything
// else) cannot change what these trees see — and cannot reach a signing
// service from a test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_LOCAL_TOML, CONFIG_TOML } from "../server.mjs";

const MACHINERY = path.dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const HUD_CLI = path.join(MACHINERY, "hud");

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "hud test",
  GIT_AUTHOR_EMAIL: "hud-test@example.invalid",
  GIT_COMMITTER_NAME: "hud test",
  GIT_COMMITTER_EMAIL: "hud-test@example.invalid",
};

function tmp(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hud-sync-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // realpath: the CLI reports the resolved root, and macOS's tmpdir is a symlink.
  return fs.realpathSync(dir);
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  }).trim();
}

/** A content tree with one uncommitted note, as a user's tree looks mid-day. */
function tree(t, name, { gitignore = ".generated/\n_hud\nhud.local.toml\n", files = {} } = {}) {
  const parent = tmp(t, name);
  const root = path.join(parent, "tree");
  fs.mkdirSync(path.join(root, "inbox"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, ".gitignore"), gitignore);
  fs.writeFileSync(path.join(root, "inbox", "note.md"), "# a note\n");
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), body);
  return { parent, root };
}

/** Run the CLI; never throws, so refusals can be asserted on. */
function hud(root, args, env = {}) {
  const r = spawnSync("bash", [HUD_CLI, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV,
      HUD_ROOT: root,
      // A port nothing listens on, so `status` cannot see a real HUD.
      HUD_PORT: "1",
      ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function commits(root) {
  try {
    return Number(git(root, "rev-list", "--count", "HEAD"));
  } catch {
    return 0;
  }
}

/** A backup command that records what it saw, and fails when told to. */
function backupScript(dir) {
  const script = path.join(dir, "backup.sh");
  fs.writeFileSync(
    script,
    [
      "#!/bin/sh",
      'printf "%s|%s|%s\\n" "$HUD_ROOT" "$(pwd -P)" "$1" >>"$BACKUP_LOG"',
      'echo "backup stderr line" >&2',
      'exit "${BACKUP_FAIL:-0}"',
      "",
    ].join("\n"),
  );
  fs.chmodSync(script, 0o755);
  return script;
}

test("local-only by default: sync commits with no remote and exits 0", (t) => {
  const { root } = tree(t, "local");
  const r = hud(root, ["sync"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(commits(root), 1);
  assert.equal(git(root, "status", "--porcelain"), "", "everything was committed");
  assert.match(r.out, /committed 2 file\(s\)/);
  assert.match(r.out, /local-only/);
  assert.match(r.out, new RegExp(CONFIG_LOCAL_TOML.replace(".", "\\.")), "it says where to enable a backup");

  const again = hud(root, ["sync"]);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /nothing to sync/);
  assert.equal(commits(root), 1);
});

test("a remote that exists is not pushed while backup.push is false", (t) => {
  const { parent, root } = tree(t, "nopush");
  const bare = path.join(parent, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", bare], { env: { ...process.env, ...GIT_ENV } });
  git(root, "remote", "add", "origin", bare);

  const r = hud(root, ["sync"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(commits(root), 1);
  assert.match(r.out, /git remote origin is not pushed to — backup\.push is false/);
  assert.equal(git(bare, "for-each-ref"), "", "nothing reached the remote");
});

test("push = true keeps the old contract: no remote refuses before committing", (t) => {
  const { root } = tree(t, "push-absent", { files: { [CONFIG_TOML]: "[backup]\npush = true\n" } });
  const r = hud(root, ["sync"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /backup\.push is on, but .* has no git remote/);
  assert.equal(commits(root), 0, "nothing was committed");
  assert.equal(git(root, "diff", "--cached", "--name-only"), "", "nothing was staged");

  const s = hud(root, ["status", "--json"]);
  assert.equal(JSON.parse(s.out).backup.status, "absent");
});

test("push = true pushes to the remote", (t) => {
  const { parent, root } = tree(t, "push", { files: { [CONFIG_TOML]: "[backup]\npush = true\n" } });
  const bare = path.join(parent, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", bare], { env: { ...process.env, ...GIT_ENV } });
  git(root, "remote", "add", "origin", bare);

  const r = hud(root, ["sync"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /synced .* -> origin\/main \(synced\)/);
  assert.equal(git(bare, "rev-parse", "main"), git(root, "rev-parse", "HEAD"));
});

test("cmd runs after the commit; a failure exits 1 and keeps the commit", (t) => {
  const { parent, root } = tree(t, "cmd");
  const script = backupScript(parent);
  const log = path.join(parent, "backup.log");
  fs.writeFileSync(path.join(root, CONFIG_LOCAL_TOML), `[backup]\ncmd = '${script} "two words"'\n`);

  const failed = hud(root, ["sync"], { BACKUP_LOG: log, BACKUP_FAIL: "3" });
  assert.equal(failed.code, 1);
  assert.equal(commits(root), 1, "the local commit stays");
  assert.match(failed.err, /exited 3/);
  assert.match(failed.err, /backup stderr line/, "the command's stderr tail is shown");
  // argv only, cwd the tree, HUD_ROOT set — and quotes group one argument.
  assert.equal(fs.readFileSync(log, "utf8"), `${root}|${root}|two words\n`);

  // A clean tree still runs it, so the failed backup is retried.
  const retried = hud(root, ["sync"], { BACKUP_LOG: log });
  assert.equal(retried.code, 0, retried.err);
  assert.match(retried.out, /nothing to commit/);
  assert.match(retried.out, /backed up: /);
  assert.equal(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length, 2);
  assert.equal(commits(root), 1);
});

test("--dry-run names the command it would run and runs nothing", (t) => {
  const { parent, root } = tree(t, "dry");
  const script = backupScript(parent);
  const log = path.join(parent, "backup.log");
  fs.writeFileSync(path.join(root, CONFIG_LOCAL_TOML), `[backup]\ncmd = "${script} arg"\n`);

  const r = hud(root, ["sync", "--dry-run"], { BACKUP_LOG: log });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /would stage \(2\)/);
  assert.match(r.out, new RegExp(`would run: ${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} arg`));
  assert.doesNotMatch(r.out, /would push/);
  assert.equal(fs.existsSync(log), false, "the command did not run");
  assert.equal(commits(root), 0, "nothing was committed");
});

test("hud.local.toml overrides hud.toml: push off there wins over push on here", (t) => {
  const { root } = tree(t, "overlay", {
    files: { [CONFIG_TOML]: "[backup]\npush = true\n", [CONFIG_LOCAL_TOML]: "[backup]\npush = false\n" },
  });
  const r = hud(root, ["sync"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /local-only/);
  assert.equal(commits(root), 1);
  assert.equal(git(root, "ls-files", CONFIG_LOCAL_TOML), "", "the overlay was not committed");
  assert.equal(git(root, "ls-files", CONFIG_TOML), CONFIG_TOML);
});

test("an un-ignored or tracked hud.local.toml is refused, staging nothing", (t) => {
  const { root } = tree(t, "leak", {
    gitignore: ".generated/\n_hud\n",
    files: { [CONFIG_LOCAL_TOML]: "[backup]\ncmd = 'copy . gs://<bucket>/hud'\n" },
  });
  const r = hud(root, ["sync"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /hud\.local\.toml is not gitignored/);
  assert.match(r.err, /printf '%s\\n' hud\.local\.toml >>/, "the one-line fix is printed");
  assert.equal(commits(root), 0);
  assert.equal(git(root, "diff", "--cached", "--name-only"), "");

  // Ignored but already tracked is the same leak: ignoring does not untrack.
  fs.appendFileSync(path.join(root, ".gitignore"), `${CONFIG_LOCAL_TOML}\n`);
  git(root, "add", "-f", CONFIG_LOCAL_TOML);
  git(root, "commit", "-qm", "oops");
  const tracked = hud(root, ["sync"]);
  assert.equal(tracked.code, 1);
  assert.match(tracked.err, /is committed in this tree/);
  assert.match(tracked.err, /rm --cached/);
});

test("status reports local, then command, never absent for an unconfigured tree", (t) => {
  const { parent, root } = tree(t, "status");
  let r = hud(root, ["status"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /backup\s+none — local-only\s+local-only by config; committed here, not copied anywhere, 2 uncommitted change\(s\)/);

  let json = JSON.parse(hud(root, ["status", "--json"]).out).backup;
  assert.equal(json.status, "local");
  assert.equal(json.mode, "local");
  assert.equal(json.configured, false);
  assert.equal(json.dirty, 2);

  const script = backupScript(parent);
  fs.writeFileSync(path.join(root, CONFIG_LOCAL_TOML), `[backup]\ncmd = "${script}"\n`);
  r = hud(root, ["status"]);
  assert.match(r.out, /cannot verify it offline/);
  assert.match(r.out, /hud\.local\.toml \(local overlay\)/);
  json = JSON.parse(hud(root, ["status", "--json"]).out);
  assert.equal(json.backup.status, "command");
  assert.equal(json.backup.configured, true);
  assert.equal(json.backup.command, script);
  assert.equal(json.config.local, CONFIG_LOCAL_TOML);
  assert.ok(json.backup.reason.length > 0);
});

test("a [backup] value of the wrong type warns, names its file, and stays local-only", (t) => {
  const { root } = tree(t, "badtype", { files: { [CONFIG_LOCAL_TOML]: '[backup]\npush = "yes"\n' } });
  const json = JSON.parse(hud(root, ["status", "--json"]).out);
  assert.equal(json.backup.status, "local");
  assert.ok(
    json.config.warnings.some((w) => w.startsWith(`${CONFIG_LOCAL_TOML}: [backup] push`)),
    JSON.stringify(json.config.warnings),
  );
});
