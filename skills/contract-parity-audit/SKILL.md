---
name: contract-parity-audit
description: >
  Use when one interface/trait has multiple implementations that are assumed
  equivalent (storage backends, providers, transports), when several public
  surfaces (CLI/API/webhook/worker) expose the same verb, when bugs cluster
  as "works on X but not Y", or to scope a guardrail-parity fix before
  estimating it. Read-only behavioral-contract audit producing two matrices;
  narrower and cheaper than a full counterfactual-audit — often its
  follow-up.
disallowed-tools: Edit
---

# Contract-Parity Audit

Two matrices answer one question: **where does a shared contract get
advertised but not delivered?** Matrix A diffs every method of a multi-impl
interface across its implementations. Matrix B maps every public surface
exposing a given operation to the chokepoint it actually reaches. Do not
redesign anything — the deliverable is the enumerated gap set that scopes
the fix.

**Provenance:** distilled from the rosary-46e7ff run (2026-09-02, archive
`~/codebase-audits/agentic-research-rosary/3274bd9/contract-parity/`) that
scoped rosary-44eec8/45504f/457927: the parent audit had sampled 4 methods
and found 2 divergences; the full matrix found **9** — a hit-rate lesson in
why sampling doesn't scope a fix. Sibling of `counterfactual-audit`; shares
its iron rules (durable evidence directory FIRST, OBSERVED/INFERRED tagging,
read-only, fresh-context subagents, thesis withheld).

## Setup

Durable output before any dispatch:
`~/codebase-audits/<org>-<repo>/<commit>/contract-parity/` — one file per
matrix. Resolve the full commit SHA; note whether a parent audit exists and
link it. Findings are banked as issues **after**, never during.

## Matrix A — implementation parity

For EVERY method of the target interface (enumerate from the definition —
no sampling), one row, reading each implementation end-to-end including
delegation chains:

1. Method + production callers ("trait-dispatch only" is an answer).
2. Per-impl location (file:line) + one-line behavior.
3. Validation performed, per impl.
4. Atomicity/concurrency mechanism, per impl (lock-held sequence / single
   statement / transaction / non-atomic multi-step).
5. Sanitization (secret scrubbing etc.), per impl.
6. Event/audit side effects, per impl.
7. Error posture (propagated vs logged-and-continued vs silent), per impl.
8. Idempotency / retry safety, per impl.
9. Deliberate-bypass semantics (escape hatches are design, not gaps —
   verify against the incident they exist for before "fixing" them).
10. Tests per impl (name them, or NONE).
11. The punchline: observable semantic difference.

Classify each method as exactly one of:

| Class | Meaning |
|---|---|
| IDENTICAL | No meaningful difference (expect many; still record) |
| REQUIRED DIFFERENCE | Justified by the impl's failure/concurrency model |
| EQUIVALENT GUARANTEE, DIFFERENT MECHANISM | e.g. mutex vs transaction |
| CONTRACT VIOLATION | One impl silently delivers weaker semantics — **the gap set** |
| UNDECIDED POLICY | A decision was contemplated and never recorded |

UNTESTED may co-occur with any class; list those methods separately.
**Never assume identical implementations are required** — the hunt is for
silently weaker semantics, not for textual sameness.

## Matrix B — surface chokepoints

Enumerate every externally reachable surface that performs the operations
under audit (CLI verbs, RPC/MCP tools, HTTP routes, webhooks, IPC, worker
loops, internal sweeps). Per surface-operation row: entrypoint (file:line);
parsing/validation; the application function reached (or "direct store
call"); lifecycle/policy gates applied; verification performed; persistence
ops; retry/idempotency; result reported to the caller **and whether failure
can be mis-reported**; tests.

Then group by OPERATION and state, per group, whether all surfaces share
one chokepoint — naming every bypass with file:line, and whether each
bypass is sanctioned (its own gate + suppression annotation + explanatory
comment) or a defect.

## Calibrations (each earned in the reference run)

- **Verify consumer liveness before classifying severity.** The reference
  run's parent audit called a lossy mapping "live on every sync pass";
  tracing its consumer chain found zero production callers — the live path
  used a different, correct mapping. Wrong liveness = wrong priority.
- **Enumerate, don't sample.** 2 divergences in 4 sampled methods became 9
  in 34. A sampled matrix cannot scope a fix.
- **Spot-verify before building on a row.** The lead re-read source for 6
  matrix claims before any implementation started; all held — but the
  skeptic's later "no open issue references X" claim failed because it
  searched the repo tree and not the issue tracker. Search both.
- **Grep discipline:** unqualified/local call forms (`use super::*` callers
  of a bare `fn`), and both directions (who calls this / what does this
  call).
- **Fixture blind spots are findings.** The reference run's handler tests
  silently exercised an empty pool for years (a test constructor seeded one
  map but not the one the handler read) — "tests exist" rows deserve one
  check that the test can fail.
- **Fix framing for the gap set:** same policy, per-impl-appropriate
  mechanism — copying one impl's lock pattern onto another's connection
  pool is a race that claims the guarantee without delivering it. Never
  prescribe a shared wrapper across impls with different concurrency
  models.

## Deliverable and follow-through

End each matrix file with: (a) the CONTRACT VIOLATION gap set as a numbered
list; (b) the UNTESTED list; (c) limitations. Bank the gap set as a comment
on the fix-owning issue — acceptance criteria must carry the mechanism
constraints and every deliberate-bypass carve-out (with its incident id),
so the fix cannot "close the gap" by breaking the escape hatch. Route
findings that belong to other issues explicitly; file new issues for
unowned ones after the audit, dedup-checked.

## Common mistakes

| Mistake | Consequence seen |
|---|---|
| Sampling methods instead of enumerating | Fix scoped at 2 gaps; 7 more found later |
| Classifying by doc or comment | The "live" defect was in dead code |
| Prescribing one wrapper for all impls | A lock pattern over a pool = race dressed as a fix |
| Treating escape hatches as gaps | Would reintroduce the incident they were built for |
| Trusting "tests exist" | The tests ran against an empty fixture |
| Findings only in chat | Bank to the durable dir + issue comments, or they evaporate |
