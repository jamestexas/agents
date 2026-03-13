---
name: doc-triage
description: Find internal docs (not for external consumers), review against code reality, bead real items, archive stale files. Converts markdown debt into tracked beads.
---

# Doc Triage — Convert Markdown Debt to Beads

Find internal documentation files that aren't meant for external consumers, review them against the actual code, create beads for anything real, and archive the originals.

## Arguments

$ARGUMENTS

Arguments format: `[repo-path] [--dry-run] [--skip-archive]`

- **repo-path**: Path to the repo to triage (default: current working directory)
- **--dry-run**: Show what would be beaded/archived without doing it
- **--skip-archive**: Create beads but don't archive the source files

## What This Solves

Repos accumulate internal markdown files over time: `TODO.md`, `KNOWN_ISSUES.md`, `INVESTIGATION_LOG.md`, `_agent_log/*.md`, `HANDOFF.md`, `EXPLORATION_SUMMARY.md`. These contain a mix of:
- Real work items (should be beads)
- Already-fixed issues (should be deleted)
- Historical context (useful but stale)
- Aspirational plans (may or may not be relevant)

This skill converts the real items into beads and archives the rest so they stop cluttering the repo.

## Workflow

### Phase 1: Discovery — Find Internal Docs

Scan for files that are NOT meant for external consumers:

```
INCLUDE patterns (internal docs):
  - TODO.md, TODOS.md
  - KNOWN_ISSUES.md, KNOWN_BUGS.md
  - INVESTIGATION_LOG.md
  - HANDOFF*.md
  - EXPLORATION_SUMMARY.md
  - MIGRATION_PLAN.md
  - HYPOTHESIS.md
  - _agent_log/*.md
  - experiments/**/NOTES.md
  - *_COMPREHENSIVE_OVERVIEW.md
  - COHESIVE_INVESTIGATION_NOTES.md
  - *_QUICK_REFERENCE.md

EXCLUDE patterns (external/keep):
  - README.md
  - CHANGELOG.md
  - CONTRIBUTING.md
  - LICENSE*
  - docs/api/**
  - ARCHITECTURE.md (keep — these are structural)
  - CLAUDE.md, AGENTS.md (tooling config)
  - ADR-*.md (architectural decisions — keep)
  - .beads/** (beads internal)
```

List all matches and show to user before proceeding.

### Phase 2: Review — Check Against Code Reality

For each discovered file, read it and evaluate every actionable item:

**For each item/section in the doc:**

1. **Is it a real, current issue?** Check the code:
   - Use Grep/Glob to verify the issue still exists
   - Check git log to see if it was already fixed
   - If referencing a specific file/function, verify it still exists

2. **Cite the code** for still-real items:
   - Reference as `file/path.go:42` (file + line number)
   - Prefer file paths over git permalinks (permalinks go stale on rebase)
   - If the item references multiple locations, cite the primary one

3. **Classify the item:**
   - `bead` — real, actionable, still exists in code
   - `fixed` — was real, now resolved (check git log)
   - `stale` — references code/files that no longer exist
   - `context` — historical context, not actionable (e.g., design rationale)

Present the classification to the user before creating beads.

### Phase 3: Bead — Create Issues for Real Items

For each item classified as `bead`:

```bash
bd create "<title from doc>" \
  --description "<description with code citation>\n\nSource: <original-file>:<line>" \
  --labels "doc-triage,<source-file-name>" \
  --priority <inferred from context> \
  --type <bug|task|feature> \
  --actor "doc-triage"
```

Priority inference:
- Bug/broken behavior → P1
- Missing feature/enhancement → P2
- Cleanup/refactor → P3
- Nice-to-have → P4

### Phase 4: Archive — Move Processed Files

After beads are created, archive the processed files:

**4.1 Create archive directory (gitignored)**

```bash
mkdir -p .archive/doc-triage-$(date +%Y-%m-%d)
```

**4.2 Ensure .gitignore excludes archive**

```bash
grep -q '^\\.archive/' .gitignore 2>/dev/null || echo '.archive/' >> .gitignore
```

**4.3 Move processed files**

```bash
mv -f "$FILE" ".archive/doc-triage-$(date +%Y-%m-%d)/$(basename $FILE)"
```

**4.4 Do NOT archive:**
- Files where some items were `bead` and others were `context` — keep the file but annotate which items are now beads
- Files the user explicitly wants to keep
- HANDOFF.md if it's the only session context document

### Phase 5: Report

Output summary:
- Files discovered: N
- Items reviewed: N
- Beads created: N (list IDs)
- Items already fixed: N
- Items stale: N
- Files archived: N
- Files kept (with annotations): N

## Important Rules

- **ALWAYS verify against code before beading.** The whole point is to not blindly convert markdown to beads. If the issue is already fixed, don't create a bead for it.
- **Cite code, not docs.** Beads should reference the actual code location, not the markdown file they came from. The markdown file is the source of discovery, not the source of truth.
- **x-ray is excluded** — it has many markdown files that are actively being used and should not be triaged in this pass.
- **Ask before archiving** if unsure whether a file is internal or external.
- **Preserve HANDOFF.md** if it's the most recent session handoff — it has context the next session needs.

## Example

```
/doc-triage ~/remotes/art/crumb

Discovered 4 internal docs:
  1. HANDOFF_2025-11-15.md (29 items)
  2. HANDOFF_GENERATED.md (15 items)
  3. _agent_log/theoretical-foundations-analyst_2025-11-11_agent_log.md (8 items)
  4. INVESTIGATION_LOG.md (12 items)

Reviewing against code...

Results:
  - 14 items → bead (real, still in code)
  - 22 items → fixed (verified in git log)
  - 8 items → stale (referenced files deleted)
  - 20 items → context (historical, not actionable)

Created 14 beads: crumb-xxx, crumb-yyy, ...
Archived 3 files to .archive/doc-triage-2026-03-13/
Kept INVESTIGATION_LOG.md (annotated)
```
