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

Prevent the 1800-line PR that sits for a week. Break feature work into a sequence of shippable PRs before writing any code — each with a single clear purpose a reviewer can hold in their head.

## Arguments

$ARGUMENTS

Accepts any of:

- **Linear ticket ID:** `PROJ-123`, `ENG-42` — fetches title, description, and acceptance criteria via Linear MCP
- **GitHub issue:** `#123` or `owner/repo#123` — fetches issue body via `gh issue view`
- **Problem statement:** free text describing the feature to build
- **Nothing:** interactive mode — ask the user what they want to build

If no arguments provided, ask: "What feature or change are you scoping?"

---

## Phase 1: Gather Context

### 1.1 Parse the input

Determine the input type and fetch details:

**Linear ticket** (matches pattern like `ABC-123`):
```
Use Linear MCP tools:
- mcp__plugin_linear_linear__get_issue to fetch the ticket
- Extract: title, description, acceptance criteria, labels, project
- Note any linked issues or parent epics for scope context
```

**GitHub issue** (matches `#123` or `owner/repo#123`):
```bash
gh issue view 123 --json title,body,labels,assignees,milestone
# Or for cross-repo:
gh issue view 123 --repo owner/repo --json title,body,labels,assignees,milestone
```

**Free text:**
Use the problem statement directly. No fetch needed.

**Nothing provided:**
Ask: "What feature or change are you scoping?" Wait for response before proceeding.

### 1.2 Extract scope signals

From whatever input was gathered, extract:

| Signal | What to look for |
|---|---|
| **What the feature does** | Core behavior — the verb phrase ("reconciles tenants", "syncs users", "handles webhook events") |
| **What it touches** | Systems, APIs, databases, infrastructure it reads from or writes to |
| **What consumes it** | Who/what triggers it — cron, event, API call, user action |
| **Constraints** | Idempotency requirements, rate limits, ordering guarantees, safety modes (dry-run) |

If the input is vague or missing critical signals, ask **ONE** clarifying question — not multiple. Pick the most important gap and ask about it. Examples:

- "Does this need to be idempotent, or is it a one-shot operation?"
- "Is this triggered by an event, a cron schedule, or a user action?"
- "Which API/service is the source of truth here?"

Do not ask a battery of questions. One question, then proceed with reasonable assumptions for the rest.

---

## Phase 2: Discover the Change Surface

### 2.1 Launch discovery agent

Launch an Explore agent (thoroughness: very thorough) with a self-contained prompt. The agent must search the codebase and return a structured change surface map.

Agent prompt:

```
You are mapping the change surface for a new feature. Here is what the feature does:

[Insert scope signals from Phase 1 — what it does, touches, consumes, constraints]

Your job is to find everything in this codebase that will need to change or that the new code will depend on. Do ALL of the following:

1. SEARCH for domain keywords from the feature description. Examples: if the feature
   involves "tenants", search for tenant, tenancy, org; if it involves "reconciliation",
   search for reconcile, sync, diff, drift.

2. MAP what files and packages will need changes. For each area found, note:
   - The file/directory path
   - What kind of change (new file, modify existing, extend interface)
   - Why it needs to change

3. IDENTIFY dependencies between areas. Which changes depend on which?
   Draw the dependency arrows: "handler depends on client" not just "handler and client".

4. FIND natural seams — boundaries where work can be split:
   - Client/library layer vs business logic
   - Business logic vs entrypoints (handlers, CLI, cron jobs)
   - Application code vs infrastructure-as-code
   - Types/interfaces vs implementations
   - Test infrastructure vs test cases

5. CHECK for existing patterns. How are similar features structured in this repo?
   - Find 2-3 reference implementations of the same kind of thing
   - Note the layering pattern they follow (e.g., client -> job -> handler -> IAC)
   - Note the dependency order they were likely built in

Return a structured change surface map:

## Change Surface Map

### Areas of Change
For each area:
- **Area:** [name — e.g., "API client", "reconciliation job", "handler entrypoints"]
- **Path(s):** [file or directory paths]
- **Change type:** [new | modify | extend]
- **Description:** [what changes here and why]

### Dependencies
[List directed dependencies between areas: "A depends on B" format]

### Natural Seams
[Where work splits cleanly — the boundaries between areas]

### Reference Implementations
[2-3 similar features found, with paths and the pattern they follow]

### Existing Infrastructure
[Anything that already exists and can be reused — shared packages, modules, utilities]
```

### 2.2 Store the discovery report

The agent returns a change surface map. Store it — this is the primary input to the decomposition phase. Do not discard or summarize it.

---

## Phase 3: Decompose Into Reviewable Units

### 3.1 Decomposition principles

Each work unit (future PR) must satisfy ALL of these:

1. **Single clear purpose** — a reviewer can describe what this PR does in one sentence
2. **Mergeable independently** — the codebase is in a valid state after merging this unit alone. No dead code, no broken imports, no half-wired features.
3. **Testable on its own** — the unit includes its own tests. A reviewer can run tests for just this unit and see them pass.
4. **Manages cognitive load** — a reviewer can hold the entire change in their head. If they can't, the unit is too big.

### 3.2 Decomposition heuristics

Use the change surface map to split work along natural seams. Prefer this ordering (earlier = merged first):

1. **Test infrastructure** — shared test helpers, fakes, fixtures that later units need
2. **Types and interfaces** — data types, API interfaces, contracts. These have zero behavior but unblock everything downstream.
3. **Client/library layer** — API clients, SDK wrappers, shared packages. These are consumed by business logic but have no callers yet.
4. **Core business logic** — the main feature logic (jobs, reconcilers, processors). Depends on client layer; consumed by entrypoints.
5. **Entrypoints and wiring** — handlers, CLI commands, cron registrations, route definitions. These wire the business logic into the running system.
6. **Infrastructure as code** — Terraform, Pulumi, CloudFormation. Deploy the infrastructure that the entrypoints need. Often depends on knowing the entrypoint shape (env vars, ports, IAM roles).

Not every feature hits all layers. Skip layers that don't apply. Some features are one unit — that's fine.

### 3.3 Check dependency order

After decomposing, verify the dependency chain:

- **Each unit's dependencies are satisfied by earlier units.** If unit 3 needs types defined in unit 2, unit 2 must come first.
- **No dead code.** Every unit introduces code that is either tested or wired. No "add function that nothing calls yet" without tests exercising it.
- **Reviewer can understand without later units.** A reviewer reading unit 2 should not need to read unit 4 to understand why unit 2 exists. Each unit's purpose is self-evident.

If the dependency check fails, reorder or re-split units until it passes.

---

## Phase 4: Output

### 4.1 Format

Present each work unit using this template:

```markdown
## Unit N: [one-line summary]

**What:** [2-3 sentences describing the change and its purpose]

**Files:**
- `path/to/file.go` — [what changes here]
- `path/to/file_test.go` — [what's tested]

**Depends on:** [Unit M, or "nothing — first in sequence"]

**Reviewer needs to know:**
- [Key context the reviewer needs — why a decision was made, what pattern is being followed, what's intentionally deferred]

**Testable by:** [How a reviewer verifies this unit works — "run tests", "deploy and hit endpoint", "terraform plan shows expected resources"]
```

### 4.2 Sanity checks

Before presenting, verify:

- [ ] No unit spans more than 2-3 concerns (if it does, split further)
- [ ] Every unit has a clear "reviewer needs to know" — if you can't write one, the unit's purpose isn't clear enough
- [ ] The dependency chain is linear or a simple DAG (no cycles, no complex interleaving)
- [ ] No trivially small units that could be folded into an adjacent unit (e.g., "add one type alias" is not a PR)
- [ ] The complete set of units covers the full feature scope from Phase 1

### 4.3 Present and confirm

Show all work units to the user. Then ask:

**"Does this breakdown make sense? Want to adjust the scope, ordering, or granularity of any unit?"**

Wait for confirmation before proceeding. If the user wants changes, adjust and re-present.

---

## Transition to Implementation

Once the user confirms the breakdown:

1. Each work unit becomes a `/writing-plans` invocation — the unit description feeds directly into the planning skill as the problem statement.
2. Start with Unit 1. Invoke `/writing-plans` with the unit's details.
3. **Wait for user confirmation before moving to the next unit.** Do not auto-chain all units. The user may want to implement and merge Unit 1 before planning Unit 2.

Suggest: "Ready to start planning Unit 1? I'll invoke `/writing-plans` with the scope for: [unit 1 summary]."

---

## Error Handling

**Ticket not found:**
If a Linear ticket ID or GitHub issue number doesn't resolve, report the error and ask the user to provide the details manually (paste the ticket description, or describe the feature in free text).

**Discovery finds nothing:**
If the Explore agent finds no relevant code — the codebase has no similar features, no matching domain keywords — this is likely a greenfield feature. Note it explicitly: "No existing patterns found. This appears to be a new capability with no prior art in the codebase." Proceed with decomposition using general heuristics rather than codebase-specific seams.

**Feature too small:**
If the change surface is a single file or a handful of lines, don't force-decompose. Report: "This looks like a single-PR change. No decomposition needed." Offer to invoke `/writing-plans` directly with the full scope.

**Feature too large:**
If the change surface spans 10+ areas with complex interdependencies, consider splitting into milestones first (each milestone = a group of work units), then decompose each milestone. Flag this to the user: "This is a large feature. I recommend splitting into N milestones before decomposing into PRs."

---

## Example

### Input

```
"Add webhook handler for build completion events"
```

### Phase 1: Gather Context

- **What it does:** Receives build completion webhooks, validates signatures, stores results, triggers downstream notifications
- **What it touches:** Webhook endpoint, build data store, notification service
- **What consumes it:** External CI system sends webhooks; internal dashboard reads results
- **Constraints:** Must validate webhook signatures, needs idempotent processing (CI may retry)

### Phase 2: Discover the Change Surface

The Explore agent finds:
- Existing webhook handlers in `handlers/` following a validate → parse → store → notify pattern
- A shared `webhooks/` package with signature validation helpers
- Build data model already exists in `models/build.go`
- Notification dispatch in `notify/` with existing channel support
- IAC for other webhook endpoints in `iac/`

### Phase 3–4: Output

```markdown
## Unit 1: Build completion event types and parsing
- **Files:** `models/build_event.go`, `models/build_event_test.go`
- **Depends on:** nothing
- **Reviewer needs to know:** New event types extending the existing build model. Parse logic for the CI webhook payload format.
- **Testable by:** `go test ./models/...`

## Unit 2: Webhook handler
- **Files:** `handlers/build_webhook.go`, `handlers/build_webhook_test.go`
- **Depends on:** Unit 1
- **Reviewer needs to know:** Follows the same validate → parse → store → notify pattern as existing webhook handlers. Uses shared signature validation from `webhooks/`.
- **Testable by:** `go test ./handlers/...`

## Unit 3: Wire endpoint and add IAC
- **Files:** `cmd/api/routes.go` (modify), `iac/build-webhook/main.tf`
- **Depends on:** Unit 2
- **Reviewer needs to know:** Thin wiring — registers the handler and deploys the endpoint. Check IAM and secret injection match sibling modules.
- **Testable by:** `go build ./cmd/api/` compiles; `terraform plan` shows expected resources
```

**"Does this breakdown make sense? Want to adjust any units?"**
