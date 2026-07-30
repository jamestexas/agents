# Park-Work Skill Implementation Plan

> **Revision:** 2026-07-30 final fail-closed correction after whole-branch
> review.

**Goal:** Deliver a portable per-session `park-work` skill that returns
`safe_to_close=true` only after strict durable evidence folds to completed or
parked and the exact receipt is written and read back.

**Architecture:** `SKILL.md` owns orchestration and human-facing boundaries.
`scripts/fold.py` owns typed protocol validation, the deterministic fold,
caller-stable retry planning, repository binding, receipt validation, and the
atomic resume gate. `tests/test_fold.py` exercises those behaviors directly.
Rosary remains the durable authority; no other repository is modified.

**Tech stack:** Markdown, Python 3 standard library, `unittest`, bound Git/jj
commands, Rosary MCP, and existing Bash repository gates.

## Global constraints

- Track work episodes independently from provider sessions.
- Require explicit caller-stable episode/intent IDs before park evaluation.
- Mint a fresh attempt ID for every evaluation retry.
- Require exact unique named checks with fixed categories and structured
  evidence.
- Require an explicit protocol phase: checkpointable preflight or durable.
- Never validate a preflight as receipt-safe.
- Require current-client child evidence independent from Rosary dispatches.
- Derive PR backing only from structured bead PR URL metadata.
- Require exact latest Rosary verify evidence for the declared acceptance
  command and exact read-only provider merge evidence.
- Bind both resume selectors to one registered repository/origin and bind
  every VCS command to its root.
- Fail active resume closed until `rosary-04faf5` supplies an atomic episode
  claim/lease.
- Never close a bead, terminate a provider, delete a worktree, or rewrite user
  changes.
- Preserve unrelated `.beads/` state and do not hand-edit bead projection
  data.
- Keep v1 per-session; bulk discovery, provider termination, Canonical Hours
  projection, and Rosary mechanism implementation remain out of scope.

## Task 1: Capture final-review regressions first

**Files:**

- Modify `skills/park-work/tests/test_fold.py`

Add executable fixtures whose expected values are hand-derived from the design:

- durable completed and parked;
- checkpoint-required completed and parked;
- active dispatch, active/unavailable current-client child, conflict, and
  unpreserved work;
- exact check-name/category/cardinality schema;
- PR-backed conditional checks and malformed exact provider evidence;
- malformed IDs, RFC3339 timestamps, repository, sessions, references, resume
  shapes, target correlation, and outcome correlation;
- process-separated unsafe/success retry identity and duplicate prior success;
- common repository binding for both selector types and contradiction cases;
- missing/drifted resume targets; and
- atomic resume gate order.

Run before production edits:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 skills/park-work/tests/test_fold.py
```

Expected RED: the existing helper lacks the new protocol entry points and
cannot import `bind_repository`, `prepare_attempt`, or `resume_gate`.

## Task 2: Implement the typed helper

**Files:**

- Modify `skills/park-work/scripts/fold.py`

Implement standard-library-only functions and matching CLI commands:

```text
evaluate
validate-receipt
confirm-readback
prepare-attempt
bind-repository
resume-gate
```

### Observation validation

Require exact top-level phase, PR-derived bead metadata, and exact check
objects. Reject missing/duplicate/unknown/mis-categorized/inapplicable checks,
invalid outcomes, malformed evidence, and non-RFC3339 timestamps with
`InputError`/CLI exit 2.

Encode check-specific authoritative evidence:

- Rosary active/dispatch records;
- Codex/Claude current-client child arrays;
- bound Git/jj conflict and operation arrays;
- preflight checkpointable vs. durable preservation references;
- latest Rosary verify observation matching the acceptance command;
- structured Rosary terminal status;
- exact `gh pr view <url> --json state,mergedAt,url` response; and
- exact resume resolver target.

### Fold

- Preflight with checkpointable preservation may return only
  `eligible=false, action=checkpoint`.
- Durable unanimous completion returns completed/write-receipt.
- Durable unanimous mechanical failure plus a resolved target returns
  parked/write-receipt.
- Every other well-formed observation is unsafe.

### Receipt

Require canonical prefixed UUIDs, anchor, provider sessions, absolute
normalized path, VCS enum, branch string, immutable head, references,
successful outcome/safety correlation, and for parked exactly one string resume
target and resolved immutable head matching passing resolver evidence and
`repository.head`. Correlate both durable preservation references with that
head. Accept only durable phase.
Parse exact fenced receipt comments in the helper and require matching
validated bytes; a missing readback or conflicting same-intent receipt remains
unsafe.

### Retry and binding

- Missing stable IDs produce a retry command and no attempt ID.
- Matching prior durable success returns unchanged.
- Otherwise mint a fresh attempt.
- Normalize registered origins, require one match, correlate receipt path/root
  and common-dir remote, and return bound argv-style commands.

### Resume

Return `authorized=false`, allow only read-only inspection, name
`rosary-04faf5`, and block workspace creation, resumed observation, and work in
that order. Truthy comment-dedupe input must not authorize.

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 skills/park-work/tests/test_fold.py
python3 -m py_compile \
  skills/park-work/scripts/fold.py \
  skills/park-work/tests/test_fold.py
```

Expected GREEN: 57 tests, 0 failures; compilation exits 0.

## Task 3: Align the skill workflow

**Files:**

- Modify `skills/park-work/SKILL.md`

Document:

- explicit stable invocation IDs and the stop/retry contract;
- current-client Codex and Claude child adapters;
- exact typed check schema/evidence mapping;
- checkpoint-before-any-receipt for completed and parked;
- durable-phase-only receipt construction/readback;
- exact Rosary verify and provider PR evidence;
- common registered-repository binding and explicit VCS roots;
- read-only resume inspection; and
- the missing atomic claim gate.

Preserve every absolute destructive boundary and v1 scope boundary.

## Task 4: Align design and plan

**Files:**

- Modify
  `docs/superpowers/specs/2026-07-30-work-episode-park-resume-design.md`
- Modify this plan

Replace prior behavior that:

- treated checkpointability as preservation;
- minted unrecoverable retry identity;
- inferred child quiescence from Rosary;
- inferred completion evidence;
- used different resume selector binding; or
- treated comments as single-holder resume safety.

Update fixture totals to the executable 57-test suite. Prose/token tests remain
supplemental and do not substitute for executable behavior.

## Task 5: Required verification

Run fresh:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 skills/park-work/tests/test_fold.py
python3 -m py_compile \
  skills/park-work/scripts/fold.py \
  skills/park-work/tests/test_fold.py
scripts/build.sh readme
scripts/build.sh check
git diff --check
```

Run targeted CLI probes:

1. terminal checkpointable preflight returns `eligible=false` and
   `action=checkpoint`;
2. an invented check/malformed receipt exits 2 and writes nothing.

Verify status contains only the intended skill/helper/tests/design/plan,
README only if generated content changed, the final report, and the
pre-existing unrelated `.beads/beads.jsonl`.

## Task 6: Report and commit

Write
`.superpowers/sdd/2026-07-30-park-work-skill/final-fix-report.md` with:

- exact RED and GREEN commands/output;
- every final-review finding disposition;
- protocol/schema decisions;
- files changed;
- required gates and targeted probes;
- residual concerns; and
- commit SHA.

Stage no `.beads/` data. Commit all final corrections once:

```bash
git -c commit.gpgsign=false commit \
  -m "[agents-dba741] fix(park-work): enforce durable episode protocol"
```
