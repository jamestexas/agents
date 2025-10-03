# Claude Code Agents Collection

A curated collection of specialized AI agents for [Claude Code](https://claude.ai/code) that provide expert-level assistance in specific technical domains.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/jamestexas/agents.git

# Install agents using symlinks (recommended - auto-updates with git pull)
cd agents
ln -s "$(pwd)"/agents/*.md ~/.claude/agents/

# Or copy agents (alternative method)
mkdir -p ~/.claude/agents
cp agents/*.md ~/.claude/agents/

# Use an agent in Claude Code
/agent production-readiness-reviewer
```

## What Are Claude Code Agents?

Claude Code agents are specialized AI personas that extend Claude Code's capabilities with domain-specific expertise. Each agent:

- Has a unique persona with deep knowledge in a specific domain
- Inherits all tools and capabilities from your Claude Code session
- Follows a structured methodology for consistent, high-quality outputs
- Creates detailed work logs for traceability and audit trails
- Can be invoked on-demand when you need specialized analysis

Think of agents as expert consultants you can call upon for focused assistance.

## Available Agents

### 🔵 Production Readiness Reviewer
**File:** [`agents/production-readiness-reviewer.md`](agents/production-readiness-reviewer.md)
**Model:** Inherits from parent session
**Persona:** Legendary principal engineer and SRE with decades of experience

Approaches code with pragmatic paranoia, systematically identifying how systems will fail in production before they do. Focuses on failure mode analysis, scalability, security, observability, and maintainability.

**Use when:**
- Preparing code for production deployment
- Reviewing critical features or bug fixes
- Analyzing performance-sensitive code
- Implementing APIs or data pipelines
- Assessing blast radius and cascading failures

### 🟢 Research Paper Reviewer
**File:** [`agents/research-paper-reviewer.md`](agents/research-paper-reviewer.md)
**Model:** Inherits from parent session
**Persona:** Distinguished research fellow with decades of peer review experience

Provides expert-level analysis of academic papers and research proposals with focus on methodological rigor, technical soundness, and novelty assessment. Applies the same standards used for top-tier journals.

**Use when:**
- Evaluating research papers for citations
- Understanding paper limitations and assumptions
- Assessing methodological validity
- Reviewing experimental design
- Distinguishing genuine advances from incremental work

### 🟣 Theoretical Foundations Analyst
**File:** [`agents/theoretical-foundations-analyst.md`](agents/theoretical-foundations-analyst.md)
**Model:** Uses Claude Opus for enhanced reasoning
**Persona:** Prodigious savant across mathematics, physics, and computer science

Approaches problems as an intellectual outsider with expertise in topological data analysis, differential geometry, gauge theory, and machine learning. Examines problems from first principles to identify fundamental issues.

**Use when:**
- Reviewing novel mathematical approaches
- Debugging complex algorithmic issues
- Analyzing theoretical foundations
- Cross-disciplinary problem solving
- Verifying mathematical consistency

### 🔵 Surgical Reviewer
**File:** [`agents/surgical-reviewer.md`](agents/surgical-reviewer.md)
**Model:** Inherits from parent session
**Persona:** Direct, precise code reviewer following kata methodology

Provides scalpel-sharp, focused code reviews that call out only what needs to change. Uses kata methodology to break down problems to their essence and rebuild them stronger. Zero fluff, maximum impact.

**Use when:**
- Need focused review of specific code changes
- Just completed a feature or refactoring
- Want precise feedback without broad suggestions
- Reviewing bug fixes or targeted improvements
- Need actionable feedback quickly

### 🔵 Documentation Synthesis Architect
**File:** [`agents/documentation-synthesis-architect.md`](agents/documentation-synthesis-architect.md)
**Model:** Inherits from parent session
**Persona:** Documentation architect specializing in information architecture

Consolidates sprawling, overlapping, or fragmented documentation into coherent, maintainable structures. Identifies patterns, eliminates redundancy, and creates clear information hierarchies.

**Use when:**
- Documentation is spread across multiple files
- Overlapping or conflicting information exists
- Need to restructure documentation for clarity
- Consolidating roadmaps, ADRs, or technical docs
- Creating coherent information architecture

## Installation

### Method 1: Symlink Installation (Recommended)

Using symlinks allows agents to automatically update when you pull new changes from the repository:

```bash
# Clone the repository
git clone https://github.com/jamestexas/agents.git
cd agents

# For user-level installation (available in all projects)
mkdir -p ~/.claude/agents
ln -s "$(pwd)"/agents/*.md ~/.claude/agents/

# For project-level installation (specific project only)
cd /path/to/your/project
mkdir -p .claude/agents
ln -s /path/to/agents/agents/*.md .claude/agents/
```

### Method 2: Copy Installation (Alternative)

If you prefer copied files over symlinks:

```bash
# Clone the repository
git clone https://github.com/jamestexas/agents.git
cd agents

# For user-level installation
mkdir -p ~/.claude/agents
cp agents/*.md ~/.claude/agents/

# For project-level installation
cd /path/to/your/project
mkdir -p .claude/agents
cp /path/to/agents/agents/*.md .claude/agents/
```

**Note:** With the copy method, you'll need to manually copy files again after pulling repository updates.

## Usage

### Invoking Agents

Once installed, invoke agents in any Claude Code session using the `/agent` command:

```bash
# Get production readiness review of your code
/agent production-readiness-reviewer

# Analyze an academic paper
/agent research-paper-reviewer

# Review mathematical foundations
/agent theoretical-foundations-analyst

# Get focused code review
/agent surgical-reviewer

# Consolidate documentation
/agent documentation-synthesis-architect
```

### How Agents Work

When you invoke an agent:

1. **Inherits Context**: The agent has access to all files and tools from your current Claude Code session
2. **Specialized Analysis**: It applies its domain expertise and structured methodology to your request
3. **Creates Work Log**: Most agents create timestamped log files (e.g., `agent-name_YYYY-MM-DD_agent_log.md`) documenting their analysis and decisions
4. **Focused Output**: You receive specialized guidance based on the agent's expertise

### Example Workflow

```bash
# 1. You're about to deploy a new API endpoint
/agent production-readiness-reviewer
# Agent performs failure mode analysis, checks security, scalability, etc.

# 2. You've written complex math code
/agent theoretical-foundations-analyst
# Agent verifies mathematical consistency and theoretical soundness

# 3. You just refactored a module
/agent surgical-reviewer
# Agent provides precise, actionable feedback on your changes
```

### Best Practices

- **Choose the right agent**: Match your task to the agent's expertise
- **Review work logs**: Agents create detailed logs for traceability
- **Use sequentially**: Different agents can provide complementary perspectives
- **Commit work logs**: Include agent logs in your commits for documentation

## Creating New Agents

Agent files follow this format:

```markdown
---
name: agent-identifier
description: When to use this agent with examples in XML format
model: inherit|opus|sonnet
color: blue|green|purple|red|orange
---

System prompt defining the agent's persona, expertise, and methodology...
```

### Guidelines for New Agents

1. **Clear Specialization:** Each agent should have a distinct domain of expertise
2. **Rich Persona:** Create a compelling backstory that reinforces the agent's capabilities
3. **Structured Methodology:** Define a clear process the agent follows
4. **Practical Examples:** Include realistic usage examples in the description
5. **Model Selection:** Use `inherit` for most agents, `opus` for complex reasoning tasks
6. **YAML Validation:** Quote the description field to handle colons: `description: "..."`

### Development Setup

If you're developing agents, set up [pre-commit](https://pre-commit.com) for automatic YAML validation:

```bash
# Install pre-commit (if not already installed)
pip install pre-commit
# or: brew install pre-commit

# Install the hooks
pre-commit install

# Run manually on all files (optional)
pre-commit run --all-files
```

This validates YAML frontmatter before each commit, preventing syntax errors like unquoted colons.

**Manual validation without pre-commit:**
```bash
./scripts/validate-agents.sh
```

## Contributing

Contributions are welcome! When submitting new agents:

1. **Clear Specialization**: Ensure the agent serves a distinct purpose not covered by existing agents
2. **File Location**: Place agent files in the `agents/` directory
3. **Naming Convention**: Use kebab-case (e.g., `my-new-agent.md`)
4. **Format Requirements**: Follow the established format with YAML frontmatter
5. **Usage Examples**: Include comprehensive examples in the description field using XML format
6. **Testing**: Test the agent thoroughly before submitting
7. **Documentation**: Update this README with the new agent's information in the Available Agents section

For detailed agent development guidelines, see [CLAUDE.md](CLAUDE.md).

## License

MIT License - See [LICENSE](LICENSE) file for details

## Support

For issues, questions, or suggestions:
- Open an issue in this repository
- For Claude Code specific issues: https://github.com/anthropics/claude-code/issues

## Acknowledgments

These agents are designed to work with [Claude Code](https://claude.ai/code), Anthropic's official CLI for Claude.