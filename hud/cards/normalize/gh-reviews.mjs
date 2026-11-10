// The `gh-reviews` shape: a pull request the operator has reviewed, with the
// operator's latest review on it, as GitHub reports it.
//
// GitHub is the record of what was posted. A review posted from the web UI,
// from `gh`, or by /review lands there the same way, so a row built from it
// needs nothing to have been written locally — the run's own `posted` is what
// /review was told, this is what happened. Each row is one PR:
//
//   {repo, number, title, url, state: OPEN|MERGED|CLOSED, head, updated_at,
//    review: {state, commit, url, at} | null}
//
// which is what docs/CARDS.md's example `gh api graphql --jq` filter prints.
// The status is derived here from the review's commit against the PR's head:
// a head that moved past the review is a PR to look at again.

import { prUrl } from "../keys.mjs";

/** The columns a card of this shape shows when it declares none: GitHub's facts, then the joined run's. */
export const COLUMNS = Object.freeze(["pr", "title", "why", "mine", "posted", "verdict", "note"]);

/** `open` is a PR still open; `all` keeps merged and closed ones too. */
export const SCOPES = Object.freeze(["open", "all"]);

export function inScope(item, scope) {
  if (scope === "all") return true;
  return item.pr_state === "OPEN";
}

const REVIEW_STATES = new Set(["APPROVED", "COMMENTED", "CHANGES_REQUESTED", "DISMISSED"]);
const PR_STATES = new Set(["OPEN", "MERGED", "CLOSED"]);
const SHA_RE = /^[0-9a-f]{40}$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const strOrNull = (v) => (typeof v === "string" && v !== "" ? v : null);
const shaOrNull = (v) => (typeof v === "string" && SHA_RE.test(v) ? v : null);

/** How the page names a review state in a reason: "approval", "comment", "change request". */
const NOUN = Object.freeze({
  APPROVED: "approval",
  COMMENTED: "comment",
  CHANGES_REQUESTED: "change request",
  DISMISSED: "dismissed review",
});

/**
 * The operator's review, whitelisted: a known state, and a 40-hex commit.
 * A review with neither is no review — the row still stands, unreviewed.
 */
function reviewOf(v) {
  if (!isObject(v) || !REVIEW_STATES.has(v.state)) return null;
  return { state: v.state, commit: shaOrNull(v.commit), url: strOrNull(v.url), at: strOrNull(v.at) };
}

/**
 * The row's status, `state` + `reason`, as the board spells them so the `why`
 * cell reads both: `needs_you` when the head moved past the review, `waiting`
 * when the review stands at the head and asked for something, `done` when it
 * approved at the head or the PR is no longer open.
 */
function statusOf(prState, head, review) {
  if (prState === "MERGED") return { state: "done", reason: "merged" };
  if (prState === "CLOSED") return { state: "done", reason: "closed" };
  if (!review) return { state: "needs_you", reason: "no review of yours on GitHub" };
  const noun = NOUN[review.state];
  if (head && review.commit && head !== review.commit) {
    return { state: "needs_you", reason: `head moved since your ${noun}` };
  }
  if (review.state === "APPROVED") return { state: "done", reason: "approved at head" };
  return { state: "waiting", reason: `your ${noun} stands at head` };
}

/**
 * One item for one row, or null when the row is not a PR GitHub could name.
 * `posted` and `review_state.mine` carry the same fields a run's do, so the
 * page's `posted` and `mine` cells draw either without knowing which.
 */
export function normalize(row) {
  if (!isObject(row)) return null;
  const pr_url = prUrl(row);
  if (!pr_url) return null;
  const pr_state = PR_STATES.has(row.state) ? row.state : null;
  const head = shaOrNull(row.head);
  const review = reviewOf(row.review);
  const head_matches = review && review.commit && head ? review.commit === head : null;
  return {
    repo: strOrNull(row.repo),
    number: Number.isInteger(row.number) ? row.number : Number(/\d+$/.exec(pr_url)[0]),
    title: strOrNull(row.title),
    url: pr_url,
    pr_url,
    pr_state,
    head,
    updated_at: strOrNull(row.updated_at),
    posted: review ? { url: review.url, state: review.state, at: review.at } : null,
    review_state: { mine: review ? { state: review.state, at: review.at, head_matches } : null },
    ...statusOf(pr_state, head, review),
  };
}

const RANK = Object.freeze({ needs_you: 0, waiting: 1, done: 2 });

const updatedMs = (item) => {
  const t = Date.parse(item.updated_at);
  return Number.isNaN(t) ? -Infinity : t;
};

/** What needs the operator first, open before merged or closed, then most recently updated; the URL breaks ties. */
export function compare(a, b) {
  const ra = RANK[a.state] ?? 3;
  const rb = RANK[b.state] ?? 3;
  if (ra !== rb) return ra - rb;
  const oa = a.pr_state === "OPEN" ? 0 : 1;
  const ob = b.pr_state === "OPEN" ? 0 : 1;
  if (oa !== ob) return oa - ob;
  const ua = updatedMs(a);
  const ub = updatedMs(b);
  if (ua !== ub) return ub - ua;
  return a.pr_url < b.pr_url ? -1 : a.pr_url > b.pr_url ? 1 : 0;
}

/** What another card joining this one may carry: the review as GitHub has it, and the derived status. */
export function forJoin(item) {
  return {
    pr_state: item.pr_state ?? null,
    head: item.head ?? null,
    posted: item.posted ?? null,
    review_state: item.review_state ?? null,
    state: item.state ?? null,
    reason: item.reason ?? null,
  };
}
