#!/usr/bin/env python3
import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLD = ROOT / "scripts" / "fold.py"
sys.path.insert(0, str(ROOT / "scripts"))

from fold import (  # noqa: E402
    InputError,
    bind_repository,
    confirm_receipt_readback,
    evaluate,
    prepare_attempt,
    resume_gate,
    validate_receipt,
)


NOW = "2026-07-30T18:00:00Z"
EPISODE_ID = "ep-11111111-1111-4111-8111-111111111111"
INTENT_ID = "park-22222222-2222-4222-8222-222222222222"
ATTEMPT_ID = "attempt-33333333-3333-4333-8333-333333333333"
HEAD = "a" * 40
PR_URL = "https://github.com/example/project/pull/17"


def evidence(source, detail, **extra):
    return {"source": source, "detail": detail, **extra}


def check(name, category, outcome, check_evidence=None, observed_at=NOW):
    return {
        "name": name,
        "category": category,
        "outcome": outcome,
        "evidence": check_evidence or evidence("fixture", f"{name}:{outcome}"),
        "observed_at": observed_at,
    }


def anchor_check(outcome="pass"):
    return check(
        "anchor_confirmed",
        "identity",
        outcome,
        evidence("explicit", "anchor selected explicitly", anchor="agents-dba741"),
    )


def repository_check(outcome="pass"):
    return check(
        "repository_resolved",
        "identity",
        outcome,
        evidence(
            "registered_repository_binding",
            "unique root and origin match",
            bound_root="/tmp/example",
            remote="https://github.com/example/project.git",
        ),
    )


def dispatch_check(outcome="pass"):
    payload = evidence(
        "rsry_active+rsry_dispatch_history",
        "authoritative active-dispatch observation",
        active_records=[] if outcome == "pass" else ["dispatch-1"],
    )
    if outcome == "unknown":
        payload = evidence(
            "rsry_active+rsry_dispatch_history",
            "authoritative query unavailable",
            error="transport unavailable",
        )
    return check("no_active_dispatch", "quiescence", outcome, payload)


def child_check(outcome="pass"):
    if outcome == "unknown":
        payload = evidence(
            "codex.current_child_operations",
            "current-client query unavailable",
            client="codex",
            authoritative=False,
            error="capability unavailable",
        )
    else:
        payload = evidence(
            "codex.current_child_operations",
            "authoritative current-client child query",
            client="codex",
            authoritative=True,
            running=[] if outcome == "pass" else ["child-7"],
        )
    return check("no_running_child_operation", "quiescence", outcome, payload)


def vcs_check(outcome="pass"):
    if outcome == "unknown":
        payload = evidence(
            "git",
            "VCS operation query unavailable",
            error="git command failed",
        )
    else:
        payload = evidence(
            "git",
            "bound-root conflict and operation observation",
            conflicts=[] if outcome == "pass" else ["src/conflicted.py"],
            operations=[],
        )
    return check("no_vcs_operation_or_conflict", "quiescence", outcome, payload)


def preservation_check(name, phase="durable", outcome="pass", reference=HEAD):
    if phase == "preflight":
        payload = evidence(
            "rsry_workspace_checkpoint",
            "checkpoint operation is available for captured workspace state",
            state="checkpointable",
            workspace="/tmp/example",
        )
    elif outcome == "pass":
        payload = evidence(
            "git",
            "post-checkpoint immutable reference resolves",
            state="durable",
            reference=reference,
        )
    else:
        payload = evidence(
            "git",
            "workspace state is not durably preserved",
            state="unpreserved" if outcome == "fail" else "unknown",
            error="durable reference does not resolve",
        )
    return check(name, "preservation", outcome, payload)


def close_check(outcome):
    if outcome == "unknown":
        payload = evidence(
            "rsry_bead_history",
            "latest verify observation unavailable",
            error="no matching verify observation",
        )
    else:
        payload = evidence(
            "rsry_bead_history",
            "latest explicit verify observation",
            observation_kind="verify",
            latest=True,
            acceptance_command="task check",
            observed_command="task check",
            verdict=outcome,
            verdict_id="verify-17",
        )
    return check("close_condition_satisfied", "completion", outcome, payload)


def terminal_check(outcome):
    if outcome == "unknown":
        payload = evidence(
            "rsry_list_beads",
            "bead record unavailable",
            error="malformed bead record",
        )
    else:
        payload = evidence(
            "rsry_list_beads",
            "structured bead status",
            status="done" if outcome == "pass" else "open",
        )
    return check("bead_terminal", "completion", outcome, payload)


def pr_check(outcome):
    command = ["gh", "pr", "view", PR_URL, "--json", "state,mergedAt,url"]
    if outcome == "unknown":
        payload = evidence(
            "gh",
            "provider read unavailable",
            command=command,
            error="authentication failed",
        )
    else:
        payload = evidence(
            "gh",
            "exact read-only provider response",
            command=command,
            response={
                "state": "MERGED" if outcome == "pass" else "OPEN",
                "mergedAt": NOW if outcome == "pass" else None,
                "url": PR_URL,
            },
        )
    return check("pr_merged", "completion", outcome, payload)


def resume_check(outcome="pass", kind="branch", value="main"):
    if outcome == "unknown":
        payload = evidence(
            "git",
            "resume resolver unavailable",
            error="resolver failed",
        )
    else:
        payload = evidence(
            "git",
            "exact immutable resume target resolver",
            target={"kind": kind, "value": value, "resolved_head": HEAD},
        )
    return check("resume_target_resolvable", "resume", outcome, payload)


def observation(
    *,
    phase="durable",
    completed=False,
    pr_backed=False,
    checkpoint_required=False,
):
    completion_outcome = "pass" if completed else "fail"
    preservation_phase = "preflight" if checkpoint_required else "durable"
    checks = [
        anchor_check(),
        repository_check(),
        dispatch_check(),
        child_check(),
        vcs_check(),
        preservation_check("tree_preserved", preservation_phase),
        preservation_check(
            "commits_reachable_or_checkpoint_resolvable", preservation_phase
        ),
        close_check(completion_outcome),
        terminal_check(completion_outcome),
    ]
    if pr_backed:
        checks.append(pr_check(completion_outcome))
    if not completed:
        checks.append(resume_check())
    return {
        "schema_version": 1,
        "protocol_phase": phase,
        "pr_backed": pr_backed,
        "bead": {
            "acceptance_command": "task check",
            "pr_url": PR_URL if pr_backed else None,
        },
        "checks": checks,
    }


def receipt(*, completed=False, pr_backed=False, resume_kind="branch"):
    document = observation(completed=completed, pr_backed=pr_backed)
    result = {
        **document,
        "episode_id": EPISODE_ID,
        "intent_id": INTENT_ID,
        "attempt_id": ATTEMPT_ID,
        "anchor_bead": "agents-dba741",
        "provider_sessions": [{"provider": "codex", "id": "session-123"}],
        "repository": {
            "path": "/tmp/example",
            "vcs": "git",
            "branch": "main",
            "head": HEAD,
        },
        "outcome": "completed" if completed else "parked",
        "safe_to_close": True,
        "references": ["bead-comment-17"],
    }
    if not completed:
        target = "main" if resume_kind == "branch" else HEAD
        result["resume"] = {
            resume_kind: target,
            "next_action": "Run task check and continue.",
        }
        result["checks"][-1] = resume_check(kind=resume_kind, value=target)
    return result


def cli(command, payload):
    return subprocess.run(
        [sys.executable, str(FOLD), command],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
    )


class FoldTests(unittest.TestCase):
    def test_durable_non_pr_completion_is_eligible(self):
        self.assertEqual(
            evaluate(observation(completed=True)),
            {
                "protocol_phase": "durable",
                "candidate": "completed",
                "eligible": True,
                "action": "write_receipt",
                "reasons": [],
            },
        )

    def test_durable_pr_backed_completion_requires_exact_pr_evidence(self):
        result = evaluate(observation(completed=True, pr_backed=True))
        self.assertTrue(result["eligible"])
        self.assertEqual(result["candidate"], "completed")

    def test_durable_parked_work_is_eligible(self):
        result = evaluate(observation())
        self.assertTrue(result["eligible"])
        self.assertEqual(result["candidate"], "parked")
        self.assertEqual(result["action"], "write_receipt")

    def test_checkpointable_completed_preflight_only_authorizes_checkpoint(self):
        result = evaluate(
            observation(
                phase="preflight", completed=True, checkpoint_required=True
            )
        )
        self.assertEqual(result["candidate"], "completed")
        self.assertFalse(result["eligible"])
        self.assertEqual(result["action"], "checkpoint")

    def test_checkpointable_parked_preflight_only_authorizes_checkpoint(self):
        result = evaluate(
            observation(
                phase="preflight", completed=False, checkpoint_required=True
            )
        )
        self.assertEqual(result["candidate"], "parked")
        self.assertFalse(result["eligible"])
        self.assertEqual(result["action"], "checkpoint")

    def test_successful_checkpoint_replacement_refolds_from_preflight_to_durable(self):
        preflight = observation(
            phase="preflight", completed=False, checkpoint_required=True
        )
        self.assertEqual(evaluate(preflight)["action"], "checkpoint")
        durable = copy.deepcopy(preflight)
        durable["protocol_phase"] = "durable"
        durable["checks"][5] = preservation_check("tree_preserved")
        durable["checks"][6] = preservation_check(
            "commits_reachable_or_checkpoint_resolvable"
        )
        result = evaluate(durable)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["action"], "write_receipt")

    def test_active_dispatch_is_unsafe(self):
        document = observation()
        document["checks"][2] = dispatch_check("fail")
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertIn("no_active_dispatch=fail", result["reasons"])

    def test_active_current_client_child_is_unsafe_without_rosary_dispatch(self):
        document = observation()
        document["checks"][3] = child_check("fail")
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertIn("no_running_child_operation=fail", result["reasons"])

    def test_unavailable_current_client_child_query_is_unknown_and_unsafe(self):
        document = observation()
        document["checks"][3] = child_check("unknown")
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertIn("no_running_child_operation=unknown", result["reasons"])

    def test_conflict_is_unsafe(self):
        document = observation()
        document["checks"][4] = vcs_check("fail")
        self.assertFalse(evaluate(document)["eligible"])

    def test_dirty_unpreserved_durable_phase_is_unsafe(self):
        document = observation()
        document["checks"][5] = preservation_check(
            "tree_preserved", outcome="fail"
        )
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertIn("tree_preserved=fail", result["reasons"])

    def test_missing_check_is_rejected(self):
        document = observation()
        document["checks"] = document["checks"][1:]
        with self.assertRaisesRegex(InputError, "missing required check"):
            evaluate(document)

    def test_duplicate_check_is_rejected(self):
        document = observation()
        document["checks"].append(copy.deepcopy(document["checks"][0]))
        with self.assertRaisesRegex(InputError, "duplicate check"):
            evaluate(document)

    def test_unknown_check_is_rejected(self):
        document = observation()
        document["checks"][0]["name"] = "invented_identity"
        with self.assertRaisesRegex(InputError, "unknown check"):
            evaluate(document)

    def test_wrong_category_is_rejected(self):
        document = observation()
        document["checks"][0]["category"] = "quiescence"
        with self.assertRaisesRegex(InputError, "must use category identity"):
            evaluate(document)

    def test_non_pr_work_must_not_invent_pr_check(self):
        document = observation()
        document["checks"].append(pr_check("pass"))
        with self.assertRaisesRegex(InputError, "pr_merged is not applicable"):
            evaluate(document)

    def test_pr_backed_work_cannot_omit_pr_check(self):
        document = observation(completed=True, pr_backed=True)
        document["checks"] = [
            item for item in document["checks"] if item["name"] != "pr_merged"
        ]
        with self.assertRaisesRegex(InputError, "missing required check pr_merged"):
            evaluate(document)

    def test_pr_backed_boolean_must_match_structured_bead_metadata(self):
        document = observation()
        document["pr_backed"] = True
        with self.assertRaisesRegex(InputError, "pr_backed must be derived"):
            evaluate(document)

    def test_mixed_completion_evidence_is_unsafe(self):
        document = observation()
        document["checks"][7] = close_check("pass")
        document["checks"] = document["checks"][:-1]
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertIn("completion evidence conflicts or is unknown", result["reasons"])

    def test_open_work_requires_mechanical_failed_completion(self):
        document = observation()
        document["checks"][7] = close_check("unknown")
        document["checks"] = document["checks"][:-1]
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertNotEqual(result["candidate"], "parked")

    def test_closed_unmerged_pr_is_parked_not_completed(self):
        result = evaluate(observation(pr_backed=True))
        self.assertTrue(result["eligible"])
        self.assertEqual(result["candidate"], "parked")

    def test_mixed_collection_preserves_independent_results(self):
        completed = evaluate(observation(completed=True))
        parked = evaluate(observation())
        unsafe_document = observation()
        unsafe_document["checks"][2] = dispatch_check("fail")
        unsafe = evaluate(unsafe_document)
        self.assertEqual(
            [completed["candidate"], parked["candidate"], unsafe["candidate"]],
            ["completed", "parked", None],
        )

    def test_missing_or_drifted_checkpoint_is_unsafe(self):
        document = observation()
        document["checks"][-1] = resume_check("fail", kind="checkpoint", value=HEAD)
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertIn("resume_target_resolvable=fail", result["reasons"])


class ReceiptTests(unittest.TestCase):
    def test_valid_durable_parked_receipt(self):
        validate_receipt(receipt())

    def test_valid_durable_completed_receipt(self):
        validate_receipt(receipt(completed=True))

    def test_preflight_checkpoint_required_receipt_cannot_validate(self):
        candidate = receipt(completed=True)
        candidate["protocol_phase"] = "preflight"
        candidate["checks"][5] = preservation_check("tree_preserved", "preflight")
        candidate["checks"][6] = preservation_check(
            "commits_reachable_or_checkpoint_resolvable", "preflight"
        )
        with self.assertRaisesRegex(InputError, "durable protocol phase"):
            validate_receipt(candidate)

    def test_post_checkpoint_evidence_must_replace_both_preservation_rows(self):
        candidate = receipt()
        candidate["checks"][5] = preservation_check("tree_preserved", "preflight")
        with self.assertRaisesRegex(InputError, "durable preservation evidence"):
            validate_receipt(candidate)

    def test_malformed_ids_are_rejected(self):
        fields = ("episode_id", "intent_id", "attempt_id")
        for field in fields:
            with self.subTest(field=field):
                candidate = receipt()
                candidate[field] = candidate[field].split("-", 1)[0] + "-truthy"
                with self.assertRaisesRegex(InputError, f"{field} must be"):
                    validate_receipt(candidate)

    def test_malformed_timestamp_is_rejected(self):
        candidate = receipt()
        candidate["checks"][0]["observed_at"] = "today"
        with self.assertRaisesRegex(InputError, "valid RFC3339"):
            validate_receipt(candidate)

    def test_repository_shape_is_strict(self):
        mutations = (
            ("path", "", "absolute"),
            ("path", {"truthy": True}, "string"),
            ("vcs", "anything", "git or jj"),
            ("branch", ["main"], "string"),
            ("head", "", "immutable"),
            ("head", "abc123", "full immutable Git"),
        )
        for field, value, message in mutations:
            with self.subTest(field=field, value=value):
                candidate = receipt()
                candidate["repository"][field] = value
                with self.assertRaisesRegex(InputError, message):
                    validate_receipt(candidate)

    def test_anchor_must_be_nonempty_string(self):
        candidate = receipt()
        candidate["anchor_bead"] = []
        with self.assertRaisesRegex(InputError, "anchor_bead"):
            validate_receipt(candidate)

    def test_provider_session_shape_is_strict(self):
        candidate = receipt()
        candidate["provider_sessions"] = [{"provider": "codex", "id": []}]
        with self.assertRaisesRegex(InputError, "provider_sessions"):
            validate_receipt(candidate)

    def test_reference_shape_is_strict(self):
        candidate = receipt()
        candidate["references"] = [{"truthy": True}]
        with self.assertRaisesRegex(InputError, "references"):
            validate_receipt(candidate)

    def test_resume_fields_must_be_nonempty_strings(self):
        candidate = receipt()
        candidate["resume"]["next_action"] = ["continue"]
        with self.assertRaisesRegex(InputError, "resume.next_action"):
            validate_receipt(candidate)

    def test_parked_receipt_requires_exactly_one_resume_target(self):
        candidate = receipt()
        candidate["resume"]["checkpoint"] = HEAD
        with self.assertRaisesRegex(InputError, "exactly one"):
            validate_receipt(candidate)

    def test_resume_target_must_match_passing_resolver_evidence(self):
        candidate = receipt()
        candidate["resume"]["branch"] = "other"
        with self.assertRaisesRegex(InputError, "must match resolver evidence"):
            validate_receipt(candidate)

    def test_resume_resolver_must_bind_target_to_immutable_receipt_head(self):
        candidate = receipt()
        candidate["checks"][-1]["evidence"]["target"]["resolved_head"] = "b" * 40
        with self.assertRaisesRegex(InputError, "immutable repository head"):
            validate_receipt(candidate)

    def test_durable_preservation_references_must_match_receipt_head(self):
        candidate = receipt()
        candidate["checks"][5]["evidence"]["reference"] = "b" * 40
        with self.assertRaisesRegex(InputError, "preservation reference"):
            validate_receipt(candidate)

    def test_claimed_outcome_must_match_fold(self):
        candidate = receipt()
        candidate["outcome"] = "completed"
        candidate.pop("resume")
        with self.assertRaisesRegex(InputError, "does not match deterministic fold"):
            validate_receipt(candidate)

    def test_close_condition_requires_latest_matching_verify_command(self):
        candidate = receipt(completed=True)
        candidate["checks"][7]["evidence"]["observed_command"] = "pytest"
        with self.assertRaisesRegex(InputError, "declared acceptance command"):
            validate_receipt(candidate)

    def test_close_condition_outcome_must_match_verify_verdict(self):
        candidate = receipt(completed=True)
        candidate["checks"][7]["evidence"]["verdict"] = "fail"
        with self.assertRaisesRegex(InputError, "verify verdict"):
            validate_receipt(candidate)

    def test_pr_merge_requires_matching_url_state_and_timestamp(self):
        candidate = receipt(completed=True, pr_backed=True)
        pr_evidence = next(
            item["evidence"]
            for item in candidate["checks"]
            if item["name"] == "pr_merged"
        )
        pr_evidence["response"]["url"] = "https://github.com/other/pr/1"
        with self.assertRaisesRegex(InputError, "PR response URL"):
            validate_receipt(candidate)

    def test_cli_schema_errors_exit_two(self):
        candidate = receipt()
        candidate["checks"][0]["name"] = "not-anchor"
        result = cli("validate-receipt", candidate)
        self.assertEqual(result.returncode, 2)
        self.assertIn("unknown check", result.stderr)


class ReceiptReadbackTests(unittest.TestCase):
    def receipt_bytes(self):
        return json.dumps(receipt(), sort_keys=True, separators=(",", ":"))

    def test_exact_validated_comment_readback_is_durable(self):
        expected = self.receipt_bytes()
        result = confirm_receipt_readback(
            {
                "receipt_bytes": expected,
                "comments": [
                    {
                        "id": "comment-17",
                        "body": f"```work_episode_receipt/v1\n{expected}\n```",
                    }
                ],
            }
        )
        self.assertEqual(
            result,
            {
                "durable": True,
                "safe_to_close": True,
                "comment_id": "comment-17",
                "reasons": [],
            },
        )

    def test_write_without_matching_readback_is_unsafe(self):
        result = confirm_receipt_readback(
            {"receipt_bytes": self.receipt_bytes(), "comments": []}
        )
        self.assertFalse(result["durable"])
        self.assertFalse(result["safe_to_close"])
        self.assertIn("matching receipt comment not found", result["reasons"])

    def test_malformed_or_prose_wrapped_fence_cannot_prove_readback(self):
        expected = self.receipt_bytes()
        result = confirm_receipt_readback(
            {
                "receipt_bytes": expected,
                "comments": [
                    {
                        "id": "comment-17",
                        "body": (
                            "prose\n```work_episode_receipt/v1\n"
                            f"{expected}\n```\nmore prose"
                        ),
                    }
                ],
            }
        )
        self.assertFalse(result["durable"])


class RetryIdentityTests(unittest.TestCase):
    def test_missing_stable_ids_mints_retry_command_and_stops(self):
        result = prepare_attempt(
            {
                "mode": "park",
                "anchor_bead": "agents-dba741",
                "episode_id": None,
                "intent_id": None,
                "prior_receipts": [],
            }
        )
        self.assertFalse(result["ready"])
        self.assertEqual(result["action"], "retry")
        self.assertNotIn("attempt_id", result)
        self.assertIn("--episode-id ep-", result["retry_command"])
        self.assertIn("--intent-id park-", result["retry_command"])

    def test_process_separated_unsafe_then_success_reuses_ids_and_fresh_attempts(self):
        invocation = {
            "mode": "park",
            "anchor_bead": "agents-dba741",
            "episode_id": EPISODE_ID,
            "intent_id": INTENT_ID,
            "prior_receipts": [],
        }
        first = cli("prepare-attempt", invocation)
        self.assertEqual(first.returncode, 0, first.stderr)
        first_plan = json.loads(first.stdout)

        unsafe = observation()
        unsafe["checks"][2] = dispatch_check("fail")
        first_fold = cli("evaluate", unsafe)
        self.assertFalse(json.loads(first_fold.stdout)["eligible"])

        second = cli("prepare-attempt", invocation)
        self.assertEqual(second.returncode, 0, second.stderr)
        second_plan = json.loads(second.stdout)
        successful = cli("evaluate", observation())
        self.assertTrue(json.loads(successful.stdout)["eligible"])

        self.assertEqual(first_plan["episode_id"], second_plan["episode_id"])
        self.assertEqual(first_plan["intent_id"], second_plan["intent_id"])
        self.assertNotEqual(first_plan["attempt_id"], second_plan["attempt_id"])

    def test_duplicate_prior_success_returns_without_fresh_attempt(self):
        existing = receipt()
        result = prepare_attempt(
            {
                "mode": "park",
                "anchor_bead": "agents-dba741",
                "episode_id": EPISODE_ID,
                "intent_id": INTENT_ID,
                "prior_receipts": [existing],
            }
        )
        self.assertEqual(result["action"], "return_existing")
        self.assertEqual(result["receipt"], existing)
        self.assertNotIn("attempt_id", result)


class RepositoryBindingTests(unittest.TestCase):
    def binding_payload(self, selector_kind):
        return {
            "selector": {
                "kind": selector_kind,
                "value": EPISODE_ID
                if selector_kind == "episode"
                else "agents-dba741",
            },
            "receipt_repository": {
                "path": "/tmp/example",
                "vcs": "git",
                "branch": "main",
                "head": HEAD,
            },
            "observed": {
                "root": "/tmp/example",
                "remote": "git@github.com:example/project.git",
                "common_dir": "/tmp/example/.git",
                "common_remote": "https://github.com/example/project",
            },
            "registrations": [
                {
                    "name": "project",
                    "url": "https://github.com/example/project.git",
                }
            ],
        }

    def test_bead_and_episode_selectors_use_same_unique_binding(self):
        bead = bind_repository(self.binding_payload("bead"))
        episode = bind_repository(self.binding_payload("episode"))
        self.assertEqual(bead["bound_root"], episode["bound_root"])
        self.assertEqual(bead["registration"], episode["registration"])
        for command in bead["commands"]:
            self.assertEqual(command[:3], ["git", "-C", "/tmp/example"])

    def test_receipt_path_root_contradiction_is_rejected(self):
        payload = self.binding_payload("episode")
        payload["observed"]["root"] = "/tmp/other"
        with self.assertRaisesRegex(InputError, "receipt path/root contradiction"):
            bind_repository(payload)

    def test_remote_or_common_dir_identity_contradiction_is_rejected(self):
        payload = self.binding_payload("bead")
        payload["observed"]["common_remote"] = (
            "https://github.com/example/unrelated.git"
        )
        with self.assertRaisesRegex(InputError, "common-dir remote contradiction"):
            bind_repository(payload)

    def test_zero_or_multiple_registered_origin_matches_are_rejected(self):
        payload = self.binding_payload("episode")
        payload["registrations"].append(
            {
                "name": "duplicate",
                "url": "ssh://git@github.com/example/project.git",
            }
        )
        with self.assertRaisesRegex(InputError, "exactly one registered repository"):
            bind_repository(payload)


class ResumeGateTests(unittest.TestCase):
    def test_missing_atomic_claim_blocks_all_resume_mutations(self):
        result = resume_gate(
            {
                "episode_id": EPISODE_ID,
                "intent_id": INTENT_ID,
                "atomic_claim": None,
            }
        )
        self.assertFalse(result["authorized"])
        self.assertEqual(result["required_mechanism"], "rosary-04faf5")
        self.assertEqual(result["allowed_actions"], ["read_only_inspection"])
        self.assertEqual(
            result["blocked_actions"],
            ["workspace_creation", "resumed_observation", "work"],
        )
        self.assertLess(
            result["gate_order"].index("atomic_claim_required"),
            result["gate_order"].index("workspace_creation_blocked"),
        )

    def test_truthy_comment_dedupe_cannot_impersonate_atomic_claim(self):
        result = resume_gate(
            {
                "episode_id": EPISODE_ID,
                "intent_id": INTENT_ID,
                "atomic_claim": {"comment_dedupe": True},
            }
        )
        self.assertFalse(result["authorized"])
        self.assertIn("atomic episode claim/lease", result["required_contract"])


class SkillContractTests(unittest.TestCase):
    def skill_text(self):
        return (ROOT / "SKILL.md").read_text()

    def test_skill_declares_stable_identity_and_client_adapters(self):
        text = self.skill_text()
        for token in (
            "--episode-id",
            "--intent-id",
            "Codex",
            "Claude",
            "current-client",
            "rosary-04faf5",
            "atomic episode claim/lease",
        ):
            self.assertIn(token, text)

    def test_skill_keeps_absolute_destructive_boundaries(self):
        text = self.skill_text().lower()
        for token in (
            "never close a bead",
            "never terminate a provider session",
            "never delete a worktree",
            "never discard, reset, stash, or rewrite user changes",
        ):
            self.assertIn(token, text)


if __name__ == "__main__":
    unittest.main()
