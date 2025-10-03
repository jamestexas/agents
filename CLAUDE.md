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
├── CLAUDE.md              # This file
└── .claude/               # Claude Code configuration
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

The agents inherit all tools and capabilities from the parent Claude Code session, so focus on domain expertise rather than tool usage.

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