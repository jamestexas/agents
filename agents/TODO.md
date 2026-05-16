# Agent Configuration Composition — Status

## Resolved (2026-05-16)

The composition mechanism described below is **shipped** in `scripts/build.sh`:

```
<!-- @include-begin _shared/<name>.md -->
[expanded content lives here, kept in sync by build]
<!-- @include-end _shared/<name>.md -->
```

- `scripts/build.sh expand` — rewrites included blocks from `_shared/`
- `scripts/build.sh check-includes` — fails if any block has drifted (CI gate)
- `scripts/build.sh check` — the CI entry point (lint + include drift + README drift)

The `_shared/` directory exists and is empty. **No content has been migrated** —
see the analysis below for why.

## Why no migration (yet)

When the audit ran across all 23 agents, the "Work Documentation Protocol"
section that the original TODO called out as duplicated turned out to be
**meaningfully varied**, not mechanically copy-pasted:

| Variant length | Agents | Character |
| -------------- | ------ | --------- |
| 3–4 lines | `surgical-reviewer`, `platform-code-reviewer`, `security-auditor`, `review-pattern-surfacer` | terse, task-specific |
| 14–20 lines | `documentation-synthesis-architect`, `production-readiness-reviewer`, `research-paper-reviewer`, `research-paper-writer`, `theoretical-foundations-analyst` | full procedure with topic-specific bullets |

The 6-step "create → start → append → update → end → commit" skeleton is
shared, but the *what to log* bullets differ per agent and carry real
guidance. Forcing a single template would either:

- Lose the topic-specific bullets (downgrade), or
- Require a 7-parameter template that's harder to read than the duplication (overshoot).

## When to migrate

Add a `_shared/` file when:

- ≥3 source files share **identical** prose (not just shape)
- The shared prose is policy/standards, not topic-specific guidance
- A change to the prose would need to land in all three files at once

Example candidate (not yet migrated): a future "Output Format Standards"
block that every reviewer-style agent should adopt verbatim.

## Related infrastructure

- `scripts/build.sh lint` — validates frontmatter against Anthropic + Gemini specs (no unknown fields, valid `color`/`model` values, required keys present)
- `scripts/build.sh readme` — regenerates the `<!-- BEGIN: AGENTS/SKILLS -->` tables in `README.md`
- `scripts/install.sh` — symlinks agents/skills into `~/.claude/`
- `.pre-commit-config.yaml` — runs lint + readme on every commit
- `.github/workflows/build.yml` — runs `build.sh check` on every PR (lint + include drift + README drift)
