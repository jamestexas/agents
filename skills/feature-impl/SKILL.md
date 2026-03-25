---
name: feature-impl
description: Research-first feature implementation workflow. Use when building new features, services, or any net-new code that should follow existing codebase patterns. Enforces pattern discovery before coding to prevent duplication, convention violations, and infrastructure conflicts. Language-agnostic; dispatches to repo-specific standards skills for convention checks.
---

# Feature Implementation Workflow

Implement new features by discovering and following existing codebase patterns before writing code. This skill prevents the most common implementation defects: duplicated utilities, convention violations, infrastructure resource conflicts, and bolt-on design.

**Discipline model:** Phases 0 and 3 are RIGID (produce artifacts, gate the next phase). Phases 1 and 2 are FLEXIBLE (adapt to the problem).

## Arguments

$ARGUMENTS

Arguments should be a problem statement describing what to build. Examples:
- "sync users from identity provider to billing system"
- "add a webhook handler for build completion events"
- "create a scheduled job that reconciles X with Y"

If no arguments provided, ask the user for a problem statement before proceeding.

---

## Phase 0: Research (MANDATORY — BLOCKING)

**No code is written until this phase produces a research document.**

Launch a separate Explore agent (thoroughness: "very thorough") with the problem statement. The agent must complete all substeps and return a structured summary.

### 0.1 Discover existing patterns

Find how similar things are built in this codebase. Use whatever code intelligence is available:

- **If mache MCP tools are available:** `mcp__mache__search` with keywords from the problem statement, `mcp__mache__find_callers` on framework entry points, `mcp__mache__find_definition` to locate implementations
- **Otherwise:** Grep for domain keywords (e.g., `Reconciler`, `Handler`, `BackfillJob`, `Sync`), Glob for structural patterns (e.g., `**/cmd/*/main.go`, `**/iac/*/main.tf`)

The goal is to find 2-3 implementations of the same *kind* of thing you're building — not by guessing names, but by **searching the codebase**.

### 0.2 Read reference implementations

Read 2-3 implementations discovered in 0.1 — **discovered, not hardcoded**. For each, extract:

| Convention | What to look for |
|---|---|
| **Type visibility** | Do constructors return interfaces or concrete types? Are structs exported or private? |
| **Error handling** | How are external API errors wrapped? What's retryable vs fatal? |
| **Test patterns** | What context function? Table-driven? What assertion style? Fake/mock conventions? |
| **Logging** | Which logger? Structured fields or format strings? |
| **Config** | Env vars via library or manual `os.Getenv`? Global var or injected? |
| **Safety** | Dry-run modes? Guard conditions? Graceful shutdown? |

### 0.3 Search for reusable utilities

Before planning to write ANY utility function, search for it:

- Search by function name pattern and by behavior description
- Check `internal/` packages of sibling modules — these can't be imported across module boundaries
- **If utility exists behind `internal/`:** flag it as a cross-module duplication risk. Options:
  1. Extract to a shared package (preferred, but may be out of scope)
  2. Copy with `// TODO(<ticket>): extract to shared package — duplicated from <source>` comment
  3. Never copy silently

### 0.4 Check for infrastructure conflicts (if IAC is involved)

- Read sibling IAC directories (`iac/`, `env/`, `modules/`) in the same area
- **Grep for exact resource names** you plan to create:
  ```
  grep -r 'name = "<your-resource-name>"' <iac-directory>
  ```
  If this returns hits from another module, you have a collision. Decide: reference the existing resource, or use a distinct name.
- Read the upstream module's `variables.tf` (not just usage examples) to understand its actual interface
- Check: does the module create resources unconditionally, or can creation be made conditional?

### 0.5 Output a research document

**GATE: This document must exist before Phase 1 begins. If empty, stop and investigate.**

```markdown
## Research Summary

### Reference Implementations
- [Name]: [path] — [key patterns noted]
- [Name]: [path] — [key patterns noted]

### Conventions Discovered
- Constructor pattern: [e.g., private type, interface return]
- Test context: [e.g., t.Context()]
- Error wrapping: [e.g., fmt.Errorf("doing X: %w", err)]
- Logging: [e.g., slog.InfoContext(ctx, ...)]
- Config: [e.g., env var library with struct tags]

### Reusable Utilities
- [Function/package]: [location, importable? or needs copying with TODO?]
- [None found]: [what was searched]

### Infrastructure (if applicable)
- Shared resources to reference: [name, owning module]
- New resources to create: [name, verified no collision]
- Module interfaces read: [module name, key variables]

### Risks
- [Any cross-module duplication, known fragility, or design tradeoffs]
```

---

## Phase 1: Design

Using the research document:

1. **Match patterns** — which discovered pattern fits? Document the choice. If deviating from an existing pattern, document *why* explicitly.
2. **Design safety modes first** — if the feature has destructive operations (deletes, overwrites, state mutations), design dry-run mode and safety guards BEFORE writing the happy path. These are first-class concerns, not afterthoughts.
3. **Map resource ownership** — for IAC: shared resources are referenced (data source), new resources are created (resource block), collision risks use conditional creation or distinct names.
4. **Define interfaces before structs** — follow whatever visibility convention the research document recorded.

---

## Phase 2: Implement

Write code following the research document and design decisions. The only rules:

- Follow the patterns discovered in Phase 0 (don't invent new ones)
- Import utilities found in Phase 0 (don't duplicate them)
- Reference shared resources found in Phase 0 (don't recreate them)
- When copying a utility from behind `internal/`, add the TODO comment from 0.3

---

## Phase 3: Self-Review (MANDATORY — NON-OPTIONAL GATE)

**GATE: All checks must pass before committing. No exceptions.**

### 3.1 Run the repo's standards skill

Check if a language-specific standards skill exists (e.g., `/go-standards`, `/python-standards`, `/ts-standards`). If it does, invoke it on all new files. If it doesn't, proceed to the manual checks below.

### 3.2 Convention grep audit

Run targeted searches on your new files. These are language-agnostic patterns — adapt the regexes to your language:

| What | Why | How |
|---|---|---|
| Hardcoded status/error codes | Should use named constants | `grep -rn '[0-9][0-9][0-9]' <new_files>` in error-handling contexts |
| Test context creation | Should use test-framework-provided context | Check test files for manual context creation vs framework helpers |
| Constructor return types | Should match convention from research doc | Check that constructors return the type pattern found in Phase 0 |
| Dead variables in tests | Every declared variable must be asserted | Scan test files for variables that are written but never read in assertions |

Fix any violations found. Do not skip.

### 3.3 Cross-module duplication check

For every new utility function or helper you wrote:
- Search the codebase for the function name — does it already exist?
- If it does: import it, or justify with a TODO comment
- Pay special attention to functions you might have unconsciously copied from a reference implementation

### 3.4 Test hygiene

For every test file:
- Every declared variable must appear in at least one assertion
- Collection builders should pre-allocate capacity when the size is known
- Test data should use the patterns discovered in Phase 0 (context helpers, assertion style, etc.)

### 3.5 Build and test

Run the language-appropriate build, lint, and test commands:
```
# Examples — use whatever your project requires
go build ./... && go vet ./... && go test ./...
npm run build && npm test
cargo check && cargo test
```

### 3.6 IAC audit (if applicable)

- Format all infrastructure files (e.g., `terraform fmt`)
- **Grep for resource name collisions** with sibling modules (repeat the check from 0.4)
- Verify configurable values are variables with defaults — no hardcoded schedules, timeouts, or names that operators can't override
- Verify shared resources use `data` sources or variable inputs, not unconditional `resource` blocks that collide

---

## Phase 4: Commit and PR

- Squash into logical commits (library, entrypoints, IAC — not your debugging history)
- Write a PR description that tells the reviewer:
  - How to review (commit order, what each commit contains)
  - What patterns were followed (reference the implementations from Phase 0)
  - Known limitations and tradeoffs (from the research document's Risks section)
- Call out anything you copied (with the TODO comments) so reviewers can decide if extraction is worth doing now

---

## Error Handling

**Phase 0 finds no matching patterns:**
This is a novel feature. Proceed, but document in the PR description that no existing pattern was found and explain the design choices from first principles.

**Phase 0 finds utility behind `internal/`:**
Copy with a TODO comment. Do not import across module boundaries. Do not silently duplicate.

**Phase 3 audit finds violations:**
Fix them. Do not skip. These are the exact issues that waste reviewer time and cause review cycles.

**Code intelligence tools (mache) unavailable:**
Fall back to Grep + Glob + Read. The research phase is mandatory regardless of tooling.

---

## Anti-Patterns This Skill Prevents

These are real defects found in production PRs that followed the "build first, read later" workflow:

| Defect | How Phase 0 prevents it |
|---|---|
| Exported concrete type when convention is interface return | 0.2 records constructor conventions before you write yours |
| Utility function duplicated from sibling module's `internal/` | 0.3 searches for existing utilities and flags duplication |
| IAC secret/resource name collision with sibling module | 0.4 greps for exact resource names before creating new ones |
| Magic numbers instead of named constants | 0.2 records error-handling conventions; 3.2 greps for violations |
| Test context using wrong helper | 0.2 records test patterns; 3.2 checks for violations |
| Safety mode bolted on after implementation | 1.2 requires designing dry-run/guards before happy path |
| Dead test variables | 3.4 checks every variable is asserted |

---

## Notes

- This skill is language-agnostic and repo-topology-agnostic. It works for monorepos, multi-repo dependency graphs, and single repos with workspaces.
- The key insight: most implementation defects come from building before reading. Phase 0 forces reading first.
- Phase 3 exists because self-review discipline erodes under time pressure. A checklist with explicit grep commands prevents skipping.
- If a repo-specific `feature-impl-config` skill exists, Phase 3.1 will invoke it for language-specific checks. Otherwise, the generic checks in 3.2 apply.
