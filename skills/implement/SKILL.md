---
name: implement
description: >-
  Deterministic end-to-end implementation orchestrator. Use when building
  net-new code or a fix that should follow the full pipeline — decompose →
  research → TDD loop → self-review gate → structural review. Thin: it
  SEQUENCES existing skills (problem-decomposer/work-scope, feature-impl,
  superpowers/test-driven-development, go-standards, self-audit,
  test-fidelity, taskfile-ci-parity, structural-pr-review) in a fixed order
  with rigid gates; it does not re-derive them. Mirror of
  structural-pr-review for the build side.
---

# implement — implementation orchestrator

A fixed-sequence chain for implementing one unit of work (a feature or a fix) with the same determinism `structural-pr-review` brings to the review side. Ad-hoc implementation anchors on whatever the author noticed first; this chain guarantees the same evidence shape every time: decompose (P0) → research (P1) → TDD loop (P2) → self-review gate (P3) → structural review (P4) → close (P5).

**Two non-negotiables:**
1. **The human does the human-facing actions.** This skill STOPS before `git push`, before opening a PR, before posting any review/reply. It prepares and verifies; the human pushes and posts. (gitsign keyless enforces this — the final signature is the author's.)
2. **Rigid gates emit artifacts.** P0 and P3 do not "complete" until their required artifact exists. A phase cannot start until the prior gate's artifact is present. Everything else is FLEXIBLE within bounded exit conditions.

## Arguments

`$ARGUMENTS` — a problem statement, a ticket ID, or a filed bead id. If empty, ask for one before proceeding.

## Determinism contract

- Phases run in order P0→P5. No reordering.
- Each phase names the EXACT skill/command it invokes. No "use appropriate tooling."
- RIGID phases (P0, P3) produce a gating artifact named below; the next phase asserts it exists.
- FLEXIBLE phases (P1, P2) iterate, but each has an explicit EXIT CONDITION — not a fixed step count.
- Create one TodoWrite item per phase at the start; a phase is not checked off until its gate/exit condition is met.

---

## P0 — SCOPE → bead specs  (RIGID · gate: filed beads exist)

Decompose the work into dispatchable units and FILE them, closing the bead→implement bridge that the decomposition skills stop short of.

1. If the input is an aspiration/capability → invoke `problem-decomposer`. If it is a ticket/feature to cut into PR-sized units → invoke `work-scope`. (Both emit specs and deliberately DO NOT file.)
2. File each emitted leaf/unit with `rsry_bead_create` — carry its file scope + a falsifiable acceptance criterion (a runnable command or a named test). Link with `rsry_bead_link` where dependent.
3. Checkpoint commit (jj/git) so the decomposition is durable before code starts.

**GATE:** `rsry_list_beads` shows the filed beads with acceptance criteria. Do not enter P1 until they exist. If the work is a one-line fix (no decomposition warranted), file ONE bead and say so — the gate is "a bead exists," not "many."

## P1 — RESEARCH  (FLEXIBLE · exit: research doc exists)

Discover the patterns the code must follow before writing it.

1. Invoke `feature-impl` Phase 0 (research): dispatch an Explore agent (thoroughness "very thorough") to find 2–3 reference implementations of the same KIND of thing, extract their conventions (type visibility, error wrapping, test/fake patterns, logging, config, safety), and search for reusable utilities (flag cross-module `internal/` duplication).

**EXIT:** a research summary naming the reference impls + the conventions to follow. Skip only for a mechanical/derived change with an obvious single pattern — and say so.

## P2 — IMPLEMENT  (FLEXIBLE, per bead · exit: `task ci` green + committed)

For each bead, in dependency order:

1. **Test first.** Invoke `superpowers/test-driven-development`: write the failing test, watch it fail. Then the **mutation check** — with the implementation in place, revert the load-bearing line and confirm the test goes red (proves the test isn't vacuous). Restore.
2. **Loop to green.** Run `task ci` if the module exposes it (see `taskfile-ci-parity`); else the raw quadruplet `go build ./... && go vet ./... && go test ./... && golangci-lint run` on the touched packages. Iterate until green. Run `go build ./... && go vet ./...` after every edit (catches unused imports / signature drift early).
3. **Conventions.** On every new `.go` file, invoke `go-standards` before committing; fix what it flags.
4. **Commit.** Foreground gitsign commit, EXPLICIT staged paths (never `git add -A`), eyeball `git diff --cached --name-only` first. Small commits, one logical change each.
5. Comment progress on the bead (`rsry_bead_comment`).

**EXIT (per bead):** `task ci`/quadruplet green AND the change committed with the mutation check recorded.

## P3 — SELF-REVIEW GATE  (RIGID · gate: self-audit + test-fidelity clean)

The pre-review gate the process does informally but never as a skill. Run BEFORE tagging any reviewer.

1. `taskfile-ci-parity` — confirm local == CI by construction (every check is a Taskfile target CI also invokes), so "green locally" means green in CI.
2. `self-audit` — dead struct fields, rotting comments, duplicate types, scope drift; dispatches an adversarial agent for design flaws.
3. `test-fidelity` — for every new test: can it fail? does it exercise the real path? any dead axis? (Read `sentinel/docs/testing-doubles.md` for any double on a fast/slow decision path.)
4. Fix findings as NEW commits (never amend a pushed commit). Re-run the P2 exit gate.

**GATE:** self-audit + test-fidelity report clean (or every finding has a NEW fix commit). Do not enter P4 until clean.

## P4 — REVIEW  (in-session · depth adapts to PR shape)

Invoke `structural-pr-review` on the branch (local, posts nothing). Its own classifier decides depth: mechanical/derived → run the falsifier; feature/behavioral → the adversarial lens dispatch (type-driven-correctness, security-auditor, dataflow-driven-troubleshooting, and a contract-conformance pass — verify every emitted value + doc/contract promise against the code). Produce the falsifiable matrix + verdict. Verify every agent claim against the code yourself before trusting it.

## P5 — CLOSE  (rigid · then STOP)

1. `rsry_bead_close` each bead — only after its change is committed AND its acceptance criterion passes. Do not close incomplete beads; comment what remains instead.
2. Prepare the human hand-off: the exact `git commit -S` (if any staging remains), the `push` command, and — if a PR/reply is next — a DRAFT body. Before drafting any human-facing prose, run the **de-claudify pass**: strip re-narration of code the author wrote, rule-of-three enumeration where one clause suffices, reflexive praise adjectives, showing-my-work verbs as prose, and hedge stacking.

**STOP.** The human runs the push, opens the PR, posts the review. This skill never does.

---

## Phase discipline (summary)

| Phase | Rigidity | Gate / exit artifact |
|---|---|---|
| P0 scope | RIGID | filed beads with acceptance criteria (`rsry_list_beads`) |
| P1 research | FLEXIBLE | research summary (reference impls + conventions) |
| P2 implement | FLEXIBLE, per bead | `task ci` green + committed + mutation check recorded |
| P3 self-review | RIGID | self-audit + test-fidelity clean (or fix commits) |
| P4 review | shape-adaptive | falsifiable matrix + verdict |
| P5 close | RIGID | beads closed; human hand-off prepared; STOP |

## Why a fixed sequence?
Same rationale as `structural-pr-review`: a deterministic chain guarantees the same evidence shape every run — decomposition (P0) → pattern-grounding (P1) → mutation-proven code (P2) → the self-review gate that catches what a compiler won't (P3) → structure-aware review (P4). The skills it calls each carry their own discipline; this skill's only job is the sequence and the gates, not re-deriving them.

## Cross-references
`structural-pr-review` (the review-side mirror), `problem-decomposer` / `work-scope` (P0 inputs), `feature-impl` (P1 research), `superpowers/test-driven-development` (P2), `go-standards` / `taskfile-ci-parity` (P2/P3), `self-audit` / `test-fidelity` (P3). Process invariants (foreground commits + explicit staging, no-deferred-work, interactive-not-autonomous, walk-commits-forward) are enforced inside the flexible phases per the author's standing preferences.
