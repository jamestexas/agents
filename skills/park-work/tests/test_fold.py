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
    def test_non_object_document_raises_input_error(self):
        with self.assertRaisesRegex(InputError, "document must be an object"):
            evaluate([])
        with self.assertRaisesRegex(InputError, "document must be an object"):
            validate_receipt([])

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

    def test_cli_rejects_non_object_json_with_input_error_exit_code(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "fold.py"), "validate-receipt"],
            input="[]",
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "document must be an object\n")


class SkillContractTests(unittest.TestCase):
    def skill_text(self):
        return (ROOT / "SKILL.md").read_text()

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

    def test_skill_declares_all_three_modes_and_mcp_dependency(self):
        text = self.skill_text()
        required_opening = """---
name: park-work
description: >-
  Check whether the current human-agent work episode is mechanically safe to
  close, park incomplete work behind a verified durable checkpoint and receipt,
  or resume a previously parked episode after revalidating live state.
allowed-tools: \"Bash,Read,Grep,Glob,mcp__rsry__*\"
argument-hint: \"[<bead-id>] | --check [<bead-id>] | --resume [<episode-id>|<bead-id>]\"
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
"""
        self.assertTrue(text.startswith(required_opening))
        for token in (
            "--check",
            "--resume",
            "MCP dependency:",
            "rsry_workspace_checkpoint",
            "rsry_agent_session_message_record",
            "rsry_bead_comment_list(id=<anchor>, repo_path=<repo>)",
            "rsry_agent_run_events(repo=<repo>, bead_id=<anchor>)",
            "rsry_expand_ref(hash=<returned-demoted-ref-hash>)",
        ):
            self.assertIn(token, text)

    def test_skill_requires_fold_helper_and_receipt_readback(self):
        text = self.skill_text()
        for token in (
            "LOADED_SKILL_FILE='<absolute SKILL.md path reported by the loader>'",
            "return_unsafe() {",
            'case "$LOADED_SKILL_FILE" in /*/park-work/SKILL.md)',
            '[ -f "$LOADED_SKILL_FILE" ]',
            'SKILL_DIR="$(CDPATH= cd -- "$(dirname -- "$LOADED_SKILL_FILE")" && pwd -P)"',
            'FOLD_HELPER="$SKILL_DIR/scripts/fold.py"',
            '[ -f "$FOLD_HELPER" ]',
            'CHECKS_FILE="$(mktemp)"',
            'CANDIDATE_RECEIPT_FILE="$(mktemp)"',
            'printf \'%s\' "$CHECKS_JSON" > "$CHECKS_FILE"',
            'printf \'%s\' "$CANDIDATE_RECEIPT_BYTES" > "$CANDIDATE_RECEIPT_FILE"',
            'python3 "$FOLD_HELPER" validate-receipt < "$CANDIDATE_RECEIPT_FILE"',
            'CANDIDATE_STATUS=$?',
            'printf \'%s\' "$RECEIPT_JSON" > "$RECEIPT_FILE"',
            'python3 "$FOLD_HELPER" evaluate < "$CHECKS_FILE"',
            'python3 "$FOLD_HELPER" validate-receipt < "$RECEIPT_FILE"',
            'FOLD_STATUS=$?',
            'RECEIPT_STATUS=$?',
            'RECEIPT_BYTES="$(cat "$RECEIPT_FILE")"',
            'RECEIPT_FENCE="$(printf \'```work_episode_receipt/v1\\n%s\\n```\' "$RECEIPT_BYTES")"',
            "parse only fenced `work_episode_receipt/v1` JSON",
            "validate each candidate",
            "same `RECEIPT_BYTES`",
        ):
            self.assertIn(token, text)
        self.assertNotIn(
            'SKILL_FILE="${SKILL_FILE:?set to the absolute path of this SKILL.md}"',
            text,
        )
        self.assertLess(
            text.index("LOADED_SKILL_FILE="),
            text.index("Before evaluating or writing, search"),
        )

    def test_skill_forbids_destructive_terminal_actions(self):
        text = self.skill_text()
        for token in (
            "anchor_confirmed",
            "repository_resolved",
            "no_active_dispatch",
            "no_running_child_operation",
            "no_vcs_operation_or_conflict",
            "tree_preserved",
            "commits_reachable_or_checkpoint_resolvable",
            "close_condition_satisfied",
            "pr_merged",
            "bead_terminal",
            "resume_target_resolvable",
            "git status --porcelain=v2 --branch",
            "git diff --name-only --diff-filter=U",
            "git rev-parse --git-dir",
            "git rev-parse --git-common-dir",
            "git branch --show-current",
            "git rev-parse HEAD",
            "git rev-parse '@{upstream}'",
            "jj status",
            "jj resolve --list",
            "jj log -r @ --no-graph -T 'change_id ++ \"\\n\"'",
            "jj bookmark list",
            "Source-to-check decision table",
            "do not write a checkpoint, receipt, comment, event, or handoff",
            "stop before checkpoint or receipt writes",
            "perform no transition",
            "leave all repositories and workspaces unchanged",
            "pre-materialization capability",
            "checkpointable",
            "only an eligible `parked` candidate on the `checkpointable` branch",
            "replace both preservation evidence items",
            "rerun the fold",
            "git cat-file -e <sha>^{commit}",
            "jj log -r <id>",
            "stable branch/checkpoint resume reference",
        ):
            self.assertIn(token, text)

        materialization = text.split("## 4. Materialize a parked receipt", 1)[1]
        self.assertLess(
            materialization.index("validate-receipt"),
            materialization.index("rsry_bead_comment(id=<anchor>"),
        )
        self.assertLess(
            materialization.index("rsry_bead_comment(id=<anchor>"),
            materialization.index("rsry_bead_comment_list(id=<anchor>"),
        )
        self.assertLess(
            materialization.index("rsry_bead_comment_list(id=<anchor>"),
            materialization.index("Print the receipt and `safe_to_close=true`"),
        )
        self.assertLess(
            materialization.index("only an eligible `parked` candidate on the `checkpointable` branch"),
            materialization.index("rsry_workspace_checkpoint"),
        )
        self.assertLess(
            materialization.index("replace both preservation evidence items"),
            materialization.index("Construct the schema-v1 receipt"),
        )


if __name__ == "__main__":
    unittest.main()
