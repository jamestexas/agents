# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a Claude Code agent definitions repository containing specialized AI agents that extend Claude Code's capabilities. The repository contains no executable code - only agent definition files in Markdown format with YAML frontmatter.

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
   - Define clear methodology and process
   - Structure output format for consistency
   - Include specific technical focus areas

4. **Declare MCP dependencies** — enforced by `scripts/build.sh lint`, not
   optional. An agent whose body calls a known MCP tool (`rsry_*`, `mache_*`,
   or the fully-qualified `mcp__server__tool` form) must carry a line
   beginning `**MCP dependency:**` naming the server and the tools it needs.
   Frontmatter does not record this, so without the line the agent's real
   runtime requirements drift silently from what is written down. Six agents
   share the common case via `<!-- @include-begin _shared/mcp-dependency-rsry.md -->`;
   an agent needing different tools states its own.

5. **Restrict tools when the agent must not write.** A reviewer that files
   findings and never patches should say so in prose *and* enforce it with
   `disallowedTools: Write, Edit` (or a `tools:` allowlist). Prose is
   documentation; the frontmatter field is the enforcement.

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
├── CLAUDE.md              # This file
└── .claude/               # Claude Code configuration
    └── settings.local.json # Local permissions
```

## Licensing — two licenses, and a one-way boundary

This repository is **Apache-2.0** (`LICENSE`) *except* `hud/`, which is
**AGPL-3.0-only** (`hud/LICENSE`). GitHub's detector reads only the root file
and will report Apache-2.0 for the whole repository; that label is wrong about
`hud/`. Do not treat the root `LICENSE` as covering every subdirectory.

**Invariant — one-way compatibility.** Apache-2.0 code may be used *inside*
`hud/`. Code from `hud/` may **not** be copied *out* into the Apache-2.0 part.
Apache-2.0 is one-way compatible with the AGPL: permissive code can be absorbed
into a copyleft work, but the reverse puts AGPL code under an Apache-2.0
notice, mislicensing it for everyone downstream — and nothing here will flag
it.

The property that keeps this checkable: `hud/` imports nothing from outside
itself, only Node builtins and its own modules. Preserve that. Concretely,
before you factor a helper out of `hud/` into a shared `scripts/` module, or
add an `import` in `hud/` that reaches above `hud/`, stop — the first is a
license violation, the second dissolves the self-containment that makes the
first visible. To share code across the boundary, move it *into* the
Apache-2.0 part and import it from there.

Vendored MIT bundles under `hud/ui/` keep their own notices; see
`hud/THIRD-PARTY-NOTICES.md`. Rationale and the full statement live in
`README.md` and `hud/docs/LICENSING.md`; `hud/README.md` carries the
load-bearing fact so no reader has to click to learn which license applies.

## Git Workflow

When committing agent definitions:
- Use semantic commit messages (feat: for new agents, fix: for corrections, docs: for documentation)
- Test agents thoroughly before committing
- Update README.md when adding new agents

## Agent Architecture

Each agent file has two parts:
1. **YAML Frontmatter**: Metadata and configuration
2. **System Prompt**: Defines persona, expertise, and behavior

By default an agent inherits the parent session's tools, so most agents can
focus on domain expertise rather than tool plumbing. That default is not a
guarantee: `disallowedTools` and `tools` narrow it, and several agents here
rely on that — the six adversarial reviewers carry
`disallowedTools: Write, Edit` so their read-only posture is enforced rather
than merely stated, and `type-driven-correctness` uses a `tools:` allowlist.
Check the frontmatter before assuming an agent can reach something.

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

## Issue tracking and session completion

Both live in [AGENTS.md](AGENTS.md), which is the single source for them:
**Issue tracking with beads (via `rsry`)** and **Landing the Plane**.

This section used to be a generated `<!-- BEGIN BEADS INTEGRATION -->` block
installed by the `bd` CLI. It instructed `bd ready` / `bd show` / `bd close` and
a `bd dolt push` step, all of which this ecosystem replaced with `rsry` — and
`rsry` never invokes `bd` (ADR-0014). Nothing in this repository read or
regenerated the block, so it was an orphan carrying a stale content hash and
contradicting AGENTS.md. Removed rather than corrected in place: a third copy of
the push discipline is how the second one came to be wrong.

Use `rsry`. Do not run `bd`.
