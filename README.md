# Claude Code Agents Collection

A curated collection of specialized AI agents for [Claude Code](https://claude.ai/code) that provide expert-level assistance in specific technical domains.

## Overview

This repository contains custom agent definitions that extend Claude Code's capabilities with specialized expertise. Each agent is a carefully crafted persona with deep domain knowledge, designed to provide focused, high-quality assistance for specific types of technical challenges.

## Available Agents

### 🔵 Production Readiness Reviewer
**File:** `production-readiness-reviewer.md`
**Purpose:** Comprehensive production readiness assessment
**Expertise:** Failure mode analysis, scalability, security, observability

A legendary principal engineer and SRE who approaches code with pragmatic paranoia, systematically identifying how systems will fail in production before they do.

**Use when:**
- Preparing code for production deployment
- Reviewing critical features or bug fixes
- Analyzing performance-sensitive code
- Implementing APIs or data pipelines

### 🟢 Research Paper Reviewer
**File:** `research-paper-reviewer.md`
**Purpose:** Expert-level academic paper analysis
**Expertise:** Methodological rigor, technical soundness, novelty assessment

A distinguished research fellow with decades of peer review experience for top-tier journals and conferences, providing incisive analysis of academic papers and research proposals.

**Use when:**
- Evaluating research papers for citations
- Understanding paper limitations and assumptions
- Assessing methodological validity
- Reviewing technical documentation

### 🟣 Theoretical Foundations Analyst
**File:** `theoretical-foundations-analyst.md`
**Model:** Uses Claude Opus for enhanced reasoning
**Purpose:** Rigorous theoretical and mathematical analysis
**Expertise:** Cross-disciplinary synthesis, fundamental correctness, mathematical rigor

A prodigious savant with deep expertise across mathematics, physics, and computer science who approaches problems as an intellectual outsider to identify fundamental issues.

**Use when:**
- Reviewing novel mathematical approaches
- Debugging complex algorithmic issues
- Analyzing theoretical foundations
- Cross-disciplinary problem solving

## Installation

### Method 1: User-Level Installation (Recommended)
Install agents globally for all your projects:

```bash
# Clone the repository
git clone https://github.com/jamestexas/agents.git
cd agents

# Copy agents to your user-level Claude directory
mkdir -p ~/.claude/agents
cp *.md ~/.claude/agents/
```

### Method 2: Project-Level Installation
Install agents for a specific project:

```bash
# Navigate to your project
cd /path/to/your/project

# Copy agents to project's Claude directory
mkdir -p .claude/agents
cp /path/to/agents/*.md .claude/agents/
```

## Usage

Once installed, you can invoke agents in any Claude Code session:

```
# Use the production readiness reviewer
/agent production-readiness-reviewer

# Use the research paper reviewer
/agent research-paper-reviewer

# Use the theoretical foundations analyst
/agent theoretical-foundations-analyst
```

Agents will inherit all available tools and capabilities from your main Claude Code session.

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

## Contributing

Contributions are welcome! When submitting new agents:

1. Ensure the agent serves a distinct purpose not covered by existing agents
2. Follow the established format and naming conventions (kebab-case)
3. Include comprehensive usage examples in the description
4. Test the agent thoroughly before submitting
5. Update this README with the new agent's information

## License

MIT License - See [LICENSE](LICENSE) file for details

## Support

For issues, questions, or suggestions:
- Open an issue in this repository
- For Claude Code specific issues: https://github.com/anthropics/claude-code/issues

## Acknowledgments

These agents are designed to work with [Claude Code](https://claude.ai/code), Anthropic's official CLI for Claude.