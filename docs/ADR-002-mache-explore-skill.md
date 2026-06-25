# ADR-002: Mache Explore Skill (Agent FS Permission Model)

**Status:** Proposed
**Date:** 2026-02-12
**Context:** When an agent explores a mache FUSE mount, every file read requires manual permission approval because the mount path is outside the agent's working directories.

## Problem

Mache projects structured data as a FUSE filesystem (e.g., `/tmp/mache-self/`). An agent using `ls`, `cat`, `Read` to explore the mount must get human approval for **every single file** — we observed 137+ approvals in one exploration session. This completely defeats the purpose of making data navigable for agents.

The root cause: Claude Code's permission model scopes auto-approval to declared working directories. A FUSE mount at `/tmp/` is not in any project's working dir.

## Decision

Create a `/mache-explore` slash command skill that:

1. **Mounts** a mache data source at a known path inside the project dir (e.g., `.mache-mount/`)
2. **Registers** the mount path as an additional working directory for the session
3. **Briefs** the agent on the projected filesystem structure (from the schema)
4. **Unmounts** on session end or explicit `/mache-unmount`

### Why Inside the Project Dir

Mounting under the project directory (e.g., `$PROJECT/.mache-mount/`) means:
- Auto-approved by Claude Code (inherits project dir permissions)
- No user intervention needed for `ls`, `cat`, `grep` on the mount
- `.gitignore` can exclude `.mache-mount/` from version control
- No `/tmp` pollution or cross-project leaks

### Skill Interface

```
/mache-explore <schema> <data-source> [mount-name]

Examples:
  /mache-explore examples/go-schema.json .                     # Mount repo as Go AST
  /mache-explore examples/nvd-schema.json ~/.agentic-research/venturi/nvd/results/results.db nvd
  /mache-unmount                                                # Clean up
```

### Implementation

The skill would:
1. Run `mkdir -p .mache-mount/<name>`
2. Run `./mache --schema <schema> --data <source> .mache-mount/<name>` in background
3. Wait for mount readiness (poll with `ls`)
4. Inject system message: "Data mounted at .mache-mount/<name>/. Use ls/cat to explore."
5. On unmount: `umount -f .mache-mount/<name>`

### Alternative: Config-Based Approach

Instead of a skill, add mount paths to `.claude/settings.json`:
```json
{
  "additionalWorkingDirs": ["/tmp/mache-self"]
}
```
Simpler but requires manual setup per mount.

## Consequences

- Agents can freely explore mache mounts without permission friction
- Mount lifecycle is managed (no orphan FUSE mounts)
- Project dir stays clean (`.gitignore` handles `.mache-mount/`)
- Skill approach is reusable across projects

## Open Questions

1. Should the skill auto-detect the schema from the data source?
2. How to handle multiple concurrent mounts?
3. Should the agent briefing include a summary of what's in the mount (e.g., package count, record count)?
