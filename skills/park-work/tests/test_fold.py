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


if __name__ == "__main__":
    unittest.main()
