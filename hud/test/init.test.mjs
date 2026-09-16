// Hermetic tests for `hud init` — the scaffold, and the detect-don't-assume
// contract that is the whole point of it.
//
// Every case runs the real `hud/hud init` against its own throwaway root under
// os.tmpdir(), never the real tree: the CLI is invoked with an explicit --root
// and with HUD_ROOT pointed at the same place, so a bug that ignored --root
// still could not reach anyone's notes.
//
// Detection is made deterministic by sandboxing PATH. The machine running this
// may or may not have the digest CLI installed, so the tests build their own
// PATH — a symlink farm of the real one with the probed tools removed, plus a
// fake for the branch that needs the tool present. That is what lets both
// branches be asserted here rather than only on a machine configured one way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_TOML, KNOWN_SECTIONS, loadConfigDetail, parseToml } from "../server.mjs";

const MACHINERY = path.dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const HUD_CLI = path.join(MACHINERY, "hud");

/** The digest CLI `init` probes for. Named once, as the script names it once. */
const DIGEST_BIN = "lectio";

function tmp(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hud-init-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The farms below are a few thousand symlinks each, so they are built once per
// distinct shape and reused. Cleanup is at process exit rather than per test
// for the same reason.
const PATH_CACHE = new Map();
const PATH_DIRS = [];
process.on("exit", () => {
  for (const dir of PATH_DIRS) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A PATH with `omit` removed and `provide` faked. Everything else stays real,
 * so only the probes under test change behaviour — `init` still needs a real
 * node, git and cat to run at all.
 */
function sandboxPath({ omit = [], provide = [] } = {}) {
  const key = JSON.stringify([omit, provide]);
  const cached = PATH_CACHE.get(key);
  if (cached) return cached;

  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "hud-init-bin-"));
  PATH_DIRS.push(bin);
  PATH_CACHE.set(key, bin);
  for (const name of provide) {
    const p = path.join(bin, name);
    fs.writeFileSync(p, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(p, 0o755);
  }
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (omit.includes(name) || provide.includes(name)) continue;
      const dest = path.join(bin, name);
      if (fs.existsSync(dest)) continue;
      try {
        fs.symlinkSync(path.join(dir, name), dest);
      } catch {
        /* unreadable or racing entry — the real PATH entry just stays absent */
      }
    }
  }
  return bin;
}

function runInit(root, args = [], env = {}) {
  return execFileSync("bash", [HUD_CLI, "init", "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, HUD_ROOT: root, ...env },
  });
}

/** `gh` is omitted everywhere: `gh auth status` would otherwise reach out. */
function offlinePath() {
  return sandboxPath({ omit: ["gh", DIGEST_BIN] });
}

test("--dry-run on a fresh path writes nothing at all", (t) => {
  const parent = tmp(t, "dry");
  const root = path.join(parent, "fresh");
  const out = runInit(root, ["--dry-run"], { PATH: offlinePath() });

  assert.equal(fs.existsSync(root), false, "--dry-run must not create the root");
  assert.deepEqual(fs.readdirSync(parent), [], "--dry-run must not create anything");
  assert.match(out, /nothing was written/);
  // A dry run has to preview the interactive part too, or it is not a preview.
  assert.match(out, /prompts it would ask/);
  assert.match(out, new RegExp(`create\\s+${CONFIG_TOML}`));
});

test("--yes scaffolds a tree whose config parses with no warnings", (t) => {
  const root = path.join(tmp(t, "scaffold"), "tree");
  runInit(root, ["--yes"], { PATH: offlinePath() });

  for (const f of ["HUD.md", "index.md", "log.md", ".gitignore", CONFIG_TOML]) {
    assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
    assert.ok(fs.statSync(path.join(root, f)).size > 0, `${f} is empty`);
  }
  for (const section of KNOWN_SECTIONS) {
    assert.ok(fs.statSync(path.join(root, section)).isDirectory(), `missing ${section}/`);
  }
  assert.equal(fs.readlinkSync(path.join(root, "_hud")), MACHINERY);

  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^\.generated\/$/m);
  assert.match(ignore, /^_hud$/m);

  // The generated file has to be readable by the parser that will read it, and
  // cleanly: a warning here would mean init wrote a line the server skips.
  const detail = loadConfigDetail(root);
  assert.equal(detail.file, CONFIG_TOML);
  assert.deepEqual(detail.warns, []);
  assert.equal(detail.data.ticket_url_template, "https://example.invalid/issue/{id}");
  assert.equal(detail.data.serve.host, "127.0.0.1");
});

test("init git-inits the tree and creates no remote", (t) => {
  const root = path.join(tmp(t, "git"), "tree");
  const out = runInit(root, ["--yes"], { PATH: offlinePath() });

  assert.ok(fs.existsSync(path.join(root, ".git")), "not a git repository");
  const remotes = execFileSync("git", ["-C", root, "remote", "-v"], { encoding: "utf8" });
  assert.equal(remotes.trim(), "", "init must not create a git remote");
  // Creating the remote is the user's call, so the command has to be printed.
  assert.match(out, /gh repo create .*--private/);
});

test("the scaffold commit is unsigned even under a signing global config", (t) => {
  const root = path.join(tmp(t, "unsigned"), "tree");
  runInit(root, ["--yes"], { PATH: offlinePath() });

  // `%G?` is `N` for an unsigned commit. This is not a style preference: on a
  // machine with `commit.gpgsign = true` and a sigstore-backed signer, signing
  // this commit would push a signature to a public transparency log and could
  // open a browser for an OIDC flow — from inside a scaffold command, for a
  // tree that is private by design.
  const sig = execFileSync("git", ["-C", root, "log", "--format=%G?", "-1"], {
    encoding: "utf8",
  }).trim();
  // An empty result means no commit was made at all (no git identity here),
  // which is a reported non-failure — but a commit that exists must be `N`.
  if (sig !== "") assert.equal(sig, "N", "the scaffold commit must not be signed");
});

test("an undetected source becomes a commented stub with a reason", (t) => {
  const root = path.join(tmp(t, "absent"), "tree");
  const out = runInit(root, ["--yes"], { PATH: offlinePath() });
  const toml = fs.readFileSync(path.join(root, CONFIG_TOML), "utf8");

  // Not configured: the parser sees no digest source, so there is no panel.
  const { data, warns } = parseToml(toml);
  assert.deepEqual(warns, []);
  assert.equal(data.sources?.digest, undefined);

  // But the explanation is in the file, next to where the config would go —
  // which is the whole contract: a grey panel carries its own reason.
  assert.match(toml, new RegExp(`^# NOT CONFIGURED: ${DIGEST_BIN} is not on PATH\\.$`, "m"));
  assert.match(toml, new RegExp(`^#\\s+\\[sources\\.digest\\]$`, "m"));
  assert.match(toml, /^# To enable: .+\.$/m);
  assert.match(out, new RegExp(`digest\\s+stub\\s+.*${DIGEST_BIN} is not on PATH`));

  // peers has no key at all, so it can only ever be a comment.
  assert.equal(data.sources?.peers, undefined);
  assert.match(toml, /^# PEERS has no config key/m);
  assert.match(toml, /gh auth login/);
});

test("a detected source becomes a live entry", (t) => {
  const root = path.join(tmp(t, "present"), "tree");
  const bin = sandboxPath({ omit: ["gh"], provide: [DIGEST_BIN] });
  const out = runInit(root, ["--yes"], { PATH: bin });
  const toml = fs.readFileSync(path.join(root, CONFIG_TOML), "utf8");

  const { data, warns } = parseToml(toml);
  assert.deepEqual(warns, []);
  assert.equal(typeof data.sources.digest.cmd, "string");
  assert.match(data.sources.digest.cmd, new RegExp(`^${DIGEST_BIN}\\b`));
  assert.match(toml, /^\[sources\.digest\]$/m);
  assert.match(out, new RegExp(`digest\\s+configured\\s+.*${DIGEST_BIN} is on PATH`));
});

test("re-running reports rather than clobbers, and never rewrites the config", (t) => {
  const root = path.join(tmp(t, "idempotent"), "tree");
  const bin = offlinePath();
  runInit(root, ["--yes"], { PATH: bin });

  // A hand edit, so a rewrite would be visible as a loss rather than as a diff
  // against something init would have produced anyway.
  const configFile = path.join(root, CONFIG_TOML);
  fs.appendFileSync(configFile, '\n# hand-edited\nticket_url_template = "https://example.invalid/t/{id}"\n');
  const before = fs.readFileSync(configFile);
  const noteFile = path.join(root, "inbox", "keep-me.md");
  fs.writeFileSync(noteFile, "# do not lose me\n");

  const out = runInit(root, ["--yes"], { PATH: bin });

  assert.deepEqual(fs.readFileSync(configFile), before, "hud.toml was rewritten");
  assert.equal(fs.readFileSync(noteFile, "utf8"), "# do not lose me\n");
  assert.match(out, /already there/);
  assert.match(out, new RegExp(`${CONFIG_TOML} \\(already there — NOT overwritten\\)`));
  // It reports what it would have written instead of writing it.
  assert.match(out, /what init would have written/);
  assert.match(out, /hand-edited/);
});

test("init refuses roots that would collapse the code/content split", (t) => {
  const parent = tmp(t, "refuse");
  const inside = path.join(MACHINERY, "would-be-a-tree");
  assert.throws(
    () => runInit(inside, ["--yes"], { PATH: offlinePath() }),
    /inside the machinery checkout/,
  );
  assert.equal(fs.existsSync(inside), false);
  assert.throws(() => runInit(os.homedir(), ["--yes"], { PATH: offlinePath() }), /home directory/);
  assert.deepEqual(fs.readdirSync(parent), []);
});
