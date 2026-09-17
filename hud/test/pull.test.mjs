// `hud pull` — bringing read-only stores up to date without owning them.
//
// The mirror of `sync`: sync pushes the one store this machine owns and reads
// no other; pull reads the others and writes none. The tests that matter are
// the refusals, because a pull that quietly clobbered a mounted store would
// look like success and lose work.
//
// Every fixture is a throwaway git repo under os.tmpdir(). Commits are made
// with `commit.gpgsign=false` explicitly: a global signing config would
// otherwise send scaffold commits to a public transparency log.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HUD_CLI = path.join(import.meta.dirname, "..", "hud");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
}

/** An upstream, a source clone to push from, and a read-store clone. */
function world(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hud-pull-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const upstream = path.join(dir, "upstream.git");
  execFileSync("git", ["init", "-q", "--bare", upstream]);

  const src = path.join(dir, "src");
  fs.mkdirSync(path.join(src, "inbox"), { recursive: true });
  fs.writeFileSync(path.join(src, "inbox/one.md"), "---\ntitle: one\n---\n");
  execFileSync("git", ["init", "-q", "-b", "main", src]);
  git(src, "add", "-A");
  git(src, "commit", "-qm", "init");
  git(src, "remote", "add", "origin", upstream);
  git(src, "push", "-q", "-u", "origin", "main");

  const read = path.join(dir, "read");
  execFileSync("git", ["clone", "-q", upstream, read]);

  const write = path.join(dir, "write");
  fs.mkdirSync(path.join(write, "inbox"), { recursive: true });
  fs.writeFileSync(path.join(write, "inbox/w.md"), "---\ntitle: w\n---\n");
  fs.writeFileSync(path.join(write, "hud.toml"), `[read.other]\npath = "${read}"\n`);

  return { dir, upstream, src, read, write };
}

/** Add a commit upstream so the read clone falls behind. */
function advance(src, name) {
  fs.writeFileSync(path.join(src, `inbox/${name}.md`), `---\ntitle: ${name}\n---\n`);
  git(src, "add", "-A");
  git(src, "commit", "-qm", name);
  git(src, "push", "-q");
}

/** Run `hud pull`; returns {code, out}. Never throws on a non-zero exit. */
function pull(root, args = []) {
  try {
    const out = execFileSync("bash", [HUD_CLI, "pull", ...args], {
      encoding: "utf8",
      env: { ...process.env, HUD_ROOT: root },
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

const head = (repo) => git(repo, "rev-parse", "HEAD").trim();

test("no read stores configured is a clean no-op", (t) => {
  const w = world(t);
  fs.writeFileSync(path.join(w.write, "hud.toml"), "");
  const { code, out } = pull(w.write);
  assert.equal(code, 0);
  assert.match(out, /no read-only stores configured/);
});

test("an up-to-date store reports current and changes nothing", (t) => {
  const w = world(t);
  const before = head(w.read);
  const { code, out } = pull(w.write);
  assert.equal(code, 0);
  assert.match(out, /other\s+current/);
  assert.equal(head(w.read), before);
});

test("a behind store fast-forwards", (t) => {
  const w = world(t);
  advance(w.src, "two");
  const { code, out } = pull(w.write);
  assert.equal(code, 0);
  assert.match(out, /other\s+updated/);
  assert.ok(fs.existsSync(path.join(w.read, "inbox/two.md")), "the new file did not arrive");
});

test("--dry-run writes nothing, not even to .git", (t) => {
  const w = world(t);
  advance(w.src, "two");
  const before = head(w.read);
  // FETCH_HEAD is the tell: a fetch would create it even though the worktree
  // stayed put, so asserting on HEAD alone would miss a non-inert dry run.
  const fetchHead = path.join(w.read, ".git", "FETCH_HEAD");
  const hadFetchHead = fs.existsSync(fetchHead);

  const { code, out } = pull(w.write, ["--dry-run"]);
  assert.equal(code, 0);
  assert.match(out, /would fast-forward/);
  assert.equal(head(w.read), before, "dry-run moved HEAD");
  assert.ok(!fs.existsSync(path.join(w.read, "inbox/two.md")), "dry-run brought a file in");
  assert.equal(fs.existsSync(fetchHead), hadFetchHead, "dry-run fetched into .git");
});

test("a dirty store is refused, and its local edit survives", (t) => {
  const w = world(t);
  advance(w.src, "two");
  const edited = path.join(w.read, "inbox/one.md");
  fs.appendFileSync(edited, "a local edit\n");
  const before = head(w.read);

  const { code, out } = pull(w.write);
  assert.equal(code, 1, "a refusal must exit non-zero");
  assert.match(out, /other\s+refused/);
  assert.match(out, /uncommitted changes/);
  assert.equal(head(w.read), before, "refusal still moved HEAD");
  assert.match(fs.readFileSync(edited, "utf8"), /a local edit/, "the local edit was lost");
  assert.ok(!fs.existsSync(path.join(w.read, "inbox/two.md")), "refusal still pulled");
});

test("local commits not on the remote are refused, never rebased away", (t) => {
  const w = world(t);
  fs.writeFileSync(path.join(w.read, "inbox/mine.md"), "---\ntitle: mine\n---\n");
  git(w.read, "add", "-A");
  git(w.read, "commit", "-qm", "local only");
  const before = head(w.read);

  const { code, out } = pull(w.write);
  assert.equal(code, 1);
  assert.match(out, /local commits are not on/);
  assert.equal(head(w.read), before);
  assert.ok(fs.existsSync(path.join(w.read, "inbox/mine.md")), "the local commit was discarded");
});

test("a diverged store is refused rather than merged", (t) => {
  const w = world(t);
  fs.writeFileSync(path.join(w.read, "inbox/mine.md"), "---\ntitle: mine\n---\n");
  git(w.read, "add", "-A");
  git(w.read, "commit", "-qm", "local only");
  advance(w.src, "three");
  const before = head(w.read);

  const { code, out } = pull(w.write);
  assert.equal(code, 1);
  assert.match(out, /diverged/);
  assert.equal(head(w.read), before, "a diverged store was merged anyway");
});

test("pull never touches the writable store", (t) => {
  const w = world(t);
  advance(w.src, "two");
  const own = path.join(w.write, "inbox/w.md");
  const before = fs.readFileSync(own, "utf8");
  const mtime = fs.statSync(own).mtimeMs;

  assert.equal(pull(w.write).code, 0);

  assert.equal(fs.readFileSync(own, "utf8"), before);
  assert.equal(fs.statSync(own).mtimeMs, mtime, "pull rewrote a file in the writable store");
  // And it did not turn the writable store into a git repo behind your back.
  assert.ok(!fs.existsSync(path.join(w.write, ".git")), "pull git-inited the writable store");
});

test("a store that is not a git repository is skipped, not refused", (t) => {
  const w = world(t);
  const plain = path.join(w.dir, "plain");
  fs.mkdirSync(path.join(plain, "inbox"), { recursive: true });
  fs.writeFileSync(path.join(plain, "inbox/p.md"), "---\ntitle: p\n---\n");
  fs.writeFileSync(path.join(w.write, "hud.toml"), `[read.plain]\npath = "${plain}"\n`);

  const { code, out } = pull(w.write);
  // Skipped is a normal state: a store with no remote cannot participate and
  // that is not an error worth failing a script over.
  assert.equal(code, 0);
  assert.match(out, /plain\s+skipped/);
  assert.match(out, /not a git repository/);
});
