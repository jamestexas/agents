// Keys: the derived fields rows meet on in a join. One function per key, used
// by every card that declares it, and never raw input — a key is computed
// from the row and refused when the row cannot back it, so two cards that
// both say `key = "pr_url"` can only ever meet on the same canonical string.

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_PR_PATH_RE = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:\/|$)/;

/**
 * `https://github.com/<owner>/<name>/pull/<N>`, or null.
 *
 * `repo` + `number` are keyed directly when `repo` is `owner/name` and
 * `number` a positive integer (a digit string counts). Failing that, a
 * GitHub pull URL is read for the same three parts — path tail, query and
 * fragment ignored — so a row that carries only its link is still keyed. A
 * row that has neither, or whose halves are not what they claim, has no key.
 *
 * @param {{repo?: unknown, number?: unknown, url?: unknown}} [row]
 * @returns {string|null}
 */
export function prUrl(row) {
  if (!row || typeof row !== "object") return null;
  const direct = fromParts(row.repo, row.number);
  if (direct) return direct;
  if (typeof row.url !== "string") return null;
  let u;
  try {
    u = new URL(row.url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com") return null;
  const m = GITHUB_PR_PATH_RE.exec(u.pathname);
  return m ? fromParts(`${m[1]}/${m[2]}`, Number(m[3])) : null;
}

function fromParts(repo, number) {
  if (typeof repo !== "string" || !REPO_RE.test(repo)) return null;
  const n = typeof number === "string" && /^\d+$/.test(number) ? Number(number) : number;
  if (!Number.isInteger(n) || n <= 0) return null;
  return `https://github.com/${repo}/pull/${n}`;
}

/** Every key by name: what a card's `key` may be set to. */
export const KEYS = Object.freeze({ pr_url: prUrl });
