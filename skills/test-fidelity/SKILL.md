---
name: test-fidelity
description: >
  Hunt vacuous / low-fidelity tests — the ones that pass whether or not the code
  is wrong in the way they claim to catch. Probes four shapes: a double that
  dodges the real thing, an assertion too loose to constrain behavior, inputs
  that never reach the claim, and coverage that is claimed but not guaranteed.
  Uses mache/modmap for value-origin and branch-reachability evidence and
  dispatches an adversarial agent for judgment. Use on a test-bearing PR or diff
  before review, or when a suite "passes" but you don't trust it.
allowed-tools: "Bash,Read,Grep,Glob,Agent"
argument-hint: "[PR number | diff | path; defaults to the current branch's diff vs main]"
---

# test-fidelity — catch tests that pass whether or not the code is right

The spine, one question:

> **Would this test still fail if the code were wrong in the way it is supposed to catch?**

If the answer is no, the test is theatre: it does not merely miss the bug, it
**certifies the buggy path as correct**, and the comment asserting fidelity makes
the next reader trust it. If your project keeps a test-double doctrine doc — a
catalog of tests that lied and the mitigations that closed them — read it once as
the local ground truth; the hunting catalog below is the portable version of it.

This skill audits whether **tests constrain the code**. It is not a bug hunt on
the code, not a coverage-percentage report, and not a style pass — other skills
and agents cover those. A line executed is not a line verified.

## When to use

- A test-bearing PR before you review or approve it (yours or a peer's).
- After an agent (including a sub-agent) wrote tests — self-reports about test
  quality are not trustworthy; verify.
- When a suite is green but you suspect it is green for the wrong reason.

## The hunting catalog — the shapes to investigate

Hunt *shapes of behavior*, not specific names. Each entry is **what they were
doing** + the probe.

### Class A — the harness dodges the real thing
- *Drove a stand-in that claims to mirror the real implementation, and nothing
  checks the claim.* → Contract-test the double against the real one through one
  shared operation table; it must fail at the moment of divergence.
- *Tested a branch production does not take* (a fast/slow-path twin, a config or
  code path that never runs live). → Assert the two paths agree, or test the one
  that actually carries traffic.
- *The asserted value is laundered* — it originates in a constant, fixture, or
  mock, not the code under test. → Trace the value's origin; the assertion must
  fail if the real computation is wrong.

### Class B — the assertion is too loose to constrain behavior
- *Asserted an emergent effect* ("it retried", "it errored", "count == 1") that
  stays true for multiple distinct causes, or even if the code were miswired. →
  Does the assertion pin the *specific mechanism*, given how many inputs the
  consumer accepts? (An acceptor with N members can't be pinned by "something
  accepted happened".)
- *Asserted a call happened or a shape was right, not that the state changed.* →
  Assert the observable consequence, not the invocation.
- *Asserted something about the test's own scaffolding* (a fake does or doesn't
  implement X). → Does the assertion say anything about production?

### Class C — the inputs never reach what is claimed
- *The fixture set up a state that cannot occur* — a precondition the real caller
  guarantees false. → Does this input actually reach the code, past the real
  guards?
- *The generator or sample never spans the boundary the property is about*
  (cannot emit the input that would exercise the gate). → Does the input range
  cross the seam?
- *A threshold was tested away from its edge* (N and 2N, never N-1 vs N). → Put
  an input on the boundary the code branches on.

### Class D — coverage is claimed but not guaranteed
- *Steered into a branch by racing timers or sleeps* instead of a deterministic
  trigger; under load it can take a different path that still passes, or flakes.
  → Is the branch reached deterministically? Prefer a sync primitive or injected
  clock over relative durations.
- *"Ran it twice and it didn't break" stood in for idempotence* — one sequence
  quantified as all. → A property, or at least the adversarial sequence.
- *A line is covered but no assertion reads what it produced* — executed is not
  verified. → Is there an assertion downstream of the covered line?

The four classes are one question pointed at four places: A — wrong because a
double lied; B — wrong but the assertion is too loose to notice; C — wrong on an
input the test never reaches; D — wrong on a path the test only *thinks* it
covers.

## Procedure

### 1. Scope and enumerate
Resolve the target (PR / diff / path; default the current branch vs `main`). List
the tests and test doubles in scope. For each, note the one behavior it claims to
verify — that claim is what you audit.

### 2. Per test, the three-layer probe

**Doctrine pass** — walk the catalog above against the test. Most tests trip zero
entries; that is the expected result and a valid verdict.

**Evidence pass** — make the suspicion mechanical with structural tooling
(detect what is available; degrade gracefully if none):

- **mache** (`find_definition` / `find_callers` / `get_impact`): does the
  producer of the asserted value trace to the code under test, or to a
  fixture/mock? Is the tested branch the one production's callers actually reach,
  or an off-path twin? (Class A.)
- **modmap** (`impact` / `dispatch`): dataflow origin-vs-render — does the value
  originate where the test implies, or is it laundered upstream? Does the tested
  path carry real reach? (Class A, laundered-value probe.)
- **coverage**: run the suite with coverage for the module under test. For each
  branch a test *claims* to exercise, confirm it is executed — and
  **deterministically**, not via a timing race (re-run under load, or read the
  test for relative-duration steering). Then confirm an assertion reads the
  value the covered line produced. Executed ≠ verified. (Class D.)
- **generator / boundary**: confirm the inputs span the seam the code branches on
  (Class C).

Per-stack evidence commands live in an optional extensions file (see below); the
Go default is `go test -coverpkg=<pkg-under-test> -coverprofile=... ./...` then
parse the profile for the specific claimed lines.

**Judgment pass** — for the property-vs-example, totality, and distinguishability
calls (Class B, and Class C's quantifier gap), dispatch **type-driven-correctness**
(its defect class 2 is exactly this: examples where a universally-quantified
property belongs, and "a generator that never produces the interesting input is
theatre"). For emitter-vs-origin value-legitimacy, **dataflow-driven-troubleshooting**
is the specialist. Otherwise reason the spine question directly.

### 3. Output
Findings grouped by class, each: **what they were doing** (the shape), the probe
that surfaced it, the mechanical evidence (mache/modmap/coverage output), and the
cheapest fix (contract-test the double, pin the specific mechanism, move the input
onto the seam, make the branch deterministic). Severity:

- **BLOCKER** — a test that would pass with the code wrong on the exact thing it
  exists to catch (a lying double, an unreachable tested branch, a laundered
  assertion).
- **COMMENT** — a reachable, cheap strengthening (a boundary sampled not pinned,
  a mechanism under-distinguished, a timing-dependent branch).
- **NOTE** — an argued, disclosed weakening recorded for the author.

Always end with **what's already at the right rung** — the contract-tested
doubles, the properties, the deterministic branches. A review that only flags is
miscalibrated.

## Calibration

The failure mode is zealotry: flagging solid tests, demanding a property for
every example, treating terseness as a defect. That trains the author to ignore
you. The opposite failure is accepting "it's tested" when the test would pass
with the code wrong. Hold the line at the spine question. **"These tests hold" is
a valid, respectable verdict** — reaching it *with evidence* (the double is
contract-tested, the branch is deterministically covered, the assertion pins the
mechanism) is the point, not the finding count.

## Project-specific extensions (optional)

If `~/.claude/skills/test-fidelity/extensions.md` exists, read it during the
Evidence pass. It layers per-stack coverage commands, repo-specific double
registries, and known-good contract-test templates on top of the generic
procedure. Absent it, the Evidence pass is the generic version and degrades
gracefully.

## Cross-references
- **Doctrine:** a project's own test-double taxonomy, if it keeps one. The
  portable mitigations: contract-test the double against the real thing through
  one shared table; pin that a fast path and a slow path agree; prefer a
  reflection-driven invariant to a hand-listed one.
- **Judgment agent:** `type-driven-correctness` (quantifier gap, totality,
  distinguishability).
- **Dataflow agent:** `dataflow-driven-troubleshooting` (emitter vs origin).
- **Structural tooling:** `mache-usage` skill; `modmap` (impact/dispatch).
