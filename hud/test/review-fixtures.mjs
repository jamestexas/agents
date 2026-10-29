// The review-run fixtures and the tmp-tree helpers, shared by the reviews
// route tests and the card tests that now serve the same files. One copy, so
// the parity test compares the two routes over the same tree rather than two
// trees that happen to agree.
//
// Not a test file, though `node --test hud/test` lists it: it declares no
// tests and runs nothing at import. No fixture carries a real person,
// company, repository or project name.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createServer } from "../server.mjs";

export const UI_DIR = path.join(import.meta.dirname, "..", "ui");

// ------------------------------------------------------------------ helpers

/** Build a tmp tree from {relative path: contents}; dirs are created as needed. */
export function fixture(t, prefix, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A legacy `{sources}` config, as JSON. */
export function writeConfig(root, sources) {
  fs.writeFileSync(path.join(root, "hud.config.json"), JSON.stringify({ sources }, null, 2));
}

/** Start the HUD server on an ephemeral port. */
export async function serve(t, root) {
  const server = createServer({ root, uiDir: UI_DIR, httpTimeoutMs: 1500, cmdTimeoutMs: 5000 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: (p) => fetch(base + p, { cache: "no-store" }),
    verb: (method, p) => fetch(base + p, { method, cache: "no-store" }),
  };
}

/** Sorted `relpath\0size` census, to prove a request changed nothing on disk. */
export function census(root) {
  const out = [];
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(child);
      else out.push(`${child}\0${fs.statSync(path.join(root, child)).size}`);
    }
  };
  walk("");
  return out.sort();
}

// ----------------------------------------------------------------- fixtures

export const RUNNING_FOR_S = 22 * 60;
export const RUNNING_STARTED = new Date(Date.now() - RUNNING_FOR_S * 1000).toISOString();
/** `m` minutes after the running run started. */
export const atMin = (m) => new Date(Date.parse(RUNNING_STARTED) + m * 60 * 1000).toISOString();

/** A value the state file carries under a key the contract does not name. */
export const EXTRA_CANARY = "extra-key-must-not-be-served";

export const running = {
  version: 1,
  repo: "owner/repo",
  pr: 101,
  title: "fix(example): still running",
  author: "login",
  mode: "deep",
  head: "0123456789abcdef",
  base: "main",
  phase: "refute",
  // Four phases so far; the one in flight has no `ended` yet. Each entry
  // carries a key the contract does not name, so the pass-through is tested.
  phases: {
    evidence: { started: RUNNING_STARTED, ended: atMin(1), extra: EXTRA_CANARY },
    questions: { started: atMin(1), ended: atMin(5) },
    settle: { started: atMin(5), ended: atMin(12) },
    refute: { started: atMin(12), ended: null },
  },
  started: RUNNING_STARTED,
  ended: null,
  verdict: null,
  // Two early signals and two entries of the wrong shape.
  early: [
    { row: 1, title: "build broken by new import", basis: "probe-failed:go-graph/build", extra: EXTRA_CANARY },
    { row: 3, title: "signature verified after parse", basis: "blocking-ran" },
    { row: "4", title: "row is not an integer", basis: "blocking-ran" },
    "not an object",
  ],
  gates: { ledger: "ok", triage: null, blocking: null },
  probes: { total: 20, ran: 19, failed: 0, unavailable: 1 },
  findings: { blocking: 0, non_blocking: 1, question: 1, observation: 0 },
  note: "projects/example-one/notes/PR-101-still-running.md",
  posted: null,
  extra: EXTRA_CANARY,
};

export const finished = {
  version: 1,
  repo: "owner/repo",
  pr: 7,
  title: "feat(example): finished and posted",
  author: "login",
  mode: "default",
  head: "fedcba9876543210",
  base: "main",
  phase: "posted",
  phases: {},
  started: "2026-10-27T10:00:00.000Z",
  ended: "2026-10-27T10:31:30.000Z",
  verdict: "APPROVE",
  gates: { ledger: "ok", triage: "ok", blocking: "ok" },
  probes: { total: 20, ran: 20, failed: 0, unavailable: 0 },
  findings: { blocking: 0, non_blocking: 0, question: 0, observation: 2 },
  note: "projects/example-two/notes/PR-7-finished.md",
  posted: {
    url: "https://github.com/owner/repo/pull/7#pullrequestreview-1",
    state: "APPROVED",
    at: "2026-10-27T10:31:00.000Z",
  },
  review_state: {
    authorship: "peer",
    mine: { state: "APPROVED", at: "2026-10-27T10:31:00.000Z", head_matches: false, extra: EXTRA_CANARY },
    humans: [
      { login: "reviewer-one", state: "APPROVED", at: "2026-10-27T09:00:00.000Z", extra: EXTRA_CANARY },
      { login: "reviewer-two", state: "COMMENTED", at: "2026-10-27T09:30:00.000Z" },
      "not an object",
      { state: "APPROVED", at: "2026-10-27T09:40:00.000Z" },
    ],
    bots: [{ login: "bot-one", state: "COMMENTED", findings: 3, at: "2026-10-27T09:10:00.000Z" }],
    threads: { total: 4, unresolved: 2, awaiting_me: 1, awaiting_author: 1, extra: EXTRA_CANARY },
    extra: EXTRA_CANARY,
  },
};

/** What the server serves of the block above: every named field, nothing else. */
export const REVIEW_STATE_SERVED = {
  authorship: "peer",
  mine: { state: "APPROVED", at: "2026-10-27T10:31:00.000Z", head_matches: false },
  humans: [
    { login: "reviewer-one", state: "APPROVED", at: "2026-10-27T09:00:00.000Z" },
    { login: "reviewer-two", state: "COMMENTED", at: "2026-10-27T09:30:00.000Z" },
  ],
  bots: [{ login: "bot-one", state: "COMMENTED", at: "2026-10-27T09:10:00.000Z", findings: 3 }],
  threads: { total: 4, unresolved: 2, awaiting_me: 1, awaiting_author: 1 },
};

/**
 * Two projects, three runs: running, finished, and one whose state file is
 * not JSON. Plus the things the glob must not match: a file under `raw/PR-*`
 * that is not `state.json`, the note the running run points at, and a run in
 * a dot-prefixed project.
 */
export function reviewsFixture(t) {
  return fixture(t, "hud-reviews-", {
    "projects/example-one/raw/PR-101/state.json": JSON.stringify(running),
    "projects/example-two/raw/PR-7/state.json": JSON.stringify(finished),
    "projects/example-one/raw/PR-9/state.json": "not json {\n",
    "projects/example-one/raw/PR-5/evidence.txt": "not a state file\n",
    "projects/example-one/notes/PR-101-still-running.md": "# still running\n",
    "projects/.hidden/raw/PR-3/state.json": JSON.stringify(finished),
  });
}

export const paths = (body) => body.items.map((i) => i.path);
