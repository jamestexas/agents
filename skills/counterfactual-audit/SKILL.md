---
name: counterfactual-audit
description: >
  Use when asked whether a repo's architecture is still right — a
  counterfactual "how would this be designed today?" question, a suspicion of
  over/under-engineering or monolith-vs-split, recurring bug families that
  smell structural, or before committing to a major refactor. Read-only,
  evidence-first, multi-pass; "the current design is largely right" is a valid
  verdict. Works on any language/repo.
---

# Counterfactual Architecture Audit

Six isolated evidence passes answer one question: **given the capabilities and
constraints genuinely required today, how would this system be designed now,
and how does that differ from the current design?** The audit does not
validate a thesis — the requester's suspicion ("too broad", "needs a split")
is deliberately withheld from every pass, and a correct outcome may be that
the present design is right.

**Provenance:** distilled from a full run against `rosary` @ 52b3db7
(2026-08-31, archive `~/codebase-audits/agentic-research-rosary/52b3db7/`) and
an external meta-review of that run. Every rule below that looks paranoid
exists because the naive version failed in that run.

## Iron rules

1. **Durable evidence directory FIRST, before any pass is dispatched.**
   `~/codebase-audits/<org>-<repo>/<commit>/` with `manifest.json`, numbered
   pass files, and `commands/` for raw tool output. Session scratchpads get
   garbage-collected — in the reference run, all six packs were destroyed by
   tmp GC *mid-session* and survived only because they had been read into
   context. Passes write here directly.
2. **Read-only.** No tracked-file edits, no issue/bead creation, no tool
   installs, no dependency changes *during* the audit. Findings are banked as
   issues **after** the final report (see Post-audit).
3. **Every material statement is tagged** `OBSERVED` (code, tests, command
   output, history), `INFERRED` (best explanation of observations), or
   `PROPOSED` (a design choice — passes 5–6 only).
4. **Every major conclusion needs 2+ independent evidence classes, one
   code-level.** Documentation never confirms itself. A prior session's
   memory note is a weaker class — label it and have a pass re-verify it in
   code before any recommendation leans on it.
5. **LOC and file size are sampling signals, never conclusions.**
6. **Passes 1–3 are doc-blind**: no README, docs/, ADRs, design notes,
   roadmaps, or glossary. They may read build/CI config needed to operate.
   Doc-blindness is what makes pass 4's doc-vs-code reconciliation evidence
   rather than circularity.

## Topology

Dispatch each pass as an **isolated, fresh-context subagent** with a
self-contained brief — never a fork/context-inheriting agent, which would
carry the requester's withheld thesis (and this conversation) into the pass.
Never ask several agents to "review the architecture" — each pass has a
non-overlapping evidence job. Resolve the full commit SHA up front; it names
the evidence directory and pins every citation.

| # | Pass | Runs | Reads |
|---|------|------|-------|
| 1 | Code cartographer | parallel, doc-blind | code, manifests, CI |
| 2 | Workflow + failure tracer | parallel, doc-blind | code, tests |
| 3 | Authority + invariant auditor | parallel, doc-blind | code, tests |
| 4 | Historian + doc reconciler | after 1–3 | packs 1–3 → git history → docs |
| 5 | Counterfactual synthesizer | after 4 | all packs + spot-checks |
| 6 | Architecture skeptic | after 5, fresh context | proposal + packs + primary source |

Each brief must state: the iron rules, the output file path in the durable
directory, and that the pack must be self-contained (later passes see only
the file, not the conversation).

## Pass briefs (adapt per repo/language)

**1 — Code cartographer.** Inventory packages/modules, executable
entrypoints, generated code, schemas, migrations, tests, deployment
artifacts. Enumerate every externally reachable surface (CLI verbs, RPC/MCP
tools, HTTP routes, webhooks, IPC, background loops) with file:line. Trace
every durable store/external system to its connection call site. Separate
counts for code/tests/docs. Largest files + fan-in/out as sampling targets.
Build an **emergent dependency diagram from actual imports/call edges** —
never from a documented diagram. Flag every verb exposed by 2+ public
surfaces for pass 2. Use the language's own graph tools (`cargo metadata` +
`cargo tree`, `go mod graph`, `npm ls`, …) and structural-index tooling
(mache) when available.

**2 — Workflow + failure tracer.** Pick 3–6 workflows from *actual* public
behavior and trace each: entrypoint → parsing/validation → policy → domain op
→ state write/external effect → result projection — then separately error,
retry, timeout, rollback, replay, and recovery. Name symbols, line ranges,
and the tests exercising each path (or their absence). Where two surfaces
share a verb, determine precisely whether they converge on one function or
duplicate logic. **Grep discipline:** search unqualified/local call forms
too — in the reference run a `module::fn` pattern missed tests calling `fn`
bare via `use super::*`, producing a false "zero coverage" claim.

**3 — Authority + invariant auditor.** Per important entity/state machine:
canonical authority (cite the read/write code, not a comment), every
writer/reader, allowed transitions and *where enforced*, transaction
boundary, projections/caches and their drift rules, precedence when
representations disagree, crash/replay/recovery semantics. Hunt named defect
patterns: multiple writable representations of one fact; silent defaults;
duplicated transition logic across surfaces or backends; validate-then-forget;
stringly-typed closed domains; dead optionality; declared APIs with no
production callers. Build a concept ledger (term → meaning → type →
dependents → synonyms → does distinct behavior justify it). Multi-impl
traits/interfaces deserve a method-by-method parity sample — two divergences
in four sampled methods was the reference run's highest-value finding.

**4 — Historian + doc reconciler.** Read packs 1–3, then git history on
flagged areas (why boundaries arose, change coupling, whether remediations
reached all backends), then — only now — the documentation. Classify every
consequential doc claim: confirmed / partial / aspirational / stale /
contradicted / historical-only / still-required-compatibility, each justified
by pack or history evidence. **Independently re-run every documented
measurement** (counts, orders, "X is live") rather than trusting either the
doc or a prior pack.

**5 — Counterfactual synthesizer.** Read all packs; independently re-read
cited source for ~10 of the most load-bearing claims before designing on
them. Restate the system's jobs in plain language, no project vocabulary.
Separate genuinely non-negotiable capabilities from assumed/aspirational
ones, with evidence per row. Evaluate each candidate boundary both ways
(cohesive responsibility? distinct authoritative data? one-directional deps?
independent failure/recovery? distinct security/scale/deploy lifecycle? what
transactions cross?). Produce **2+ materially different designs including a
conservative one preserving the current runtime topology** — never default to
microservices, more packages, or a rewrite. Current-to-target table (one of
KEEP / MERGE / MOVE BEHIND BOUNDARY / MAKE OPTIONAL / DELETE / DEFER per
area, each with evidence). Reversible migration sequence: every slice
preserves observable behavior, has a success condition and rollback point.
State explicitly whether the greenfield ideal and safest reachable target
differ and why.

**6 — Architecture skeptic.** Fresh context that did not author the
proposal. Build the strongest evidence-based case that the *current*
architecture is right where the proposal wants change. For each proposed
change, name the most likely real invariant, transaction, recovery path, or
compatibility requirement it breaks if implemented carelessly — checked
against actual code, not hypothetically. Independently re-read primary
source for 4+ recommendation-critical claims; flag any conclusion exceeding
its evidence (memory-note citations especially). "The recommendation
survives" is a valid result. In the reference run this pass caught a fix
that would have reintroduced a named production incident, and re-graded a
defect's severity on the default backend — budget for it.

## Judgment calibrations (each earned by a reference-run failure)

- **Zero callers ⇒ deletion *candidate*, not deletion.** DELETE only when:
  no production callers **and** no external API commitment **and** no
  current migration/feature consuming it **and** history shows no
  paused-but-still-owned initiative (check the issue tracker, not just the
  repo tree). Otherwise DEFER / ARCHIVE-CANDIDATE.
- **Risk-tier per slice, never uniformly.** "Low risk" claimed for a whole
  plan hid a call-site swap that was actually a visibility-and-state
  redesign, and a "move the check" that was actually a concurrency design.
- **A moved/renamed body is new surface to every ratchet.** Baselined
  complexity re-homed under a new name re-triggers gates; plan for it.
- **Same-named guarantees across backends are claims, not facts** — the
  reference run's core finding was one trait, two impls, disjoint guardrail
  subsets, zero parity tests.

## Final report

Deliver in one message: verdict + confidence (split "restructure?" from
"specific defects" from "fix implementation"); plain-language system
description; measured shape + emergent diagram; workflow traces; authority
map; boundary findings *including evidence for keeping things together*;
essential-vs-accident; candidate designs; recommendation; action table;
migration sequence; contrary evidence + falsifiers per major conclusion; doc
reconciliation appendix. Close with four reflection answers: Would the
recommendation survive the opposite framing? Strongest case for no change?
Which recommendation rests on the weakest evidence? What single additional
trace most reduces uncertainty? Publish as an artifact; update
`manifest.json` with the verdict and pass roster.

## Post-audit (after the report, outside the read-only boundary)

Dedup-check the tracker, then bank each finding as an issue/bead whose
**acceptance criteria carry the skeptic's implementation caveats** — the
escape-hatch carve-outs and mechanism constraints are worthless in a chat
transcript. Cross-reference conflicting open issues explicitly instead of
silently contradicting them. Note in the manifest which issues were filed.

## Common mistakes

| Mistake | Consequence seen |
|---|---|
| Evidence packs in session tmp | All six destroyed by GC mid-session |
| Trusting a pass's grep as exhaustive | "Zero coverage" claim false — unqualified calls missed |
| Skipping the skeptic to save tokens | Would have shipped a fix reintroducing a named incident |
| Treating docs as evidence | The only actively-false claims lived in verification-trail-free prose |
| One uniform risk estimate | Two slices were design decisions disguised as call swaps |
| Auditing the thesis you were handed | Withhold it from every brief; the answer may be "design is right" |
