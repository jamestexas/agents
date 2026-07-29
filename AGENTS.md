# AGENTS.md

This file provides guidance to Codex when working with code in this repository. It is the Codex-facing counterpart to CLAUDE.md; both describe the same repository, and a change to the conventions belongs in both.

## Repository Overview

This is an agent definitions repository containing specialized agents. They are consumed by Claude Code and by Codex; the on-disk install target is `~/.claude/` for both, via `scripts/install.sh`. The repository contains no executable code - only agent definition files in Markdown format with YAML frontmatter.

## Agent Development Workflow

### Testing Agents Locally
```bash
# Copy agent to user directory for testing
cp agent-name.md ~/.claude/agents/

# Or copy to project directory
cp agent-name.md /path/to/project/.claude/agents/
```

### Creating New Agents

1. **File Naming**: Use kebab-case (e.g., `code-performance-optimizer.md`)
2. **Required Frontmatter Fields**:
   - `name`: Must match filename without extension
   - `description`: Include XML-formatted usage examples
   - `model`: Usually `inherit`, use `opus` for complex reasoning
   - `color`: Choose from blue, green, purple, red, orange

3. **Agent Persona Guidelines**:
   - Create compelling backstory that reinforces expertise
   - Define clear methodology and process
   - Structure output format for consistency
   - Include specific technical focus areas

### Quality Standards

- **Description**: Must include at least 2 detailed usage examples in XML format
- **Persona**: Should establish credibility and unique perspective
- **Process**: Define structured approach with numbered steps
- **Output**: Specify format for agent responses

## Repository Structure

```
/
├── *.md                    # Agent definition files
├── README.md              # Public documentation
├── AGENTS.md              # This file
└── .claude/              # agent + skill install target (see scripts/install.sh)
    └── settings.local.json # Local permissions
```

## Git Workflow

When committing agent definitions:
- Use semantic commit messages (feat: for new agents, fix: for corrections, docs: for documentation)
- Test agents thoroughly before committing
- Update README.md when adding new agents

## Agent Architecture

Each agent file has two parts:
1. **YAML Frontmatter**: Metadata and configuration
2. **System Prompt**: Defines persona, expertise, and behavior

By default an agent inherits the parent session's tools. That default is not a guarantee: `disallowedTools` and `tools` narrow it, and several agents here rely on that — the six adversarial reviewers carry `disallowedTools: Write, Edit` so their read-only posture is enforced rather than merely stated. Check the frontmatter before assuming an agent can reach something.

## Common Tasks

### Add a new agent
1. Create new `.md` file with kebab-case name
2. Add YAML frontmatter with required fields
3. Write comprehensive system prompt
4. Test locally before committing
5. Update README.md with agent information

### Modify existing agent
1. Edit the agent's `.md` file
2. Test changes locally
3. Commit with descriptive message

### Share agents with team
```bash
# Push to GitHub
git add *.md
git commit -m "feat: add new agent for X"
git push

# Team members can then clone and install
```

<!-- >>> rsry beads (managed by `rsry init` - edit outside these markers) >>>
# Agent Instructions

<!--
  Canonical rsry-native AGENTS.md. `rsry init` writes this into a repo (the
  rsry-native replacement for `bd setup <tool>`). Learns from bd's AGENTS.md
  concepts (ready-work detection, dependency types, discovered-from) but routes
  through `rsry` — never `bd`. See rosary ADR-0014.
-->

This project tracks all work as **beads**, stored in `.beads/` (a Dolt database,
or a SQLite `beads.db` for single-user repos) and accessed **through `rsry`** —
the CLI or the `rsry_*` MCP tools. Rosary owns the store and reads/writes it
in-process over the Dolt/SQLite wire; it **never invokes the `bd` CLI**
(ADR-0014). Do not run `bd`.

## Quick Reference

```bash
rsry bead list --dispatchable      # work that's actually safe to pick up
rsry bead list --ready             # open + unblocked (superset of dispatchable)
rsry bead review <id>              # full context: summary + comments + change-set
rsry bead comment add <id> "note"  # progress notes (humans + other agents read these)
rsry bead close <id>               # complete work (requires a close condition)
rsry status --repo <name>          # counts for one repo (omit --repo = all repos)
```

The `rsry_*` MCP tools mirror these (`rsry_list_beads`, `rsry_bead_create`,
`rsry_bead_close`, `rsry_bead_comment`, …) and are the preferred surface from
inside an MCP client.

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations — `cp`/`mv`/`rm` may be
aliased to `-i` and hang waiting for y/n:

```bash
cp -f source dest    mv -f source dest    rm -f file    rm -rf dir    cp -rf src dst
```

`scp`/`ssh` → `-o BatchMode=yes` · `apt-get` → `-y` · `brew` → `HOMEBREW_NO_AUTO_UPDATE=1`.

## Issue Tracking with beads (via `rsry`)

All issue tracking goes through beads. Do NOT use markdown TODOs, task lists, or
external trackers. Do NOT use the `bd` CLI — use `rsry`.

### Why beads

- **Dependency-aware** — track blockers and relationships (`blocks`, `related`,
  `parent-child`, `discovered-from`) so ready-work detection is automatic.
- **Version-controlled** — Dolt with cell-level merge; syncs across machines via
  a Dolt remote (the `post-merge`/`post-push` hooks run `dolt pull|push`).
- **Agent-optimized** — JSON output, `--ready`/`--dispatchable` filters,
  `discovered-from` links so found work traces to its origin.

### Create work

```bash
rsry bead create "Issue title" --description "Detailed context" \
  --issue-type bug --priority 1 --files src/foo.rs
```

Implementation beads (`bug`/`feature`/`task`/`chore`) require a **file scope**
(`--files`) and a **close condition** (an `--acceptance-criteria`, a runnable
test command in the description, or the default PR-merge signal). Planning types
(`epic`/`design`/`research`) and `review` are exempt from the file-scope rule.

### Link related work (typed edges)

Dependencies carry a **type** — `blocks` (the default), `related`,
`parent-child`, `discovered-from`:

```bash
# work you found while doing something else → trace it to its origin
rsry_bead_link  id=<new>  depends_on=<origin>  dep_type=discovered-from
# subtask under an umbrella/epic
rsry_bead_link  id=<child> depends_on=<parent> dep_type=parent-child
```

`parent-child` and `discovered-from` are **containment** edges, and they gate
auto-close: a parent bead won't be closed by a merged PR while it still has open
children — the PR is linked, but the umbrella stays open until the last child
lands. Use `blocks` for ordering (A must finish before B) — closing a blocker is
the normal unblock signal and does **not** hold anything open.

### Claim, update, complete

```bash
rsry bead comment add <id> "progress note"     # don't close incomplete beads — comment
rsry bead close <id>                           # gated on the close condition
```

### Issue types

`bug`, `feature`, `task`, `chore` (implementation) · `epic`, `design`,
`research` (planning) · `review` (read-only adversarial). A secondary
`work_mode` axis (investigation / synthesis / adversarial / procedural / …) maps
back to a canonical issue type when a bead is authored.

### Priorities

`0` critical (security, data loss, broken builds) · `1` high · `2` medium
(default) · `3` low.

### Ready vs dispatchable

`--ready` = open + unblocked. `--dispatchable` is the strict subset actually safe
to hand to an agent: also a close condition, a bounded file scope, and a refined
description (`Bead::is_dispatchable`). **Check `rsry bead list --dispatchable`
before asking "what should I work on?"** — prefer it over `--ready`.

### State sync (automatic, rsry-native)

There is **no** `bd dolt push` / `issues.jsonl` step you run by hand. When a PR
merges, the git `post-merge` hook (installed by `rsry hooks install`) runs
`rsry close-merged --local` — reading the squash-merge commit
(`[bead-id] … (#N)`) from local `git log` and closing the bead — plus a
`dolt pull` for Dolt-backed repos. No webhook, no `gh`, no manual export.

## Commit contract (enforced at commit-msg time)

Every commit must match `[bead-id] <type>(<scope>): <subject>` — Golden Rule 11
(bead reference) + Conventional Commits. The commit-msg hook rejects anything
else (and auto-injects `[bead-id]` from `.rsry-bead-id` in agent worktrees). Open
PRs with `rsry pr --title "…"` so the `[bead-id]` lands in the squash subject and
the merged bead auto-closes.

## Landing the Plane (Session Completion)

Work is NOT complete until `git push` succeeds.

1. **File beads for remaining work** — `rsry bead create …` (with
   `discovered-from` links where relevant).
1. **Run the gate** (if code changed) — `task check` (the canonical verification
   gate) where the repo has one.
1. **Update bead status** — close finished work; comment on in-progress items.
1. **PUSH** — `git pull --rebase && git push && git status` (must show
   "up to date").
1. **Hand off** — context for the next session.

- NEVER stop before pushing — that strands work locally.
- If push fails, resolve and retry until it succeeds.
<<< rsry beads <<< -->
