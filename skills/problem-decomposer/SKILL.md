---
name: problem-decomposer
description: Decompose an aspiration into dispatchable bead specs via 5-whys descent + a 7-property rubric. Use when starting new platform/capability/migration work that needs breaking down before agents can ship it, or to audit a backlog for orphan-dispatchable beads.
allowed-tools: Read Write Edit Glob Grep Bash(ls *) Bash(date *) Bash(rg *)
argument-hint: <aspiration-slug> [--input=PATH] [--output-dir=PATH] [--audit=PATH]
---

<!-- Author: jamestexas — drafted by claude-opus-4-7 (2026-05-17) -->

# /problem-decomposer — Aspiration → dispatchable lattice

Take an aspiration ("ship a platform, not a collection of repos"), descend it through the 5-whys until each branch reaches leaves that satisfy the 7 dispatchability properties (see `DISPATCHABILITY.md`), and emit a structured problem-statement doc + bead specs + non-leaves queue.

## Arguments

`$ARGUMENTS`

- **`<aspiration-slug>`** — short kebab-case identifier for the aspiration (e.g. `substrate-idl`, `cross-repo-coordination`, `q3-platform-launch`). Becomes the output filename.
- **`--input=PATH`** *(optional)* — path to a doc describing the aspiration + relevant context. If omitted, the skill prompts the user (or the orchestrator) for the aspiration text inline.
- **`--output-dir=PATH`** *(default: `docs/problems/`)* — where the decomposition doc and bead specs go.
- **`--audit=PATH`** *(optional)* — instead of decomposing a new aspiration, audit an existing doc (or bead backlog) for orphan-dispatchable items. See "Audit mode" below.

## Modes

### Decompose mode (default)

Take a new aspiration → produce a fresh lattice doc + bead specs.

### Audit mode (`--audit=PATH`)

Take an existing decomposition doc, ADR, or bead backlog → check each leaf against the 7 dispatchability properties + the 5-whys chain. Emit a report listing:

- Leaves that pass all 7 (good)
- Leaves that fail one or more (with which property and why)
- Leaves whose "why?" chain doesn't reach a real aspiration (orphans — candidates for kill or re-parent)
- Non-leaves still in the queue (real work, not yet ready)

## What this skill solves

Most decompositions hit one of three failure modes:

1. **Too shallow** — the breakdown stops at requirements like "design the system" or "improve UX" that aren't actually dispatchable. Agents pick them up, stall, give up.
2. **Too unrooted** — leaves are concrete but the "why?" chain dead-ends at "because I noticed it." Agent budget burns on work that doesn't compound into a coherent platform.
3. **Tree-shaped, not lattice-shaped** — work that serves multiple goals gets duplicated (with drift) or shoehorned under one arbitrary parent. The cross-cutting structure is lost.

This skill enforces:

- **Descent until dispatchable** — every leaf passes all 7 properties from `DISPATCHABILITY.md`. Anything that doesn't is honestly classified as a non-leaf in the queue.
- **Rooted via 5-whys** — every leaf has a complete chain to a real aspiration. Orphans are flagged at write-time, not at execution-time.
- **Lattice, not tree** — leaves can have multiple parents. The doc and the Mermaid graph render this directly.

## Hard rules (non-negotiable)

1. **Every leaf must pass all 7 dispatchability properties.** Score them explicitly in the leaf's spec section. If even one fails, the node is not a leaf — push it to the Non-leaves queue with the failing property named.
2. **Every leaf must root to the aspiration via ≤5 whys.** If the chain takes more than 5 steps, you've smushed multiple layers — split the requirement.
3. **No invented work.** Every leaf's problem statement, acceptance criteria, and inputs must trace to real files / repos / specs / ADRs / beads that exist (verifiable via Read / Glob / Grep). Don't fabricate file paths or APIs.
4. **Mark `[unverified]` rather than invent.** If you propose a leaf that *should* touch a specific file but you couldn't confirm the file exists, mark the leaf `[unverified]` and surface it in the report.
5. **Honor the lattice.** When a leaf serves multiple parent requirements, give it multiple parents in the lattice table and the Mermaid graph. Don't pick one arbitrarily and lose the cross-cutting signal.
6. **The Non-leaves queue is not a punt.** Each entry must name (a) what dispatchability property fails today, and (b) what would unblock it. "Needs more thought" is not a valid answer — restate the work or kill it.
7. **Refuse on missing TEMPLATE / DISPATCHABILITY.** If either is missing from this skill's directory, refuse. The shape is the value.

## Workflow

### Phase 0 — Validate

1. Resolve `--output-dir=` (default `docs/problems/`). Create if missing.
2. Read `${CLAUDE_SKILL_DIR}/TEMPLATE.md` and `${CLAUDE_SKILL_DIR}/DISPATCHABILITY.md`. Refuse if either is missing or has had its H2 headers renamed.
3. If `--audit=PATH`, jump to "Audit mode workflow" below. Otherwise:
4. Acquire the aspiration text. If `--input=PATH`, read it. Otherwise, the aspiration was provided in $ARGUMENTS or the invocation context.
5. Validate the aspiration's shape: it must describe a *state of the world* (not a deliverable, not a constraint). If the aspiration is anti-shaped (e.g., "migrate to X"), refuse and restate: "That's a means, not an end. What state of the world does migrating to X produce?"

### Phase 1 — Surface candidate requirements

Read context broadly to identify what requirements descend from the aspiration:

- The aspiration text itself
- ADRs and design docs in the relevant repo (`docs/adr/`, `docs/plans/`)
- Existing CLAUDE.md / README / ARCHITECTURE.md
- Prior decomposition docs in `<output-dir>/` (so this one composes with existing work)
- Optionally: `prior-art-cartographer` output in `docs/prior-art/` (decisions about adopt/borrow/skip become requirement constraints)

Produce a *flat* list of candidate requirements — one line each, no hierarchy yet.

### Phase 2 — 5-Whys upward check

For each candidate requirement, walk **up** the why-chain by asking "why is this required?" Continue until you reach the aspiration or hit a dead-end.

- ≤5 steps to aspiration → requirement is rooted, keep it.
- Dead-end / "because I want to" → requirement is orphan, drop it.
- More than 5 steps → you've collapsed multiple layers; split.

This phase is the **filter** — drops orphan candidates before they pollute the lattice.

### Phase 3 — Build the requirement lattice

Arrange surviving requirements into a DAG:

- Top: the aspiration (one node).
- Bottom: candidates for dispatchable leaves (one per requirement-with-acceptance-criteria).
- Middle: intermediate requirements that need their own children.

Allow multiple parents per node. The lattice may be a chain in trivial cases or a wide DAG in real ones. Don't force a tree shape.

### Phase 4 — Descend until dispatchable

For each candidate leaf, run it through the 7-property checklist in `DISPATCHABILITY.md`:

1. Self-contained problem statement
2. Falsifiable acceptance criteria
3. Enumerable inputs
4. Shape-predictable output
5. Bounded scope
6. Observable failure
7. Realistic time-box

- **All 7 pass:** it's a dispatchable leaf. Write its bead spec section in the output doc.
- **One or more fail:** it's not yet a leaf. Either decompose it further (one more level of children, then re-check), or push to the Non-leaves queue with the failing property named.

**Don't force.** If a node genuinely isn't dispatchable today (e.g., "design the substrate-IDL trait library" — output shape unknowable until you start), don't shoehorn it into dispatchable shape. Honest non-leaf > performative leaf.

### Phase 5 — Emit the doc

Write `<output-dir>/<aspiration-slug>.md` following `${CLAUDE_SKILL_DIR}/TEMPLATE.md` exactly:

- **Aspiration** — one paragraph.
- **5-Whys descent** — one chain per major branch.
- **Requirement lattice** — table of intermediate nodes with parents/children.
- **Dispatchable leaves** — one full bead spec per leaf.
- **Non-leaves queue** — table of real-but-not-yet-dispatchable items + what would unblock.
- **Lattice (Mermaid)** — rendered DAG. Color aspiration / requirement / leaf differently.
- **Action items** — short list (file leaves; track non-leaves; refresh after first batch ships).
- **Cross-references** — related ADRs, beads, prior-art entries, sibling decompositions.

### Phase 6 — Report

Output a concise summary (≤300 words):

- Aspiration restated in one line
- Lattice shape (N requirements, M leaves, K non-leaves)
- The 3 leaves most likely to compound (i.e., parents of multiple downstream requirements)
- Anything you couldn't verify (`[unverified]` count + why)
- Suggested next move: "file these leaves via rosary:note" / "review the lattice with a human before filing" / "this aspiration is malformed, restate"

### Audit mode workflow

When `--audit=PATH` is set, the workflow shifts:

1. Read the target doc / bead-export.
2. For each leaf / bead in the input, score against the 7 dispatchability properties.
3. For each leaf, walk its "why?" chain (from problem statement / labels / parent links) to check rootedness.
4. Classify each as:
   - **Rooted-dispatchable** (all 7 pass + chain reaches aspiration)
   - **Orphan-dispatchable** (all 7 pass + chain dead-ends → kill candidate)
   - **Non-dispatchable** (one or more properties fail → either decompose or restate)
5. Emit an audit report at `<output-dir>/audit-<source>-<date>.md` with the classification table + suggested actions per item.

Audit mode is **read-only** — never modifies the source. Output is a recommendation document.

## What you don't do

- **Don't file beads directly.** Output is a doc + bead specs. The user (or `rosary:note` as a follow-up) does the actual filing.
- **Don't invent work.** Every leaf must trace to real files / repos. Use Read / Glob / Grep to verify before proposing.
- **Don't shoehorn non-leaves into leaf shape.** Honest non-leaves > performative leaves.
- **Don't compare against external systems.** That's `prior-art-cartographer`'s job. This skill consumes prior-art decisions as constraints; doesn't redo the analysis.
- **Don't run more than one aspiration per invocation.** Multiple aspirations interact in non-obvious ways; do them in sequence, not parallel.

## Refusal conditions

| Condition | Refuse with |
|---|---|
| Aspiration is anti-shaped (a deliverable / a constraint / a means) | "That's not an aspiration. <reason>. Restate as a state of the world." |
| TEMPLATE.md or DISPATCHABILITY.md missing | "Skill scaffolding missing; the shape is the value. Restore the files." |
| Output dir contains a doc with the same slug less than 7 days old | "A decomposition for this slug exists at <path>, dated <date>. Refresh that one instead of overwriting." |
| User asks for opinion prose | "I emit structured docs, not essays. The decisions are in each leaf's spec; the lattice is in the Mermaid graph." |
| Asked to decompose without an aspiration text | "Give me the aspiration first. One paragraph describing the state of the world we want to be true. If you don't have one, that's the work — write it before decomposing." |

## Examples

```
/problem-decomposer substrate-idl
→ Prompt for aspiration text; produce docs/problems/substrate-idl.md

/problem-decomposer cross-repo-coordination --input=docs/specs/substrate-idl.md
→ Read input doc, decompose into docs/problems/cross-repo-coordination.md

/problem-decomposer audit-q3-backlog --audit=docs/beads/q3-export.md
→ Audit mode; produce docs/problems/audit-q3-backlog-<date>.md

/problem-decomposer
→ Refuse: "Pass an aspiration slug + text."
```

## Supporting files in this skill

- `TEMPLATE.md` — the canonical problem-decomposition doc shape
- `DISPATCHABILITY.md` — the 7-property checklist (standalone-usable)
- `examples/substrate-idl.md` — worked example: descend "ship art-substrate as a platform" into bead specs

## Mailbox

If a dispatch surfaces meta-level surprises (the dispatchability rubric needs an 8th property, the 5-why limit is wrong for your domain, the Mermaid lattice doesn't render certain shapes), append a structured block to `<output-dir>/_clarifications.md`:

```markdown
## YYYY-MM-DD — <slug> — <subject>

- **Surface:** SKILL.md | TEMPLATE.md | DISPATCHABILITY.md | this-doc
- **Surprise:** one paragraph
- **Proposed fix:** one paragraph
- **Severity:** low | medium | high
```

The orchestrator processes between runs. Same pattern as `prior-art-cartographer`.

## Style notes

- **Be terse.** Each leaf's spec is ~10-15 lines. Long prose belongs in the linked ADR, not in the bead spec.
- **Be specific.** Acceptance criteria must be falsifiable. Inputs must be enumerable. Don't hand-wave.
- **Be honest about non-leaves.** A clear "this is not yet dispatchable because property #4 fails" is more useful than a fake leaf.
- **Be reproducible.** Two runs on the same aspiration with the same context should produce nearly-identical lattices (modulo lattice-isomorphism — the structure should match even if leaf order differs).
