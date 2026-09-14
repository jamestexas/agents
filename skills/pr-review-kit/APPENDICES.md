# pr-review-kit — appendices

A sidecar to [SKILL.md](SKILL.md), carrying the reference material the phases
point at: the author's review pattern (A), CLOSED-not-merged PRs (B), memory and
persistence (C), the heavier review skills (D), and the glossary. None of it is
needed to run a review — it is what you consult when the situation calls for it.

---

## Appendix A — Identifying the author's review pattern

Spend two minutes reading a sample of the author's recent PRs to calibrate. Patterns worth detecting:

- **AI self-review pattern**: author posts inline comments via their own bot (often prefixed `🤖:` or labeled "AI panel"). Treat these as pre-merge punch lists, not blocking review. Apply Rule 2 (walk commits forward) ruthlessly.
- **Stacked-PR author**: every PR has a sibling. Read the stack root before reviewing any leaf. The leaf often makes sense only in the context of the root.
- **Design-doc-cited author**: author cites "TRD §X" / "spec §Y" in PR bodies. Find the doc before reviewing. See Phase 3.
- **Iterative-fix author**: author files a small PR, gets AI review, fixes within hours via follow-up commits. The PR's mid-iteration state is normal-state. Don't review the iteration — wait for stabilization, or do a delta review against the last review-stable commit.
- **Description-light author**: PR body is one sentence. Read the linked ticket; if no ticket, read the diff cold and infer intent. Rule 1 applies — label inferences explicitly.

---

## Appendix B — How to handle CLOSED-not-merged PRs

If `state=CLOSED` and `mergedAt=null`:

1. Read the last few issue comments — often the author posts *"Superseded by #M"* when closing.
2. If no supersede comment, check the cross-references in the timeline:
   ```bash
   gh api repos/$OWNER/$REPO/issues/$N/timeline \
     --jq '[.[] | select(.event == "cross-referenced")] | .[].source.issue.number'
   ```
3. The replacement PR may be by a different author (someone consolidated the work). Don't assume the original author files all follow-ups.
4. Update your notes: mark the old PR's notes file as "stale, superseded by #M" and either write a new notes file for #M or note the link.

---

## Appendix C — Memory and persistence (if your harness supports it)

If your harness has persistent memory across sessions (e.g., Claude Code's `~/.claude/projects/<project>/memory/` directory), save the following kinds of findings as the session unfolds:

- **Footguns / quirks** — non-obvious tool behavior (e.g., "this test framework freezes the clock," "this datastore uses MySQL InnoDB gap locks"). File pattern: `reference_<topic>.md`.
- **Workflow corrections from the user** — when the user explicitly says "stop doing X" or "always do Y." File pattern: `feedback_<rule>.md`.
- **Project context** — ongoing initiatives, ticket states, ownership. File pattern: `project_<name>.md`.

Reference these in future sessions to avoid re-discovering the same lessons.

---

## Appendix D — When to invoke the heavier review skills

This kit is the foundation. Two heavier patterns build on it:

- **Mache-driven structural review**: if your harness has a `mache` MCP server (or equivalent code-intelligence tool), use it to generate a spec-driven diagram + emergent diagram of the PR's structural changes. Compare them — the gap between intended and emergent architecture is often the load-bearing finding.
- **Multi-agent panel synthesis**: dispatch 3-4 specialty agents in parallel (Phase 5), then synthesize. Each agent should be told its working dir + HEAD SHA + that it should require primary-source citations. Synthesize their findings against the actual code (Phase 6) before relaying to the user.

These are optimizations on the base playbook, not replacements. Always do Phases 1-4 first; agent dispatch without baseline state-reading produces shallow findings.

---

## Glossary

- **Falsifiable claim**: a statement whose truth can be checked in 30 seconds by running a specific command or reading a specific file:line. *"Field X is at proto number 21"* is falsifiable. *"This design is elegant"* is not.
- **Cross-PR invariant**: a property that must hold across multiple PRs in a stack (e.g., "no symbol from package A is exported to package B"). Verifiable by `grep` across the affected files.
- **Supersedes**: a PR closed without merge whose work has been moved into a different PR — typically a different author, different architectural cut, or a consolidation of multiple smaller PRs into one.
- **Walk commits forward**: starting from a comment's timestamp, scan all subsequent commits to see if any of them addressed the issue the comment raised. Counterpart to "review thread state."
