// The `http` kind: rows are the array one loopback GET returns.
//
// This is the board route's proxy and its degradation ladder, moved here so
// any card can declare one: live ⇒ snapshot (`stale: true`) ⇒ nothing, with
// the reason. The snapshot is the upstream's own bytes under
// `$HUD_ROOT/.generated/cards/<name>.json` — machine-written work data in the
// content tree, dot-prefixed so the tree walker skips it, never beside the
// machinery, which is public code. What is joined onto a live answer is read
// fresh or not at all and never written here.

import fs from "node:fs";
import path from "node:path";

import { errText } from "../../errtext.mjs";

/** Every outward call is bounded in time and size. */
export const LIMITS = Object.freeze({
  timeoutMs: 4000,
  maxBytes: 2 * 1024 * 1024,
});

const GENERATED = ".generated";

/** Where a card's snapshot lives. */
export function snapshotFile(root, name) {
  return path.join(root, GENERATED, "cards", `${name}.json`);
}

/**
 * Where the per-source routes kept theirs. Read when the card has no snapshot
 * of its own yet, so a tree from before cards serves its last board while the
 * upstream is down; written by nothing here.
 */
export function legacySnapshotFile(root, name) {
  return path.join(root, GENERATED, `${name}.json`);
}

/**
 * @returns {{cached_at: string, data: unknown}|null} the snapshot, or null if
 *   absent, unreadable or not a snapshot. Never throws: a corrupt snapshot is
 *   the same as no snapshot.
 */
export function readSnapshotFile(file) {
  try {
    const snap = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!snap || typeof snap !== "object" || typeof snap.cached_at !== "string") return null;
    return snap;
  } catch {
    return null;
  }
}

/**
 * Write `{cached_at, data}` via a temp file + rename, so a reader never sees a
 * half-written snapshot. A failed write is logged and swallowed: losing the
 * cache must not lose the live response.
 */
export function writeSnapshotFile(file, data) {
  const snap = { cached_at: new Date().toISOString(), data };
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing further to do */
    }
    process.stderr.write(`hud: could not cache ${path.basename(file, ".json")}: ${errText(err)}\n`);
  }
  return snap;
}

/** GET `url` and parse it as JSON. Throws, with the reason, on any failure. */
export async function fetchJson(url, { timeoutMs, maxBytes }) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > maxBytes) throw new Error("upstream response too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("upstream response is not JSON");
  }
}

/** The array a payload carries: `items`, `prs`, or the payload itself. Anything else is no rows. */
export function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const k of ["items", "prs"]) if (Array.isArray(payload[k])) return payload[k];
  return [];
}

/**
 * The card's rows, live or from its snapshot.
 *
 * @param {{name: string, url: string}} card a card the registry validated
 * @param {{hudRoot: string, httpTimeoutMs?: number}} ctx
 * @returns {Promise<
 *   {payload: unknown, rows: unknown[], stale: false, cached_at: string} |
 *   {payload: unknown, rows: unknown[], stale: true, cached_at: string, error: string} |
 *   {stale: true, cached_at: null, error: string}
 * >} the third form is "nothing to serve": no `rows`, and the reason.
 */
export async function read(card, ctx) {
  const file = snapshotFile(ctx.hudRoot, card.name);
  try {
    const payload = await fetchJson(card.url, {
      timeoutMs: ctx.httpTimeoutMs ?? LIMITS.timeoutMs,
      maxBytes: LIMITS.maxBytes,
    });
    const { cached_at } = writeSnapshotFile(file, payload);
    return { payload, rows: rowsOf(payload), stale: false, cached_at };
  } catch (err) {
    const error = errText(err);
    const snap = readSnapshotFile(file) ?? readSnapshotFile(legacySnapshotFile(ctx.hudRoot, card.name));
    if (snap) return { payload: snap.data, rows: rowsOf(snap.data), stale: true, cached_at: snap.cached_at, error };
    return { stale: true, cached_at: null, error };
  }
}

/**
 * Read the kind's own field off a stanza onto the card: `url`, an absolute
 * http(s) URL. Loopback is the design's intent but not enforced — a HUD in a
 * container reaches its board through the host's name, as CONTAINER.md says.
 */
export function validate(raw, card) {
  let u;
  try {
    u = new URL(raw.url);
  } catch {
    u = null;
  }
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) {
    return { field: "url", reason: "url must be an absolute http(s) URL" };
  }
  card.url = raw.url;
  return null;
}
