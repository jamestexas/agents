---
name: pr-review
description: Systematic PR review response workflow with automated quality checks
---

# PR Review Response Workflow

Systematically address PR review comments with automated quality checks, organized implementation, and ready-to-post responses.

## Arguments

$ARGUMENTS

Arguments can be:
- PR number (e.g., `123`)
- Nothing (auto-detect from current branch)
- Linear ticket ID (e.g., `ENG-123`) - will find associated PR

## Workflow

### Phase 1: Discovery & Context Gathering

**1.1 Determine the PR**

If PR number provided:
```bash
PR_NUM="$1"
```

If Linear ticket ID provided (format: ABC-123):
```bash
# Use Linear MCP to get issue and extract PR link
# Linear issues often have PR links in description or comments
```

If nothing provided, detect from current branch:
```bash
# Get current branch
BRANCH=$(git branch --show-current)

# Find PR for this branch
gh pr list --head "$BRANCH" --json number,title,url
```

Ask user to confirm the PR if ambiguous.

**1.2 Fetch PR review comments**

```bash
# Get all review comments with details
gh api repos/{owner}/{repo}/pulls/$PR_NUM/comments \
  --jq '.[] | {path: .path, line: .line, body: .body, id: .id, user: .user.login, in_reply_to_id: .in_reply_to_id, created_at: .created_at}'
```

**1.3 Filter unaddressed comments**

Parse the JSON to identify:
- Comments from reviewers (not the PR author)
- Comments without replies (where `in_reply_to_id` is null)
- Exclude comments the user has already responded to

**1.4 Check for related Linear ticket**

If a Linear ticket is linked to the PR:
```bash
# Extract ticket ID from PR description or branch name
# Use Linear MCP to fetch ticket details and add context
```

### Phase 2: Organization & Planning

**2.1 Create todo list**

Use TodoWrite to create organized list:
- Group by file/component
- Categorize by type:
  - ✅ Quick wins (copyrights, typos, comments)
  - 🔧 Code improvements (refactoring, helpers)
  - 💬 Design questions (need discussion)
  - 🧪 Testing requests

**2.2 Present plan to user**

Show:
- Number of comments to address
- Categorized list
- Estimated scope

Ask: "Ready to proceed with implementation? Any comments you want to skip or handle manually?"

### Phase 3: Implementation

**3.1 Implement fixes systematically**

Work through the todo list:
- Start with quick wins first (builds confidence, reduces diff noise)
- Group related changes for atomic commits
- Update todos to in_progress → completed as you work

**3.2 Read files before editing**

ALWAYS read files first to understand context.

**3.3 Avoid over-engineering**

- Only fix what was requested
- Don't add features or extra refactoring
- Keep changes minimal and focused

**3.4 Create clean commits**

```bash
# Stage specific files (NEVER use git add -A)
git add file1.go file2.tf

# Sign commits
git commit -S -m "refactor: address PR review comments

- Fix copyright years to YYYY
- Extract repeated strings to variables
- Add helper function for X

Addresses review comments from @reviewer."
```

### Phase 4: Quality Checks (Parallel Execution)

**IMPORTANT**: Launch these TWO agents in parallel (single message, multiple Task tool calls):

**4.1 Platform Code Review**
```
Launch platform-code-reviewer agent to review:
- Go idioms and patterns
- Terraform semantic correctness
- Platform-specific anti-patterns
- Regional/environment configuration
```

**4.2 Duplication Check**
```
Launch Explore agent (medium thoroughness) to verify:
- Not duplicating existing utilities
- Using appropriate existing abstractions
- Following established patterns in codebase
- No reinvented wheels
```

**Wait for both agents to complete.**

**4.3 Analyze findings**

Review both agent outputs:
- Critical issues → Must fix before pushing
- Suggestions → Discuss with user
- Confirmations → Document in commit messages

### Phase 5: Refinements

**5.1 Address quality check findings**

If issues found:
- Fix critical issues
- Commit improvements
- Consider re-running checks if changes were significant

**5.2 Check code comment tone**

Ensure code comments are:
- Professional and factual
- Not conversational or narrative
- Not "responding" to review comments within code
- Self-contained documentation

### Phase 6: Push & Generate Responses

**6.1 Verify clean state**

```bash
# Ensure no uncommitted changes
git status

# Verify commits are signed
git log --show-signature -3
```

**6.2 Push to remote**

```bash
git push
```

**6.3 Generate response templates**

For each unaddressed comment, create appropriate response:

**Simple fixes:**
```
✅ Fixed in <commit_hash>
```

**With explanation:**
```
✅ Fixed in <commit_hash>

[Brief explanation of what was changed and why]
```

**Design questions:**
```
[Thoughtful explanation with context]

Technical rationale: [...]
Trade-offs considered: [...]
```

**Already handled:**
```
✅ Already addressed in <commit_hash> - [what was done]
```

**6.4 Present responses to user**

Show all generated responses grouped by comment thread. Include:
- Comment ID (for posting via gh)
- File and line context
- Proposed response text

Ask user: "Ready to post these responses? Any you want to modify?"

### Phase 7: Post Responses (Optional)

If user approves, post responses via gh CLI:

```bash
# Post inline comment reply
gh api repos/{owner}/{repo}/pulls/{pr_num}/comments \
  -X POST \
  -f body="✅ Fixed in abc1234" \
  -F in_reply_to=COMMENT_ID
```

Or provide commands for user to run manually.

### Phase 8: Linear Ticket Update (If Applicable)

If PR is linked to a Linear ticket:

```bash
# Update ticket with progress comment
# Use Linear MCP: create_comment with summary of changes
```

Example comment:
```markdown
PR review comments addressed:
- Fixed 8/10 comments in commit abc1234
- 2 design questions answered
- Platform review: SHIP ✅
- Duplication check: PASSED ✅

Ready for re-review.
```

## Error Handling

**If PR not found:**
- List recent PRs via `gh pr list`
- Ask user to specify PR number

**If Linear ticket not found:**
- Skip Linear integration (it's optional)
- Continue with PR-only workflow

**If quality checks fail:**
- Show findings to user
- Ask whether to fix and retry, or proceed anyway
- Never auto-push with failing checks

**If git push fails:**
- Check if branch is behind remote
- Offer to pull and retry
- Don't force-push without confirmation

## Edge Cases

**Comment already has reply:**
- Skip it in todo list
- Note in summary: "X comments already addressed"

**Conflicting comments:**
- Flag for user attention
- Don't auto-implement contradictory changes

**Large number of comments (>15):**
- Ask user if they want to batch them
- Offer to tackle quick wins first

**No unaddressed comments:**
- Report: "All review comments already addressed! 🎉"
- Exit gracefully

## Output Format

### Summary Report
```
📊 PR Review Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR: #123 - Feature implementation
Reviewer: @reviewer
Comments: 10 total, 7 unaddressed

Categories:
✅ Quick wins: 3
🔧 Code improvements: 3
💬 Design questions: 1
🧪 Testing: 0

Ready to proceed? [y/n]
```

### Progress Tracking
Use TodoWrite throughout to show real-time progress.

### Final Report
```
✅ PR Review Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Commits: 3 (all signed ✅)
  - abc1234: refactor: address review comments
  - def5678: docs: clarify X
  - ghi9012: fix: update Y

Quality Checks:
  - Platform review: SHIP ✅
  - Duplication check: PASSED ✅

Responses ready for 7 comments.
Pushed to origin/your-branch ✅

Next: Post responses to PR (commands provided below)
```

## Example Usages

**Basic usage:**
```bash
/pr-review 123
# Addresses all comments in PR #123
```

**Auto-detect from branch:**
```bash
/pr-review
# Detects PR from current branch
```

**From Linear ticket:**
```bash
/pr-review ENG-456
# Finds PR linked to Linear ticket ENG-456
```

## Integration Points

**GitHub:**
- `gh pr view` - Get PR details
- `gh api` - Fetch review comments, post replies
- `gh pr comment` - Add general PR comments

**Linear (optional):**
- Find PR link in ticket description
- Update ticket with progress
- Link commits back to ticket

**Git:**
- Branch detection
- Signed commits
- Clean history

**Quality Agents:**
- platform-code-reviewer (if available)
- Explore agent for duplication checks
- Any other review agents in environment

## Notes

- All file operations use Read/Edit/Write tools (not bash)
- Git operations use bash (never redirect bash output to files)
- TodoWrite for progress tracking throughout
- Always confirm before destructive operations
- Keep commits atomic and well-described
- Sign all commits for compliance
