---
name: pr-review
description: Unified PR review skill — give reviews or respond to them. Auto-detects mode. Review mode runs three lenses in parallel (convention, behavioral correctness, infrastructure) then synthesizes with a disagreement matrix. Respond mode implements fixes and posts threaded replies.
---

# PR Review

Give or respond to pull request reviews. Review mode runs parallel analysis agents through three lenses — convention compliance, behavioral correctness, and infrastructure — then synthesizes findings with explicit disagreement handling.

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
- Note the stated scope — you'll check for both scope creep AND understated scope later

### R.2 Launch parallel analysis agents

Launch FOUR agents in parallel (single message, multiple Agent tool calls):

**Agent 1: Convention compliance** (the "standard" lens)
```
Explore agent (very thorough):
- Find 2-3 reference implementations for the same kind of change in this repo
- Compare the PR's patterns against them: type visibility, error handling, test
  conventions, logging, config
- Flag deviations from established patterns
- Check build hygiene: are dependency files tidy? (go.mod, package-lock.json, etc.)
  Do direct imports match direct dependency declarations?
```

**Agent 2: Behavioral correctness** (the "adversarial" lens)
```
Explore agent (very thorough):
This is the most important agent. It traces execution paths, not patterns.

For each mutation path (write/delete/update) in the PR:
1. Trace the full path: trigger → handler → business logic → external API call
2. Identify all inputs to the path and ask: what if this input is truncated,
   empty, stale, or arrives out of order?
3. For event-driven code: enumerate every event type the system handles.
   For each event type, trace what happens. Then ask: what event sequences
   could produce bad state? (e.g., unverify then delete, create during cleanup)
4. For cleanup/deletion logic: what happens if the "source of truth" query
   returns a truncated or incomplete result? Does the code delete things it
   shouldn't?
5. For pagination: does the code page through all results or assume single-page?
   What is the consequence of truncation — missed work (recoverable) or
   data deletion (catastrophic)?
6. For error handling: trace every error path. Is the same error type handled
   consistently across all call sites? (e.g., if 401 is special-cased in one
   place, is it special-cased everywhere?)
7. For dry-run/safety modes: does dry-run cover ALL mutation paths, or only
   some? If the feature has 3 write paths and dry-run covers 2, that's a bug.

Rate severity based on CONSEQUENCE, not just code quality:
- Same pattern as existing code but worse consequence here = escalate
- Pre-existing bug but this PR makes it reachable from a new path = escalate
- Documented limitation with self-healing = note but don't necessarily block
```

**Agent 3: Duplication and reuse**
```
Explore agent (medium):
- For each new utility function in the PR, search the codebase for existing
  equivalents
- Check if any copied code exists behind internal/ in another module
- If code was copied, check for behavioral divergence from the original
  (different return values, different error handling, missing edge cases)
- Flag duplicated logic that should be extracted or imported
```

**Agent 4: Infrastructure audit** (only if PR contains .tf files)
```
Explore agent (medium):
- Read sibling IAC modules in the same directory
- grep -r for resource names the PR creates to check for collisions
- Verify module variable interfaces match actual upstream module signatures
- Check for hardcoded values that should be variables
- Check team/product/label tags for consistency with sibling modules
  (these affect alert routing, dashboards, and cost attribution)
- Verify secret injection method matches the module's expected pattern
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
| Untested code in main | Functions with non-trivial logic in `package main` with no `_test.go` |
| Build hygiene | Dependency files tidy? Direct/indirect markers correct? |

### R.4 Synthesize findings

This is not just a merge — it's a structured synthesis that handles disagreement.

**4.1 Group by location**

Group all findings from all agents by file:line. When multiple agents flag the same location, note it.

**4.2 Build the disagreement matrix**

Where agents disagree on severity or whether something is an issue at all:

```markdown
| Location | Convention | Behavioral | Duplication | IAC | Resolution |
|----------|-----------|------------|-------------|-----|------------|
| groups.go:38 | nit (pre-existing) | BLOCK (truncation → deletion) | — | — | ESCALATE: consequence is worse here |
| handler.go:95 | — | issue (event ordering gap) | divergence from original | — | Flag: needs human judgment |
```

**4.3 Apply consequence-aware severity**

For each finding, the final severity considers:

- **"This PR introduced it"** vs **"this code has the bug"** — pre-existing bugs that the PR makes *worse* or *newly reachable* should still be flagged, but with explicit context about what's new vs inherited
- **Consequence escalation** — same code pattern in two services can warrant different severity if the blast radius differs (e.g., missed backfill vs active data deletion)
- **Self-healing** — a bug that self-heals on the next cron run is less severe than one that persists until manual intervention, but for customer-facing systems, "up to 1 hour of broken notifications" may still be unacceptable

**4.4 Classify each finding**

| Severity | Meaning |
|---|---|
| BLOCK | Must fix before merge. Data loss, security, or correctness bug. |
| FIX | Should fix. Convention violation, missing test, inconsistency. |
| NIT | Optional. Style, minor improvement, documentation. |
| FLAG | Needs human judgment. Agents disagree, or severity depends on product context. |

### R.5 Compile review

For each finding:

- **File:line** — specific location
- **What's wrong** — direct, imperative statement
- **Why** — one line explaining the risk or convention
- **Severity** — BLOCK / FIX / NIT / FLAG
- **New vs inherited** — did this PR introduce it, or is it pre-existing?

Lead with BLOCKs, then FLAGs (because these need human attention), then FIXes, then NITs.

If there are disagreements between agents, include a **Disagreements** section:
```markdown
## Disagreements

D1. [Location] — Convention agent says [X]. Behavioral agent says [Y].
    Resolution depends on: [what human context is needed].
```

### R.6 Render verdict

Conclude with exactly one of:
- **APPROVE** — no blocking issues, nits only
- **REQUEST CHANGES** — blocking or flagged issues exist but PR is salvageable
- **CLOSE PR** — fundamental design problems require starting over

### R.7 Present to user

Show the compiled review. Ask:
- "Post this as a GitHub review? (approve/request-changes/comment)"
- "Any items you want to remove or soften?"

If user approves, post via:
```bash
gh pr review $PR_NUM --request-changes --body "$(cat <<'EOF'
<review body>
EOF
)"
```

Or for inline comments, use the review comments API.

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

**Build the permalink after pushing:**

```bash
# Get the HEAD SHA after push (needed for stable permalinks)
SHA=$(git rev-parse HEAD)

# Build permalink for a specific file and line:
# https://github.com/{owner}/{repo}/blob/{sha}/{path}#L{line}
# For a range: #L{start}-L{end}
```

Detect `{owner}/{repo}` from the PR metadata fetched in Phase 1.

**Response templates:**

**Simple fix:**
```
Fixed — see [{path}#L{line}](https://github.com/{owner}/{repo}/blob/{sha}/{path}#L{line})
```

**With explanation:**
```
Fixed — [{path}#L{start}-L{end}](https://github.com/{owner}/{repo}/blob/{sha}/{path}#L{start}-L{end})

[Brief explanation of what was changed and why]
```

**Multiple locations:**
```
Fixed in {sha_short}:
- [{path1}#L{line}](permalink1) — [what changed here]
- [{path2}#L{line}](permalink2) — [what changed here]
```

**Design question:**
```
[Thoughtful explanation with context]

See the implementation: [{path}#L{start}-L{end}](permalink)

Technical rationale: [...]
Trade-offs considered: [...]
```

**Intentional non-change:**
```
Keeping as-is — [reasoning].

Current code: [{path}#L{line}](permalink)
[Evidence or reference supporting the decision]
```

**Pre-existing issue acknowledged:**
```
This is pre-existing behavior — see [{path}#L{line}](permalink). Filed {ticket} to address separately.
[Why fixing it here would expand scope beyond this PR]
```

### S.8 Present and post

Show all responses grouped by thread. Include:
- Comment ID (for posting via gh)
- File and line context
- Proposed response text **with permalinks already rendered**

Verify every response contains at least one `github.com/.../blob/` permalink. If a response is missing one, add it before presenting.

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

### S.9 Ticket update (optional)

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

**Pre-existing bugs surfaced by review:** Distinguish clearly. If the PR didn't introduce the bug but makes it worse or newly reachable, flag it as "inherited, escalated." If the bug is completely pre-existing and unrelated to the PR's changes, note it but don't block.

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

**Analysis Agents:** Convention compliance, behavioral correctness, duplication, IAC audit

**Standards Skills:** `/go-standards`, `/python-standards`, etc. — invoked for convention audits

---

## Design Rationale

This skill uses a multi-lens review model inspired by adversarial review systems that run "good cop" and "bad cop" passes independently, then synthesize.

**Why multiple agents instead of one pass?**
A single reviewer tends to anchor on either convention or correctness, rarely both. Convention-focused reviews catch style issues but miss behavioral edge cases (event ordering, pagination truncation, incomplete dry-run coverage). Behavioral reviews catch correctness bugs but miss style violations. Running both in parallel and synthesizing produces better coverage than either alone.

**Why the disagreement matrix?**
When two agents flag the same location for different reasons, that's the highest-value signal. When they disagree on severity, that reveals a judgment call that needs human input. Surfacing disagreements explicitly (rather than picking a winner) gives the reviewer the information they need to decide.

**Why consequence-aware severity?**
The same code pattern can be a nit in one service and a blocker in another. A single-page list call that truncates results is a nit when the consequence is "missed backfill that self-heals." It's a blocker when the consequence is "actively deletes customer data for orgs on page 2+." The behavioral agent is instructed to rate by consequence, not pattern.

**Why "new vs inherited"?**
Agent reviewers struggle to distinguish "this code has a bug" from "this PR introduced a bug." Both are factually accurate observations, but they require different responses. A pre-existing bug that's unrelated to the PR is informational. A pre-existing bug that the PR makes worse or newly reachable is actionable. Labeling each finding as new or inherited gives the human reviewer the context to make that call.

---

## Notes

- Review mode does NOT write code — it produces a review document
- Respond mode DOES write code — it implements fixes and commits
- The behavioral correctness agent is the most important addition — it traces execution paths rather than matching patterns, catching edge cases that static analysis misses
- Always confirm with user before posting reviews or pushing code
- The convention compliance check reuses the same pattern-discovery approach from `/feature-impl` Phase 0, repurposed as a review lens
