// The `cmd` kind: rows are what one local command prints.
//
// The `http` kind's ladder with a process in place of a GET: live ⇒ snapshot
// (`stale: true`) ⇒ nothing, with the reason. The argv is the stanza's,
// run with no shell from the tree's root, so a config value can never grow
// into a pipeline. A command is not a loopback GET: it may spend a remote
// budget (a `gh` call spends GitHub's) and take seconds, so a snapshot younger
// than the card's refresh is served as live instead of running it again, and
// a second request while one run is in flight waits on that run.

import { execFile } from "node:child_process";

import { tokenizeCommand } from "../../cmdline.mjs";
import { errText } from "../../errtext.mjs";
// A cycle (the registry imports this module), safe because the constant is
// read inside read(), long after both modules have evaluated.
import { DEFAULT_REFRESH_S } from "../registry.mjs";
import { readSnapshotFile, snapshotFile, writeSnapshotFile } from "./http.mjs";

/** Every run is bounded in time and output. */
export const LIMITS = Object.freeze({
  timeoutMs: 15_000,
  maxBytes: 2 * 1024 * 1024,
});

/** Runs in flight, by snapshot file: one command per card at a time. */
const inFlight = new Map();

/**
 * The rows a command printed: one JSON array, or one JSON value per line.
 * Throws when it is neither, so bad output is a failure and never "no rows".
 */
export function parseRows(stdout) {
  const text = String(stdout).trim();
  if (text === "") return [];
  try {
    const whole = JSON.parse(text);
    if (Array.isArray(whole)) return whole;
  } catch {
    /* not one document; try one per line */
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      throw new Error("command output is not a JSON array or JSON lines");
    }
  }
  return rows;
}

/** The first non-empty stderr line, else the error's own text: the reason a card shows. */
function reasonOf(err, stderr) {
  const line = String(stderr ?? "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  if (line) return line;
  if (err && err.killed) return "command timed out";
  return errText(err);
}

function runArgv(argv, ctx) {
  return new Promise((resolve, reject) => {
    execFile(
      argv[0],
      argv.slice(1),
      {
        cwd: ctx.hudRoot || undefined,
        env: { ...(ctx.env ?? process.env), HUD_ROOT: ctx.hudRoot ?? "" },
        timeout: ctx.cmdTimeoutMs ?? LIMITS.timeoutMs,
        maxBuffer: LIMITS.maxBytes,
        windowsHide: true,
      },
      (err, stdout, stderr) => (err ? reject(new Error(reasonOf(err, stderr))) : resolve(stdout)),
    );
  });
}

/**
 * The card's rows: a fresh-enough snapshot, else a run, else the last
 * snapshot marked stale. Same three forms as the `http` kind.
 *
 * @param {{name: string, cmd: string[], refresh?: number}} card a card the registry validated
 * @param {{hudRoot: string, now?: number, env?: object, cmdTimeoutMs?: number}} ctx
 */
export async function read(card, ctx) {
  const file = snapshotFile(ctx.hudRoot, card.name);
  const now = ctx.now ?? Date.now();
  const maxAgeMs = (card.refresh ?? DEFAULT_REFRESH_S) * 1000;
  const snap = readSnapshotFile(file);
  if (snap && Array.isArray(snap.data) && now - Date.parse(snap.cached_at) < maxAgeMs) {
    return { payload: snap.data, rows: snap.data, stale: false, cached_at: snap.cached_at };
  }

  let pending = inFlight.get(file);
  if (!pending) {
    pending = runArgv(card.cmd, ctx)
      .then(parseRows)
      .then((rows) => ({ rows, cached_at: writeSnapshotFile(file, rows).cached_at }))
      .finally(() => inFlight.delete(file));
    inFlight.set(file, pending);
  }
  try {
    const { rows, cached_at } = await pending;
    return { payload: rows, rows, stale: false, cached_at };
  } catch (err) {
    const error = errText(err);
    const last = readSnapshotFile(file);
    if (last && Array.isArray(last.data)) {
      return { payload: last.data, rows: last.data, stale: true, cached_at: last.cached_at, error };
    }
    return { stale: true, cached_at: null, error };
  }
}

/**
 * Read the kind's own field onto the card as argv: `cmd` is a list of
 * non-empty strings, or one string split the way `[sources.digest] cmd` is —
 * quotes group, and there is no shell. A list is the form for an argument
 * that is awkward to quote, like a query.
 */
export function validate(raw, card) {
  const argv = typeof raw.cmd === "string" ? tokenizeCommand(raw.cmd) : raw.cmd;
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((s) => typeof s === "string" && s !== "")) {
    return { field: "cmd", reason: "cmd must be a command string or a non-empty list of strings, run with no shell" };
  }
  card.cmd = [...argv];
  return null;
}
