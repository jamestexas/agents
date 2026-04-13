---
name: pr-respond
description: >
  Fresh-eyes review and review comment response for PRs. Use when the user has
  a PR with review comments, is preparing for PR review, wants a fresh-eyes
  assessment before requesting colleague review, or starts a session on a branch
  with an open PR. Does discovery-driven review — explores the codebase to build
  domain understanding before forming opinions, like a smart new hire reading the
  code for the first time.
allowed-tools: "Bash,Read,Glob,Grep,Agent"
argument-hint: "[PR number, owner/repo#N, or nothing for auto-detect]"
---

# pr-respond — Fresh-Eyes Review & Comment Response

Discovery-driven PR review and comment response. The core principle: **build understanding through codebase exploration before forming opinions, like a smart new hire reading the code for the first time.**

This skill does not start with opinions and look for evidence. It starts with evidence and lets opinions emerge. The discovery agent reads the code cold, traces dependencies, and earns its understanding — the same way a thoughtful colleague would on their first week.

---

## Arguments

$ARGUMENTS

Arguments can be:
- PR number: `123` or `owner/repo#123`
- Nothing (auto-detect from current branch)

---

## Architecture Constraint: Isolated Reviewer

This is the most important design decision in this skill.

The discovery agent in Phase 2 MUST be spawned as a **fresh subagent with NO implementation context**. It receives:
- The PR diff
- Access to the codebase (Read, Glob, Grep, Bash)
- Review comments (if engage mode)

It does NOT receive:
- Conversation history from this session
- Planning context or design documents
- Ticket details or requirements
- The author's reasoning or intent

**Why this matters:** If the agent has the author's context, it rationalizes instead of questioning. It reads `// handle edge case for deleted groups` and thinks "that makes sense, they explained it in the ticket." A fresh-eyes agent reads the same comment and asks "what edge case? I see a nil check but no test for it. What happens when the group is deleted mid-sync?"

If something can't be understood from the code alone, that's a signal — a human reviewer would be confused too. The isolation constraint turns "the agent didn't understand" from a failure into valuable feedback.

---

## Phase 1: Load PR State

### 1.1 Detect the PR

If a PR number is provided in `$ARGUMENTS`, use it directly.

Otherwise, auto-detect from the current branch:
```bash
# Try to get PR number for current branch
gh pr view --json number --jq '.number'
```

If that fails, fall back to listing recent PRs:
```bash
BRANCH=$(git branch --show-current)
gh pr list --head "$BRANCH" --json number,title,url
```

If ambiguous, ask the user to confirm.

### 1.2 Fetch PR data

Fetch all PR data in parallel:

```bash
# PR metadata
gh pr view $PR_NUM --json title,body,author,files,baseRefName,headRefName,url

# Full diff
gh pr diff $PR_NUM

# Commit history
gh pr view $PR_NUM --json commits --jq '.commits[].messageHeadline'

# Review comments (inline comments on code)
OWNER_REPO=$(gh pr view $PR_NUM --json headRepository --jq '.headRepository.owner.login + "/" + .headRepository.name')
gh api repos/$OWNER_REPO/pulls/$PR_NUM/comments \
  --jq '.[] | {id: .id, path: .path, line: .line, original_line: .original_line, body: .body, user: .user.login, created_at: .created_at, in_reply_to_id: .in_reply_to_id}'

# Review submissions (approvals, change requests, overall comments)
gh api repos/$OWNER_REPO/pulls/$PR_NUM/reviews \
  --jq '.[] | {id: .id, user: .user.login, state: .state, body: .body}'
```

### 1.3 Categorize comments

Classify each review comment into one of three categories:

**Unaddressed** — No reply from the PR author exists. Check: comment has no child where `in_reply_to_id` equals this comment's `id`, or no child from the PR author.

**Already replied** — The PR author has posted a reply (a comment with `in_reply_to_id` matching this comment's `id`).

**Addressed by code** — The file referenced by the comment was modified after the comment was posted:
```bash
# Check if the file was modified after the comment timestamp
git log --after="<comment_created_at>" --oneline -- <comment_path>
```
If commits exist after the comment date touching that file, mark as "likely addressed by code" but verify by reading the current code at that location.

### 1.4 Determine mode

Based on the comment categorization, select one of three modes:

- **Engage** — Unaddressed comments exist. Primary mode: draft responses to reviewer feedback.
- **Fresh-eyes** — No review comments at all. Run discovery and report observations to the user (not posted to GitHub).
- **All-addressed** — Comments exist but all are replied to or addressed by code. Offer to run fresh-eyes anyway.

Display a summary and wait for user confirmation:

```
PR #789: "feat: add build completion webhook handler"
5 files changed, +340 -12
Review comments: 8 total
  - 3 from @alice (all replied)
  - 5 from @bob (3 unaddressed)
Mode: Engage — 3 unaddressed comments from @bob
Proceed?
```

Wait for user confirmation before continuing.

---

## Phase 2: Discover (Isolated Agent)

### 2.1 Prepare the agent prompt

Build a self-contained prompt for the discovery agent. This prompt must include everything the agent needs and nothing it shouldn't have.

**Include:**
- List of changed files (from PR metadata)
- Key changes from the diff (summarized — what functions were added/modified/deleted, what files are new)
- Review comments with file paths and line numbers (if engage mode)
- Instructions to explore the codebase and build understanding

**Do NOT include:**
- Anything from the current conversation history
- Ticket descriptions, design documents, or planning context
- The PR author's stated intent or reasoning
- Any prior analysis from this session

### 2.2 Launch the discovery agent

Launch a fresh Agent with `subagent_type: "Explore"` and thorough exploration depth.

The agent prompt must instruct it to:

1. **Read each changed file in full** — not just the diff hunks. Read the entire file to understand the context around changes.

2. **Trace outward** — for each changed function or type:
   - Who calls it? (`Grep` for function name across codebase)
   - What does it depend on? (imports, injected dependencies)
   - Are there related tests? (`Glob` for `*_test*` or `*.test.*` in the same directory)
   - Is there similar code elsewhere? (search for parallel implementations)

3. **Build understanding** — after reading, articulate in its own words:
   - What does this PR actually do? (not what the title says — what the code does)
   - What conventions does this codebase follow? (error handling, logging, test patterns)
   - What edge cases exist in the changed code paths?
   - What assumptions does the code make?

4. **For each review comment** (engage mode only):
   - Read the code the reviewer is pointing at
   - Trace the concern — is the reviewer's claim accurate?
   - Note evidence with specific file paths and line numbers
   - If the reviewer is wrong, explain why with code references
   - If the reviewer is right, identify the fix location

5. **Flag anything that couldn't be figured out from code alone** — missing documentation, unclear naming, implicit contracts, magic numbers without explanation. These are the most valuable findings because they predict where human reviewers will also be confused.

The agent must return a structured report:

```
## Understanding
[What the PR does, in the agent's own words]

## Conventions Found
[Patterns observed in the codebase that are relevant to this PR]

## Per-Comment Analysis
[For each review comment: evidence, assessment, suggested response direction]

## Fresh-Eyes Observations
[Things noticed that no reviewer mentioned — potential issues, questions, or praise]
```

### 2.3 Receive discovery report

The discovery report is the foundation for Phase 3. It contains evidence-backed analysis from an agent that earned its understanding through exploration rather than inheriting it from the author.

---

## Phase 3: Engage

### 3.1 Engage mode (unaddressed comments)

Using the discovery report, draft responses for each unaddressed comment.

**Response drafting rules:**

Every response MUST include a GitHub permalink to specific lines:
```
https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{start}-L{end}
```

**Collect the ingredients:**
```bash
# Full SHA for stable permalinks
SHA=$(git rev-parse HEAD)

# Get the PR's base branch
BASE=$(gh pr view $PR_NUM --json baseRefName --jq '.baseRefName')
```

**Find relevant lines for each comment:**
```bash
# Show changed line numbers in the file across the entire PR
git diff "origin/$BASE"...HEAD --unified=0 -- $COMMENT_PATH | grep '^@@'
# Output like: @@ -38,1 +38,15 @@ — means lines 38-52 in the new file
```

Read the `@@` hunks to identify the line range most relevant to the reviewer's comment.

**Response templates:**

**Simple fix:**
```
Fixed — see [{path}#L{line}](https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{line})
```

**With explanation:**
```
Fixed — [{path}#L{start}-L{end}](https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{start}-L{end})

[explanation]
```

**Already handled elsewhere:**
```
This is handled at [{path}#L{start}-L{end}](https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{start}-L{end}) — [explanation]
```

**Valid concern:**
```
Good catch — [acknowledge]. Fixed at [{path}#L{start}-L{end}](https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{start}-L{end}).
```

**Intentional non-change:**
```
Keeping as-is — [reasoning].

Current code: [{path}#L{line}](https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{line})
```

**Design discussion:**
```
[explanation]

See: [{path}#L{start}-L{end}](https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{start}-L{end})

Trade-offs: [...]
```

**Pre-existing issue:**
```
This is pre-existing — see [{path}#L{line}](https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{line}).
[why not in this PR]
```

### 3.2 Fresh-eyes mode (no comments)

Compile observations from the discovery report into a structured assessment for the user:

- **Convention concerns** — deviations from codebase patterns found by the discovery agent
- **Edge cases** — untested or unhandled scenarios identified through tracing
- **Things the agent couldn't figure out** — these predict reviewer confusion
- **Looks good** — aspects of the PR that follow conventions well or handle edge cases thoughtfully

This assessment is NOT posted to GitHub. It is shown to the user as a pre-review self-check before requesting colleague review.

---

## Phase 4: Present and Post

### 4.1 Permalink hard gate

**HARD GATE:** Before presenting any responses to the user, scan every drafted response body for `github.com/.../blob/`.

If ANY response is missing a permalink: **STOP.** Go back to Phase 3.1 and find the lines. Do not present responses without permalinks. Do not substitute bare commit hashes as a workaround.

Every response must have at least one clickable GitHub permalink so the reviewer can see exactly what code is being referenced.

### 4.2 Present responses

Display drafted responses grouped by reviewer, then by file:

```
## Responses to @bob

### handlers/build_webhook.go

**Thread #1** (comment ID: 1234567)
> Reviewer: "This doesn't validate the webhook signature before parsing the body..."

Response:
Good catch — moved signature validation before body parsing. See [handlers/build_webhook.go#L38-L45](https://github.com/org/repo/blob/abc123/handlers/build_webhook.go#L38-L45).

---

**Thread #2** (comment ID: 1234568)
> Reviewer: "What happens if the build ID already exists in the store?"

Response:
It upserts — same behavior as the deploy webhook. See [handlers/build_webhook.go#L72](https://github.com/org/repo/blob/abc123/handlers/build_webhook.go#L72)

---
```

Action options:
1. **Post all** — post every drafted response
2. **Select** — choose by number which to post
3. **Edit** — modify a specific response before posting
4. **Skip** — don't post anything

### 4.3 User approval

Wait for the user to choose an action. If they choose to edit, accept modifications and re-validate the permalink hard gate.

### 4.4 Post responses

Before posting, ensure the local SHA is on the remote (permalinks must resolve):

```bash
# Check if local HEAD is on the remote
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/$(git branch --show-current))

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "Local commits not pushed. Push needed for permalinks to resolve."
  git push
fi
```

Post each approved response as a reply to the original comment:

```bash
gh api repos/$OWNER_REPO/pulls/$PR_NUM/comments \
  -X POST \
  -f body="$RESPONSE_BODY" \
  -F in_reply_to=$COMMENT_ID
```

Report what was posted:
```
Posted 3 responses to PR #789:
  - 2 replies to @bob (1 fix, 1 explanation)
  - 1 reply to @alice (already-handled)
```

---

## Error Handling

**PR not found:** List recent PRs via `gh pr list --limit 10`, ask the user to specify.

**No review comments in engage mode:** Switch to fresh-eyes mode automatically. Inform the user: "No review comments found. Switching to fresh-eyes mode for a pre-review self-check."

**`gh api` POST fails:** Report the error, show the response body that failed to post, and offer to retry or save responses for manual posting.

**Discovery agent returns thin results:** If the discovery report lacks per-comment analysis or has no evidence (file paths, line numbers), re-launch with a more explicit prompt directing the agent to specific files. Do not proceed with unsupported opinions.

**Permalink line range unclear:** If a comment references code that no longer exists at HEAD (deleted lines, moved code), use `git log --follow` to trace the file and note in the response that the code was moved or removed, linking to the nearest relevant location.

---

## Notes

- Does NOT implement code fixes — this skill drafts and posts review comment responses. Use `pr-review --respond` if you need to implement fixes and commit code changes.
- The isolated agent constraint is the key differentiator from `pr-review`. The pr-review skill has full conversation context; pr-respond deliberately discards it to simulate a fresh reviewer.
- Fresh-eyes mode is a pre-review self-check: run it before requesting colleague review to catch issues a fresh reader would notice. Engage mode is for responding to existing review comments with evidence-backed replies.
- All responses are posted under the user's GitHub identity via the `gh` CLI. The skill does not impersonate or use separate credentials.
