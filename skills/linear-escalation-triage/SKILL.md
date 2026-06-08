---
name: linear-escalation-triage
description: >
  Use when handling Linear tickets assigned to you — during weekly oncall
  queue sweeps, when picking up a specific aged escalation (P1/P2 in Triage
  > 7 days), when cleaning up stale Todos where work may have landed
  elsewhere, or when an external escalation (Slack ping, support comment)
  surfaces a ticket needing a triaged customer-facing reply.
user-invocable: true
argument-hint: "[--sweep|--ticket <ID>] [--mode oncall|project] [--stale-only]"
allowed-tools: "mcp__linear-server__*, mcp__rsry__*, Bash(gh:*), Bash(rsry:*), WebFetch"
---

# Linear Escalation Triage

## Overview

Workflow for Linear tickets assigned to you, in two modes:

- **Oncall mode** — weekly rotation; proactively handle the queue
- **Project mode** — outside oncall; work a specific Linear-tracked ticket

Both modes share the same per-ticket protocol. They differ in *entry conditions* and *exit conditions*.

**Core principle:** sweep before you dive. Without a sweep, whatever's loudest wins — which is how P1s sit in `Triage` for weeks before someone notices.

## Required tools

- `mcp__linear-server__list_issues` — queue sweep
- `mcp__linear-server__get_issue` / `list_comments` — pull context
- `mcp__linear-server__list_issue_statuses` — enumerate your team's status names (don't assume)
- `mcp__linear-server__save_comment` / `save_issue` — post reply, transition status
- `Bash(gh:*)` — pull linked external issues, search PR history

## Optional tools (graceful degradation)

- `mcp__rsry__*` — bead-based record-keeping (recommended; if unavailable, keep notes locally and skip the `Record` step)
- `WebFetch` — for fetching external runbooks / docs
- Knowledge-base search (Glean / equivalent) — for prior-art lookups

## When to Use

- Start of weekly oncall rotation → full sweep
- Specific escalation comes in (Slack ping, external ping, ticket assignment) → per-ticket protocol
- Aged P1/P2 in `Triage` > 7 days
- Stale-Todo cleanup pass

## When NOT to Use

- One-off investigation with no Linear ticket → generic investigation
- Code work where the ticket is well-defined and the implementation is clear (no triage needed)
- Internal-only design work without a customer-facing escalation → use a planning skill instead

## Setup (one-time per user)

1. Create a triage repo: `mkdir ~/triage && cd ~/triage && git init`
2. Enable rsry: `rsry enable ~/triage`
3. Discover your Linear team's status names: call `mcp__linear-server__list_issue_statuses` with `team: <your-team-name>` and note which name maps to each `type` (`triage`, `started`, `completed`, etc.). The skill assumes generic names below; substitute your team's actual names when you use it.
4. Note your canonical doc URLs (public docs, internal runbooks) somewhere persistent — memory entries or a local config file.

## Oncall-mode sweep

### Start of week

1. `list_issues assignee:me` (no status filter, all open)
2. Flag in this order:
   - **P1/P2 in `Triage` > 7 days** — top of stack
   - **P1+ in `Todo` not yet started** — second
   - **Anything in `Triage` > 30 days** — "should we still own this?"
3. **Stale-Todo audit**: for each `Todo` > 30 days, ask *"did the work happen elsewhere?"* Cross-check `git log`, knowledge-base search, and PR history on related repos for keywords in the ticket title. Close stale tickets aggressively — they pollute the queue and hide real signal.
4. Open a bead per actionable ticket in your triage repo (template below). Set `**Mode:** oncall` in body.

### End of week

Write a **handoff bead**: tickets touched, status of each, what the next oncall should pick up first. Title: `oncall-handoff-YYYY-WW`. Future you (or the next rotation) reads this before doing their own sweep.

## Project mode

Skip the sweep — you're on a specific ticket. Jump straight to the per-ticket protocol. Set `**Mode:** project` in any bead you open.

## Per-ticket protocol (both modes)

1. **Pull context**: Linear body + comments, linked external issue, linked support ticket, stakeholder identifier, escalator name + date if relevant.
2. **Hypothesize first**: from symptoms alone, write 1-3 candidate root causes *before* touching code. Forces a falsifiable claim and prevents jumping to "obvious" answers that turn out wrong.
3. **Verify in codebase**: grep for *exact* error strings (not paraphrases). Dispatch a search agent for cross-references if the symptom is non-obvious. Rank file:line citations.
4. **Search the knowledge base** with the exact error string, quoted. Look for prior runbooks, support tickets, standing customer-issue trails.
5. **Cross-check canonical docs**: maintained runbooks, public docs, role/policy definitions. Identify the source of truth *before* drafting the reply.
6. **Draft reply in two tones**:
   - **Customer-facing**: collaborative ("path forward" not "you need to"); link only to public canonical docs.
   - **Internal**: tight citation chain; link to all prior internal cases for next-time reuse.
7. **Show drafts before posting** — never post on Linear without explicit approval. Customer comms is irreversible.
8. **Post + transition**:
   - Top-level comment on the Linear ticket (not a reply unless thread shape demands it)
   - Transition status appropriately (see status semantics below)
   - **Never touch the synced external issue** — Linear handles linkback via status type
9. **Record a bead** in your triage repo (template below).
10. **Document hiccups**: anything the skill didn't help with → separate bead titled `skill-refactor: <thing>`. These accumulate as the refactor backlog.

## Linear status semantics

Linear statuses have *types* (`triage`, `unstarted`, `started`, `completed`, `canceled`, `backlog`) and team-specific *names*. The type determines synced-external-issue behavior — only `completed` closes linked external issues.

| Type | Common names | Sync effect |
|---|---|---|
| triage | `Triage` | none |
| unstarted | `Todo`, `Backlog` | none |
| started | `In Progress`, `In Review`, `Blocked` | none |
| completed | `Done` | **closes linked external issue** |
| canceled | `Canceled`, `Duplicate` | depends on team config |

For "awaiting customer" — most teams use `Blocked` (type=`started`, no sync close). Confirm your team's convention via `list_issue_statuses` rather than assuming a name exists.

## Bead template

```
**Linear:** <linear-url>
**External issue:** <gh-url-if-linked>
**Support ticket:** <support-url-if-linked>
**Stakeholder:** <identifier>
**Mode:** oncall | project
**Filed by:** <person> on <date>
**Priority:** P1/P2/P3
**Linear status:** <state>

## Symptom
<paste verbatim error in code block>

## Root cause
<one paragraph or "TBD">

## Action taken (<date>)
- <what you did>
- <what you posted>
- <status transition>

## Awaiting
<what unblocks closing this bead>

## Provenance
- Runbook: <url>
- Public docs: <url>
- Prior cases: <links>
```

Create via:

```
mcp__rsry__rsry_bead_create
  repo_path: <your triage repo path>
  issue_type: research
  priority: 1 (P1) / 2 (P2) / 3 (P3+)
```

## Discovery via rsry (when available)

- `rsry_bead_search query=<ticket-id>` — look up specific ticket history
- `rsry_list_beads --status=open` — current in-flight queue
- `rsry_list_beads --status=blocked` — awaiting external action
- Title prefix `oncall-handoff-` — past oncall handoffs

## Counter-rules (failure modes)

| Don't | Why |
|---|---|
| Lead with "prior art" framing in customer-facing tickets | Reads as defensive / blame-shaped |
| Dismiss workarounds without reading the canonical runbook | Partial workarounds often satisfy stated success criteria |
| Post on Linear without explicit approval | Customer comms is irreversible — show drafts |
| Cite people in design talk ("we agreed", "X said") | Anchor to functional artifacts (PRD, code, docs), not personal attributions |
| Touch external issues when Linear owns the lifecycle | The Linear ↔ external sync handles state via `type:completed` |
| Conflate diagnosis confidence with action framing | "Am I right?" and "should the customer do X?" are different questions |

## Red flags — STOP

- "I'll just post it real quick" → STOP. Show the draft.
- "Customer obviously needs to..." → STOP. Re-check the canonical doc.
- "This is a [product] bug" → STOP. Correctness vs UX? Different routing.
- "Workaround is bad, don't recommend" → STOP. Re-read what the workaround enables before recommending against it.
- "Beads say we already did X" → STOP. Verify against current state (`git log`, PR list, ticket states) before recommending from stale memory.

## Common mistakes

- **Assuming a status name exists**: always run `list_issue_statuses` for your team rather than assuming names like "Awaiting Customer" exist.
- **Conflating Linear and external lifecycles**: only `completed`-type status closes linked external issues. `Blocked` keeps them open.
- **Sweeping without a notebook**: a bead-per-ticket is the discipline that lets you walk away mid-sweep and resume cleanly.
- **Recommending from stale bead memory**: beads are notes frozen in time. Verify file paths, PR existence, and ticket states against current reality before acting on them.
