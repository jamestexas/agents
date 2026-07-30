#!/usr/bin/env python3
"""Pure protocol gates for the park-work skill."""

import json
import os
import re
import shlex
import sys
import uuid
from datetime import datetime
from urllib.parse import urlparse


OUTCOMES = {"pass", "fail", "unknown"}
PROTOCOL_PHASES = {"preflight", "durable"}
CHECK_CATEGORIES = {
    "anchor_confirmed": "identity",
    "repository_resolved": "identity",
    "no_active_dispatch": "quiescence",
    "no_running_child_operation": "quiescence",
    "no_vcs_operation_or_conflict": "quiescence",
    "tree_preserved": "preservation",
    "commits_reachable_or_checkpoint_resolvable": "preservation",
    "close_condition_satisfied": "completion",
    "bead_terminal": "completion",
    "pr_merged": "completion",
    "resume_target_resolvable": "resume",
}
BASE_CHECKS = {
    "anchor_confirmed",
    "repository_resolved",
    "no_active_dispatch",
    "no_running_child_operation",
    "no_vcs_operation_or_conflict",
    "tree_preserved",
    "commits_reachable_or_checkpoint_resolvable",
}
COMPLETION_CHECKS = {"close_condition_satisfied", "bead_terminal"}
PRESERVATION_CHECKS = {
    "tree_preserved",
    "commits_reachable_or_checkpoint_resolvable",
}
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
RFC3339_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"
    r"(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)
GIT_HEAD_PATTERN = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
ATOMIC_RESUME_MECHANISM = "rosary-04faf5"


class InputError(ValueError):
    """Raised when input cannot participate in the fail-closed protocol."""


def _require_object(value, label):
    if not isinstance(value, dict):
        raise InputError(f"{label} must be an object")
    return value


def _require_exact_keys(value, required, label, optional=()):
    keys = set(value)
    required = set(required)
    optional = set(optional)
    missing = required - keys
    if missing:
        raise InputError(f"{label} missing field {sorted(missing)[0]}")
    unknown = keys - required - optional
    if unknown:
        raise InputError(f"{label} has unknown field {sorted(unknown)[0]}")


def _nonempty_string(value, label):
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"{label} must be a non-empty string")
    return value


def _rfc3339(value, label):
    _nonempty_string(value, label)
    if not RFC3339_PATTERN.fullmatch(value):
        raise InputError(f"{label} must be a valid RFC3339 timestamp")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError as error:
        raise InputError(f"{label} must be a valid RFC3339 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise InputError(f"{label} must be a valid RFC3339 timestamp")
    return value


def _identifier(value, prefix, label):
    _nonempty_string(value, label)
    suffix = value[len(prefix) :] if value.startswith(prefix) else ""
    if not UUID_PATTERN.fullmatch(suffix):
        raise InputError(f"{label} must be {prefix}<UUID>")
    return value


def _url(value, label):
    _nonempty_string(value, label)
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise InputError(f"{label} must be an absolute HTTP(S) URL")
    return value


def _common_evidence(item, index):
    evidence = item["evidence"]
    if not isinstance(evidence, dict) or not evidence:
        raise InputError(f"checks[{index}].evidence must be a non-empty object")
    _nonempty_string(evidence.get("source"), f"checks[{index}].evidence.source")
    _nonempty_string(evidence.get("detail"), f"checks[{index}].evidence.detail")
    return evidence


def _validate_anchor_evidence(evidence, index):
    _require_exact_keys(
        evidence, {"source", "detail", "anchor"}, f"checks[{index}].evidence"
    )
    if evidence["source"] not in {"explicit", "human_confirmation"}:
        raise InputError(f"checks[{index}] anchor source is not authoritative")
    _nonempty_string(evidence["anchor"], f"checks[{index}].evidence.anchor")


def _validate_repository_evidence(evidence, index):
    _require_exact_keys(
        evidence,
        {"source", "detail", "bound_root", "remote"},
        f"checks[{index}].evidence",
    )
    if evidence["source"] != "registered_repository_binding":
        raise InputError(f"checks[{index}] repository source is not authoritative")
    root = _nonempty_string(
        evidence["bound_root"], f"checks[{index}].evidence.bound_root"
    )
    if not os.path.isabs(root):
        raise InputError(f"checks[{index}].evidence.bound_root must be absolute")
    _nonempty_string(evidence["remote"], f"checks[{index}].evidence.remote")


def _validate_dispatch_evidence(evidence, item, index):
    label = f"checks[{index}].evidence"
    if item["outcome"] == "unknown":
        _require_exact_keys(evidence, {"source", "detail", "error"}, label)
        _nonempty_string(evidence["error"], f"{label}.error")
    else:
        _require_exact_keys(evidence, {"source", "detail", "active_records"}, label)
        records = evidence["active_records"]
        if not isinstance(records, list) or any(
            not isinstance(record, str) or not record for record in records
        ):
            raise InputError(f"{label}.active_records must be an array of strings")
        if (item["outcome"] == "pass") != (records == []):
            raise InputError(f"checks[{index}] outcome contradicts active records")
    if evidence["source"] != "rsry_active+rsry_dispatch_history":
        raise InputError(f"checks[{index}] dispatch source is not authoritative")


def _validate_child_evidence(evidence, item, index):
    label = f"checks[{index}].evidence"
    allowed_sources = {
        "codex.current_child_operations": "codex",
        "claude.current_child_operations": "claude",
    }
    if evidence["source"] not in allowed_sources:
        raise InputError(f"checks[{index}] child source is not a current-client query")
    if item["outcome"] == "unknown":
        _require_exact_keys(
            evidence,
            {"source", "detail", "client", "authoritative", "error"},
            label,
        )
        if evidence["authoritative"] is not False:
            raise InputError(f"{label}.authoritative must be false when unknown")
        _nonempty_string(evidence["error"], f"{label}.error")
    else:
        _require_exact_keys(
            evidence,
            {"source", "detail", "client", "authoritative", "running"},
            label,
        )
        if evidence["authoritative"] is not True:
            raise InputError(f"{label}.authoritative must be true")
        running = evidence["running"]
        if not isinstance(running, list) or any(
            not isinstance(operation, str) or not operation for operation in running
        ):
            raise InputError(f"{label}.running must be an array of strings")
        if (item["outcome"] == "pass") != (running == []):
            raise InputError(f"checks[{index}] outcome contradicts running children")
    if evidence["client"] != allowed_sources[evidence["source"]]:
        raise InputError(f"checks[{index}] child client/source mismatch")


def _validate_vcs_evidence(evidence, item, index):
    label = f"checks[{index}].evidence"
    if evidence["source"] not in {"git", "jj"}:
        raise InputError(f"checks[{index}] VCS evidence source must be git or jj")
    if item["outcome"] == "unknown":
        _require_exact_keys(evidence, {"source", "detail", "error"}, label)
        _nonempty_string(evidence["error"], f"{label}.error")
        return
    _require_exact_keys(
        evidence, {"source", "detail", "conflicts", "operations"}, label
    )
    for field in ("conflicts", "operations"):
        values = evidence[field]
        if not isinstance(values, list) or any(
            not isinstance(value, str) or not value for value in values
        ):
            raise InputError(f"{label}.{field} must be an array of strings")
    clear = evidence["conflicts"] == [] and evidence["operations"] == []
    if (item["outcome"] == "pass") != clear:
        raise InputError(f"checks[{index}] outcome contradicts VCS evidence")


def _validate_preservation_evidence(evidence, item, index, phase):
    label = f"checks[{index}].evidence"
    if phase == "preflight":
        _require_exact_keys(
            evidence, {"source", "detail", "state", "workspace"}, label
        )
        if (
            item["outcome"] != "pass"
            or evidence["state"] != "checkpointable"
            or evidence["source"] != "rsry_workspace_checkpoint"
        ):
            raise InputError(
                f"checks[{index}] preflight preservation must be checkpointable"
            )
        workspace = _nonempty_string(evidence["workspace"], f"{label}.workspace")
        if not os.path.isabs(workspace):
            raise InputError(f"{label}.workspace must be absolute")
        return
    if item["outcome"] == "pass":
        if evidence.get("state") != "durable":
            raise InputError(f"checks[{index}] requires durable preservation evidence")
        _require_exact_keys(
            evidence, {"source", "detail", "state", "reference"}, label
        )
        _nonempty_string(evidence["reference"], f"{label}.reference")
    elif item["outcome"] == "fail":
        _require_exact_keys(evidence, {"source", "detail", "state", "error"}, label)
        if evidence["state"] != "unpreserved":
            raise InputError(f"checks[{index}] failed evidence must be unpreserved")
        _nonempty_string(evidence["error"], f"{label}.error")
    else:
        _require_exact_keys(evidence, {"source", "detail", "state", "error"}, label)
        if evidence["state"] != "unknown":
            raise InputError(f"checks[{index}] unknown preservation state is invalid")
        _nonempty_string(evidence["error"], f"{label}.error")


def _validate_close_evidence(evidence, item, index, bead):
    label = f"checks[{index}].evidence"
    if evidence["source"] != "rsry_bead_history":
        raise InputError(f"checks[{index}] close condition source is not Rosary verify")
    if item["outcome"] == "unknown":
        _require_exact_keys(evidence, {"source", "detail", "error"}, label)
        _nonempty_string(evidence["error"], f"{label}.error")
        return
    _require_exact_keys(
        evidence,
        {
            "source",
            "detail",
            "observation_kind",
            "latest",
            "acceptance_command",
            "observed_command",
            "verdict",
            "verdict_id",
        },
        label,
    )
    if evidence["observation_kind"] != "verify" or evidence["latest"] is not True:
        raise InputError(f"checks[{index}] must use the latest verify observation")
    command = bead["acceptance_command"]
    if (
        evidence["acceptance_command"] != command
        or evidence["observed_command"] != command
    ):
        raise InputError(
            f"checks[{index}] verify command must match declared acceptance command"
        )
    if evidence["verdict"] != item["outcome"]:
        raise InputError(f"checks[{index}] outcome must match verify verdict")
    _nonempty_string(evidence["verdict_id"], f"{label}.verdict_id")


def _validate_terminal_evidence(evidence, item, index):
    label = f"checks[{index}].evidence"
    if evidence["source"] != "rsry_list_beads":
        raise InputError(f"checks[{index}] bead status source is not authoritative")
    if item["outcome"] == "unknown":
        _require_exact_keys(evidence, {"source", "detail", "error"}, label)
        _nonempty_string(evidence["error"], f"{label}.error")
        return
    _require_exact_keys(evidence, {"source", "detail", "status"}, label)
    status = _nonempty_string(evidence["status"], f"{label}.status")
    terminal = status in {"closed", "done"}
    if (item["outcome"] == "pass") != terminal:
        raise InputError(f"checks[{index}] outcome contradicts bead status")


def _validate_pr_evidence(evidence, item, index, pr_url):
    label = f"checks[{index}].evidence"
    if evidence["source"] != "gh":
        raise InputError(f"checks[{index}] PR source must be exact provider read")
    expected_command = ["gh", "pr", "view", pr_url, "--json", "state,mergedAt,url"]
    if item["outcome"] == "unknown":
        _require_exact_keys(
            evidence, {"source", "detail", "command", "error"}, label
        )
        if evidence["command"] != expected_command:
            raise InputError(f"checks[{index}] PR command is not the exact read-only query")
        _nonempty_string(evidence["error"], f"{label}.error")
        return
    _require_exact_keys(
        evidence, {"source", "detail", "command", "response"}, label
    )
    if evidence["command"] != expected_command:
        raise InputError(f"checks[{index}] PR command is not the exact read-only query")
    response = _require_object(evidence["response"], f"{label}.response")
    _require_exact_keys(response, {"state", "mergedAt", "url"}, f"{label}.response")
    if response["url"] != pr_url:
        raise InputError(f"checks[{index}] PR response URL must match bead PR URL")
    if item["outcome"] == "pass":
        if response["state"] != "MERGED":
            raise InputError(f"checks[{index}] passing PR state must be MERGED")
        _rfc3339(response["mergedAt"], f"{label}.response.mergedAt")
    else:
        if response["state"] not in {"OPEN", "CLOSED"} or response["mergedAt"] is not None:
            raise InputError(f"checks[{index}] failed PR evidence is malformed")


def _validate_resume_evidence(evidence, item, index):
    label = f"checks[{index}].evidence"
    if evidence["source"] not in {"git", "jj"}:
        raise InputError(f"checks[{index}] resume resolver must be git or jj")
    if item["outcome"] == "unknown":
        _require_exact_keys(evidence, {"source", "detail", "error"}, label)
        _nonempty_string(evidence["error"], f"{label}.error")
        return
    _require_exact_keys(evidence, {"source", "detail", "target"}, label)
    target = _require_object(evidence["target"], f"{label}.target")
    _require_exact_keys(
        target, {"kind", "value", "resolved_head"}, f"{label}.target"
    )
    if target["kind"] not in {"checkpoint", "branch"}:
        raise InputError(f"{label}.target.kind is invalid")
    _nonempty_string(target["value"], f"{label}.target.value")
    _nonempty_string(target["resolved_head"], f"{label}.target.resolved_head")


def _validate_check_evidence(item, index, phase, bead):
    evidence = _common_evidence(item, index)
    name = item["name"]
    if name == "anchor_confirmed":
        _validate_anchor_evidence(evidence, index)
    elif name == "repository_resolved":
        _validate_repository_evidence(evidence, index)
    elif name == "no_active_dispatch":
        _validate_dispatch_evidence(evidence, item, index)
    elif name == "no_running_child_operation":
        _validate_child_evidence(evidence, item, index)
    elif name == "no_vcs_operation_or_conflict":
        _validate_vcs_evidence(evidence, item, index)
    elif name in PRESERVATION_CHECKS:
        _validate_preservation_evidence(evidence, item, index, phase)
    elif name == "close_condition_satisfied":
        _validate_close_evidence(evidence, item, index, bead)
    elif name == "bead_terminal":
        _validate_terminal_evidence(evidence, item, index)
    elif name == "pr_merged":
        _validate_pr_evidence(evidence, item, index, bead["pr_url"])
    elif name == "resume_target_resolvable":
        _validate_resume_evidence(evidence, item, index)


def _validate_bead(document):
    if not isinstance(document.get("pr_backed"), bool):
        raise InputError("pr_backed must be boolean")
    bead = _require_object(document.get("bead"), "bead")
    _require_exact_keys(bead, {"acceptance_command", "pr_url"}, "bead")
    _nonempty_string(bead["acceptance_command"], "bead.acceptance_command")
    pr_url = bead["pr_url"]
    if pr_url is not None:
        _url(pr_url, "bead.pr_url")
    if document["pr_backed"] != (pr_url is not None):
        raise InputError("pr_backed must be derived from bead.pr_url")
    return bead


def _validated_checks(document, allowed_document_keys):
    _require_object(document, "document")
    _require_exact_keys(
        document,
        {"schema_version", "protocol_phase", "pr_backed", "bead", "checks"},
        "document",
        optional=allowed_document_keys,
    )
    if document.get("schema_version") != 1:
        raise InputError("schema_version must be 1")
    phase = document.get("protocol_phase")
    if phase not in PROTOCOL_PHASES:
        raise InputError("protocol_phase must be preflight or durable")
    bead = _validate_bead(document)
    checks = document.get("checks")
    if not isinstance(checks, list):
        raise InputError("checks must be an array")

    by_name = {}
    for index, item in enumerate(checks):
        if not isinstance(item, dict):
            raise InputError(f"checks[{index}] must be an object")
        _require_exact_keys(
            item,
            {"name", "category", "outcome", "evidence", "observed_at"},
            f"checks[{index}]",
        )
        name = _nonempty_string(item["name"], f"checks[{index}].name")
        if name not in CHECK_CATEGORIES:
            raise InputError(f"unknown check {name}")
        if name in by_name:
            raise InputError(f"duplicate check {name}")
        category = _nonempty_string(item["category"], f"checks[{index}].category")
        expected_category = CHECK_CATEGORIES[name]
        if category != expected_category:
            raise InputError(f"check {name} must use category {expected_category}")
        if item["outcome"] not in OUTCOMES:
            raise InputError(f"checks[{index}].outcome is invalid")
        _rfc3339(item["observed_at"], f"checks[{index}].observed_at")
        by_name[name] = item

    required = set(BASE_CHECKS) | set(COMPLETION_CHECKS)
    if document["pr_backed"]:
        required.add("pr_merged")
    elif "pr_merged" in by_name:
        raise InputError("pr_merged is not applicable to non-PR work")
    for name in sorted(required):
        if name not in by_name:
            raise InputError(f"missing required check {name}")

    completion_names = set(COMPLETION_CHECKS)
    if document["pr_backed"]:
        completion_names.add("pr_merged")
    completion_outcomes = {by_name[name]["outcome"] for name in completion_names}
    if completion_outcomes == {"fail"}:
        if "resume_target_resolvable" not in by_name:
            raise InputError("missing required check resume_target_resolvable")
    elif "resume_target_resolvable" in by_name:
        raise InputError("resume_target_resolvable is not applicable")

    expected = required | (
        {"resume_target_resolvable"} if completion_outcomes == {"fail"} else set()
    )
    unexpected = set(by_name) - expected
    if unexpected:
        raise InputError(f"unknown check {sorted(unexpected)[0]}")

    for index, item in enumerate(checks):
        _validate_check_evidence(item, index, phase, bead)
    return by_name, completion_names


def _decision(document, by_name, completion_names):
    phase = document["protocol_phase"]
    reasons = [
        f"{name}={by_name[name]['outcome']}"
        for name in sorted(BASE_CHECKS - PRESERVATION_CHECKS)
        if by_name[name]["outcome"] != "pass"
    ]
    completion_outcomes = {by_name[name]["outcome"] for name in completion_names}
    candidate = None
    if completion_outcomes == {"pass"}:
        candidate = "completed"
    elif completion_outcomes == {"fail"}:
        candidate = "parked"
    else:
        reasons.append("completion evidence conflicts or is unknown")

    if phase == "preflight":
        if reasons or candidate is None:
            return {
                "protocol_phase": phase,
                "candidate": None,
                "eligible": False,
                "action": None,
                "reasons": reasons,
            }
        return {
            "protocol_phase": phase,
            "candidate": candidate,
            "eligible": False,
            "action": "checkpoint",
            "reasons": ["durable preservation evidence required"],
        }

    reasons.extend(
        f"{name}={by_name[name]['outcome']}"
        for name in sorted(PRESERVATION_CHECKS)
        if by_name[name]["outcome"] != "pass"
    )
    if candidate == "parked":
        resume = by_name["resume_target_resolvable"]
        if resume["outcome"] != "pass":
            reasons.append(f"resume_target_resolvable={resume['outcome']}")
    if reasons or candidate is None:
        return {
            "protocol_phase": phase,
            "candidate": None,
            "eligible": False,
            "action": None,
            "reasons": reasons,
        }
    return {
        "protocol_phase": phase,
        "candidate": candidate,
        "eligible": True,
        "action": "write_receipt",
        "reasons": [],
    }


def evaluate(document):
    """Validate and fold one exact preflight or durable observation."""

    by_name, completion_names = _validated_checks(document, allowed_document_keys=())
    return _decision(document, by_name, completion_names)


def _validate_repository(repository):
    repository = _require_object(repository, "repository")
    _require_exact_keys(repository, {"path", "vcs", "branch", "head"}, "repository")
    if not isinstance(repository["path"], str):
        raise InputError("repository.path must be a string")
    if not repository["path"].strip():
        raise InputError("repository.path must be an absolute non-empty string")
    path = repository["path"]
    if not os.path.isabs(path):
        raise InputError("repository.path must be absolute")
    if os.path.normpath(path) != path:
        raise InputError("repository.path must be normalized")
    if repository["vcs"] not in {"git", "jj"}:
        raise InputError("repository.vcs must be git or jj")
    _nonempty_string(repository["branch"], "repository.branch")
    if not isinstance(repository["head"], str) or not repository["head"].strip():
        raise InputError("repository.head must be an immutable non-empty string")
    head = repository["head"]
    if repository["vcs"] == "git" and not GIT_HEAD_PATTERN.fullmatch(head):
        raise InputError("repository.head must be a full immutable Git object ID")
    if repository["vcs"] == "jj" and (
        any(character.isspace() for character in head) or len(head) < 8
    ):
        raise InputError("repository.head must be an immutable jj change ID")
    return repository


def _validate_provider_sessions(provider_sessions):
    if not isinstance(provider_sessions, list):
        raise InputError("provider_sessions must be an array")
    seen = set()
    for index, session in enumerate(provider_sessions):
        if not isinstance(session, dict):
            raise InputError(f"provider_sessions[{index}] must be an object")
        _require_exact_keys(
            session, {"provider", "id"}, f"provider_sessions[{index}]"
        )
        if session["provider"] not in {"codex", "claude"}:
            raise InputError(f"provider_sessions[{index}].provider is invalid")
        session_id = _nonempty_string(
            session["id"], f"provider_sessions[{index}].id"
        )
        key = (session["provider"], session_id)
        if key in seen:
            raise InputError("provider_sessions must be unique")
        seen.add(key)


def _validate_references(references):
    if not isinstance(references, list) or any(
        not isinstance(reference, str) or not reference.strip()
        for reference in references
    ):
        raise InputError("references must be an array of non-empty strings")


def _validate_resume(receipt, by_name):
    resume = _require_object(receipt.get("resume"), "resume")
    _require_exact_keys(
        resume,
        {"next_action"},
        "resume",
        optional={"checkpoint", "branch"},
    )
    _nonempty_string(resume["next_action"], "resume.next_action")
    targets = [name for name in ("checkpoint", "branch") if name in resume]
    if len(targets) != 1:
        raise InputError("parked receipt requires exactly one resume target")
    kind = targets[0]
    value = _nonempty_string(resume[kind], f"resume.{kind}")
    resolver = by_name["resume_target_resolvable"]
    if resolver["outcome"] != "pass":
        raise InputError("parked receipt requires passing resolver evidence")
    observed_target = resolver["evidence"]["target"]
    if (
        observed_target["kind"] != kind
        or observed_target["value"] != value
    ):
        raise InputError("resume target must match resolver evidence")
    if observed_target["resolved_head"] != receipt["repository"]["head"]:
        raise InputError("resume resolver must match immutable repository head")


def validate_receipt(receipt):
    """Validate a durable successful receipt and its fold correlation."""

    receipt_fields = {
        "episode_id",
        "intent_id",
        "attempt_id",
        "anchor_bead",
        "provider_sessions",
        "repository",
        "outcome",
        "safe_to_close",
        "references",
        "resume",
    }
    by_name, completion_names = _validated_checks(
        receipt, allowed_document_keys=receipt_fields
    )
    required = {
        "schema_version",
        "protocol_phase",
        "pr_backed",
        "bead",
        "checks",
        "episode_id",
        "intent_id",
        "attempt_id",
        "anchor_bead",
        "provider_sessions",
        "repository",
        "outcome",
        "safe_to_close",
        "references",
    }
    if receipt.get("outcome") == "parked":
        required.add("resume")
    _require_exact_keys(receipt, required, "receipt")
    if receipt["protocol_phase"] != "durable":
        raise InputError("receipt validation requires durable protocol phase")
    _identifier(receipt["episode_id"], "ep-", "episode_id")
    _identifier(receipt["intent_id"], "park-", "intent_id")
    _identifier(receipt["attempt_id"], "attempt-", "attempt_id")
    _nonempty_string(receipt["anchor_bead"], "anchor_bead")
    _validate_provider_sessions(receipt["provider_sessions"])
    repository = _validate_repository(receipt["repository"])
    for name in PRESERVATION_CHECKS:
        item = by_name[name]
        if (
            item["outcome"] == "pass"
            and item["evidence"]["reference"] != repository["head"]
        ):
            raise InputError(
                f"{name} preservation reference must match repository.head"
            )
    _validate_references(receipt["references"])
    if receipt["outcome"] not in {"completed", "parked"}:
        raise InputError("outcome must be completed or parked")
    if receipt["safe_to_close"] is not True:
        raise InputError("successful receipt must set safe_to_close=true")
    decision = _decision(receipt, by_name, completion_names)
    if (
        not decision["eligible"]
        or decision["candidate"] != receipt["outcome"]
        or decision["action"] != "write_receipt"
    ):
        raise InputError("receipt outcome does not match deterministic fold")
    if receipt["outcome"] == "parked":
        _validate_resume(receipt, by_name)


def _receipt_fence_payload(body):
    if not isinstance(body, str):
        return None
    opening = "```work_episode_receipt/v1\n"
    closing = "\n```"
    if not body.startswith(opening) or not body.endswith(closing):
        return None
    payload = body[len(opening) : -len(closing)]
    if not payload or "```" in payload:
        return None
    return payload


def confirm_receipt_readback(document):
    """Prove exact durable bead-comment readback for serialized receipt bytes."""

    document = _require_object(document, "readback")
    _require_exact_keys(document, {"receipt_bytes", "comments"}, "readback")
    receipt_bytes = _nonempty_string(
        document["receipt_bytes"], "readback.receipt_bytes"
    )
    try:
        expected = json.loads(receipt_bytes)
    except json.JSONDecodeError as error:
        raise InputError("readback.receipt_bytes must be valid JSON") from error
    validate_receipt(expected)
    comments = document["comments"]
    if not isinstance(comments, list):
        raise InputError("readback.comments must be an array")

    exact_matches = []
    conflicting_intent = False
    for index, comment in enumerate(comments):
        if not isinstance(comment, dict):
            raise InputError(f"readback.comments[{index}] must be an object")
        _require_exact_keys(
            comment, {"id", "body"}, f"readback.comments[{index}]"
        )
        comment_id = _nonempty_string(
            comment["id"], f"readback.comments[{index}].id"
        )
        payload = _receipt_fence_payload(comment["body"])
        if payload is None:
            continue
        try:
            candidate = json.loads(payload)
            validate_receipt(candidate)
        except (json.JSONDecodeError, InputError):
            continue
        if candidate["intent_id"] != expected["intent_id"]:
            continue
        if payload == receipt_bytes:
            exact_matches.append(comment_id)
        else:
            conflicting_intent = True

    if conflicting_intent:
        return {
            "durable": False,
            "safe_to_close": False,
            "comment_id": None,
            "reasons": ["conflicting receipt bytes for stable intent"],
        }
    if not exact_matches:
        return {
            "durable": False,
            "safe_to_close": False,
            "comment_id": None,
            "reasons": ["matching receipt comment not found"],
        }
    return {
        "durable": True,
        "safe_to_close": True,
        "comment_id": exact_matches[0],
        "reasons": [],
    }


def _mint(prefix):
    return prefix + str(uuid.uuid4())


def prepare_attempt(invocation):
    """Plan a caller-stable park retry without persisting unsafe attempts."""

    invocation = _require_object(invocation, "invocation")
    _require_exact_keys(
        invocation,
        {"mode", "anchor_bead", "episode_id", "intent_id", "prior_receipts"},
        "invocation",
    )
    if invocation["mode"] != "park":
        raise InputError("invocation.mode must be park")
    anchor = _nonempty_string(invocation["anchor_bead"], "invocation.anchor_bead")
    episode_id = invocation["episode_id"]
    intent_id = invocation["intent_id"]
    if episode_id is not None:
        _identifier(episode_id, "ep-", "episode_id")
    if intent_id is not None:
        _identifier(intent_id, "park-", "intent_id")
    if not isinstance(invocation["prior_receipts"], list):
        raise InputError("invocation.prior_receipts must be an array")

    if episode_id is None or intent_id is None:
        episode_id = episode_id or _mint("ep-")
        intent_id = intent_id or _mint("park-")
        retry_command = (
            f"/park-work --episode-id {shlex.quote(episode_id)} "
            f"--intent-id {shlex.quote(intent_id)} {shlex.quote(anchor)}"
        )
        return {
            "ready": False,
            "action": "retry",
            "episode_id": episode_id,
            "intent_id": intent_id,
            "retry_command": retry_command,
        }

    for candidate in invocation["prior_receipts"]:
        if not isinstance(candidate, dict):
            raise InputError("prior_receipts items must be objects")
        if candidate.get("intent_id") != intent_id:
            continue
        validate_receipt(candidate)
        if (
            candidate["episode_id"] == episode_id
            and candidate["anchor_bead"] == anchor
        ):
            return {
                "ready": True,
                "action": "return_existing",
                "episode_id": episode_id,
                "intent_id": intent_id,
                "receipt": candidate,
            }
        raise InputError("prior successful receipt contradicts stable identity")

    return {
        "ready": True,
        "action": "evaluate",
        "episode_id": episode_id,
        "intent_id": intent_id,
        "attempt_id": _mint("attempt-"),
    }


def _normalize_remote(remote):
    remote = _nonempty_string(remote, "remote").strip()
    if re.match(r"^[^/@:\s]+@[^/:\s]+:.+$", remote):
        user_host, path = remote.split(":", 1)
        host = user_host.split("@", 1)[1]
        normalized = f"{host}/{path}"
    else:
        parsed = urlparse(remote)
        if parsed.scheme in {"http", "https", "ssh", "git"} and parsed.hostname:
            normalized = f"{parsed.hostname}{parsed.path}"
        elif parsed.scheme == "file":
            normalized = os.path.normpath(parsed.path)
        elif os.path.isabs(remote):
            normalized = os.path.normpath(remote)
        else:
            raise InputError("remote must be an authoritative URL or absolute path")
    return normalized[:-4] if normalized.endswith(".git") else normalized


def bind_repository(payload):
    """Bind either resume selector to one registered origin and exact root."""

    payload = _require_object(payload, "binding")
    _require_exact_keys(
        payload,
        {"selector", "receipt_repository", "observed", "registrations"},
        "binding",
    )
    selector = _require_object(payload["selector"], "selector")
    _require_exact_keys(selector, {"kind", "value"}, "selector")
    if selector["kind"] not in {"bead", "episode"}:
        raise InputError("selector.kind must be bead or episode")
    if selector["kind"] == "episode":
        _identifier(selector["value"], "ep-", "selector.value")
    else:
        _nonempty_string(selector["value"], "selector.value")

    repository = _validate_repository(payload["receipt_repository"])
    observed = _require_object(payload["observed"], "observed")
    _require_exact_keys(
        observed, {"root", "remote", "common_dir", "common_remote"}, "observed"
    )
    root = _nonempty_string(observed["root"], "observed.root")
    common_dir = _nonempty_string(observed["common_dir"], "observed.common_dir")
    if not os.path.isabs(root) or not os.path.isabs(common_dir):
        raise InputError("observed root and common_dir must be absolute")
    if os.path.normpath(root) != repository["path"]:
        raise InputError("receipt path/root contradiction")

    remote = _normalize_remote(observed["remote"])
    common_remote = _normalize_remote(observed["common_remote"])
    if common_remote != remote:
        raise InputError("common-dir remote contradiction")
    registrations = payload["registrations"]
    if not isinstance(registrations, list):
        raise InputError("registrations must be an array")
    matches = []
    for index, registration in enumerate(registrations):
        if not isinstance(registration, dict):
            raise InputError(f"registrations[{index}] must be an object")
        _require_exact_keys(
            registration, {"name", "url"}, f"registrations[{index}]"
        )
        _nonempty_string(registration["name"], f"registrations[{index}].name")
        if _normalize_remote(registration["url"]) == remote:
            matches.append(registration)
    if len(matches) != 1:
        raise InputError("exactly one registered repository must match origin")

    if repository["vcs"] == "git":
        commands = [
            ["git", "-C", root, "status", "--porcelain=v2", "--branch"],
            ["git", "-C", root, "diff", "--name-only", "--diff-filter=U"],
            ["git", "-C", root, "rev-parse", "--git-dir"],
            ["git", "-C", root, "rev-parse", "--git-common-dir"],
            ["git", "-C", root, "rev-parse", "HEAD"],
        ]
    else:
        commands = [
            ["jj", "--repository", root, "status"],
            ["jj", "--repository", root, "resolve", "--list"],
            [
                "jj",
                "--repository",
                root,
                "log",
                "-r",
                "@",
                "--no-graph",
                "-T",
                'change_id ++ "\\n"',
            ],
        ]
    return {
        "selector": selector,
        "registration": matches[0],
        "bound_root": root,
        "common_dir": common_dir,
        "commands": commands,
    }


def resume_gate(document):
    """Expose the v1 resume boundary while the atomic claim is unavailable."""

    document = _require_object(document, "resume gate")
    _require_exact_keys(
        document, {"episode_id", "intent_id", "atomic_claim"}, "resume gate"
    )
    _identifier(document["episode_id"], "ep-", "episode_id")
    _identifier(document["intent_id"], "park-", "intent_id")
    return {
        "authorized": False,
        "required_mechanism": ATOMIC_RESUME_MECHANISM,
        "required_contract": (
            "atomic episode claim/lease with a caller-stable claim ID, "
            "episode uniqueness, compare-and-set ownership, expiry, and release"
        ),
        "allowed_actions": ["read_only_inspection"],
        "blocked_actions": [
            "workspace_creation",
            "resumed_observation",
            "work",
        ],
        "gate_order": [
            "read_only_inspection",
            "atomic_claim_required",
            "workspace_creation_blocked",
            "resumed_observation_blocked",
            "work_blocked",
        ],
        "reason": (
            f"atomic resume claim primitive {ATOMIC_RESUME_MECHANISM} is unavailable"
        ),
    }


def main(argv):
    commands = {
        "evaluate": evaluate,
        "validate-receipt": validate_receipt,
        "confirm-readback": confirm_receipt_readback,
        "prepare-attempt": prepare_attempt,
        "bind-repository": bind_repository,
        "resume-gate": resume_gate,
    }
    if len(argv) != 2 or argv[1] not in commands:
        raise InputError(
            "usage: fold.py evaluate|validate-receipt|prepare-attempt|"
            "confirm-readback|bind-repository|resume-gate"
        )
    document = json.load(sys.stdin)
    result = commands[argv[1]](document)
    if argv[1] == "validate-receipt":
        result = {"valid": True}
    json.dump(result, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main(sys.argv)
    except (InputError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
