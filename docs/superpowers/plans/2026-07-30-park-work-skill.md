# Park-Work Skill Implementation Plan

> **Revision:** 2026-07-30 third final fail-closed correction after live
> Rosary-contract review.

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
- Keep completion unavailable until `rosary-a6166d` supplies command-bound,
  authoritatively ordered verify history; never synthesize missing history
  fields.
- Permit parking from a mechanically nonterminal Rosary status with unknown
  close history, exact known PR applicability, and a passing resume resolver.
- Bind both resume selectors to one registered repository/origin and bind
  every VCS command to its root.
- Correlate successful receipt anchor, repository binding, backend, root,
  workspace, and immutable head.
- Inspect all same-intent successes, reject semantic conflicts independent of
  order—including exact acceptance/PR contracts—and preserve exact duplicate
  source bytes/comment IDs.
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

- terminal completed-gate blocking and durable parked;
- checkpoint-required parked and blocked terminal preflight;
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
- typed unavailable close-condition evidence without synthetic command/kind/
  sequence/latest/authoritative/complete facts;
- structured Rosary terminal status;
- exact `gh pr view <url> --json state,mergedAt,url` response; and
- exact resume resolver target.

### Fold

- Preflight with checkpointable preservation may return only
  `eligible=false, action=checkpoint`.
- Terminal `done|closed` remains unsafe because completion cannot be proven
  without `rosary-a6166d`.
- Durable `open|in_progress|blocked` plus known applicable PR evidence and a
  resolved target returns parked/write-receipt despite unknown close history.
- Every other well-formed observation is unsafe.

### Receipt

Require canonical prefixed UUIDs, anchor, provider sessions, absolute
normalized path, VCS enum, branch string, immutable head, references,
successful outcome/safety correlation, and for parked exactly one string resume
target and resolved immutable head matching passing resolver evidence and
`repository.head`. Correlate the confirmed anchor, complete validated
repository binding, VCS source/backend, both preservation workspaces, and
parked resolver with the receipt repository and head. Accept only durable
phase.
Parse exact fenced receipt comments in the helper and require matching
validated bytes; a missing readback or conflicting same-intent receipt remains
unsafe.

### Retry and binding

- Missing stable IDs produce a retry command and no attempt ID.
- Inspect every matching prior durable success; reject semantic conflicts
  independent of input order, including the exact bead object and derived
  `pr_backed` contract, and return only semantically identical duplicates with
  their exact source bytes/comment IDs.
- Otherwise mint a fresh attempt.
- Normalize registered origins without collapsing nondefault ports, require
  one match, correlate full receipt/selector/path/backend identity, validate
  exact root/Git-dir/common-dir/remote command observations, and return bound
  argv-style commands.

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

Expected GREEN: 79 tests, 0 failures; compilation exits 0.

## Task 3: Align the skill workflow

**Files:**

- Modify `skills/park-work/SKILL.md`

Document:

- explicit stable invocation IDs and the stop/retry contract;
- current-client Codex and Claude child adapters;
- exact typed check schema/evidence mapping;
- checkpoint-before-any-receipt for an eligible nonterminal parked candidate;
- durable-phase-only receipt construction/readback;
- unavailable Rosary completion gating, nonterminal parking, and exact provider
  PR evidence;
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

Update fixture totals to the executable 79-test suite. Prose/token tests remain
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
2. uncorrelated receipt anchor/repository/backend/workspace evidence exits 2;
3. conflicting prior successes fail closed in both input orders while exact
   duplicate sources are preserved;
4. different remote ports, selector mismatch, and false Git common-dir
   relationships exit 2; and
5. no synthetic Rosary history fields are accepted; `open|in_progress|blocked`
   park, while `done|closed` remain unsafe without `rosary-a6166d`.

Verify status contains only the intended skill/helper/tests/design/plan,
README only if generated content changed, the final report, and the
pre-existing unrelated `.beads/beads.jsonl`.

## Task 6: Report and commit

Write
`.superpowers/sdd/2026-07-30-park-work-skill/final-fix-3-report.md` with:

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
  -m "[agents-dba741] fix(park-work): gate completion on authoritative history"
```
