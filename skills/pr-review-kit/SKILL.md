---
name: pr-review-kit
description: >
  Self-contained playbook for rigorous PR review: state inspection,
  design-intent hunting, verification rules (cite sources, walk commits,
  verify artifacts), agent dispatch, falsifiable-matrix output, GitHub
  posting only with explicit authorization. Generic, sequential phases.
allowed-tools: "Bash,Read,Glob,Grep,Edit,Write,Agent"
argument-hint: "[PR number, owner/repo#N, or nothing to ask]"
---


A complete, self-contained playbook for reviewing a pull request. Hand this file to a fresh reader — human or Claude session — along with the target PR, and they have everything needed to do a rigorous review without prior context.

---

## How to use this document

**You are a new reader.** This kit does not assume:

- You know about other skills, agents, or memory entries in any parent repo.
- You know the project's design conventions.
- You know the PR author's review style.
- You have any prior session history.

It assumes only that you have:

- `gh` CLI authenticated to the relevant org.
- `git` with worktree support.
- File read/write access in the reader's home dir.
- (Optional) Specialty subagents available via the harness — generic instructions below cover dispatch when they exist.

**Two reading modes:**

- **Mode A — Doing a review yourself.** Read top-to-bottom; phases are sequential.
- **Mode B — Coordinating multiple reviews.** Skip to Phase 7 (output format) — the per-PR notes file shape is the durable artifact you'll keep.

---

## Phase 1 — Read the PR state cold

Before forming any opinion, build a complete picture of the PR's metadata, review history, and commit history. Run these in parallel:

```bash
OWNER=<github org>
REPO=<github repo>
N=<PR number>

# Core PR metadata (title, author, size, state, mergeable)
gh pr view $N --repo $OWNER/$REPO \
  --json number,title,author,state,additions,deletions,changedFiles,baseRefName,headRefName,createdAt,updatedAt,reviewDecision,mergeable,body

# File list with per-file delta size
gh pr view $N --repo $OWNER/$REPO --json files \
  --jq '.files[] | "\(.additions)+/\(.deletions)- \(.path)"'

# All review submissions (humans, AI bots)
gh api repos/$OWNER/$REPO/pulls/$N/reviews \
  --jq '[.[] | {user: .user.login, state, submitted_at, body_preview: (.body[0:200])}]'

# All inline comments — note the in_reply_to_id; resolved threads still appear
gh api repos/$OWNER/$REPO/pulls/$N/comments \
  --jq '[.[] | {id, path, line, user: .user.login, in_reply_to_id, created_at, body_preview: (.body[0:200])}]'

# Commit history, newest first
gh api 'repos/'$OWNER'/'$REPO'/pulls/'$N'/commits?per_page=100' --paginate \
  --jq 'sort_by(.commit.author.date) | reverse | .[] | "\(.sha[0:10]) \(.commit.author.date) \(.commit.message | split("\n")[0])"'

# If state is CLOSED but mergedAt is null, find why
gh api repos/$OWNER/$REPO/issues/$N/comments \
  --jq '.[-5:] | .[] | {user: .user.login, created_at, body_preview: (.body[0:300])}'
```

**Key thing to notice in this phase**: who has reviewed, what they said, and how the PR has evolved over time. PRs by authors who run their own AI-bot self-review often have many inline comments that look "open" but are pre-merge punch lists already addressed by later commits (see Phase 4).

### Staleness gate — does the PR still apply to base?

Always run this before reviewing the diff. A PR that renders a clean diff on GitHub may be unmergeable against current base if the surrounding code was refactored *under it*. For any PR more than a few days old, this is often *the* load-bearing finding — and no other phase surfaces it.

```bash
# Run git commands against the canonical remote (see Phase 2 on fork-vs-upstream).
git fetch <upstream-remote> pull/$N/head:pr-$N-review
MB=$(git merge-base pr-$N-review <upstream-remote>/<base>)
git rev-list --count $MB..<upstream-remote>/<base>   # how many commits behind base

# Drift on touched files — a changed signature means the patch will not apply.
for f in $(git diff --name-only $MB pr-$N-review); do
  diff -q <(git show <upstream-remote>/<base>:"$f" 2>/dev/null) <(git show pr-$N-review:"$f") >/dev/null || echo "diverged: $f"
done
```

A large commit count behind base plus signature/API drift on a touched function means **the fix idea may survive a rebase but the patch does not apply** — report it as a blocker distinct from code-quality findings; it is what a `mergeable: UNKNOWN` status usually reflects.

---

## Phase 2 — Clean working copy via worktree

For PRs over ~500 LOC or any structural change, create a git worktree at the PR's HEAD so you can read the actual code without disturbing your main working directory.

```bash
git fetch <upstream-remote> pull/$N/head:pr-$N-review
git worktree add <path-to-new-worktree> pr-$N-review
```

If `<upstream-remote>` is unclear: `git remote -v` and pick the one pointing at the canonical org/repo (often `upstream`, not `origin` if you work from a fork).

Clean up when done:

```bash
git worktree remove <path-to-new-worktree>
git branch -D pr-$N-review
```

---

## Phase 3 — Find the design intent

A PR is an encoding of a design decision. Without the design, you can only review syntax. Hunt for the design intent in this order:

1. **The PR body itself** — many authors embed design rationale, link the spec, or cite an RFC. Read it fully before assuming it's absent.
2. **Linked tickets** — Linear, GitHub Issues, Jira. The ticket description often contains acceptance criteria + scope decisions.
3. **In-tree design docs** — `docs/`, `design/`, `proposals/`, `rfcs/`. Search the repo (`find . -name '*.md' | xargs grep -l 'design\|TRD\|RFC'`).
4. **Out-of-tree design docs** — Notion, Confluence, Google Docs, Slack file attachments. **If the PR body cites "TRD §X" or "spec §Y" without a link, that doc is somewhere — ask the user.**
5. **Adjacent PRs** — same author's prior or sibling PRs in the same area. Look for a "design" or "stubs" PR in the stack.

**Stop here and ask the user if you can't find it.** Reviewing without design intent produces shallow critique. *"This code does X"* is verifiable; *"this code should do Y instead of X"* requires knowing what Y is per the design.

---

## Phase 4 — Verification disciplines (non-negotiable)

These four rules govern every claim you make about the PR. They're learned from prior review-session failures; each one corresponds to a specific class of error.

### Rule 1 — Cite primary sources, or label inferences

When you make a claim about an RFC, spec, library behavior, or vendor API:

- **Either** cite the source: URL + section + quoted text. *"RFC 7644 §3.5.2 says PATCH operations MUST be atomic per [link]."*
- **Or** label the inference: *"Inferred from library documentation, not verified against the RFC text."*

**Why this rule exists**: a prior session had an agent claim *"RFC 7644 doesn't specify operator precedence"* — based entirely on reading three library docstrings that called the precedence rule "convention." The RFC actually does specify it (with a MUST clause in prose below the ABNF). The agent had no access to read the RFC and presented an inference as fact. The next reviewer would have inherited that wrong claim.

### Rule 2 — Walk commits forward; review-thread state ≠ code state

Before claiming "bug X is still open at HEAD" based on an inline comment showing as unresolved:

```bash
# Get the comment's created_at timestamp first
gh api repos/$OWNER/$REPO/pulls/$N/comments --jq '.[] | select(.id == <comment-id>) | .created_at'

# Scan commits AFTER that timestamp for matches against the cited file/issue label
gh api 'repos/'$OWNER'/'$REPO'/pulls/'$N'/commits?per_page=100' --paginate \
  --jq 'sort_by(.commit.author.date) | reverse | .[] | "\(.commit.author.date) \(.commit.message | split("\n")[0])"' \
  | head -30
```

If a 2026-05-21 commit says `fix(scope): address CI-1 ...` and the comment is from 2026-05-19 about CI-1, **the bug is closed in code even though the thread is open in GitHub**. Inline comments persist as discussion artifacts; they don't auto-resolve.

**Strongest verification**: read the actual current code at the cited file:line. Bug in code now → comment still valid. Bug not in code now → comment is historical.

### Rule 3 — Investigate, don't ask permission to look

If a question can be answered by reading a file, running `gh`, or grepping the repo: do it. Don't ask the user *"want me to pull X?"* or *"should I check Y?"* — that wastes turns and signals lack of agency.

The exception: actions with side effects (posting reviews, force-pushing, sending messages, deleting work). Confirm before those. Reading and investigation are not side effects.

Also: drop verbal tics like *"honest take,"* *"my honest read,"* *"honestly."* They add nothing. If a take needs hedging, hedge specifically — *"I haven't verified this against the code"* — not vaguely.

### Rule 4 — Verify actual artifacts, not summaries

When asked to investigate or validate something, check the actual state — code, logs, DB, the file on disk — first. Do not summarize the spec or PR description back to the user and call that investigation. The summary is what's claimed; the artifact is what's true.

---

## Phase 5 — Dispatch agents (when the harness has them)

For PRs with significant scope or structural risk, parallel specialty agents add value over solo review. Generic shapes (your harness may name them differently):

| Agent role | When to dispatch |
|---|---|
| **Fresh-eyes / Explore** | Read the PR code cold, isolated from the PR description, to predict where future maintainers will be confused. The isolation is load-bearing — agents that read the description rationalize the design instead of probing it. |
| **Formal / theoretical analysis** | For RFC compliance, ABNF correctness, formal algebraic invariants, build-vs-buy framing with falsifiable axes. |
| **Red-team / paradigm-assessor** | To challenge load-bearing design claims ("this is exhaustive by construction," "this round-trip invariant holds"). |
| **Surgical / code-quality** | For kata-style line-level review focused only on what's wrong, not comprehensive commentary. |
| **Production-readiness** | For PRs heading to prod paths — error handling, observability, scaling. |

**Prompt design rules for any agent**:

1. State the working directory and the exact HEAD SHA the agent should read from. Otherwise it'll read main and produce stale findings.
2. For agents claiming RFC/spec compliance: require URL + section + quoted text, or explicit "inferred from secondary sources" labeling.
3. For fresh-eyes agents: **exclude the PR description from the prompt**. Otherwise the agent anchors on the author's framing.
4. Tell the agent the user's intent (review-only / produce-fixes / write-tests) — agents not told this often default to writing code.

---

## Phase 6 — Verify before relaying

Every agent claim that gets relayed to the user must be verified by you against the actual code or design doc. Agent confidence is not evidence.

Failure modes to expect:

- **Misidentified targets**: agent searches for "helpers" and finds the wrong helpers. *Example*: a discovery agent flagged a PR author as having lied about "inlining helpers" when the author had inlined a *different* set of helpers (toMap/toSlice) than the agent looked at (compareBool/compareString).
- **Stale framing**: agent reads inline comments as a punch list, doesn't walk commits forward to check fixes. Rule 2 catches this.
- **Phantom citations**: agent cites "RFC §X" without quoting; Rule 1 catches this.

When an agent says X, your reply should not be *"the agent found X."* It should be *"X is verified: file.go:42 has the cited code"* or *"the agent claimed X but file.go:42 shows Y — drop the claim."*

---

## Phase 7 — Output format: the falsifiable matrix

The durable artifact of a review is a per-PR notes file. Format below. Each row is structured so a future reader can independently verify the claim in 30 seconds — no judgment call required, just a check.

File location: `<notes-dir>/PR-N-<short-title>.md`. Pick a `<notes-dir>` outside the repo you're reviewing (so the notes don't get committed) and consistent across reviews (so future-you can grep your own past matrices). Example: `<notes-dir>/<scope-or-stack>-review/PR-12345-protocol-layer.md`.

```markdown
# PR #N — [title] ([ticket-id])

| Field | Value |
|---|---|
| Author | [github handle] |
| Size | +X / -Y, Z files |
| State | OPEN / CLOSED / MERGED |
| Self-review | N AI bot passes, M open inline comments |
| Linked design doc | [path or URL] |
| Notes-author | [your handle] |

## What it does (one paragraph)

[Plain-language summary. Not the PR title, not the body — your own words after reading the code.]

## Design anchor

| Source | Section | What it requires |
|---|---|---|
| [Design doc] | §X | "[quoted requirement]" |
| [RFC] | §Y | "[quoted requirement]" |
| [Threat model] | R-N | "[quoted risk]" |

## Falsifiable matrix

Each row: claim, where to verify, current verdict, who verified.

| # | Claim | Evidence location | Verdict | Verified by |
|---|---|---|---|---|
| 1 | Field X exists at proto field number Y | `path/to/file.proto` line Z | ✅ verified | [your handle], [date] |
| 2 | Code at file:line implements design requirement A | `path/to/file.go:L42-L60` | ✅ matches design | [your handle], [date] |
| 3 | RFC §X.Y requires behavior B | [RFC URL] §X.Y para 3 | ✅ design exists | [your handle], [date] |
| 4 | PR description claims P, but code does Q | PR body §P; `file.go:L80` | ❌ mismatch | [your handle], [date] |
| 5 | Agent claimed C; code at L100 confirms | `file.go:L100` | ✅ agent right | [your handle], [date] |
| 6 | Agent claimed D; code at L120 contradicts | `file.go:L120` | ❌ agent wrong | [your handle], [date] |

**Verdict vocabulary** (use these exact strings, not opinion-shaped variants):

- `✅ verified` — claim is true; evidence read.
- `✅ matches design` — code matches design doc.
- `✅ design exists` — the design doc says what's claimed; code conformance is separate.
- `❌ mismatch` — code contradicts the claim or design.
- `⚠️ deferred` — claim is for code in a different PR / future ticket; not verifiable here.
- `⚠️ unverified` — couldn't verify in this session; verification commands attached below.

## Open gaps (deferred to other PRs)

- [Gap A]: [what it is] → [which future PR or ticket]
- [Gap B]: …

## Quick verification commands

```bash
[command 1 — explicit, runnable, produces evidence for matrix row N]
[command 2 — …]
```
```

**Why this shape**: every row is a checkable claim, not opinion. A new reviewer can pick up the file, run the commands, and confirm the verdicts independently. Reviews built this way compound: each PR's notes are reusable input for the next PR's review.

---

## Phase 8 — Post to GitHub (only when explicitly authorized)

**Default posture: do not post.** Notes stay local until the user explicitly says "post X." This is non-negotiable; posting is the only side-effect category that affects shared state visibly to others.

When authorized:

```bash
# Body-only review (approve / comment / request-changes)
gh pr review $N --repo $OWNER/$REPO --approve -F /tmp/body.md
gh pr review $N --repo $OWNER/$REPO --comment -F /tmp/body.md
gh pr review $N --repo $OWNER/$REPO --request-changes -F /tmp/body.md

# Reply to a specific existing inline thread
gh api repos/$OWNER/$REPO/pulls/$N/comments -X POST \
  -f body="$(cat /tmp/reply.md)" -F in_reply_to=<comment-id>

# Atomic batch: overall body + multiple new inline comments in one submission
gh api repos/$OWNER/$REPO/pulls/$N/reviews -X POST --input /tmp/review.json
# review.json shape:
#   {commit_id, event: "COMMENT|APPROVE|REQUEST_CHANGES", body,
#    comments: [{path, line, body}]}
```

After posting, verify it landed:

```bash
gh api repos/$OWNER/$REPO/pulls/$N/reviews \
  --jq '[.[] | select(.user.login == "<your-handle>")] | .[-1] | {id, state, submitted_at}'
```

---

## Phase 9 — Engage mode: responding to existing reviewer comments

When the PR has existing inline reviewer comments — yours, or on a PR you're collaborating on — drafting replies is a distinct workflow from fresh review. This phase covers it end-to-end. Same default-do-not-post posture as Phase 8.

### 9.0 — Generate the reply-tracking file

Before categorizing or drafting anything, generate a per-PR reply-tracking file. This is the durable artifact that answers "have I both *fixed* and *replied* to every comment?" at a glance.

The key insight: `Code-addressed` and `Reply-posted` are two independent states. A comment can be fully fixed in code yet have no reply posted — leaving the reviewer's thread visibly open on a merged or approved PR. The tracking file makes this gap impossible to miss.

**Location**: same `<notes-dir>` as Phase 7 notes, named `PR-N-<short-title>-replies.md`. Keep it outside the repo being reviewed.

**Generate raw comment data** (root comments only — not replies — sorted by file):

```bash
OWNER=<org>; REPO=<repo>; N=<PR number>
SHA=$(git rev-parse HEAD)   # must be the pushed HEAD; used for permalinks
AUTHOR=$(gh pr view $N --repo $OWNER/$REPO --json author --jq '.author.login')

# All root-level comments with html_url + created_at, sorted by file then line.
# Flags already_replied=true if the PR author has a reply under that thread.
gh api "repos/$OWNER/$REPO/pulls/$N/comments?per_page=100" --paginate \
  --jq --arg author "$AUTHOR" '
    (map(select(.in_reply_to_id == null)) | sort_by(.path, .line)) as $roots |
    ([.[] | select(.in_reply_to_id != null and .user.login == $author) | .in_reply_to_id] | unique) as $replied |
    $roots[] | {
      id,
      html_url,
      path,
      line: (.line // .original_line),
      reviewer: .user.login,
      created_at,
      already_replied: ([.id] | inside($replied)),
      body
    }
  '
```

**Tracking file template** — one block per root comment, ordered by file:

```markdown
# PR #N — [title] — Reply Tracking

Code permalink base: `<sha>` (pushed HEAD).
Ordered by file. Code-addressed = fix verified in code. Reply-posted = reply visible in GitHub thread.

---

## N. `<path>:<line>` — [first ~8 words of reviewer's comment]

- **Comment link:** https://github.com/OWNER/REPO/pull/N#discussion_rID
- **Code-addressed:** [ ]
- **Reply-posted:** [ ]
- **Timestamp:** [created_at ISO 8601]
- **Priority:** [P1/P2/P3 — assigned by human]

---

**notes:** [why/how handled — fill in during §9.2]

**thread:** [reviewer's original comment, verbatim]

**reply:** [copy-paste-ready markdown with code permalinks pinned to `<sha>`]
```

**Comment link is always a full `html_url`** — never a bare comment ID.

**The two-state matrix:**

| Code-addressed | Reply-posted | Meaning |
|---|---|---|
| `[ ]` | `[ ]` | Not handled — needs code fix and reply |
| `[x]` | `[ ]` | Fix is in the code; reply still needed — the most common gap on approved PRs |
| `[ ]` | `[x]` | Reply posted ("will fix") but code change not yet verified |
| `[x]` | `[x]` | Done |

**Agent rule**: set `Code-addressed: [x]` only after reading the current code at the cited file:line and confirming the concern is resolved (Rule 4 — commit timestamps are not evidence; the commit may have touched a different part of the file). Set `Reply-posted: [x]` only after the `gh api POST` in §9.5 returns HTTP 201.

### 9.1 Categorize every comment

Bucket each existing inline comment into one of three categories before drafting anything:

- **Unaddressed** — No reply exists from the PR author. Check: comment has no child where `in_reply_to_id` equals this comment's `id`, or no child from the PR author.
- **Already replied** — The PR author has posted a reply (a comment with `in_reply_to_id` matching this comment's `id`).
- **Addressed by code** — The file referenced by the comment was modified after the comment was posted. Check with:
  ```bash
  git log --after="<comment-created-at>" --oneline -- <comment-path>
  ```
  If commits exist after the comment date touching that file, mark as "likely addressed by code" — but **verify by reading the current code at the cited line** (Rule 4 — don't trust the timestamp alone; the commit might have touched a different part of the file). This is the same Rule 2 (walk commits forward) applied to comment triage.

Display a categorized summary to the user before drafting:

```
PR #789: "feat: add build completion webhook handler"
5 files changed, +340 -12
Inline comments: 8 total
  - 3 from @alice (all replied)
  - 5 from @bob (3 unaddressed, 2 addressed-by-code)
Mode: Engage — drafting 3 replies for @bob's unaddressed comments.
Proceed?
```

Wait for user confirmation before drafting. After confirmation, update the tracking file (§9.0): set `Code-addressed: [x]` for each comment verified as addressed by code; leave `Reply-posted: [ ]` until §9.5.

### 9.2 Discovery agent: per-comment analysis

For each unaddressed comment, the isolated discovery agent (Phase 5 — fresh-eyes / Explore) should be instructed to:

- Read the cited file:line in full context (not just the diff hunk).
- Trace the reviewer's concern. Is the claim accurate against the current code?
- Note evidence with specific file paths and line numbers.
- If the reviewer is wrong, explain why with code references.
- If the reviewer is right, identify the fix location.

The agent returns a structured per-comment block:

```
## Per-Comment Analysis

### Thread #1 (comment 1234567, @bob, handlers/build_webhook.go:42)
Reviewer: "This doesn't validate the webhook signature before parsing."
Evidence: handlers/build_webhook.go:38-48 — signature check at L52, after parse at L40.
Assessment: Reviewer is correct; order is parse-then-verify, should be verify-then-parse.
Suggested response direction: acknowledge, fix, link to the corrected lines.
```

### 9.3 Response templates

Every drafted response **must include a GitHub permalink to specific lines**. The Phase 8 posting commands take a body file (`/tmp/reply.md`); these templates produce that body.

Collect ingredients first:

```bash
SHA=$(git rev-parse HEAD)
BASE=$(gh pr view $N --repo $OWNER/$REPO --json baseRefName --jq '.baseRefName')

# Show changed line ranges in the relevant file
git diff "origin/$BASE"...HEAD --unified=0 -- $COMMENT_PATH | grep '^@@'
# Output like: @@ -38,1 +38,15 @@ — means lines 38-52 in the new file
```

Permalink format: `https://github.com/$OWNER/$REPO/blob/$SHA/$PATH#L<start>-L<end>`

**Templates** (pick one per comment):

```
# Simple fix
Fixed — see [<path>#L<line>](<permalink>)

# Fix with explanation
Fixed — <permalink>

<explanation>

# Already handled elsewhere
This is handled at <permalink> — <explanation>

# Valid concern
Good catch — <acknowledge>. Fixed at <permalink>.

# Intentional non-change
Keeping as-is — <reasoning>.

Current code: <permalink>

# Design discussion
<explanation>

See: <permalink>

Trade-offs: <list>

# Pre-existing issue
This is pre-existing — see <permalink>.
<why not in this PR>
```

### 9.4 Permalink hard-gate

**HARD GATE**: Before presenting any drafted response to the user, scan every response body for `github.com/.../blob/`.

If ANY response is missing a permalink: **STOP**. Go back to 9.3 and find the lines. Do not present responses without permalinks. Do not substitute bare commit hashes as a workaround. Every response must have at least one clickable permalink so the reviewer can see exactly which code is being referenced.

### 9.5 Present + authorize + post

Display drafted responses grouped by reviewer, then by file:

```
## Responses to @bob

### handlers/build_webhook.go

Thread #1 (comment 1234567)
> "This doesn't validate the webhook signature before parsing..."

Response:
Good catch — moved signature verification before body parse. See [handlers/build_webhook.go#L38-L45](<permalink>).
```

Offer action options:

1. **Post all** — post every drafted reply
2. **Select** — choose by number which to post
3. **Edit** — modify a specific response before posting (then re-validate the hard-gate)
4. **Skip** — don't post anything

Wait for user choice. **Do not post without explicit authorization.**

Before posting, ensure local SHA is on the remote (permalinks must resolve):

```bash
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/$(git branch --show-current))
[ "$LOCAL_SHA" != "$REMOTE_SHA" ] && git push
```

Then use the inline-reply command from Phase 8:

```bash
gh api repos/$OWNER/$REPO/pulls/$N/comments -X POST \
  -f body="$(cat /tmp/reply.md)" -F in_reply_to=<comment-id>
```

Repeat per response. After each HTTP 201, mark `Reply-posted: [x]` in the tracking file for that comment. Report what was posted:

```
Posted 3 responses to PR #789:
  - 2 replies to @bob (1 fix, 1 explanation)
  - 1 reply to @alice (already-handled)
Tracking file updated: 3 Reply-posted checkboxes set.
```

### 9.6 Resolve threads + re-request review

Everything in this section is plain `gh api` — REST for re-requesting review, GraphQL for thread resolution (GitHub's REST API has no resolve-thread endpoint). No GitHub App / MCP connector required; `gh auth status` is the only prerequisite, same as every other command in this skill.

**Map comment IDs to thread IDs.** The numeric comment IDs used for posting (9.5) and GitHub's thread IDs (needed to resolve) are different ID spaces. Fetch the mapping once per PR:

```bash
gh api graphql -f query='
  query($owner:String!, $repo:String!, $pr:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        reviewThreads(first: 100) {
          nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
        }
      }
    }
  }' -f owner=$OWNER -f repo=$REPO -F pr=$N \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | {threadId: .id, firstCommentId: .comments.nodes[0].databaseId, isResolved}'
```

`firstCommentId` matches the numeric `id` used in 9.0's reply-tracking file and the `in_reply_to` value from 9.5 — join on that to find each thread's `threadId` (`PRRT_...`).

**Resolve gate:** only resolve a thread whose tracking-file row has **both** `Code-addressed: [x]` and `Reply-posted: [x]` checked (9.0/Rule 4's existing discipline — don't resolve on the strength of a posted reply alone; the code must actually be confirmed fixed). Never resolve a thread you haven't replied to — a silently-resolved unreplied thread reads as the reviewer's concern being dismissed.

```bash
gh api graphql -f query='
  mutation($threadId:ID!) {
    resolveReviewThread(input:{threadId:$threadId}) { thread { isResolved } }
  }' -f threadId=<PRRT_...>
```

Resolving an already-resolved thread is a no-op — safe to call without checking `isResolved` first if you've already confirmed the gate above.

**Re-request review.** After posting responses (and resolving what qualifies), if the PR needs another look from a reviewer who already reviewed (their prior review is now stale against the fixes):

```bash
gh api repos/$OWNER/$REPO/pulls/$N/requested_reviewers -X POST -f 'reviewers[]=<username>'
```

This is the same effect as GitHub's "re-request review" button — it works even if that reviewer already submitted a review (their old review stays visible but the PR shows as awaiting them again). Only do this on explicit authorization, same gate as 9.5 posting — ask "Re-request review from @X?" rather than doing it automatically once responses are posted.

Report what happened, in the same style as 9.5:

```
Resolved 2 threads (both had Code-addressed + Reply-posted). Left 1 unresolved — @alice's design question needs her reply first.
Re-requested review from @bob.
```

### 9.7 Engage-mode error handling

- **PR not found**: `gh pr list --limit 10`, ask user to specify.
- **No inline comments**: not an engage-mode situation — switch back to fresh-review (Phases 1-7).
- **`gh api` POST fails**: report the error and the response body that failed to post; offer retry or save for manual posting.
- **Permalink line range unclear** (cited code no longer exists at HEAD): use `git log --follow` to trace the file, and note in the response that the code was moved or removed, linking to the nearest relevant location.
- **Discovery agent returns thin per-comment analysis** (no evidence, no file:line citations): re-launch with a more explicit prompt directing to specific files. Don't post responses backed by unsupported opinions.

---

## Appendix A — Identifying the author's review pattern

Spend two minutes reading a sample of the author's recent PRs to calibrate. Patterns worth detecting:

- **AI self-review pattern**: author posts inline comments via their own bot (often prefixed `🤖:` or labeled "AI panel"). Treat these as pre-merge punch lists, not blocking review. Apply Rule 2 (walk commits forward) ruthlessly.
- **Stacked-PR author**: every PR has a sibling. Read the stack root before reviewing any leaf. The leaf often makes sense only in the context of the root.
- **Design-doc-cited author**: author cites "TRD §X" / "spec §Y" in PR bodies. Find the doc before reviewing. See Phase 3.
- **Iterative-fix author**: author files a small PR, gets AI review, fixes within hours via follow-up commits. The PR's mid-iteration state is normal-state. Don't review the iteration — wait for stabilization, or do a delta review against the last review-stable commit.
- **Description-light author**: PR body is one sentence. Read the linked ticket; if no ticket, read the diff cold and infer intent. Rule 1 applies — label inferences explicitly.

---

## Appendix B — How to handle CLOSED-not-merged PRs

If `state=CLOSED` and `mergedAt=null`:

1. Read the last few issue comments — often the author posts *"Superseded by #M"* when closing.
2. If no supersede comment, check the cross-references in the timeline:
   ```bash
   gh api repos/$OWNER/$REPO/issues/$N/timeline \
     --jq '[.[] | select(.event == "cross-referenced")] | .[].source.issue.number'
   ```
3. The replacement PR may be by a different author (someone consolidated the work). Don't assume the original author files all follow-ups.
4. Update your notes: mark the old PR's notes file as "stale, superseded by #M" and either write a new notes file for #M or note the link.

---

## Appendix C — Memory and persistence (if your harness supports it)

If your harness has persistent memory across sessions (e.g., Claude Code's `~/.claude/projects/<project>/memory/` directory), save the following kinds of findings as the session unfolds:

- **Footguns / quirks** — non-obvious tool behavior (e.g., "this test framework freezes the clock," "this datastore uses MySQL InnoDB gap locks"). File pattern: `reference_<topic>.md`.
- **Workflow corrections from the user** — when the user explicitly says "stop doing X" or "always do Y." File pattern: `feedback_<rule>.md`.
- **Project context** — ongoing initiatives, ticket states, ownership. File pattern: `project_<name>.md`.

Reference these in future sessions to avoid re-discovering the same lessons.

---

## Appendix D — When to invoke the heavier review skills

This kit is the foundation. Two heavier patterns build on it:

- **Mache-driven structural review**: if your harness has a `mache` MCP server (or equivalent code-intelligence tool), use it to generate a spec-driven diagram + emergent diagram of the PR's structural changes. Compare them — the gap between intended and emergent architecture is often the load-bearing finding.
- **Multi-agent panel synthesis**: dispatch 3-4 specialty agents in parallel (Phase 5), then synthesize. Each agent should be told its working dir + HEAD SHA + that it should require primary-source citations. Synthesize their findings against the actual code (Phase 6) before relaying to the user.

These are optimizations on the base playbook, not replacements. Always do Phases 1-4 first; agent dispatch without baseline state-reading produces shallow findings.

---

## Glossary

- **Falsifiable claim**: a statement whose truth can be checked in 30 seconds by running a specific command or reading a specific file:line. *"Field X is at proto number 21"* is falsifiable. *"This design is elegant"* is not.
- **Cross-PR invariant**: a property that must hold across multiple PRs in a stack (e.g., "no symbol from package A is exported to package B"). Verifiable by `grep` across the affected files.
- **Supersedes**: a PR closed without merge whose work has been moved into a different PR — typically a different author, different architectural cut, or a consolidation of multiple smaller PRs into one.
- **Walk commits forward**: starting from a comment's timestamp, scan all subsequent commits to see if any of them addressed the issue the comment raised. Counterpart to "review thread state."
