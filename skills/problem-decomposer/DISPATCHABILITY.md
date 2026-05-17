# Dispatchability — the 7 properties

A unit of work is **dispatchable** when an autonomous agent can pick it up from a fresh context window and complete it without further human input. Used both:

- **At decomposition time** — by `problem-decomposer` to decide whether a node is a leaf or needs more decomposition.
- **At audit time** — by humans (or `rosary:evolve`) to grade existing beads / issues and triage the ones that aren't dispatchable.

> *Necessary but not sufficient:* a node passes dispatchability only if it satisfies **all seven** properties. A node that passes all seven and traces back to a real aspiration via "why?" chain is **rooted-dispatchable** — the actual bar for "this should go in the queue."

---

## The seven properties

### 1. Self-contained problem statement

The bead's own text is the entire input the agent needs to understand the task. No "see the design doc that's still being written," no "ask the user what they meant," no "check the discussion in PR #142."

**Failure mode:** Agent stalls in the first 10 minutes waiting for clarification. Wastes context window on exploratory reads of unrelated files.

**Passes:**
> "Add a `--dry-run` flag to `tools/schema-bridge` CLI that prints the proposed codegen output to stdout without writing files. Flag should not affect lint/parse behavior. Tests live in `tools/schema-bridge/tests/cli_dry_run.rs`."

**Fails:**
> "Improve the schema-bridge UX."

### 2. Falsifiable acceptance criteria

There exists a definite test for "done." "It works" isn't falsifiable. "The seven existing tests still pass AND three new tests pass" is.

Acceptance criteria can be any of:
- Tests that pass (named or generated)
- A file that exists with specific content shape (e.g. a generated codegen output)
- A command that exits 0
- A structured document matching a template
- A PR that passes CI

**Failure mode:** Agent declares victory on partial work because there's no objective standard. Reviewer can't disagree on principle.

**Passes:**
> "Acceptance: `task test -- const_*` passes; CI's `lint` job stays green; `task generate -- examples/contract.capnp` emits a `Contract` struct with `version: number()`."

**Fails:**
> "Acceptance: const support feels right."

### 3. Enumerable inputs

Every file, directory, repo, tool, schema, env var, and external dependency the agent needs is named. The agent should not have to discover where things are.

**Failure mode:** Agent invents paths (hallucination); reads 40 unrelated files trying to find the right one (context blow); cites file paths that don't exist.

**Passes:**
> "Inputs:
> - `tools/schema-bridge/src/parser.rs` (current parser)
> - `tools/schema-bridge/src/ir.rs` (intermediate representation)
> - `tools/schema-bridge/tests/fixtures/const_*.capnp` (test fixtures)
> - Cap'n Proto language reference §const: https://capnproto.org/language.html"

**Fails:**
> "Inputs: the schema-bridge code, the capnp spec."

### 4. Shape-predictable output

The agent and the reviewer agree in advance on the *shape* of the output: a diff against named files, a new file at a named path, a passing test, a structured report.

**Failure mode:** Output isn't reviewable in a bounded amount of time. The reviewer doesn't know whether to expect 10 lines or 1000.

**Passes:**
> "Output:
> - PR against `main` in `cloister`
> - Touches `tools/schema-bridge/src/codegen.rs`, `tools/schema-bridge/src/ir.rs`, `tools/schema-bridge/tests/`
> - Net diff < 400 lines"

**Fails:**
> "Output: whatever fixes the problem."

### 5. Bounded scope

"And cascade everywhere this is used" is its own bead. Cross-cutting work is either pulled into this bead with explicit enumeration or filed as a downstream dependency.

**Failure mode:** Agent expands scope mid-task because "while I'm here I'll also fix X," runs out of context, ships partial work in multiple places.

**Passes:**
> "Scope: const support in schema-bridge's codegen pipeline only. Migration of `@notme/contract` to use const is a separate bead (depends-on this one)."

**Fails:**
> "Scope: const support and update all the consumers."

### 6. Observable failure

The bead can be marked failed with a specific reason that doesn't require human triage to detect. The agent (or CI) can detect failure unambiguously.

**Failure mode:** Silent partial completion looks like success. The orchestrator can't tell that the bead's work was actually undone or doesn't compose.

**Observable failure shapes:**
- Test exit code ≠ 0
- File doesn't exist at expected path
- Generated output doesn't parse / doesn't match expected shape
- Agent's own report includes `[unverified]` or `[stuck]` markers
- CI job goes red

**Failure mode passes:** Failure looks distinct from success and gets surfaced.

### 7. Realistic time-box

Fits in one agent session — roughly 100k-200k tokens of context, a few hours of wall clock, ≤ ~6 tool turns of nested work. If estimate is bigger, decompose.

**Heuristics:**
- "Adds a flag to existing CLI" → easily fits
- "Adds a new codegen target" → probably fits if the IR is clean
- "Migrates 8 consumers" → almost certainly doesn't fit; decompose per-consumer
- "Refactors the whole module" → doesn't fit; restate as a sequence of bounded refactors
- "Designs and implements a system" → doesn't fit; split design (research bead) from implementation (multiple beads)

**Failure mode:** Agent runs out of context, leaves half-shipped work, or chases its own tail across compaction cycles.

---

## How to use this as a checklist

For a candidate leaf node, ask each question:

```
□ 1. Could a fresh-context agent read just the bead text and start work?
□ 2. Is there a test, command, or document that proves "done"?
□ 3. Are all inputs (files, repos, tools, refs) named?
□ 4. Do we know the output's shape (diff against X, new file at Y, etc.)?
□ 5. Is the scope bounded — and is cross-cutting work explicitly out-of-scope?
□ 6. Will failure be visible without human inspection?
□ 7. Does this fit in one agent session?
```

7 ✓ → dispatchable leaf. File it.
Any ✗ → not yet a leaf. Either decompose, restate, or re-classify (research / design / consultation are valid non-dispatchable work shapes that need different handling).

## What non-dispatchable work looks like

Common shapes you'll find at non-leaves:

| Shape | Why it's not dispatchable | What to do |
|---|---|---|
| Research / exploration | No acceptance criteria; output shape unknown until you start | File as a research bead with a *deliverable* acceptance (a report at path X) — that makes it dispatchable. |
| Design / ADR | Output is a decision, not a diff. Falsifiable in principle but the criteria are "does this hold up to review?" | File as a design bead with acceptance = "ADR doc lands at path X, passes review by reviewer Y." |
| Refactor everything | Unbounded scope | Decompose: refactor module A, refactor module B, etc. Each becomes its own leaf. |
| "Build the system" | Aspiration, not work | Decompose via 5-whys until you reach concrete deliverables. |
| Cross-cutting change with N call sites | Scope grows linearly with N | Either: (a) one bead per call site, (b) one bead for "add the new API; old API stays" + N beads for migration, (c) one bead with explicit enumeration of all N sites and the time-box raised accordingly. |

## Rooted vs orphan dispatchability

A node is **rooted-dispatchable** when:

1. All 7 properties pass (dispatchable), AND
2. Going up the "why?" chain reaches a real aspiration (not "because I noticed it" or "for completeness").

An **orphan-dispatchable** node passes 1–7 but doesn't trace to an aspiration. These are the most insidious kind of bead: they burn agent budget on work that doesn't compound. The decomposition discipline catches them at write-time, not at execution-time.

If an orphan-dispatchable node looks too useful to kill, the right move is to **find or write its parent aspiration first**. If you can't, the work shouldn't ship.
