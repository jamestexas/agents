# Engage mode — responding to existing reviewer comments

A sidecar to [SKILL.md](SKILL.md), carrying Phase 9 in full. Read it when the PR
already carries inline reviewer comments you need to answer; skip it entirely for
a fresh review. Phases 1–8 referenced below live in SKILL.md.

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
