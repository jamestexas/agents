---
name: pr-review
description: Unified PR review skill — give reviews or respond to them. Auto-detects mode based on context. Includes parallel quality agents, cross-repo pattern checks, and convention audits. Use with a PR number, Linear ticket, or auto-detect from branch.
---

# PR Review

Give or respond to pull request reviews with automated quality checks.

## Arguments

$ARGUMENTS

Arguments can be:
- PR number: `123` or `owner/repo#123`
- Linear ticket: `ENG-123` (finds associated PR)
- Nothing (auto-detect from current branch)
- Explicit mode: `--review 123` (give review) or `--respond 123` (address comments)

---

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

## Review Mode

*You are giving a review of someone else's (or your own) PR.*

### R.1 Read the diff and existing comments

- Read the full diff from 1.2
- Note any existing review comments (resolved, in-progress, or unaddressed) to avoid duplicating feedback
- Read the PR description to understand scope and intent

### R.2 Launch parallel analysis agents

Launch THREE agents in parallel (single message, multiple Agent tool calls):

**Agent 1: Pattern compliance**
```
Explore agent (very thorough):
- Find 2-3 reference implementations for the same kind of change in this repo
- Compare the PR's patterns against them: type visibility, error handling, test
  conventions, logging, config
- Flag deviations from established patterns
```

**Agent 2: Duplication and reuse**
```
Explore agent (medium):
- For each new utility function in the PR, search the codebase for existing
  equivalents
- Check if any copied code exists behind internal/ in another module
- Flag duplicated logic that should be extracted or imported
```

**Agent 3: Infrastructure audit** (only if PR contains .tf files)
```
Explore agent (medium):
- Read sibling IAC modules in the same directory
- grep -r for resource names the PR creates to check for collisions
- Verify module variable interfaces match actual upstream module signatures
- Check for hardcoded values that should be variables
```

**Wait for all agents to complete.**

### R.3 Convention audit

If a language-specific standards skill exists (e.g., `/go-standards`), invoke it on all changed files.

Then run targeted grep audits on changed files:

| Check | What to grep for |
|---|---|
| Hardcoded status codes | Numeric literals in error-handling code |
| Wrong test context | Manual context creation vs framework helpers |
| Constructor return types | Constructors returning concrete types vs interfaces |
| Dead test variables | Variables written but never asserted |
| Non-standard logging | Imports of logging libraries that differ from repo convention |
| Scope creep | Files changed outside the stated PR scope |

### R.4 Compile review

Synthesize agent findings and audit results into a bulleted flaw list. For each issue:

- **File:line** — specific location
- **What's wrong** — direct, imperative statement
- **Why** — one line explaining the convention or risk
- **Severity** — Block (must fix), Fix (should fix), Nit (optional)

Group by severity. Lead with blocking issues.

### R.5 Render verdict

Conclude with exactly one of:
- **APPROVE** — no blocking issues, nits only
- **REQUEST CHANGES** — blocking issues exist but PR is salvageable
- **CLOSE PR** — fundamental design problems require starting over

### R.6 Present to user

Show the compiled review. Ask:
- "Post this as a GitHub review? (approve/request-changes/comment)"
- "Any items you want to remove or soften?"

If user approves, post via:
```bash
# Submit review with comments
gh pr review $PR_NUM --request-changes --body "$(cat <<'EOF'
<review body>
EOF
)"
```

Or for inline comments, use the review comments API.

---

## Respond Mode

*You are the PR author addressing review comments.*

### S.1 Filter unaddressed comments

From the data in 1.2, identify:
- Comments from reviewers (not the PR author)
- Comments without replies (where `in_reply_to_id` is null)
- Exclude comments already responded to

### S.2 Organize and plan

Create a task list grouped by file/component:

| Category | Description |
|---|---|
| Quick wins | Typos, formatting, naming, comments |
| Code changes | Refactoring, helpers, pattern fixes |
| Design questions | Need discussion, not just a code change |
| Testing | New or modified tests requested |

Present the plan. Ask: "Ready to proceed? Any comments you want to skip or handle manually?"

### S.3 Implement fixes

Work through the task list:
- Start with quick wins (reduces noise for re-review)
- Group related changes for atomic commits
- Read files before editing
- Only fix what was requested — no scope creep
- Stage specific files (never `git add -A`)

### S.4 Quality checks

Launch TWO agents in parallel:

**Agent 1: Convention review**
```
Review the changes just made:
- Do fixes follow repo patterns?
- Any new violations introduced while fixing?
```

**Agent 2: Duplication check**
```
Verify fixes didn't introduce duplicated code
```

Fix any issues found.

### S.5 Commit

```bash
git add <specific files>
git commit -m "refactor: address PR review comments

- <list of changes>

Addresses review comments from @reviewer."
```

### S.6 Generate responses

For each addressed comment, create a response:

**Simple fix:**
```
Fixed in <commit_hash>
```

**With explanation:**
```
Fixed in <commit_hash>

[Brief explanation of what was changed and why]
```

**Design question:**
```
[Thoughtful explanation with context]

Technical rationale: [...]
Trade-offs considered: [...]
```

**Intentional non-change:**
```
Keeping as-is — [reasoning].
[Evidence or reference supporting the decision]
```

### S.7 Present and post

Show all responses grouped by thread. Include comment ID and file context.

Ask: "Ready to post these responses? Any you want to modify?"

If approved:
```bash
# Push changes
git push

# Post inline replies
gh api repos/{owner}/{repo}/pulls/{pr_num}/comments \
  -X POST \
  -f body="Fixed in abc1234" \
  -F in_reply_to=COMMENT_ID
```

### S.8 Ticket update (optional)

If a Linear ticket is linked:
```
PR review comments addressed:
- Fixed N/M comments in <commit>
- K design questions answered
- Quality checks: passed

Ready for re-review.
```

---

## Error Handling

**PR not found:** List recent PRs via `gh pr list`, ask user to specify.

**Linear ticket not found:** Skip Linear integration, continue with PR-only workflow.

**Quality checks fail:** Show findings, ask whether to fix and retry or proceed. Never auto-push with failures.

**Git push fails:** Check if branch is behind remote. Offer to pull and retry. Don't force-push without confirmation.

**No unaddressed comments (respond mode):** Report "All comments addressed" and exit.

**Empty diff (review mode):** Report "No changes to review" and exit.

---

## Edge Cases

**Comment already has reply:** Skip in respond mode. Acknowledge in summary.

**Conflicting reviewer comments:** Flag for user attention. Don't auto-implement contradictions.

**Large PR (>15 files or >500 lines):** Suggest reviewing in chunks by commit or component. Offer to focus on the riskiest files first.

**Large number of comments (>15):** Offer to batch in respond mode. Tackle quick wins first.

**PR from a fork:** Adjust `gh api` paths. Flag if push access may be limited.

---

## Example Usages

```bash
# Review someone else's PR
/pr-review 34545

# Respond to comments on your PR (auto-detect from branch)
/pr-review

# Explicit modes
/pr-review --review 34545
/pr-review --respond 34545

# From Linear ticket
/pr-review ENG-456
```

---

## Integration Points

**GitHub:** `gh pr view`, `gh pr diff`, `gh api` (comments, reviews), `gh pr review`

**Linear (optional):** Find PR link, fetch context, post update

**Git:** Branch detection, clean commits, push

**Quality Agents:** platform-code-reviewer, Explore (duplication), Explore (IAC audit)

**Standards Skills:** `/go-standards`, `/python-standards`, etc. — invoked for convention audits

---

## Notes

- Review mode does NOT write code — it produces a review document
- Respond mode DOES write code — it implements fixes and commits
- Both modes use parallel agents for quality checks
- Always confirm with user before posting reviews or pushing code
- The review mode's pattern compliance check is the same Phase 0 research from `/feature-impl`, repurposed as a review lens
