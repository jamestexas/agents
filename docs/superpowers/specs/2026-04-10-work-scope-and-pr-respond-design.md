# Design: work-scope & pr-respond

Two skills that bookend the feature development workflow. `work-scope` decomposes work into reviewable units before coding starts. `pr-respond` provides fresh-eyes review and responds to review comments on a PR.

Both share a discovery-first approach: explore the codebase to earn understanding before forming opinions.

## Problem

Feature work done in silos produces large PRs. Large PRs are hard to review — they sit, get rubber-stamped, or generate review cycles that waste colleague time on things AI could handle. Two gaps exist:

1. **No upfront decomposition.** Work gets figured out as it goes, so the PR boundary ends up being "everything I did" rather than a reviewable unit.
2. **No first-pass reviewer.** Review comments that could be resolved with codebase exploration (tracing a call path, checking a convention, verifying a claim) still require a colleague's time.

## Skill 1: `work-scope`

### Location

`skills/work-scope/SKILL.md`

### Frontmatter

```yaml
---
name: work-scope
description: >
  Decompose feature work into reviewable, shippable units before coding starts.
  Use when the user provides a ticket (Linear ID, GitHub issue), describes a feature
  to build, or is about to start a multi-file change. Breaks work into a sequence
  of PRs that each have a single clear purpose a reviewer can hold in their head.
  Feeds into writing-plans — each work unit becomes a plan.
allowed-tools: "Bash,Read,Glob,Grep,Agent,mcp__mache__*"
argument-hint: "<ticket-id, problem statement, or nothing for interactive>"
---
```

### Trigger conditions

The skill should fire when:
- User provides a Linear ticket ID or GitHub issue
- User describes a feature to build ("I need to add X")
- User is about to start multi-concern work
- The user's described work clearly spans multiple concerns (different layers, packages, or systems)

### Phase 1: Gather context

Read the ticket or problem statement. If a Linear ID or GitHub issue URL, fetch it to understand what "done" looks like. Extract:
- What the feature needs to do
- Any constraints or dependencies mentioned
- Who/what consumes the output

### Phase 2: Discover

Explore the codebase to understand what needs to change. This is not about *how* to write the code — it's about *where* the changes land:

- What packages/modules will be touched?
- What are the dependency relationships between those changes?
- What already exists that this builds on?
- What are the natural seams in the affected code? (seam-discovery thinking)
- What tests exist for the areas being changed?

Launch an Explore agent for this. The agent should search broadly — grep for domain keywords, read related modules, trace dependency chains. The output is a map of the change surface.

### Phase 3: Decompose into reviewable units

Using the discovery map, split the work into PRs that each:

- **Have a single clear purpose** a reviewer can hold in their head
- **Can be merged independently** (or in a defined stack order with explicit dependencies)
- **Are testable on their own** — each PR should be verifiable without the others
- **Manage cognitive load** — not a hard line count, but each unit should be something a reviewer can reason about in one sitting

Decomposition heuristics:
- **Layer boundaries** are natural split points (client library, business logic, entrypoints, IAC)
- **New types/interfaces** often deserve their own PR — reviewers can evaluate the API surface without implementation noise
- **Test infrastructure** (new test helpers, fakes, fixtures) can land first
- **IAC** almost always splits from application code

### Phase 4: Output

An ordered list of work units:

```markdown
## Work Units

### 1. Add Notification API client
- **Files:** `internal/clients/tenants.go`, tests, doc.go
- **Depends on:** nothing
- **Reviewer needs to know:** This is a thin wrapper around the notification service API. Review the type surface and error handling.

### 2. Add tenant reconciliation job
- **Files:** `internal/tenants/job.go`, tests, DESIGN.md
- **Depends on:** #1 (uses the client)
- **Reviewer needs to know:** Core business logic. The reconciliation algorithm is: list local → list remote → diff → upsert/delete.

### 3. Wire up entrypoints
- **Files:** `cmd/tenant-handler/main.go`, `cmd/tenant-reconciler/main.go`
- **Depends on:** #1, #2
- **Reviewer needs to know:** Thin wiring. The interesting decisions are in #2.

### 4. Add IAC
- **Files:** `iac/tenant-reconciler/main.tf`, `variables.tf`
- **Depends on:** #3 (references the service)
- **Reviewer needs to know:** Check tags, regions, and module variable interfaces against existing patterns.
```

### Transition

Each work unit feeds into `writing-plans` as a separate plan. The user works through them in order. This is the handoff — work-scope decides *what* the units are, writing-plans decides *how* to implement each one.

---

## Skill 2: `pr-respond`

### Location

`skills/pr-respond/SKILL.md`

### Frontmatter

```yaml
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
```

### Trigger conditions

The skill should fire when:
- User mentions review comments on their PR
- User asks for a fresh-eyes check before requesting review
- User starts a session on a branch with an open PR that has unaddressed comments
- User says "look at my PR" or similar

### Architecture constraint: isolated reviewer agent

The review agent MUST be spawned as a fresh subagent with NO implementation context. It receives:
- The PR diff
- Access to the codebase (Explore tools)
- The review comments (if any)

It does NOT receive:
- Conversation history
- Planning context
- Ticket details
- The author's reasoning

This is non-negotiable. The value is fresh eyes. If the agent has the author's context, it rationalizes instead of questioning. If something can't be understood from the code alone, that's a signal — it means a human reviewer would be confused too.

### Phase 1: Load PR state

Auto-detect PR from current branch (or use provided argument):

```bash
PR_NUM=$(gh pr view --json number --jq '.number' 2>/dev/null)
```

Fetch:
- PR diff (`gh pr diff`)
- Review comments (`gh api repos/{owner}/{repo}/pulls/{pr_num}/comments`)
- Review submissions (`gh api repos/{owner}/{repo}/pulls/{pr_num}/reviews`)
- Commit history (`gh pr view --json commits`)

Categorize comments:
- **Unaddressed:** from reviewers, no reply (no `in_reply_to_id` pointing to them)
- **Already replied:** have a reply from the author
- **Addressed by code:** file was modified after the comment was posted

### Phase 2: Discover (isolated agent)

Launch a fresh Agent (subagent_type: Explore) with a self-contained prompt. The prompt includes:
- The PR diff (or a summary with file paths and key changes)
- Instructions to explore the codebase and build understanding
- No implementation context — the agent must earn its understanding

The agent should:
- Read the files touched by the diff
- Trace outward: callers of changed functions, related modules, test coverage
- Understand the conventions in the surrounding code
- Build a mental model of what this PR does and why

The agent returns a discovery report: what it learned, what it found surprising, what it couldn't figure out from the code alone.

### Phase 3: Engage

Two sub-modes depending on PR state:

#### If there are unaddressed review comments:

Using the discovery report from Phase 2, the parent skill drafts responses for each comment:
- Reads the code the reviewer pointed at (informed by the discovery agent's understanding)
- Traces the concern — is it valid? Already mitigated elsewhere? Actually a bigger issue?
- Forms an evidence-backed response

Response format follows the permalink discipline from pr-review Section S.7:
- Every response MUST include a GitHub permalink (`github.com/.../blob/...`)
- Templates: "Fixed — see [permalink]", "This is handled at [permalink] because...", "Valid concern — [evidence from code exploration]"

**Hard gate:** Before presenting responses, scan every response for `github.com/.../blob/`. If any response is missing a permalink, stop and find the evidence.

#### If no comments yet (pre-review fresh-eyes check):

With the discovery context, flag things a reviewer would likely ask about:
- Unconventional patterns (different from how similar things are built nearby)
- Missing error handling or edge cases the code doesn't address
- Things the agent couldn't understand from the code — if the AI can't figure it out, a reviewer won't either
- Dependency or import concerns

Surface these as observations, not a formal review. The user can address proactively.

### Phase 4: Present and post

Show the user all drafted responses grouped by thread:
- Comment ID, file:line, reviewer, original comment
- Drafted response with permalink

User approves, edits, or skips each one. Only approved responses are posted.

```bash
# Push first — permalinks need SHA on remote
git push

# Post each approved response
gh api repos/{owner}/{repo}/pulls/{pr_num}/comments \
  -X POST \
  -f body="$RESPONSE_BODY" \
  -F in_reply_to=$COMMENT_ID
```

---

## Relationship between skills

```
ticket / problem statement
        |
        v
  [work-scope]  ──→  ordered work units
        |
        v  (each unit)
  [writing-plans]  ──→  implementation plan
        |
        v
  [feature-impl / TDD / etc]  ──→  code on branch
        |
        v
  [pr-respond: fresh-eyes]  ──→  pre-review self-check
        |
        v
  request colleague review
        |
        v
  [pr-respond: engage]  ──→  address review comments
        |
        v
  merge
```

## Concrete example: Tenant reconciler (example PR)

**Without these skills:** 1843-line PR, 13 files, two waves of reviewers, 28 comments. Reviewer has to hold the entire thing in their head.

**With work-scope:** Before coding, the work decomposes into:
1. Notification API client (client + tests, ~430 lines)
2. Reconciliation job logic (business logic + tests, ~825 lines)
3. Handler entrypoints (wiring, ~300 lines)
4. IAC (terraform, ~290 lines)

Each is reviewable in isolation. Each tells a clear story.

**With pr-respond:** Before requesting review on PR #1 (the client), run fresh-eyes check. The isolated agent explores the codebase, finds how other clients are built in `internal/clients/`, and flags: "Other clients wrap 401 with a hint message but this one doesn't — intentional?" The author fixes it before a colleague ever sees it.

When alice leaves 7 comments on the next PR, `pr-respond` traces each concern through the code and drafts evidence-backed replies. The author reviews and approves the batch. alice comes back to a PR where every comment has a substantive response with code links — not "fixed" or "done."

## Open questions

None — design is complete pending user review.

---

## Implementation Status

**Completed:** 2026-04-10

- `skills/work-scope/SKILL.md` — created
- `skills/pr-respond/SKILL.md` — created
