# work-scope & pr-respond Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two skills that bookend the feature development workflow — `work-scope` decomposes feature work into reviewable PR-sized units before coding starts, and `pr-respond` provides fresh-eyes discovery-driven review and review comment responses on PRs.

**Architecture:** Skills are markdown prompt files with YAML frontmatter in `skills/`. `work-scope` takes a ticket or problem statement and outputs ordered work units that feed into `writing-plans`. `pr-respond` auto-detects the PR from the current branch, spawns an isolated discovery agent with no implementation context, and uses `gh api` to post evidence-backed responses with permalink discipline.

**Tech Stack:** Claude Code skills (SKILL.md + YAML frontmatter), `gh` CLI (PR metadata, review comments, posting replies), Agent tool (isolated Explore subagents for discovery)

---

## File Map

| Action | Path |
|--------|------|
| CREATE | `skills/work-scope/SKILL.md` |
| CREATE | `skills/pr-respond/SKILL.md` |

---

## Task 1: `work-scope` skill

**Files:**
- Create: `skills/work-scope/SKILL.md`

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p skills/work-scope
```

- [ ] **Step 2: Write `skills/work-scope/SKILL.md`**

Write the full skill file:

```markdown
---
name: work-scope
description: >
  Decompose feature work into reviewable, shippable units before coding starts.
  Use when the user provides a ticket (Linear ID, GitHub issue), describes a feature
  to build, or is about to start a multi-file change. Breaks work into a sequence
  of PRs that each have a single clear purpose a reviewer can hold in their head.
  Feeds into writing-plans — each work unit becomes a plan.
allowed-tools: "Bash,Read,Glob,Grep,Agent,mcp__mache__*,mcp__plugin_linear_linear__*"
argument-hint: "<ticket-id, problem statement, or nothing for interactive>"
---

# work-scope — Decompose Work Into Reviewable Units

Break feature work into a sequence of PRs that are each reviewable in a single sitting. The goal is to prevent the "1800-line PR that sits for a week" problem by scoping work upfront.

## Arguments

$ARGUMENTS

Arguments can be:
- A Linear ticket ID: `PROJ-123`, `ENG-456`
- A GitHub issue: `#123` or `owner/repo#123`
- A problem statement: `"add tenant reconciler"`
- Nothing (interactive — will ask what you're building)

If no arguments provided, ask the user for a problem statement before proceeding.

---

## Phase 1: Gather Context

Understand what "done" looks like before exploring the codebase.

### 1.1 Parse the input

If a **Linear ticket ID** (format: `ABC-123`):
```bash
# Use Linear MCP to fetch the ticket
```
Extract: title, description, acceptance criteria, linked issues.

If a **GitHub issue** (format: `#N` or `owner/repo#N`):
```bash
gh issue view $ISSUE_NUM --json title,body,labels,milestone
# or cross-repo:
gh issue view $ISSUE_NUM --repo $REPO --json title,body,labels,milestone
```

If a **problem statement** (free text): use it directly.

### 1.2 Extract scope signals

From the ticket or problem statement, identify:
- **What the feature needs to do** — the core deliverable
- **What it touches** — services, APIs, databases, infrastructure
- **What consumes it** — downstream systems, users, other teams
- **Constraints** — deadlines, dependencies on other work, compatibility requirements

If the input is vague, ask ONE clarifying question before proceeding to discovery. Do not ask multiple questions — discovery will answer most of them.

---

## Phase 2: Discover the Change Surface

Explore the codebase to understand *where* the changes land. This is not about *how* to write the code — it's about mapping the territory.

### 2.1 Launch discovery agent

Launch an Explore agent (thoroughness: "very thorough") with a self-contained prompt:

```
Given this feature: [problem statement from Phase 1]

Explore the codebase to map what needs to change:

1. Search for domain keywords from the feature description. What packages/modules
   are involved?

2. For each area that needs changes:
   - What files exist there today?
   - What do they depend on?
   - What depends on them?
   - What tests exist?

3. Look for natural seams — boundaries between:
   - Client/API layer vs business logic
   - Business logic vs entrypoints/wiring
   - Application code vs infrastructure (IAC)
   - New types/interfaces vs their implementations
   - Test infrastructure vs test cases

4. Check for existing patterns — how are similar features structured?
   (e.g., other reconcilers, other handlers, other API clients)

Return a structured change surface map:
- Areas that need changes, grouped by layer/concern
- Dependencies between those areas (what must exist before what)
- Existing patterns that this work should follow
- Any shared resources or utilities that already exist
```

### 2.2 Store the discovery report

The agent returns a change surface map. This is the input to decomposition.

---

## Phase 3: Decompose Into Reviewable Units

Using the discovery map, split the work into PRs.

### 3.1 Decomposition principles

Each unit must:
- **Have a single clear purpose** a reviewer can hold in their head
- **Be mergeable independently** (or in a defined stack order)
- **Be testable on its own** — each PR should be verifiable without the others
- **Manage cognitive load** — not a hard line count, but reviewable in one sitting

### 3.2 Decomposition heuristics

Apply these in order — each is a natural split point:

1. **Test infrastructure first** — new test helpers, fakes, fixtures. These unblock everything else and are easy to review.

2. **Types and interfaces** — new types, API surfaces, data structures. Reviewers can evaluate the design without implementation noise.

3. **Client/library layer** — wrappers around external APIs or shared utilities. These are self-contained and testable.

4. **Core business logic** — the main feature logic. This is usually the meatiest PR but should be focused on one concern.

5. **Entrypoints and wiring** — CLI commands, HTTP handlers, event subscribers, cron jobs. Thin wiring that connects the logic to the runtime.

6. **Infrastructure (IAC)** — Terraform, Kubernetes manifests, CI config. Almost always splits from application code.

### 3.3 Check dependency order

For each unit, verify:
- Its dependencies are satisfied by earlier units (or by code already in main)
- It doesn't introduce dead code (each unit should be usable/testable on its own)
- A reviewer can understand it without reading later units

If a unit depends on something from a later unit, reorder or merge them.

---

## Phase 4: Output

Present the ordered work units to the user.

### 4.1 Format

```markdown
## Work Units

### 1. [One-line summary]
- **What:** [2-3 sentence description of the PR's purpose]
- **Files:** [list of files/packages involved]
- **Depends on:** [previous unit numbers, or "nothing"]
- **Reviewer needs to know:** [what to focus on when reviewing this PR]
- **Testable by:** [how to verify this unit independently]

### 2. [One-line summary]
...
```

### 4.2 Sanity checks

Before presenting, verify:
- No unit touches more than ~2-3 concerns
- Every unit has a clear "reviewer needs to know" that can be understood without reading other units
- The dependency chain is linear or a simple DAG (no cycles)
- No unit is so small it's not worth a separate PR (merge trivial changes into their parent unit)

### 4.3 Present and confirm

Show the work units. Ask:
> "Does this breakdown make sense? Want to adjust any units — merge, split, reorder?"

---

## Transition to Implementation

Once the user approves the work units:

1. Each unit becomes a separate invocation of `writing-plans`
2. Start with unit #1
3. After each unit is implemented and merged, move to the next

Announce:
> "Work units approved. Ready to start planning unit #1: [title]? I'll invoke writing-plans for it."

Do NOT invoke writing-plans automatically — wait for the user to confirm they're ready to start.

---

## Error Handling

**Ticket not found:** Ask user for the problem statement directly. Skip ticket fetching.

**Discovery finds nothing relevant:** The feature may be entirely new with no existing patterns. Proceed with decomposition using general heuristics. Note in the output that no existing patterns were found.

**Feature is too small to decompose:** If the discovery map shows changes in only 1-2 files in the same concern area, say so: "This looks like a single-PR change — no decomposition needed." Offer to proceed directly to writing-plans.

**Feature is too large to decompose in one pass:** If the discovery map reveals 5+ independent subsystems, flag it: "This is really N separate features. Let's scope the first one." Help the user pick where to start.

---

## Example

**Input:** `PROJ-123` (tenant reconciler)

**Discovery finds:**
- `internal/clients/` has existing API client patterns (identities, workflows)
- `internal/tenants/` doesn't exist yet — new package
- `cmd/` has handler entrypoints for other reconcilers
- `iac/` has Terraform modules for similar services
- Existing reconcilers follow: client → job → handler → IAC pattern

**Output:**

### 1. Add the notification service tenant API client
- **What:** Thin wrapper around the notification service tenant API. Set/get/delete/list operations. Follows the same pattern as the existing identities and workflows clients.
- **Files:** `internal/clients/tenants.go`, `internal/clients/tenants_test.go`, `internal/clients/doc.go`, `internal/clients/example_test.go`
- **Depends on:** nothing
- **Reviewer needs to know:** Review the type surface and error handling. Compare against `internal/clients/identities.go` for convention alignment.
- **Testable by:** `go test ./internal/clients/...`

### 2. Add tenant reconciliation job
- **What:** Core reconciliation logic. Lists verified groups from datastore, lists tenants from the notification service, diffs, upserts/deletes.
- **Files:** `internal/tenants/job.go`, `internal/tenants/job_test.go`, `internal/tenants/doc.go`, `internal/tenants/example_test.go`, `internal/tenants/DESIGN.md`
- **Depends on:** #1
- **Reviewer needs to know:** The reconciliation algorithm. Compare against `internal/workflows/job.go` for the pattern.
- **Testable by:** `go test ./internal/tenants/...`

### 3. Wire up handler entrypoints
- **What:** HTTP handler for group events and cron entrypoint for the reconciler.
- **Files:** `cmd/tenant-handler/main.go`, `cmd/tenant-reconciler/main.go`
- **Depends on:** #1, #2
- **Reviewer needs to know:** Thin wiring — the interesting decisions are in #2.
- **Testable by:** `go build ./cmd/tenant-handler && go build ./cmd/tenant-reconciler`

### 4. Add IAC
- **What:** Terraform module for the tenant reconciler service and handler.
- **Files:** `iac/tenant-reconciler/main.tf`, `iac/tenant-reconciler/variables.tf`
- **Depends on:** #3
- **Reviewer needs to know:** Check tags, regions, and module variable interfaces against `iac/event-reconciler/`.
- **Testable by:** `terraform validate`
```

- [ ] **Step 3: Verify skill structure**

Check the file was written correctly:
```bash
head -10 skills/work-scope/SKILL.md
```

Expected: YAML frontmatter with `name: work-scope`, `description`, `allowed-tools`, `argument-hint`.

```bash
grep -c '^## Phase' skills/work-scope/SKILL.md
```

Expected: `4` (Phase 1 through Phase 4)

- [ ] **Step 4: Commit**

```bash
git add skills/work-scope/SKILL.md
git commit -m "$(cat <<'EOF'
feat(skills): add work-scope — decompose features into reviewable PR units

Breaks feature work into a sequence of shippable PRs before coding starts.
Takes a ticket ID or problem statement, discovers the change surface, and
outputs ordered work units that feed into writing-plans.
EOF
)"
```

---

## Task 2: `pr-respond` skill

**Files:**
- Create: `skills/pr-respond/SKILL.md`

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p skills/pr-respond
```

- [ ] **Step 2: Write `skills/pr-respond/SKILL.md`**

Write the full skill file:

```markdown
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

Provide discovery-driven review of a PR and respond to review comments with evidence-backed replies. The core principle: build understanding through codebase exploration before forming opinions, like a smart new hire reading the code for the first time.

## Arguments

$ARGUMENTS

Arguments can be:
- PR number: `123` or `owner/repo#123`
- Nothing (auto-detect from current branch)

If no arguments provided, detect from current branch.

---

## Architecture Constraint: Isolated Reviewer

The discovery agent MUST be spawned as a fresh subagent with NO implementation context.

**It receives:**
- The PR diff (file paths and key changes)
- Access to the codebase (Explore tools)
- The review comments (if any)

**It does NOT receive:**
- Conversation history from this session
- Planning context or ticket details
- The author's reasoning or intent

This is non-negotiable. The value is fresh eyes. If the agent has the author's context in its prompt, it rationalizes instead of questioning. If something can't be understood from the code alone, that's a signal — a human reviewer would be confused too, and that's worth flagging.

---

## Phase 1: Load PR State

### 1.1 Detect the PR

```bash
# Auto-detect from current branch
PR_NUM=$(gh pr view --json number --jq '.number' 2>/dev/null)
OWNER_REPO=$(gh pr view --json headRepository --jq '.headRepository.owner.login + "/" + .headRepository.name' 2>/dev/null)
```

If auto-detect fails and no argument provided, list recent PRs and ask the user:
```bash
gh pr list --author @me --json number,title,headRefName --jq '.[:5]'
```

### 1.2 Fetch PR data

Fetch all of this in parallel:

```bash
# PR metadata
gh pr view $PR_NUM --json title,body,author,baseRefName,headRefName

# Full diff
gh pr diff $PR_NUM

# Commit history
gh pr view $PR_NUM --json commits --jq '.commits[] | {oid: .oid[:8], msg: .messageHeadline}'

# Review comments
gh api repos/$OWNER_REPO/pulls/$PR_NUM/comments \
  --jq '.[] | {id, path, line, body, user: .user.login, in_reply_to_id, created_at}'

# Review submissions
gh api repos/$OWNER_REPO/pulls/$PR_NUM/reviews \
  --jq '.[] | {id, user: .user.login, state, body}'
```

### 1.3 Categorize comments

For each review comment from a reviewer (not the PR author):

**Unaddressed:** No reply exists (no other comment has `in_reply_to_id` pointing to this comment's `id`).

**Already replied:** The PR author has posted a reply.

**Addressed by code:** The file was modified after the comment was posted:
```bash
git log --after="$COMMENT_CREATED_AT" --oneline -- "$COMMENT_PATH"
```
If commits exist after the comment date on that file, check whether the current code addresses the reviewer's concern. Don't assume — read and verify.

### 1.4 Determine mode

- **If there are unaddressed review comments:** Engage mode — discover, then respond to comments
- **If no comments exist yet:** Fresh-eyes mode — discover, then flag potential reviewer concerns
- **If all comments are addressed:** Report "All comments addressed" and ask if user wants a fresh-eyes pass anyway

Present the mode and comment summary to the user:
```
PR #456: "notifications: add tenant reconciler"
13 files changed, +1843 -1

Review comments: 28 total
  - 7 from @alice (all replied)
  - 15 from @bob (12 unaddressed)
  - 6 from @jamestexas (self, replies)

Mode: Engage — 12 unaddressed comments from @bob

Proceed?
```

Wait for user confirmation before launching the discovery agent.

---

## Phase 2: Discover (Isolated Agent)

### 2.1 Prepare the agent prompt

Build a self-contained prompt for the discovery agent. Include:
- The list of changed files and a summary of what changed in each (from the diff)
- The unaddressed review comments (if in engage mode)
- Instructions to explore — NOT the author's reasoning

### 2.2 Launch the discovery agent

Launch a fresh Agent (subagent_type: "Explore", thoroughness: "very thorough"):

```
You are reviewing a pull request with fresh eyes. You have no context about why
this code was written — you need to build that understanding from the code itself.

## PR Summary
Title: [title]
Changed files:
[list of files with +/- line counts]

## Key Changes
[For each file: 2-3 sentence summary of what the diff shows, extracted from the diff itself]

## Review Comments to Address
[If engage mode: list each unaddressed comment with id, file, line, reviewer, body]

## Your Task

1. Read each changed file in full (not just the diff — read the whole file for context)

2. For each changed file, trace outward:
   - Who calls the functions that changed? (grep for function names)
   - What do the changed functions depend on?
   - Are there related tests? Are they adequate?
   - How do similar things work elsewhere in the codebase?

3. Build understanding:
   - What does this PR actually do? (form your own understanding, don't rely on the PR title)
   - What conventions does the surrounding code follow?
   - What edge cases exist that the code may not handle?

4. For each review comment (if any):
   - Read the code the reviewer pointed at
   - Trace the concern — is it valid? Already mitigated? Actually worse than they think?
   - Note the evidence you found (specific file paths and line numbers)

5. Flag anything you couldn't figure out from the code alone.
   If you can't understand why something is done a certain way, a reviewer won't either.

Return a structured discovery report:

## Understanding
[What this PR does, in your own words]

## Conventions Found
[Patterns in surrounding code that are relevant to reviewing this PR]

## Per-Comment Analysis (if engage mode)
For each review comment:
### Comment [id]: [first 50 chars of body]
- **Reviewer's concern:** [restate]
- **What I found:** [evidence from exploration — file paths, line numbers, code excerpts]
- **Assessment:** [valid / already mitigated / partially valid / incorrect]
- **Suggested response:** [draft response with file:line references]

## Fresh-Eyes Observations
[Things a reviewer would likely ask about that weren't in the comments]
- [observation] — evidence: [file:line]
```

### 2.3 Receive discovery report

The agent returns its findings. This is the foundation for Phase 3.

---

## Phase 3: Engage

### 3.1 Engage mode (unaddressed comments)

Using the discovery report, draft a response for each unaddressed comment.

**Response drafting rules:**

1. Every response MUST include a GitHub permalink to specific code.
   Format: `https://github.com/{OWNER_REPO}/blob/{SHA}/{path}#L{start}-L{end}`

2. Get the SHA and base branch:
   ```bash
   SHA=$(git rev-parse HEAD)
   BASE=$(gh pr view $PR_NUM --json baseRefName --jq '.baseRefName')
   ```

3. For each comment, find the relevant lines:
   ```bash
   # Find changed lines in the file
   git diff "origin/$BASE"...HEAD --unified=0 -- $COMMENT_PATH | grep '^@@'
   ```
   Pick the hunk most relevant to the reviewer's comment. Build the permalink.

4. If the fix is in a DIFFERENT file than the comment, link the new file.

5. If you cannot determine the line range, fall back to file-level link. Never use bare commit hashes.

**Response templates:**

Simple fix:
```
Fixed — see [{path}#L{line}]({permalink})
```

With explanation:
```
Fixed — [{path}#L{start}-L{end}]({permalink})

[Brief explanation of what was changed and why]
```

Already handled elsewhere:
```
This is handled at [{path}#L{start}-L{end}]({permalink}) — [explanation of how it mitigates the concern]
```

Valid concern, addressing:
```
Good catch — [acknowledge the issue]. Fixed at [{path}#L{start}-L{end}]({permalink}).

[Explanation of the approach taken]
```

Intentional non-change:
```
Keeping as-is — [reasoning].

Current code: [{path}#L{line}]({permalink})
[Evidence supporting the decision]
```

Design discussion:
```
[Thoughtful explanation with context]

See: [{path}#L{start}-L{end}]({permalink})

Trade-offs: [...]
```

Pre-existing issue:
```
This is pre-existing — see [{path}#L{line}]({permalink}).
[Why fixing it here would expand scope beyond this PR]
```

### 3.2 Fresh-eyes mode (no comments)

Using the discovery report, compile observations a reviewer would likely raise:

```markdown
## Fresh-Eyes Observations

### Convention concerns
- [observation] — [evidence at file:line]

### Edge cases
- [observation] — [evidence at file:line]

### Things I couldn't figure out from the code
- [observation] — [this would confuse a reviewer too]

### Looks good
- [positive observations — patterns followed correctly, good test coverage, etc.]
```

Present to the user. These are NOT posted to GitHub — they're for the author to address proactively before requesting review.

---

## Phase 4: Present and Post

### 4.1 Permalink hard gate

**HARD GATE:** Before presenting ANY response to the user, scan every response body for `github.com/.../blob/`. If ANY response is missing a permalink, STOP. Go back and find the evidence. Do not present responses without permalinks. Do not substitute bare commit hashes.

### 4.2 Present responses

Show all drafted responses grouped by reviewer, then by file:

```markdown
## Responses to @bob

### Thread 1: tenant-handler/main.go (nit — remove dead code)
**Comment:** [first 80 chars of reviewer comment]
**Response:**
Fixed — see [tenant-handler/main.go#L42](permalink)

### Thread 2: tenant-handler/main.go (return nil for non-retryable)
**Comment:** [first 80 chars of reviewer comment]
**Response:**
Good catch — non-retryable errors now return nil. See [tenant-handler/main.go#L70-L75](permalink)

[Explanation of the change]

---
Action: [post all / select individually / edit / skip]
```

### 4.3 User approval

The user can:
- **Post all** — post every response
- **Select** — pick which responses to post by number
- **Edit** — modify a response before posting
- **Skip** — don't post anything (maybe they want to make code changes first)

### 4.4 Post responses

Only after user approval. Push first if needed (permalinks require the SHA on remote):

```bash
# Check if we need to push
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/$(git branch --show-current) 2>/dev/null || echo "none")
if [ "$LOCAL" != "$REMOTE" ]; then
  git push
fi

# Post each approved response
gh api repos/$OWNER_REPO/pulls/$PR_NUM/comments \
  -X POST \
  -f body="$RESPONSE_BODY" \
  -F in_reply_to=$COMMENT_ID
```

Report what was posted:
```
Posted 8/12 responses to PR #456.
Skipped: #3 (user edit pending), #7 (deferred), #10-#12 (will address in code first)
```

---

## Error Handling

**PR not found / auto-detect fails:** List recent PRs with `gh pr list --author @me`, ask user to specify.

**No review comments (engage mode):** Switch to fresh-eyes mode automatically.

**gh api post fails:** Show the error, offer to retry. Common causes: auth, comment already replied to, PR closed.

**Discovery agent returns thin results:** The codebase may be small or the PR is isolated. Proceed with what's available — even partial discovery is better than no discovery.

**Permalink line range unclear:** Fall back to file-level link. Log which comments needed fallback so the user knows.

---

## Notes

- This skill does NOT implement code fixes. If the user wants to make changes based on the review, they do that separately (or use `pr-review --respond` for the full fix-and-respond workflow).
- The isolated agent constraint is the key differentiator from `pr-review`. pr-review's analysis agents are pattern-matchers; pr-respond's discovery agent builds understanding from scratch.
- Fresh-eyes mode is for self-review before requesting colleague review. Engage mode is for responding to existing review comments. Both use the same discovery engine.
- The skill posts responses under the user's GitHub identity (via `gh` CLI auth). It does not impersonate a bot.
```

- [ ] **Step 3: Verify skill structure**

Check the file was written correctly:
```bash
head -12 skills/pr-respond/SKILL.md
```

Expected: YAML frontmatter with `name: pr-respond`, `description`, `allowed-tools`, `argument-hint`.

```bash
grep -c '^## Phase' skills/pr-respond/SKILL.md
```

Expected: `4` (Phase 1 through Phase 4)

```bash
grep -c 'HARD GATE' skills/pr-respond/SKILL.md
```

Expected: `1` (the permalink hard gate)

```bash
grep 'isolated\|fresh eyes\|NO implementation context' skills/pr-respond/SKILL.md | head -5
```

Expected: Multiple matches confirming the isolation constraint is documented.

- [ ] **Step 4: Commit**

```bash
git add skills/pr-respond/SKILL.md
git commit -m "$(cat <<'EOF'
feat(skills): add pr-respond — fresh-eyes review and comment response

Discovery-driven PR review that spawns an isolated agent with no
implementation context. Two modes: fresh-eyes (pre-review self-check)
and engage (respond to existing review comments with evidence-backed
replies via gh api).
EOF
)"
```

---

## Task 3: Final verification and documentation commit

**Files:**
- Verify: `skills/work-scope/SKILL.md`
- Verify: `skills/pr-respond/SKILL.md`
- Modify: `docs/superpowers/specs/2026-04-10-work-scope-and-pr-respond-design.md` (mark complete)

- [ ] **Step 1: Verify both skills exist and have correct structure**

```bash
ls -la skills/work-scope/SKILL.md skills/pr-respond/SKILL.md
```

Expected: Both files exist.

```bash
for skill in work-scope pr-respond; do
  echo "=== $skill ==="
  head -1 skills/$skill/SKILL.md  # should be ---
  grep '^name:' skills/$skill/SKILL.md
  grep '^allowed-tools:' skills/$skill/SKILL.md
  echo ""
done
```

Expected: Both skills have frontmatter with correct name and allowed-tools.

- [ ] **Step 2: Verify work-scope contains key sections**

```bash
grep -n '^## Phase\|^### [0-9]' skills/work-scope/SKILL.md
```

Expected output showing:
- Phase 1: Gather Context (with 1.1, 1.2)
- Phase 2: Discover the Change Surface (with 2.1, 2.2)
- Phase 3: Decompose Into Reviewable Units (with 3.1, 3.2, 3.3)
- Phase 4: Output (with 4.1, 4.2, 4.3)
- Transition to Implementation

- [ ] **Step 3: Verify pr-respond contains key sections**

```bash
grep -n '^## Phase\|^## Architecture\|HARD GATE\|isolated\|in_reply_to' skills/pr-respond/SKILL.md
```

Expected: Architecture constraint section, 4 phases, hard gate, isolation references, `in_reply_to` in the posting command.

- [ ] **Step 4: Mark spec as implemented**

Append to `docs/superpowers/specs/2026-04-10-work-scope-and-pr-respond-design.md`:

```markdown

---

## Implementation Status

**Completed:** 2026-04-10

- `skills/work-scope/SKILL.md` — created
- `skills/pr-respond/SKILL.md` — created
```

- [ ] **Step 5: Commit spec update**

```bash
git add docs/superpowers/specs/2026-04-10-work-scope-and-pr-respond-design.md
git commit -m "$(cat <<'EOF'
docs: mark work-scope and pr-respond design as implemented
EOF
)"
```
