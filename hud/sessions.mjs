// Sessions panel data layer: the two tiers from the design addendum.
//
// Tier 1 (raw) — `listSessions` walks `<root>/projects/<slug>/*.jsonl` and
// derives a row per session. Claude Code's JSONL is officially internal and
// version-unstable, so this reader is tolerant by contract: any content it
// cannot make sense of degrades that row to filename + mtime with `warn`,
// and `listSessions` never throws on content.
//
// Tier 2 (graft) — `lectioGraft` asks the lectio daemon which commits, PRs,
// and tickets it has already joined to each session and decorates the rows.
// lectio owns the ingest-and-graft pipeline; nothing here re-parses a
// transcript to rediscover what lectio already indexed.
//
// Node stdlib only. No dependency of this module writes anything.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Total bytes any one transcript may cost us. Transcripts reach 100s of MB. */
export const DEFAULT_MAX_BYTES = 256 * 1024;

/** Share of the cap spent on the head; the rest buys the tail. */
const HEAD_RATIO = 0.75;

/** Panel titles are one glanceable line. */
const MAX_TITLE_LEN = 120;

/**
 * Slug segments that are filesystem plumbing rather than project identity.
 * The slug is a flattened absolute path, so its leading segments name where
 * code lives on this machine, not what the work was.
 */
const PATH_NOISE = new Set([
  "users", "home", "var", "private", "tmp", "opt", "mnt",
  "github", "gitlab", "src", "code", "repos", "dev", "go", "projects",
  "documents", "downloads", "desktop", "workspace", "work",
]);

/** Wrapper elements Claude Code injects around non-prose user turns. */
const WRAPPER_TAGS = [
  "local-command-caveat",
  "local-command-stdout",
  "local-command-stderr",
  "command-name",
  "command-message",
  "command-args",
  "command-contents",
  "system-reminder",
  "user-prompt-submit-hook",
];

// --------------------------------------------------------------- tier 1: raw

/**
 * List every session transcript under a ~/.claude-shaped root.
 *
 * @param {string} root e.g. `~/.claude` (expanded)
 * @param {{maxBytes?: number}} [opts] `maxBytes` is the hard per-file read cap.
 * @returns {Array<object>} rows sorted most-recently-active first. Each row
 *   carries `bytesRead` — the bytes this row actually cost — so the cap is
 *   assertable from outside.
 */
export function listSessions(root, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const projectsDir = path.join(root, "projects");

  const slugs = readdirSafe(projectsDir)
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const rows = [];
  for (const slug of slugs) {
    const slugDir = path.join(projectsDir, slug);
    const transcripts = readdirSafe(slugDir)
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => e.name);

    // A slug dir holding no transcript at top level is not a project the
    // panel knows about — commonly one that only ever accumulated memory/.
    if (transcripts.length === 0) continue;

    const project = projectNameFromSlug(slug);
    for (const file of transcripts) {
      rows.push(
        readSessionRow({
          file: path.join(slugDir, file),
          id: file.slice(0, -".jsonl".length),
          project,
          projectSlug: slug,
          subagentCount: countSubagents(slugDir, file.slice(0, -".jsonl".length)),
          maxBytes,
        }),
      );
    }
  }

  rows.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : a.id < b.id ? -1 : 1));
  return rows;
}

/**
 * Readable project label for a flattened path slug.
 *
 * The flattening is lossy — a `-` in the slug may have been a path separator
 * or a literal hyphen — so this is a display heuristic, never an identity.
 * `projectSlug` on every row keeps the unambiguous original.
 */
export function projectNameFromSlug(slug) {
  const segments = String(slug).split("-").filter(Boolean);

  // Drop leading plumbing segments, plus the username that follows a home
  // root (`Users`/`home`), which is noise and often PII.
  let start = 0;
  while (start < segments.length - 1 && PATH_NOISE.has(segments[start].toLowerCase())) {
    const isHomeRoot = ["users", "home"].includes(segments[start].toLowerCase());
    start += isHomeRoot ? 2 : 1;
  }
  const meaningful = segments.slice(Math.min(start, segments.length - 1));
  if (meaningful.length === 0) return String(slug);

  const last = meaningful[meaningful.length - 1];
  // A trailing stub (`a`, `tf`, `v2`) is a qualifier, not a name — keep the
  // segment before it so the label still says what the project is.
  if (last.length <= 2 && meaningful.length >= 2) {
    return meaningful.slice(-2).join("-");
  }
  return last;
}

function readSessionRow({ file, id, project, projectSlug, subagentCount, maxBytes }) {
  let read;
  try {
    read = readBounded(file, maxBytes);
  } catch {
    // Unreadable file (raced cleanup, permissions): still a row, still warned.
    return degraded({ id, project, projectSlug, subagentCount, bytesRead: 0, mtime: null, file });
  }

  const headRecords = parseLines(read.headLines);
  const tailRecords = parseLines(read.tailLines);

  // Nothing in the sampled window was JSON: treat the transcript as opaque.
  if (headRecords.length === 0 && tailRecords.length === 0) {
    return degraded({
      id, project, projectSlug, subagentCount,
      bytesRead: read.bytesRead, mtime: read.mtime, file,
    });
  }

  const startedAt = firstTimestamp(headRecords) ?? firstTimestamp(tailRecords) ?? read.mtime;
  const lastAt = lastTimestamp(tailRecords) ?? lastTimestamp(headRecords) ?? read.mtime;

  return {
    id,
    project,
    projectSlug,
    title: extractTitle(headRecords) ?? path.basename(file),
    startedAt,
    lastAt,
    subagentCount,
    bytesRead: read.bytesRead,
  };
}

function degraded({ id, project, projectSlug, subagentCount, bytesRead, mtime, file }) {
  return {
    id,
    project,
    projectSlug,
    title: path.basename(file),
    startedAt: null,
    lastAt: mtime,
    subagentCount,
    bytesRead,
    warn: true,
  };
}

/**
 * Read at most `maxBytes` of a file as a head chunk plus a tail chunk.
 *
 * Partial lines at the inner edges of the two chunks are dropped, so every
 * line handed back is a whole line. The file is never read in full unless it
 * already fits under the cap.
 */
function readBounded(file, maxBytes) {
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    const mtime = new Date(stat.mtimeMs).toISOString();

    const headCap = Math.max(1, Math.floor(maxBytes * HEAD_RATIO));
    const tailCap = Math.max(0, maxBytes - headCap);

    const headLen = Math.min(headCap, size);
    const headBuf = Buffer.alloc(headLen);
    let bytesRead = headLen > 0 ? fs.readSync(fd, headBuf, 0, headLen, 0) : 0;
    const truncated = headLen < size;
    const headLines = splitComplete(headBuf.subarray(0, bytesRead), {
      dropLast: truncated,
      dropFirst: false,
    });

    let tailLines = [];
    if (truncated && tailCap > 0) {
      const tailStart = Math.max(headLen, size - tailCap);
      const tailLen = size - tailStart;
      if (tailLen > 0) {
        const tailBuf = Buffer.alloc(tailLen);
        const got = fs.readSync(fd, tailBuf, 0, tailLen, tailStart);
        bytesRead += got;
        // The first line of the tail chunk starts mid-line unless we happened
        // to land exactly after a newline; dropping it is cheaper than caring.
        tailLines = splitComplete(tailBuf.subarray(0, got), { dropFirst: true, dropLast: false });
      }
    }

    return { headLines, tailLines, bytesRead, size, mtime, truncated };
  } finally {
    fs.closeSync(fd);
  }
}

function splitComplete(buf, { dropFirst, dropLast }) {
  const lines = buf.toString("utf8").split("\n");
  if (dropLast) lines.pop();
  if (dropFirst) lines.shift();
  return lines.filter((l) => l.trim() !== "");
}

function parseLines(lines) {
  const out = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) out.push(value);
    } catch {
      // A single malformed line is expected (concurrent writes, truncation);
      // it costs us that line, not the row.
    }
  }
  return out;
}

function firstTimestamp(records) {
  for (const rec of records) if (typeof rec.timestamp === "string") return rec.timestamp;
  return null;
}

function lastTimestamp(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (typeof records[i].timestamp === "string") return records[i].timestamp;
  }
  return null;
}

/** First user turn that is actual prose, not a wrapped command or hook echo. */
function extractTitle(records) {
  for (const rec of records) {
    if (rec.type !== "user") continue;
    if (rec.isMeta) continue;
    const text = userText(rec);
    if (!text) continue;
    const prose = stripWrappers(text);
    if (prose) return prose;
  }
  return null;
}

function userText(rec) {
  const content = rec.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    // tool_result blocks are machine chatter, never a title.
    if (block?.type === "text" && typeof block.text === "string") return block.text;
  }
  return null;
}

function stripWrappers(text) {
  let out = text;
  for (const tag of WRAPPER_TAGS) {
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), " ");
    out = out.replace(new RegExp(`</?${tag}>`, "g"), " ");
  }
  const firstLine = out.split("\n").map((l) => l.trim()).find((l) => l !== "");
  if (!firstLine) return null;
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > MAX_TITLE_LEN ? `${collapsed.slice(0, MAX_TITLE_LEN - 1)}…` : collapsed;
}

/**
 * Subagent transcripts live at `<session-id>/subagents/agent-*.jsonl`. They
 * are a count on the parent row, never rows of their own — the sibling
 * `.meta.json` files there are not transcripts and are not counted.
 */
function countSubagents(slugDir, sessionId) {
  return readdirSafe(path.join(slugDir, sessionId, "subagents")).filter(
    (e) => e.isFile() && /^agent-.*\.jsonl$/.test(e.name),
  ).length;
}

function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------- tier 2: graft

/** lectio artifact URI → which graft column it belongs in. */
const GRAFT_MATCHERS = [
  { column: "commits", test: (u) => u.startsWith("git://") && u.includes("/commit/") },
  { column: "prs", test: (u) => u.startsWith("gh://") && /\/pr\/\d+$/.test(u) },
  { column: "tickets", test: (u) => u.startsWith("linear://") },
  { column: "tickets", test: (u) => u.startsWith("rosary://") && u.includes("/bead/") },
  { column: "tickets", test: (u) => u.startsWith("gh://") && /\/issue\/\d+$/.test(u) },
];

/**
 * Decorate session rows with the commits/PRs/tickets lectio has already
 * joined to them.
 *
 * The daemon speaks JSON-RPC 2.0 MCP over `POST <daemonUrl>/mcp` behind a
 * shared-secret `x-lectio-token` header (token file
 * `~/.local/share/lectio/daemon.token`); a request without the token gets a
 * 401, which reaches the panel as "unavailable".
 *
 * Empty columns are the expected result today: as of 2026-09-10 no
 * `claude://session/…` artifact in the projection carries any edge, so
 * lectio has nothing to graft yet. That is lectio's side of the contract
 * (its ADR-0003 work-context graph) and deliberately not reimplemented here
 * — the HUD reads the edge graph, it does not derive it.
 *
 * Never throws. Daemon absent, slow, or erroring ⇒ that row gets
 * `graft: "unavailable"` and is otherwise untouched.
 *
 * @param {Array<object>} sessions rows from `listSessions`
 * @param {string} daemonUrl e.g. `http://127.0.0.1:7533`
 * @param {{timeoutMs?: number, token?: string, tokenPath?: string,
 *          fetchImpl?: Function}} [opts]
 */
export async function lectioGraft(sessions, daemonUrl, opts = {}) {
  const rows = Array.isArray(sessions) ? sessions : [];
  if (rows.length === 0) return [];

  try {
    const timeoutMs = opts.timeoutMs ?? 2000;
    const token = opts.token ?? readToken(opts.tokenPath);
    const doFetch = opts.fetchImpl ?? globalThis.fetch;
    const endpoint = mcpEndpoint(daemonUrl);
    // One deadline for the whole batch: the panel is either fresh or greyed,
    // and N sequential 2s waits is not a thing a HUD refresh can afford.
    const signal = AbortSignal.timeout(timeoutMs);

    return await Promise.all(
      rows.map(async (row, i) => {
        const result = await callTool({
          doFetch, endpoint, token, signal, id: i + 1,
          name: "memory_traverse",
          args: { uri: sessionUri(row.id) },
        });
        if (!result) return { ...row, graft: "unavailable" };
        return { ...row, graft: classifyNeighbors(result.neighbors) };
      }),
    );
  } catch {
    return rows.map((row) => ({ ...row, graft: "unavailable" }));
  }
}

/** The lectio artifact URI for a Claude Code session id. */
export function sessionUri(sessionId) {
  return `claude://session/${sessionId}`;
}

/**
 * One MCP `tools/call`. Exported so a caller that wants a different tool
 * (`memory_get_timeline`, `memory_get_by_uri`) reuses this envelope handling
 * instead of restating it.
 *
 * @returns {Promise<object|null>} the tool's own JSON result, or null on any
 *   transport, protocol, or tool-level failure.
 */
export async function callTool({ doFetch, endpoint, token, signal, id = 1, name, args }) {
  let response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-lectio-token": token } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal,
    });
  } catch {
    return null; // unreachable, refused, aborted
  }
  if (!response.ok) return null; // 401 without a token, 5xx, ...

  let body;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  return unwrapToolResult(body);
}

/**
 * MCP tool results travel as a content envelope whose text is the tool's JSON
 * payload; the daemon also accepts a legacy shape where the result *is* the
 * payload. Accept either, reject `isError` and JSON-RPC errors.
 */
function unwrapToolResult(body) {
  if (!body || typeof body !== "object" || body.error) return null;
  const result = body.result;
  if (!result || typeof result !== "object") return null;
  if (result.isError) return null;

  if (Array.isArray(result.content)) {
    const text = result.content.find((c) => c?.type === "text")?.text;
    if (typeof text !== "string") return null;
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return result;
}

function classifyNeighbors(neighbors) {
  const graft = { commits: [], prs: [], tickets: [] };
  if (!Array.isArray(neighbors)) return graft;

  const seen = new Set();
  for (const entry of neighbors) {
    const uri = typeof entry === "string" ? entry : entry?.other;
    if (typeof uri !== "string" || seen.has(uri)) continue;
    seen.add(uri);
    const match = GRAFT_MATCHERS.find((m) => m.test(uri));
    if (!match) continue; // fs://, claude://turn/…, mache symbols: not a graft column
    graft[match.column].push({
      uri,
      label: graftLabel(uri),
      url: graftUrl(uri),
      kind: typeof entry === "object" && typeof entry?.kind === "string" ? entry.kind : null,
    });
  }

  for (const column of Object.keys(graft)) {
    graft[column].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
  }
  return graft;
}

function graftLabel(uri) {
  const commit = uri.match(/\/commit\/([0-9a-f]+)$/i);
  if (commit) return commit[1].slice(0, 8);
  const gh = uri.match(/^gh:\/\/([^/]+)\/([^/]+)\/(pr|issue)\/(\d+)$/);
  if (gh) return `${gh[1]}/${gh[2]}#${gh[4]}`;
  const linear = uri.match(/^linear:\/\/[^/]+\/(.+)$/);
  if (linear) return linear[1];
  const bead = uri.match(/\/bead\/(.+)$/);
  if (bead) return bead[1];
  return uri;
}

/** Watch-only invariant: the HUD links out, so every graft row needs a link. */
function graftUrl(uri) {
  const gh = uri.match(/^gh:\/\/([^/]+)\/([^/]+)\/(pr|issue)\/(\d+)$/);
  if (gh) {
    const kind = gh[3] === "pr" ? "pull" : "issues";
    return `https://github.com/${gh[1]}/${gh[2]}/${kind}/${gh[4]}`;
  }
  return null; // local commits and ticket schemes need caller-side templates
}

function mcpEndpoint(daemonUrl) {
  const base = String(daemonUrl ?? "").replace(/\/+$/, "");
  return base.endsWith("/mcp") ? base : `${base}/mcp`;
}

function readToken(tokenPath) {
  if (process.env.LECTIO_DAEMON_TOKEN) return process.env.LECTIO_DAEMON_TOKEN;
  const file = tokenPath ?? path.join(os.homedir(), ".local", "share", "lectio", "daemon.token");
  try {
    return fs.readFileSync(file, "utf8").trim() || null;
  } catch {
    return null; // no token ⇒ the daemon 401s ⇒ "unavailable", which is correct
  }
}
