# ADR-001: Orchestrator/Meta-Agent Pattern

**Status:** Proposed
**Date:** 2026-01-12
**Context:** Need hierarchical agent architecture where meta-agents spawn specialized sub-agents

## Decision

Implement two meta-agent types:

### 1. agent-architect
- Creates new agents from patterns/templates
- Ensures consistency across agent definitions
- Validates agent structure before creation

### 2. task-orchestrator
- Understands task taxonomy
- Routes tasks to appropriate sub-agent via Task tool
- Aggregates results from sub-agents
- Reports unified output

## Architecture

```
task-orchestrator (meta-agent)
    │ Task tool (subagent_type=X)
    ├── dependency-investigator (external lib analysis)
    ├── production-readiness-reviewer (deploy readiness)
    ├── platform-archaeologist (infra memory)
    └── theoretical-foundations-analyst (math/theory)
```

## Implementation Approach

**Option A (Chosen):** Pure prompt engineering - orchestrator is a well-crafted system prompt that uses Task tool with subagent_type parameter

**Option B (Future):** Claude Agent SDK for programmatic orchestration

## Next Steps

1. Create `dependency-investigator.md` agent for external Go library analysis
2. Create `task-orchestrator.md` that can invoke sub-agents
3. Trial with real-world performance investigation task

## Related

- Example use case: Scanner performance optimization requiring dependency analysis
