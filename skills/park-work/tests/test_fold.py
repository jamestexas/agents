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
REMOTE = "https://github.com/example/project.git"


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


def binding_observations(root="/tmp/example", remote=REMOTE):
    return {
        "root": {
            "command": ["git", "-C", root, "rev-parse", "--show-toplevel"],
            "stdout": root,
        },
        "git_dir": {
            "command": [
                "git",
                "-C",
                root,
                "rev-parse",
                "--path-format=absolute",
                "--git-dir",
            ],
            "stdout": f"{root}/.git",
        },
        "common_dir": {
            "command": [
                "git",
                "-C",
                root,
                "rev-parse",
                "--path-format=absolute",
                "--git-common-dir",
            ],
            "stdout": f"{root}/.git",
        },
        "remote": {
            "command": ["git", "-C", root, "remote", "get-url", "origin"],
            "stdout": remote,
        },
    }


def binding_result(
    selector_kind="bead",
    *,
    root="/tmp/example",
    remote=REMOTE,
    head=HEAD,
):
    selector = {
        "kind": selector_kind,
        "value": EPISODE_ID if selector_kind == "episode" else "agents-dba741",
    }
    repository = {
        "path": root,
        "vcs": "git",
        "branch": "main",
        "head": head,
    }
    observations = binding_observations(root, remote)
    return {
        "schema_version": 1,
        "selector": selector,
        "receipt_identity": {
            "episode_id": EPISODE_ID,
            "anchor_bead": "agents-dba741",
            "repository": repository,
        },
        "registration": {
            "name": "project",
            "url": REMOTE,
            "canonical_remote": "github.com/example/project",
        },
        "backend": "git",
        "bound_root": root,
        "git_dir": f"{root}/.git",
        "common_dir": f"{root}/.git",
        "canonical_remote": "github.com/example/project",
        "observations": observations,
        "commands": [
            ["git", "-C", root, "status", "--porcelain=v2", "--branch"],
            ["git", "-C", root, "diff", "--name-only", "--diff-filter=U"],
            ["git", "-C", root, "rev-parse", "--path-format=absolute", "--git-dir"],
            [
                "git",
                "-C",
                root,
                "rev-parse",
                "--path-format=absolute",
                "--git-common-dir",
            ],
            ["git", "-C", root, "rev-parse", "HEAD"],
        ],
    }


def repository_check(outcome="pass"):
    return check(
        "repository_resolved",
        "identity",
        outcome,
        evidence(
            "registered_repository_binding",
            "unique root and origin match",
            binding=binding_result(),
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
            backend="git",
            bound_root="/tmp/example",
            error="git command failed",
        )
    else:
        payload = evidence(
            "git",
            "bound-root conflict and operation observation",
            backend="git",
            bound_root="/tmp/example",
            commands=[
                [
                    "git",
                    "-C",
                    "/tmp/example",
                    "status",
                    "--porcelain=v2",
                    "--branch",
                ],
                [
                    "git",
                    "-C",
                    "/tmp/example",
                    "diff",
                    "--name-only",
                    "--diff-filter=U",
                ],
            ],
            conflicts=[] if outcome == "pass" else ["src/conflicted.py"],
            operations=[],
        )
    return check("no_vcs_operation_or_conflict", "quiescence", outcome, payload)


def preservation_check(name, phase="durable", outcome="pass", reference=HEAD):
    if phase == "preflight":
        payload = evidence(
            "rsry_workspace_checkpoint",
            "checkpoint operation is available for captured workspace state",
            backend="git",
            bound_root="/tmp/example",
            state="checkpointable",
            workspace="/tmp/example",
            captured_head=HEAD,
            checkpoint_available=True,
        )
    elif outcome == "pass":
        payload = evidence(
            "git",
            "post-checkpoint immutable reference resolves",
            backend="git",
            bound_root="/tmp/example",
            workspace="/tmp/example",
            state="durable",
            reference=reference,
            resolved_head=reference,
            resolver_command=[
                "git",
                "-C",
                "/tmp/example",
                "cat-file",
                "-e",
                f"{reference}^{{commit}}",
            ],
        )
    else:
        payload = evidence(
            "git",
            "workspace state is not durably preserved",
            backend="git",
            bound_root="/tmp/example",
            workspace="/tmp/example",
            state="unpreserved" if outcome == "fail" else "unknown",
            error="durable reference does not resolve",
        )
    return check(name, "preservation", outcome, payload)


def verify_record(sequence, verdict, command="task check", record_id=None):
    return {
        "id": record_id or f"verify-{sequence}",
        "kind": "verify",
        "command": command,
        "verdict": verdict,
        "observed_at": f"2026-07-30T18:00:{sequence:02d}Z",
        "sequence": sequence,
    }


def close_check(outcome, records=None):
    if records is None:
        records = [] if outcome == "unknown" else [verify_record(1, outcome)]
    payload = evidence(
        "rsry_bead_history",
        "complete authoritative verify history",
        acceptance_command="task check",
        ordering={
            "key": "sequence",
            "direction": "ascending",
            "authoritative": True,
            "complete": True,
        },
        records=records,
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
            backend="git",
            bound_root="/tmp/example",
            error="resolver failed",
        )
    else:
        payload = evidence(
            "git",
            "exact immutable resume target resolver",
            backend="git",
            bound_root="/tmp/example",
            resolver_command=[
                "git",
                "-C",
                "/tmp/example",
                "rev-parse",
                value,
            ],
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

    def test_unknown_rosary_bead_status_is_schema_error(self):
        document = observation()
        document["checks"][8]["evidence"]["status"] = "not-a-rosary-status"
        with self.assertRaisesRegex(InputError, "unrecognized Rosary bead status"):
            evaluate(document)

    def test_latest_matching_verify_failure_wins_over_stale_pass(self):
        document = observation()
        document["checks"][7] = close_check(
            "fail", [verify_record(1, "pass"), verify_record(2, "fail")]
        )
        result = evaluate(document)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["candidate"], "parked")

    def test_stale_pass_claim_is_rejected_when_newer_verify_failed(self):
        document = observation(completed=True)
        document["checks"][7] = close_check(
            "pass", [verify_record(1, "pass"), verify_record(2, "fail")]
        )
        with self.assertRaisesRegex(InputError, "latest matching verify verdict"):
            evaluate(document)

    def test_reversed_verify_history_is_rejected(self):
        document = observation()
        document["checks"][7] = close_check(
            "fail", [verify_record(2, "fail"), verify_record(1, "pass")]
        )
        with self.assertRaisesRegex(InputError, "strictly ascending"):
            evaluate(document)

    def test_tied_verify_history_is_rejected(self):
        document = observation()
        document["checks"][7] = close_check(
            "fail",
            [
                verify_record(1, "pass", record_id="verify-a"),
                verify_record(1, "fail", record_id="verify-b"),
            ],
        )
        with self.assertRaisesRegex(InputError, "unique sequence"):
            evaluate(document)

    def test_mismatched_verify_commands_derive_unknown(self):
        document = observation()
        document["checks"][7] = close_check(
            "unknown", [verify_record(1, "pass", command="pytest")]
        )
        document["checks"] = document["checks"][:-1]
        result = evaluate(document)
        self.assertFalse(result["eligible"])
        self.assertIn("completion evidence conflicts or is unknown", result["reasons"])

    def test_missing_verify_history_derives_unknown(self):
        document = observation()
        document["checks"][7] = close_check("unknown", [])
        document["checks"] = document["checks"][:-1]
        self.assertFalse(evaluate(document)["eligible"])

    def test_valid_latest_verify_pass_and_fail_are_derived(self):
        passed = evaluate(observation(completed=True))
        failed = evaluate(observation())
        self.assertEqual(passed["candidate"], "completed")
        self.assertEqual(failed["candidate"], "parked")


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
        preservation = candidate["checks"][5]["evidence"]
        preservation["reference"] = "b" * 40
        preservation["resolved_head"] = "b" * 40
        preservation["resolver_command"][-1] = f"{'b' * 40}^{{commit}}"
        with self.assertRaisesRegex(InputError, "preservation reference"):
            validate_receipt(candidate)

    def test_anchor_must_match_confirmed_anchor_evidence(self):
        candidate = receipt()
        candidate["anchor_bead"] = "agents-other"
        with self.assertRaisesRegex(InputError, "confirmed anchor"):
            validate_receipt(candidate)

    def test_repository_path_must_match_validated_binding(self):
        candidate = receipt()
        candidate["repository"]["path"] = "/tmp/other"
        with self.assertRaisesRegex(InputError, "validated repository binding"):
            validate_receipt(candidate)

    def test_vcs_backend_must_match_every_authoritative_evidence_source(self):
        candidate = receipt()
        candidate["checks"][4]["evidence"]["source"] = "jj"
        candidate["checks"][4]["evidence"]["backend"] = "jj"
        candidate["checks"][4]["evidence"]["commands"] = [
            ["jj", "--repository", "/tmp/example", "status"],
            ["jj", "--repository", "/tmp/example", "resolve", "--list"],
        ]
        with self.assertRaisesRegex(InputError, "repository.vcs"):
            validate_receipt(candidate)

    def test_model_prose_cannot_be_durable_preservation_source(self):
        candidate = receipt()
        candidate["checks"][5]["evidence"]["source"] = "model.prose"
        with self.assertRaisesRegex(InputError, "authoritative preservation source"):
            validate_receipt(candidate)

    def test_both_preservation_rows_must_use_same_bound_workspace(self):
        candidate = receipt()
        candidate["checks"][6]["evidence"]["workspace"] = "/tmp/other"
        with self.assertRaisesRegex(InputError, "same bound workspace"):
            validate_receipt(candidate)

    def test_parked_resolver_backend_must_match_repository_vcs(self):
        candidate = receipt()
        candidate["checks"][-1]["evidence"]["source"] = "jj"
        candidate["checks"][-1]["evidence"]["backend"] = "jj"
        candidate["checks"][-1]["evidence"]["resolver_command"] = [
            "jj",
            "--repository",
            "/tmp/example",
            "log",
            "-r",
            "main",
            "--no-graph",
        ]
        with self.assertRaisesRegex(InputError, "resume resolver.*repository.vcs"):
            validate_receipt(candidate)

    def test_combined_uncorrelated_adversarial_receipt_exits_two(self):
        candidate = receipt()
        candidate["anchor_bead"] = "agents-other"
        candidate["repository"]["path"] = "/tmp/other"
        candidate["checks"][5]["evidence"]["source"] = "model.prose"
        candidate["checks"][-1]["evidence"]["source"] = "jj"
        candidate["checks"][-1]["evidence"]["backend"] = "jj"
        result = cli("validate-receipt", candidate)
        self.assertEqual(result.returncode, 2)
        self.assertNotEqual(result.stdout, '{"valid": true}\n')

    def test_claimed_outcome_must_match_fold(self):
        candidate = receipt()
        candidate["outcome"] = "completed"
        candidate.pop("resume")
        with self.assertRaisesRegex(InputError, "does not match deterministic fold"):
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
    def invocation(self, prior_receipts):
        return {
            "mode": "park",
            "anchor_bead": "agents-dba741",
            "episode_id": EPISODE_ID,
            "intent_id": INTENT_ID,
            "prior_receipts": prior_receipts,
        }

    def prior_source(self, candidate, comment_id):
        source_bytes = json.dumps(candidate, sort_keys=True, separators=(",", ":"))
        return {
            "receipt": candidate,
            "source_bytes": source_bytes,
            "comment_id": comment_id,
        }

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
        result = prepare_attempt(self.invocation([existing]))
        self.assertEqual(result["action"], "return_existing")
        self.assertEqual(result["receipt"], existing)
        self.assertNotIn("attempt_id", result)

    def test_conflicting_prior_successes_fail_closed_in_forward_order(self):
        first = receipt()
        second = receipt()
        second["repository"]["head"] = "b" * 40
        second["checks"][5]["evidence"]["reference"] = "b" * 40
        second["checks"][5]["evidence"]["resolved_head"] = "b" * 40
        second["checks"][5]["evidence"]["resolver_command"][-1] = (
            f"{'b' * 40}^{{commit}}"
        )
        second["checks"][6] = copy.deepcopy(second["checks"][5])
        second["checks"][6]["name"] = (
            "commits_reachable_or_checkpoint_resolvable"
        )
        second["checks"][-1]["evidence"]["target"]["resolved_head"] = "b" * 40
        second["checks"][-1]["evidence"]["resolver_command"][-1] = "main"
        binding = second["checks"][1]["evidence"]["binding"]
        binding["receipt_identity"]["repository"]["head"] = "b" * 40
        with self.assertRaisesRegex(InputError, "conflicting prior successes"):
            prepare_attempt(self.invocation([first, second]))

    def test_conflicting_prior_successes_fail_closed_in_reverse_order(self):
        first = receipt()
        second = copy.deepcopy(first)
        second["outcome"] = "completed"
        second.pop("resume")
        second["checks"] = observation(completed=True)["checks"]
        with self.assertRaisesRegex(InputError, "conflicting prior successes"):
            prepare_attempt(self.invocation([second, first]))

    def test_semantically_identical_duplicates_preserve_all_source_metadata(self):
        first = receipt()
        second = copy.deepcopy(first)
        second["attempt_id"] = "attempt-44444444-4444-4444-8444-444444444444"
        sources = [
            self.prior_source(first, "comment-2"),
            self.prior_source(second, "comment-1"),
        ]
        result = prepare_attempt(self.invocation(sources))
        self.assertEqual(result["action"], "return_existing")
        self.assertEqual(
            [source["comment_id"] for source in result["prior_sources"]],
            ["comment-1", "comment-2"],
        )
        self.assertEqual(
            {source["source_bytes"] for source in result["prior_sources"]},
            {source["source_bytes"] for source in sources},
        )

    def test_identical_duplicate_result_is_order_independent(self):
        candidate = receipt()
        first = self.prior_source(candidate, "comment-2")
        second = self.prior_source(copy.deepcopy(candidate), "comment-1")
        forward = prepare_attempt(self.invocation([first, second]))
        reverse = prepare_attempt(self.invocation([second, first]))
        self.assertEqual(forward, reverse)


class RepositoryBindingTests(unittest.TestCase):
    def binding_payload(
        self,
        selector_kind,
        *,
        remote="git@github.com:example/project.git",
        registration_url=REMOTE,
    ):
        return {
            "selector": {
                "kind": selector_kind,
                "value": EPISODE_ID
                if selector_kind == "episode"
                else "agents-dba741",
            },
            "receipt_identity": {
                "episode_id": EPISODE_ID,
                "anchor_bead": "agents-dba741",
                "repository": {
                    "path": "/tmp/example",
                    "vcs": "git",
                    "branch": "main",
                    "head": HEAD,
                },
            },
            "observations": binding_observations("/tmp/example", remote),
            "registrations": [
                {
                    "name": "project",
                    "url": registration_url,
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
        payload["observations"]["root"]["stdout"] = "/tmp/other"
        with self.assertRaisesRegex(InputError, "receipt path/root contradiction"):
            bind_repository(payload)

    def test_remote_or_common_dir_identity_contradiction_is_rejected(self):
        payload = self.binding_payload("bead")
        payload["observations"]["remote"]["stdout"] = (
            "https://github.com/example/unrelated.git"
        )
        with self.assertRaisesRegex(InputError, "registered repository"):
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

    def test_non_default_remote_ports_are_not_collapsed(self):
        payload = self.binding_payload(
            "episode",
            remote="ssh://git@code.example:2222/team/repo.git",
            registration_url="ssh://git@code.example:3333/team/repo.git",
        )
        with self.assertRaisesRegex(InputError, "exactly one registered repository"):
            bind_repository(payload)

    def test_bead_selector_must_equal_receipt_anchor(self):
        payload = self.binding_payload("bead")
        payload["selector"]["value"] = "agents-other"
        with self.assertRaisesRegex(InputError, "selector must match receipt anchor"):
            bind_repository(payload)

    def test_episode_selector_must_equal_receipt_episode(self):
        payload = self.binding_payload("episode")
        payload["selector"]["value"] = (
            "ep-99999999-9999-4999-8999-999999999999"
        )
        with self.assertRaisesRegex(InputError, "selector must match receipt episode"):
            bind_repository(payload)

    def test_arbitrary_common_dir_is_rejected_even_when_absolute(self):
        payload = self.binding_payload("bead")
        payload["observations"]["common_dir"]["stdout"] = "/tmp/arbitrary-common"
        with self.assertRaisesRegex(InputError, "common-dir relationship"):
            bind_repository(payload)

    def test_git_dir_outside_common_dir_is_rejected(self):
        payload = self.binding_payload("episode")
        payload["observations"]["git_dir"]["stdout"] = "/tmp/other/.git"
        with self.assertRaisesRegex(InputError, "common-dir relationship"):
            bind_repository(payload)

    def test_observation_command_must_be_exactly_bound(self):
        payload = self.binding_payload("bead")
        payload["observations"]["common_dir"]["command"][2] = "/tmp/other"
        with self.assertRaisesRegex(InputError, "exact bound command"):
            bind_repository(payload)

    def test_receipt_backend_must_match_observation_backend(self):
        payload = self.binding_payload("episode")
        payload["receipt_identity"]["repository"]["vcs"] = "jj"
        payload["receipt_identity"]["repository"]["head"] = "jjchange123"
        with self.assertRaisesRegex(InputError, "backend observations"):
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
