# pr-review — respond mode (author side)

The author-side half of the former `/pr-review --respond`: triage the review
comments on your own PR, fix what needs fixing, push, and reply in each
thread with a permalink. Kept here because `/review` does not write code.

Start with `/review <pr> --engage`: it seeds one ledger row per unresolved
thread and prior review, settles each against the current code (walking the
commits made since the comment), and tells you which are fixed, answered, or
still open. Then use the steps below for the ones that need a change or a
reply.

## Phase 1: Discovery

### 1.1 Determine the PR

If PR number provided:
```bash
PR_NUM="$1"
```

If Linear ticket ID provided (format: ABC-123):
```bash
# Use Linear MCP to get issue and extract PR link
```

If nothing provided, detect from current branch:
```bash
BRANCH=$(git branch --show-current)
gh pr list --head "$BRANCH" --json number,title,url
```

Ask user to confirm if ambiguous.

### 1.2 Fetch PR metadata

```bash
# PR details
gh pr view $PR_NUM --json title,body,author,files,baseRefName,headRefName

# Full diff
gh pr diff $PR_NUM

# Existing review comments
gh api repos/{owner}/{repo}/pulls/$PR_NUM/comments \
  --jq '.[] | {path: .path, line: .line, body: .body, id: .id, user: .user.login, in_reply_to_id: .in_reply_to_id}'

# Review submissions (approvals, change requests)
gh api repos/{owner}/{repo}/pulls/$PR_NUM/reviews \
  --jq '.[] | {id: .id, user: .user.login, state: .state, body: .body}'
```

### 1.3 Detect mode

If user specified `--review` or `--respond`, use that mode.

Otherwise auto-detect:
- **Respond mode** if: the current git user is the PR author AND there are unaddressed review comments from others
- **Review mode** if: the current git user is NOT the PR author, OR there are no unaddressed comments, OR the user's prompt indicates they want to review

Present the detected mode and ask user to confirm before proceeding.

### 1.4 Check for related Linear ticket (optional)

Extract ticket ID from PR description or branch name. If found, fetch context via Linear MCP.

---

## Respond Mode

*You are the PR author addressing review comments.*

### S.1 Filter and triage comments

From the data in 1.2, identify:
- Comments from reviewers (not the PR author)
- Comments without replies (where `in_reply_to_id` is null)
- Exclude comments already responded to

**Already-addressed detection:**

For each comment, check whether the referenced code was modified AFTER the comment was posted:

```bash
# Get the comment's creation date and the file it references
# Check if commits on this branch after that date modified the same file+region
git log --after="<comment_created_at>" --oneline -- <comment_path>
```

If the referenced lines were already changed in a subsequent commit, mark the comment as **"likely addressed"** and verify by reading the current code. Don't assume — confirm that the current code actually resolves the reviewer's concern.

### S.2 Validate reviewer claims

Before implementing fixes, run a quick verification pass on non-trivial comments:

```
For each comment flagging a behavioral issue (not just style):
1. Read the code the reviewer is pointing at
2. Trace the execution path they describe — is their scenario actually possible?
3. If the reviewer's claim is wrong or already mitigated, note it
4. If the reviewer's claim is valid, note the fix approach
```

This prevents blindly implementing changes based on incorrect assumptions. Reviewers (human and AI) sometimes misread code flow or miss existing guards.

Apply the external-behavior discipline from R.3 here too, in the direction it is most often skipped: a reviewer's claim about what an ORM tag, a driver, or a wire format does needs the same mechanism-at-a-named-line standard before you rewrite code against it.

### S.3 Organize and plan

Create a task list grouped by file/component:

| Category | Description |
|---|---|
| Already addressed | Changed in a prior commit — just needs a response |
| Quick wins | Typos, formatting, naming, comments |
| Code changes | Refactoring, helpers, pattern fixes |
| Behavioral fixes | Correctness issues, missing error paths, edge cases |
| Design questions | Need discussion, not just a code change |
| Testing | New or modified tests requested |

For each item, include a **proposed action**:

```
#1 groups.go:38 — Pagination risk [Behavioral fix]
   Proposed: Add pagination loop to ListVerifiedGroups using NextCursor
   Alternative: Document as known limitation matching existing pattern

#2 tenant-handler:97 — Unverification gap [Behavioral fix]
   Proposed: Skip Verified check for group.deleted.v1 events

#3 job.go:164 — Missing 401 on List [Quick win]
   Proposed: Add isUnauthorized check matching other call sites

#7 iac/main.tf:63 — Wrong team tag [Quick win]
   Proposed: Change to customer-platform to match event-reconciler
```

Present the plan with proposed actions. Ask: "Ready to proceed? Any you want to change, skip, or handle manually?"

### S.4 Implement fixes

Work through the task list:
- Start with already-addressed items (just confirm, no code change needed)
- Then quick wins (reduces noise for re-review)
- Then behavioral fixes and code changes
- Group related changes for atomic commits
- Read files before editing
- Only fix what was requested — no scope creep
- Stage specific files (never `git add -A`)

### S.5 Quality checks

Launch TWO agents in parallel:

**Agent 1: Convention review**
```
Review the changes just made:
- Do fixes follow repo patterns?
- Any new violations introduced while fixing?
```

**Agent 2: Behavioral verification**
```
For any behavioral fixes made:
- Does the fix actually address the traced execution path?
- Did the fix introduce new edge cases?
- Is the fix tested?
```

Fix any issues found.

### S.6 Commit

```bash
git add <specific files>
git commit -m "refactor: address PR review comments

- <list of changes>

Addresses review comments from @reviewer."
```

### S.7 Generate responses

**Every response MUST include a GitHub permalink to the specific line(s) changed.** No bare commit hashes. The reviewer should be able to click one link and see exactly what changed.

**Step 1: Collect the ingredients.**

```bash
# Full SHA for stable permalinks
SHA=$(git rev-parse HEAD)

# Owner/repo from the PR (already fetched in Phase 1)
# e.g., "myorg/myrepo"
OWNER_REPO=$(gh pr view $PR_NUM --json headRepository --jq '.headRepository.owner.login + "/" + .headRepository.name')
```

**Step 2: For each comment, find the lines that address it.**

Each review comment from Phase 1 has a `path` field (the file the reviewer commented on). Find the relevant lines in the current HEAD:

```bash
# Get the PR's base branch
BASE=$(gh pr view $PR_NUM --json baseRefName --jq '.baseRefName')

# Show changed line numbers in the file across the entire PR
git diff "origin/$BASE"...HEAD --unified=0 -- <comment_path> | grep '^@@' | head -10
# Output like: @@ -38,1 +38,15 @@ → means lines 38-52 in the new file
```

Read the `@@` hunks to get the line range. Pick the hunk most relevant to the reviewer's comment, then build the permalink:
```
https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{start}-L{end}
```

If the fix spans multiple hunks in the same file, link the most relevant one. If the fix is in a DIFFERENT file than the comment, link the new file.

**Step 3: If you cannot determine the line range, fall back to file-level link** (`#L1` omitted), but this should be rare. Never fall back to a bare commit hash.

**Response templates.** Three shapes, not six. Every reply to a review thread
is one of exactly three things — *the code changed*, *the code is not
changing*, or *you asked something and here is the answer* — and a reply that
fits none of them is a reply you have not finished thinking about. Near-identical
templates that differ only in how much prose follows invite picking by feel; one
shape per outcome holds under load. Optional lines stay optional: drop the
explanation when the diff is self-evident.

**1 — Changed.** One location or many; the explanation line is optional.
```
Fixed — [{path}#L{start}-L{end}](https://github.com/{owner}/{repo}/blob/{sha}/{path}#L{start}-L{end})

[Optional: one line on what changed and why, when the diff alone doesn't say it]
```
```
Fixed in {sha_short}:
- [{path1}#L{line}](permalink1) — [what changed here]
- [{path2}#L{line}](permalink2) — [what changed here]
```

**2 — Not changing.** Covers a deliberate decline and a pre-existing issue; the
only difference is whether a ticket carries it forward, so say which.
```
Keeping as-is — [reasoning].

Current code: [{path}#L{line}](permalink)
[Evidence or reference supporting the decision]
```
```
This is pre-existing behavior — see [{path}#L{line}](permalink). Filed {ticket} to address separately.
[Why fixing it here would expand scope beyond this PR]
```

**3 — Answering.** A design question or a clarification, where the deliverable
is reasoning rather than a diff.
```
[Thoughtful explanation with context]

See the implementation: [{path}#L{start}-L{end}](permalink)

Technical rationale: [...]
Trade-offs considered: [...]
```

**Refusal condition — a template is a gate, not a mould.** If you cannot build
the permalink for shapes 1 or 2, **the reply is not posted**. Fall back to the
file-level link per Step 3; if even the file is uncertain, you have not located
the fix you are claiming to have made, and saying "fixed" is an assertion you
cannot back. Surface it as unresolved instead and say what you could not find.
A reply whose evidence link is wrong is worse than no reply: it spends the
author's trust and costs them a round trip to discover the claim was empty.

### S.8 Present and post

Show all responses grouped by thread. Include:
- Comment ID (for posting via gh)
- File and line context
- Proposed response text **with permalinks already rendered**

**HARD GATE:** Before presenting responses to the user, scan every response body for `github.com/.../blob/`. If ANY response is missing a permalink, STOP — go back to Step 2 and find the lines. Do not present responses without permalinks. Do not substitute bare commit hashes as a workaround.

Ask: "Ready to post these responses? Any you want to modify?"

If approved:
```bash
# Push first (permalinks need the SHA to be on the remote)
git push

# Post inline replies
gh api repos/{owner}/{repo}/pulls/{pr_num}/comments \
  -X POST \
  -f body="Fixed — see [path#L42](https://github.com/owner/repo/blob/abc1234/path#L42)" \
  -F in_reply_to=COMMENT_ID
```

### S.9 Resolve threads + re-request review

After posting (S.8), resolve any thread whose reply just confirmed a fix, and re-request review if the PR needs another look. This is pure `gh api` (REST for re-request, GraphQL for thread resolution — GitHub's REST API has no resolve-thread endpoint) — no GitHub App/MCP connector needed. Full detail (ID-mapping query, the resolve-gate rule, the mutation, the re-request command) lives in `skills/pr-review-kit/ENGAGE.md` §9.6 — follow it as written rather than re-deriving; the short version: only resolve threads you've both replied to AND confirmed the code addresses, and only re-request review with explicit user authorization (same posting gate as S.8).

### S.10 Ticket update (optional)

If a Linear ticket is linked:
```
PR review comments addressed:
- Fixed N/M comments in <commit>
- K design questions answered
- Quality checks: passed

Ready for re-review.
```
