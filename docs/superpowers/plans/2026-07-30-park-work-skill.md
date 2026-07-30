# Park-Work Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portable `park-work` skill that mechanically classifies a work episode as completed, parked, or unsafe and returns `safe_to_close=true` only after a durable receipt is read back.

**Architecture:** The skill owns orchestration and human-facing workflow; a small Python helper owns the deterministic fold and receipt-shape validation. Rosary remains the durable authority through current MCP calls and an anchor-bead comment fallback. Provider termination, bulk session discovery, board projection, scheduled waiting, and new cross-repository runtime code remain outside this implementation.

**Tech Stack:** Markdown skill package, Python 3 standard library, `unittest`, Git/jj command evidence, Rosary MCP tools, existing Bash repository gates.

## Global Constraints

- Track a logical work episode; provider-native sessions are references, not the durable identity.
- Every required check returns exactly `pass`, `fail`, or `unknown`; required `unknown` fails closed.
- Model-authored summaries and next-action prose never participate in the safety fold.
- `completed` requires terminal, quiescent, preserved work; `parked` requires explicitly nonterminal, quiescent, preserved, resumable work.
- Never close a bead, terminate a provider session, delete a worktree, rewrite user changes, or silently mint/choose an anchor bead.
- A receipt must be written and read back before the skill returns `safe_to_close=true`.
- A stable park intent may have several evaluation attempts, but retries must return an existing successful receipt when one is already present.
- v1 is per-session. Bulk discovery and provider-specific termination are out of scope.
- No new runtime dependency; Python code uses only the standard library.
- Preserve unrelated working-tree and `.beads/` changes.

---

### Task 1: Deterministic Safety Fold and Receipt Validator

**Files:**
- Create: `skills/park-work/scripts/fold.py`
- Create: `skills/park-work/tests/test_fold.py`

**Interfaces:**
- Consumes: JSON object `{ "schema_version": 1, "checks": Check[] }`, where `Check` has `name`, `category`, `outcome`, `evidence`, and `observed_at`.
- Produces: `evaluate(document) -> {"candidate": "completed" | "parked" | null, "eligible": bool, "reasons": str[]}`.
- Produces: `validate_receipt(receipt) -> None`, raising `InputError` on malformed or internally inconsistent receipts.
- Produces CLI: `python3 fold.py evaluate` and `python3 fold.py validate-receipt`, both reading JSON from stdin and emitting one JSON object to stdout.

- [ ] **Step 1: Write failing fold tests**

Create `skills/park-work/tests/test_fold.py` with imports resolved from the
sibling `scripts` directory and fixtures covering the exact three-way fold:

```python
#!/usr/bin/env python3
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from fold import InputError, evaluate, validate_receipt  # noqa: E402


def check(name, category, outcome):
    return {
        "name": name,
        "category": category,
        "outcome": outcome,
        "evidence": f"{name}:{outcome}",
        "observed_at": "2026-07-30T18:00:00Z",
    }


def base_checks():
    return [
        check("anchor_confirmed", "identity", "pass"),
        check("repo_resolved", "identity", "pass"),
        check("no_active_dispatch", "quiescence", "pass"),
        check("no_vcs_operation", "quiescence", "pass"),
        check("tree_preserved", "preservation", "pass"),
    ]


class FoldTests(unittest.TestCase):
    def test_completed_requires_unanimous_completion_evidence(self):
        document = {
            "schema_version": 1,
            "checks": base_checks()
            + [
                check("close_condition", "completion", "pass"),
                check("pr_merged", "completion", "pass"),
            ],
        }
        self.assertEqual(
            evaluate(document),
            {"candidate": "completed", "eligible": True, "reasons": []},
        )

    def test_parked_requires_explicitly_nonterminal_and_resumable(self):
        document = {
            "schema_version": 1,
            "checks": base_checks()
            + [
                check("close_condition", "completion", "fail"),
                check("resume_target", "resume", "pass"),
            ],
        }
        self.assertEqual(
            evaluate(document),
            {"candidate": "parked", "eligible": True, "reasons": []},
        )

    def test_unknown_required_evidence_fails_closed(self):
        checks = base_checks()
        checks[2] = check("no_active_dispatch", "quiescence", "unknown")
        result = evaluate({"schema_version": 1, "checks": checks})
        self.assertFalse(result["eligible"])
        self.assertIsNone(result["candidate"])
        self.assertIn("no_active_dispatch=unknown", result["reasons"])

    def test_mixed_completion_evidence_is_unsafe(self):
        document = {
            "schema_version": 1,
            "checks": base_checks()
            + [
                check("close_condition", "completion", "pass"),
                check("pr_merged", "completion", "fail"),
                check("resume_target", "resume", "pass"),
            ],
        }
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertIn("completion evidence conflicts or is unknown", result["reasons"])

    def test_missing_required_category_is_unsafe(self):
        checks = [c for c in base_checks() if c["category"] != "preservation"]
        checks.append(check("close_condition", "completion", "pass"))
        result = evaluate({"schema_version": 1, "checks": checks})
        self.assertFalse(result["eligible"])
        self.assertIn("missing required preservation evidence", result["reasons"])

    def test_nonterminal_without_resume_evidence_is_unsafe(self):
        document = {
            "schema_version": 1,
            "checks": base_checks()
            + [check("close_condition", "completion", "fail")],
        }
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertIn("missing required resume evidence", result["reasons"])


class ReceiptTests(unittest.TestCase):
    def valid_receipt(self):
        return {
            "schema_version": 1,
            "episode_id": "ep-11111111",
            "intent_id": "park-22222222",
            "attempt_id": "attempt-33333333",
            "anchor_bead": "agents-dba741",
            "repository": {
                "path": "/tmp/example",
                "vcs": "git",
                "branch": "main",
                "head": "abc123",
            },
            "checks": base_checks()
            + [check("close_condition", "completion", "fail")]
            + [check("resume_target", "resume", "pass")],
            "outcome": "parked",
            "safe_to_close": True,
            "resume": {
                "checkpoint": "change-id",
                "next_action": "Continue the implementation bead.",
            },
            "references": [],
        }

    def test_valid_receipt(self):
        validate_receipt(self.valid_receipt())

    def test_safe_unsafe_receipt_is_rejected(self):
        receipt = self.valid_receipt()
        receipt["outcome"] = "unsafe"
        with self.assertRaisesRegex(InputError, "unsafe receipt cannot be safe_to_close"):
            validate_receipt(receipt)

    def test_parked_receipt_requires_resume_target(self):
        receipt = self.valid_receipt()
        receipt["resume"] = {}
        with self.assertRaisesRegex(InputError, "parked receipt requires"):
            validate_receipt(receipt)

    def test_successful_receipt_must_set_safe_to_close(self):
        receipt = self.valid_receipt()
        receipt["safe_to_close"] = False
        with self.assertRaisesRegex(InputError, "successful receipt must"):
            validate_receipt(receipt)

    def test_claimed_outcome_must_match_deterministic_fold(self):
        receipt = self.valid_receipt()
        receipt["outcome"] = "completed"
        with self.assertRaisesRegex(InputError, "does not match deterministic fold"):
            validate_receipt(receipt)

    def test_cli_reads_stdin_and_emits_json(self):
        payload = {
            "schema_version": 1,
            "checks": base_checks()
            + [check("close_condition", "completion", "pass")],
        }
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "fold.py"), "evaluate"],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout)["candidate"], "completed")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run:

```bash
python3 skills/park-work/tests/test_fold.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'fold'`.

- [ ] **Step 3: Implement the pure fold and validator**

Create `skills/park-work/scripts/fold.py`:

```python
#!/usr/bin/env python3
import json
import sys


OUTCOMES = {"pass", "fail", "unknown"}
BASE_CATEGORIES = ("identity", "quiescence", "preservation")


class InputError(ValueError):
    pass


def _checks(document):
    if document.get("schema_version") != 1:
        raise InputError("schema_version must be 1")
    checks = document.get("checks")
    if not isinstance(checks, list):
        raise InputError("checks must be an array")
    for index, item in enumerate(checks):
        if not isinstance(item, dict):
            raise InputError(f"checks[{index}] must be an object")
        for field in ("name", "category", "outcome", "evidence", "observed_at"):
            if not isinstance(item.get(field), str) or not item[field]:
                raise InputError(f"checks[{index}].{field} must be a non-empty string")
        if item["outcome"] not in OUTCOMES:
            raise InputError(f"checks[{index}].outcome is invalid")
    return checks


def _category(checks, name):
    return [item for item in checks if item["category"] == name]


def evaluate(document):
    checks = _checks(document)
    reasons = []

    for category in BASE_CATEGORIES:
        items = _category(checks, category)
        if not items:
            reasons.append(f"missing required {category} evidence")
            continue
        reasons.extend(
            f"{item['name']}={item['outcome']}"
            for item in items
            if item["outcome"] != "pass"
        )

    if reasons:
        return {"candidate": None, "eligible": False, "reasons": reasons}

    completion = _category(checks, "completion")
    if not completion:
        return {
            "candidate": None,
            "eligible": False,
            "reasons": ["missing required completion evidence"],
        }

    completion_outcomes = {item["outcome"] for item in completion}
    if completion_outcomes == {"pass"}:
        return {"candidate": "completed", "eligible": True, "reasons": []}
    if completion_outcomes != {"fail"}:
        return {
            "candidate": None,
            "eligible": False,
            "reasons": ["completion evidence conflicts or is unknown"],
        }

    resume = _category(checks, "resume")
    if not resume:
        return {
            "candidate": None,
            "eligible": False,
            "reasons": ["missing required resume evidence"],
        }
    resume_failures = [
        f"{item['name']}={item['outcome']}"
        for item in resume
        if item["outcome"] != "pass"
    ]
    if resume_failures:
        return {"candidate": None, "eligible": False, "reasons": resume_failures}
    return {"candidate": "parked", "eligible": True, "reasons": []}


def validate_receipt(receipt):
    _checks(receipt)
    for field in ("episode_id", "intent_id", "attempt_id", "anchor_bead"):
        if not isinstance(receipt.get(field), str) or not receipt[field]:
            raise InputError(f"{field} must be a non-empty string")
    repository = receipt.get("repository")
    if not isinstance(repository, dict):
        raise InputError("repository must be an object")
    for field in ("path", "vcs", "branch", "head"):
        if not isinstance(repository.get(field), str):
            raise InputError(f"repository.{field} must be a string")
    outcome = receipt.get("outcome")
    if outcome not in {"completed", "parked", "unsafe"}:
        raise InputError("outcome is invalid")
    if not isinstance(receipt.get("safe_to_close"), bool):
        raise InputError("safe_to_close must be boolean")
    if outcome == "unsafe" and receipt["safe_to_close"]:
        raise InputError("unsafe receipt cannot be safe_to_close")
    if outcome in {"completed", "parked"} and not receipt["safe_to_close"]:
        raise InputError("successful receipt must set safe_to_close")
    decision = evaluate(receipt)
    if outcome in {"completed", "parked"} and (
        not decision["eligible"] or decision["candidate"] != outcome
    ):
        raise InputError("receipt outcome does not match deterministic fold")
    if outcome == "parked":
        resume = receipt.get("resume")
        if not isinstance(resume, dict) or not (
            resume.get("checkpoint") or resume.get("branch")
        ) or not resume.get("next_action"):
            raise InputError(
                "parked receipt requires a checkpoint or branch and next_action"
            )


def main(argv):
    if len(argv) != 2 or argv[1] not in {"evaluate", "validate-receipt"}:
        raise InputError("usage: fold.py evaluate|validate-receipt")
    document = json.load(sys.stdin)
    if argv[1] == "evaluate":
        result = evaluate(document)
    else:
        validate_receipt(document)
        result = {"valid": True}
    json.dump(result, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main(sys.argv)
    except (InputError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
python3 skills/park-work/tests/test_fold.py
```

Expected: 12 tests pass.

- [ ] **Step 5: Run syntax and formatting checks**

Run:

```bash
python3 -m py_compile skills/park-work/scripts/fold.py skills/park-work/tests/test_fold.py
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the deterministic core**

```bash
git add skills/park-work/scripts/fold.py skills/park-work/tests/test_fold.py
git commit -m "[agents-dba741] feat(park-work): add deterministic safety fold"
```

### Task 2: Check and Park Workflow

**Files:**
- Create: `skills/park-work/SKILL.md`
- Modify: `skills/park-work/tests/test_fold.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: `fold.py evaluate` and `fold.py validate-receipt` from Task 1.
- Consumes Rosary MCP: `rsry_active`, `rsry_dispatch_history`, `rsry_bead_history`, `rsry_list_beads`, `rsry_expand_ref`, `rsry_bead_comment`, `rsry_agent_session_addresses`, `rsry_agent_session_message_record`, and `rsry_workspace_checkpoint`.
- Produces: `/park-work [<bead-id>]` and `/park-work --check [<bead-id>]`.
- Produces: a schema-v1 receipt matching the design specification.

- [ ] **Step 1: Add failing skill-contract tests**

Append this test class to `skills/park-work/tests/test_fold.py` before the
`if __name__ == "__main__"` block:

```python
class SkillContractTests(unittest.TestCase):
    def skill_text(self):
        return (ROOT / "SKILL.md").read_text()

    def test_skill_declares_all_three_modes_and_mcp_dependency(self):
        text = self.skill_text()
        for token in (
            "--check",
            "--resume",
            "MCP dependency:",
            "rsry_workspace_checkpoint",
            "rsry_agent_session_message_record",
        ):
            self.assertIn(token, text)

    def test_skill_requires_fold_helper_and_receipt_readback(self):
        text = self.skill_text()
        self.assertIn("scripts/fold.py evaluate", text)
        self.assertIn("scripts/fold.py validate-receipt", text)
        self.assertIn("read the receipt back", text.lower())
        self.assertIn("safe_to_close", text)

    def test_skill_forbids_destructive_terminal_actions(self):
        text = self.skill_text()
        for phrase in (
            "never close a bead",
            "never terminate a provider session",
            "never delete a worktree",
        ):
            self.assertIn(phrase, text.lower())
```

- [ ] **Step 2: Run tests and verify the missing skill failure**

Run:

```bash
python3 skills/park-work/tests/test_fold.py
```

Expected: the fold tests pass and the three contract tests fail with
`FileNotFoundError` for `skills/park-work/SKILL.md`.

- [ ] **Step 3: Create the skill frontmatter and non-negotiable boundaries**

Create `skills/park-work/SKILL.md` beginning exactly with:

```markdown
---
name: park-work
description: >-
  Check whether the current human-agent work episode is mechanically safe to
  close, park incomplete work behind a verified durable checkpoint and receipt,
  or resume a previously parked episode after revalidating live state.
allowed-tools: "Bash,Read,Grep,Glob,mcp__rsry__*"
argument-hint: "[<bead-id>] | --check [<bead-id>] | --resume [<episode-id>|<bead-id>]"
---

# Park Work

`park-work` evaluates one logical work episode. A provider-native Codex or
Claude session is evidence attached to that episode, not its identity.

**MCP dependency:** rosary (`rsry_*`).

## Absolute boundaries

- Never close a bead.
- Never terminate a provider session.
- Never delete a worktree.
- Never discard, reset, stash, or rewrite user changes.
- Never silently select or mint an anchor bead.
- Never set or print `safe_to_close=true` until a schema-valid receipt has
  been written and read back by its stable `intent_id`.
- Never use model-authored prose as safety evidence.
```

- [ ] **Step 4: Add mode resolution and anchor resolution**

Add sections that:

1. Parse `$ARGUMENTS` into `check`, `park`, or `resume`.
2. Use an explicit bead ID without confirmation.
3. Otherwise propose exactly one anchor using active dispatch, branch/bookmark,
   then most recently touched bead.
4. Ask the human to confirm a detected anchor before any write.
5. Return `unsafe` when detectors disagree or no anchor exists; do not mint a
   bead.
6. Reuse a nonterminal `episode_id` and successful receipt found on the anchor;
   otherwise mint `ep-<uuid>`, `park-<uuid>`, and `attempt-<uuid>`.

Include this exact retry rule:

```markdown
Before evaluating or writing, search the anchor's events and comments for the
stable `intent_id`. If a schema-valid successful receipt already exists, read
it back and return it; do not append a second semantic transition.
```

- [ ] **Step 5: Add exact evidence collection**

Specify that every evidence item is appended to one JSON `checks` array with
`name`, `category`, `outcome`, compact `evidence`, and RFC3339
`observed_at`. Define the required checks:

```text
identity:
  anchor_confirmed
  repository_resolved

quiescence:
  no_active_dispatch
  no_running_child_operation
  no_vcs_operation_or_conflict

preservation:
  tree_preserved
  commits_reachable_or_checkpoint_resolvable

completion:
  close_condition_satisfied
  pr_merged                 # include only for a PR-backed bead
  bead_terminal

resume:
  resume_target_resolvable  # required only when completion checks all fail
```

For Git, require evidence from:

```bash
git status --porcelain=v2 --branch
git diff --name-only --diff-filter=U
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git rev-parse HEAD
git rev-parse '@{upstream}'
```

For jj, require:

```bash
jj status
jj resolve --list
jj log -r @ --no-graph -T 'change_id ++ "\n"'
jj bookmark list
```

An unavailable command, authentication failure, malformed response, active
operation, or contradictory source becomes `unknown` or `fail` according to
the tool's actual result; it is never coerced to `pass`.

- [ ] **Step 6: Add deterministic candidate evaluation**

Require the skill to write the checks object to a temporary file created by
`mktemp`, run:

```bash
python3 "$SKILL_DIR/scripts/fold.py" evaluate < "$CHECKS_FILE"
```

The skill must treat `eligible=false` as `unsafe`, print the exact `reasons`,
perform no transition, and leave all repositories/workspaces unchanged.

For `--check`, print the candidate plus evidence and stop before checkpoint or
receipt writes.

- [ ] **Step 7: Add park materialization and read-back gate**

Document this order:

1. For a `parked` candidate, call `rsry_workspace_checkpoint` only when the
   current tree is not already durably reachable.
2. Re-run preservation checks against the returned checkpoint/change ID.
3. Construct the receipt with the candidate outcome and
   `safe_to_close=true`.
4. Run `fold.py validate-receipt`.
5. Write the receipt to the anchor bead as a fenced
   `work_episode_receipt/v1` JSON comment.
6. Read the bead history/comments back and find the exact `intent_id`.
7. Compare `episode_id`, `outcome`, and checkpoint/branch fields byte-for-byte.
8. When `rsry_agent_session_addresses` returns an address, also write the same
   payload through `rsry_agent_session_message_record` using a stable event ID.
9. Render `/tmp/park-<date>-<slug>.md` from the same receipt.
10. Print the receipt and `safe_to_close=true` only after steps 4–8 succeed.

If a write times out, the next attempt searches by `intent_id` before writing.
If read-back cannot prove durability, return `unsafe` and do not tell the human
to close the provider session.

- [ ] **Step 8: Run focused tests**

Run:

```bash
python3 skills/park-work/tests/test_fold.py
```

Expected: 15 tests pass.

- [ ] **Step 9: Regenerate and validate README registration**

Run:

```bash
scripts/build.sh readme
scripts/build.sh check
```

Expected: README's Skills table contains `park-work`; all agent/skill files
pass lint; README/frontmatter sync is valid.

- [ ] **Step 10: Commit check and park mode**

```bash
git add skills/park-work/SKILL.md skills/park-work/tests/test_fold.py README.md
git commit -m "[agents-dba741] feat(park-work): add check and park workflow"
```

### Task 3: Resume, Drift Detection, and Retry Semantics

**Files:**
- Modify: `skills/park-work/SKILL.md`
- Modify: `skills/park-work/tests/test_fold.py`

**Interfaces:**
- Consumes: a schema-valid parked receipt found by explicit `episode_id` or
  confirmed anchor bead.
- Produces: `/park-work --resume [<episode-id>|<bead-id>]`.
- Produces: a durable `resumed` observation reusing the original
  `episode_id`.

- [ ] **Step 1: Add failing resume-contract tests**

Add to `SkillContractTests`:

```python
    def test_resume_revalidates_before_restoring_or_working(self):
        text = self.skill_text().lower()
        for phrase in (
            "latest parked receipt",
            "revalidate live state",
            "another active holder",
            "missing checkpoint",
            "record the resumed observation",
            "begin work only after",
        ):
            self.assertIn(phrase, text)

    def test_retry_and_partial_outcome_rules_are_explicit(self):
        text = self.skill_text().lower()
        self.assertIn("stable `intent_id`", text)
        self.assertIn("independent episode", text)
        self.assertIn("one unsafe episode", text)
```

- [ ] **Step 2: Run tests and verify resume contract failure**

Run:

```bash
python3 skills/park-work/tests/test_fold.py
```

Expected: existing tests pass; the new tests fail because the required resume
and independent-result language is absent.

- [ ] **Step 3: Add the resume workflow**

Add a `## Resume` section implementing this exact sequence:

1. Resolve the latest parked receipt by explicit episode ID or confirmed
   anchor bead.
2. Validate it with `fold.py validate-receipt`.
3. Revalidate live state through Rosary and the VCS before restoring anything.
4. Stop on closed/abandoned/reassigned work, another active holder, missing
   checkpoint, unresolved conflict, or receipt/schema drift.
5. Resolve the recorded checkpoint or pushed branch without deleting or
   rewriting another workspace.
6. Restate the bounded next action as context, not safety evidence.
7. Record the resumed observation with the same `episode_id` and a fresh
   `attempt_id`.
8. Read the resumed observation back.
9. Begin work only after the resumed observation is durable.

Use the exact phrases asserted by the tests, including “latest parked receipt,”
“revalidate live state,” “another active holder,” “missing checkpoint,”
“record the resumed observation,” and “begin work only after.”

- [ ] **Step 4: Add retry and independent-result rules**

Add a `## Retry and collections` section:

```markdown
A retry reuses the stable `intent_id` and creates a fresh `attempt_id`. A new
attempt may observe changed evidence; an existing successful transition is
returned rather than rewritten.

Each invocation evaluates one independent episode. A controller may collect
several receipts later, but one unsafe episode never rolls back or weakens a
completed or parked result from another episode.
```

- [ ] **Step 5: Run tests and repository gate**

Run:

```bash
python3 skills/park-work/tests/test_fold.py
scripts/build.sh check
git diff --check
```

Expected: 17 tests pass; repository check and diff check exit 0.

- [ ] **Step 6: Commit resume behavior**

```bash
git add skills/park-work/SKILL.md skills/park-work/tests/test_fold.py
git commit -m "[agents-dba741] feat(park-work): add drift-safe resume"
```

### Task 4: Real Rosary/VCS Smoke and Final Verification

**Files:**
- Modify only if the smoke exposes a defect:
  `skills/park-work/SKILL.md`,
  `skills/park-work/scripts/fold.py`,
  `skills/park-work/tests/test_fold.py`
- Verify: `README.md`

**Interfaces:**
- Consumes: the complete skill and helper from Tasks 1–3.
- Produces: live evidence on `agents-dba741` that the receipt write/read-back
  path works against a disposable registered repository and real Rosary bead.

- [ ] **Step 1: Create a disposable repository with a stable digit-free basename**

Run:

```bash
PARKWORK_SMOKE_PARENT="$(mktemp -d)"
PARKWORK_SMOKE_REPO="$PARKWORK_SMOKE_PARENT/parkworksmoke"
mkdir "$PARKWORK_SMOKE_REPO"
git -C "$PARKWORK_SMOKE_REPO" init -b main
git -C "$PARKWORK_SMOKE_REPO" config user.name "Park Work Smoke"
git -C "$PARKWORK_SMOKE_REPO" config user.email "park-work-smoke@example.invalid"
```

Use the stable child basename because Rosary bead prefixes must be digit-free.
Do not delete or reuse any pre-existing path.

- [ ] **Step 2: Onboard it through real Rosary and create one bounded bead**

Run:

```bash
rsry init "$PARKWORK_SMOKE_REPO"
```

Then call `rsry_bead_create` with:

```json
{
  "repo_path": "<PARKWORK_SMOKE_REPO>",
  "title": "Park-work live receipt smoke",
  "description": "Exercise the skill against a real repository and durable Rosary comment read-back.",
  "issue_type": "task",
  "priority": 2,
  "files": ["proof.txt"],
  "acceptance_criteria": "A work_episode_receipt/v1 comment is written and read back by stable intent ID."
}
```

Record the returned bead ID; do not infer it from command output.

- [ ] **Step 3: Create and preserve real incomplete work**

Run:

```bash
printf '%s\n' 'park-work smoke' > "$PARKWORK_SMOKE_REPO/proof.txt"
git -C "$PARKWORK_SMOKE_REPO" add proof.txt
git -C "$PARKWORK_SMOKE_REPO" commit -m "[<SMOKE_BEAD_ID>] test(park-work): add smoke fixture"
```

Replace `<SMOKE_BEAD_ID>` with the exact ID returned in Step 2. Configure a
local bare remote inside `$PARKWORK_SMOKE_PARENT`, push `main`, and verify
`git rev-parse '@{upstream}'` succeeds:

```bash
git init --bare "$PARKWORK_SMOKE_PARENT/remote.git"
git -C "$PARKWORK_SMOKE_REPO" remote add origin "$PARKWORK_SMOKE_PARENT/remote.git"
git -C "$PARKWORK_SMOKE_REPO" push -u origin main
git -C "$PARKWORK_SMOKE_REPO" rev-parse '@{upstream}'
```

- [ ] **Step 4: Execute the skill's park path with the real bead**

Follow `skills/park-work/SKILL.md` using the explicit smoke bead ID and
repository path. The completion check must return `fail` because the bead is
open; quiescence and preservation must pass; the deterministic helper must
return a `parked` candidate.

Write the receipt through `rsry_bead_comment`, then read comments/history back
and verify the exact `intent_id`, `episode_id`, `outcome=parked`, pushed branch,
and `safe_to_close=true`.

- [ ] **Step 5: Prove fail-closed behavior**

Create an unresolved merge conflict in a second disposable branch inside the
same smoke repository. Run `--check` and verify
`no_vcs_operation_or_conflict=fail` produces `eligible=false` and no new
receipt comment.

Abort the disposable merge only after recording the observed result; this is
safe because the repository exists solely under the fresh
`PARKWORK_SMOKE_PARENT`.

- [ ] **Step 6: Record live evidence and clean only the disposable fixture**

Add a comment to `agents-dba741` containing:

- smoke repository path,
- smoke bead ID,
- park receipt intent ID,
- read-back result,
- conflict fail-closed result,
- exact test/gate outputs.

After confirming `PARKWORK_SMOKE_PARENT` is the exact non-empty value returned
by `mktemp -d` in Step 1 and contains the `parkworksmoke` child, remove that
temporary parent. Do not run cleanup against `/tmp`, the repository root, or an
unvalidated variable.

- [ ] **Step 7: Run the complete fresh verification gate**

Run:

```bash
python3 skills/park-work/tests/test_fold.py
python3 -m py_compile skills/park-work/scripts/fold.py skills/park-work/tests/test_fold.py
scripts/build.sh check
git diff --check
git status --short
```

Expected:

- 17 tests pass.
- Python compilation exits 0.
- All agent/skill files pass lint and README is in sync.
- `git diff --check` exits 0.
- Status contains only intended `agents-dba741` files plus any pre-existing
  unrelated user files.

- [ ] **Step 8: Commit any smoke-derived corrections**

If Step 4 or 5 required corrections, commit only the listed implementation
files:

```bash
git add skills/park-work/SKILL.md skills/park-work/scripts/fold.py skills/park-work/tests/test_fold.py README.md
git commit -m "[agents-dba741] fix(park-work): honor live receipt evidence"
```

If no correction was required, do not create an empty commit.

- [ ] **Step 9: Review the implementation diff and close the bead**

Review:

```bash
git log --oneline --decorate -5
git diff origin/main...HEAD -- skills/park-work README.md
```

After all tests and the live smoke pass and every implementation commit is
present, close `agents-dba741` with `rsry_bead_close`. Do not close the separate
mechanism beads; this skill does not implement their runtime work.
