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
ROSARY_VERIFY_MECHANISM = "rosary-a6166d"
ROSARY_BEAD_STATUSES = {"open", "in_progress", "blocked", "done", "closed"}


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
        {"source", "detail", "binding"},
        f"checks[{index}].evidence",
    )
    if evidence["source"] != "registered_repository_binding":
        raise InputError(f"checks[{index}] repository source is not authoritative")
    _validate_repository_binding(
        evidence["binding"], f"checks[{index}].evidence.binding"
    )


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
    if evidence.get("backend") != evidence["source"]:
        raise InputError(f"checks[{index}] VCS source/backend mismatch")
    root = _nonempty_string(evidence.get("bound_root"), f"{label}.bound_root")
    if not os.path.isabs(root) or os.path.normpath(root) != root:
        raise InputError(f"{label}.bound_root must be absolute and normalized")
    if item["outcome"] == "unknown":
        _require_exact_keys(
            evidence, {"source", "detail", "backend", "bound_root", "error"}, label
        )
        _nonempty_string(evidence["error"], f"{label}.error")
        return
    _require_exact_keys(
        evidence,
        {
            "source",
            "detail",
            "backend",
            "bound_root",
            "commands",
            "conflicts",
            "operations",
        },
        label,
    )
    expected_commands = (
        [
            ["git", "-C", root, "status", "--porcelain=v2", "--branch"],
            ["git", "-C", root, "diff", "--name-only", "--diff-filter=U"],
        ]
        if evidence["backend"] == "git"
        else [
            ["jj", "--repository", root, "status"],
            ["jj", "--repository", root, "resolve", "--list"],
        ]
    )
    if evidence["commands"] != expected_commands:
        raise InputError(f"{label}.commands must be exact bound VCS commands")
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
    allowed_sources = {"git", "jj", "rsry_workspace_checkpoint"}
    if evidence["source"] not in allowed_sources:
        raise InputError(f"checks[{index}] authoritative preservation source required")
    backend = evidence.get("backend")
    if backend not in {"git", "jj"}:
        raise InputError(f"{label}.backend must be git or jj")
    if evidence["source"] in {"git", "jj"} and evidence["source"] != backend:
        raise InputError(f"checks[{index}] preservation source/backend mismatch")
    root = _nonempty_string(evidence.get("bound_root"), f"{label}.bound_root")
    workspace = _nonempty_string(evidence.get("workspace"), f"{label}.workspace")
    if any(
        not os.path.isabs(path) or os.path.normpath(path) != path
        for path in (root, workspace)
    ):
        raise InputError(f"{label} roots must be absolute and normalized")
    if phase == "preflight":
        _require_exact_keys(
            evidence,
            {
                "source",
                "detail",
                "backend",
                "bound_root",
                "state",
                "workspace",
                "captured_head",
                "checkpoint_available",
            },
            label,
        )
        if (
            item["outcome"] != "pass"
            or evidence["state"] != "checkpointable"
            or evidence["source"] != "rsry_workspace_checkpoint"
            or evidence["checkpoint_available"] is not True
        ):
            raise InputError(
                f"checks[{index}] preflight preservation must be checkpointable"
            )
        _nonempty_string(evidence["captured_head"], f"{label}.captured_head")
        return
    if item["outcome"] == "pass":
        if evidence.get("state") != "durable":
            raise InputError(f"checks[{index}] requires durable preservation evidence")
        required = {
            "source",
            "detail",
            "backend",
            "bound_root",
            "workspace",
            "state",
            "reference",
            "resolved_head",
            "resolver_command",
        }
        if evidence["source"] == "rsry_workspace_checkpoint":
            required.add("checkpoint_id")
        _require_exact_keys(evidence, required, label)
        reference = _nonempty_string(evidence["reference"], f"{label}.reference")
        resolved_head = _nonempty_string(
            evidence["resolved_head"], f"{label}.resolved_head"
        )
        if reference != resolved_head:
            raise InputError(f"checks[{index}] preservation resolver head mismatch")
        expected_command = (
            ["git", "-C", root, "cat-file", "-e", f"{reference}^{{commit}}"]
            if backend == "git"
            else [
                "jj",
                "--repository",
                root,
                "log",
                "-r",
                reference,
                "--no-graph",
            ]
        )
        if evidence["resolver_command"] != expected_command:
            raise InputError(
                f"checks[{index}] preservation resolver command is not exact"
            )
        if evidence["source"] == "rsry_workspace_checkpoint":
            _nonempty_string(evidence["checkpoint_id"], f"{label}.checkpoint_id")
    elif item["outcome"] == "fail":
        _require_exact_keys(
            evidence,
            {
                "source",
                "detail",
                "backend",
                "bound_root",
                "workspace",
                "state",
                "error",
            },
            label,
        )
        if evidence["state"] != "unpreserved":
            raise InputError(f"checks[{index}] failed evidence must be unpreserved")
        _nonempty_string(evidence["error"], f"{label}.error")
    else:
        _require_exact_keys(
            evidence,
            {
                "source",
                "detail",
                "backend",
                "bound_root",
                "workspace",
                "state",
                "error",
            },
            label,
        )
        if evidence["state"] != "unknown":
            raise InputError(f"checks[{index}] unknown preservation state is invalid")
        _nonempty_string(evidence["error"], f"{label}.error")


def _validate_close_evidence(evidence, item, index, bead):
    label = f"checks[{index}].evidence"
    if evidence["source"] != "rsry_bead_history":
        raise InputError(f"checks[{index}] close condition source is not Rosary verify")
    _require_exact_keys(evidence, {"source", "detail", "error"}, label)
    _nonempty_string(evidence["error"], f"{label}.error")
    if item["outcome"] != "unknown":
        raise InputError(
            f"checks[{index}] close condition must be unknown until "
            f"{ROSARY_VERIFY_MECHANISM} supplies command-bound ordered history"
        )


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
    if status not in ROSARY_BEAD_STATUSES:
        raise InputError(f"checks[{index}] unrecognized Rosary bead status {status}")
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
    if evidence.get("backend") != evidence["source"]:
        raise InputError(f"checks[{index}] resume resolver source/backend mismatch")
    root = _nonempty_string(evidence.get("bound_root"), f"{label}.bound_root")
    if not os.path.isabs(root) or os.path.normpath(root) != root:
        raise InputError(f"{label}.bound_root must be absolute and normalized")
    if item["outcome"] == "unknown":
        _require_exact_keys(
            evidence, {"source", "detail", "backend", "bound_root", "error"}, label
        )
        _nonempty_string(evidence["error"], f"{label}.error")
        return
    _require_exact_keys(
        evidence,
        {
            "source",
            "detail",
            "backend",
            "bound_root",
            "resolver_command",
            "target",
        },
        label,
    )
    target = _require_object(evidence["target"], f"{label}.target")
    _require_exact_keys(
        target, {"kind", "value", "resolved_head"}, f"{label}.target"
    )
    if target["kind"] not in {"checkpoint", "branch"}:
        raise InputError(f"{label}.target.kind is invalid")
    _nonempty_string(target["value"], f"{label}.target.value")
    _nonempty_string(target["resolved_head"], f"{label}.target.resolved_head")
    expected_command = (
        ["git", "-C", root, "rev-parse", target["value"]]
        if evidence["backend"] == "git"
        else [
            "jj",
            "--repository",
            root,
            "log",
            "-r",
            target["value"],
            "--no-graph",
        ]
    )
    if evidence["resolver_command"] != expected_command:
        raise InputError(f"checks[{index}] resume resolver command is not exact")


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
    parking_applicable = by_name["bead_terminal"]["outcome"] == "fail"
    if parking_applicable:
        if "resume_target_resolvable" not in by_name:
            raise InputError("missing required check resume_target_resolvable")
    elif "resume_target_resolvable" in by_name:
        raise InputError("resume_target_resolvable is not applicable")

    expected = required | (
        {"resume_target_resolvable"} if parking_applicable else set()
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
    candidate = None
    terminal_outcome = by_name["bead_terminal"]["outcome"]
    close_outcome = by_name["close_condition_satisfied"]["outcome"]
    other_completion = completion_names - {
        "bead_terminal",
        "close_condition_satisfied",
    }
    unknown_other_completion = [
        name
        for name in sorted(other_completion)
        if by_name[name]["outcome"] == "unknown"
    ]
    if (
        terminal_outcome == "fail"
        and close_outcome == "unknown"
        and not unknown_other_completion
    ):
        candidate = "parked"
    else:
        if terminal_outcome == "pass" and close_outcome == "unknown":
            reasons.append(
                f"completed unavailable: required Rosary mechanism "
                f"{ROSARY_VERIFY_MECHANISM} cannot prove the declared "
                "acceptance command and latest verdict"
            )
        else:
            reasons.append("completion evidence conflicts or is unknown")
        reasons.extend(
            f"{name}=unknown" for name in unknown_other_completion
        )

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
    if (
        receipt["anchor_bead"]
        != by_name["anchor_confirmed"]["evidence"]["anchor"]
    ):
        raise InputError("anchor_bead must match the confirmed anchor evidence")

    binding = by_name["repository_resolved"]["evidence"]["binding"]
    binding_identity = binding["receipt_identity"]
    if binding_identity["episode_id"] != receipt["episode_id"]:
        raise InputError("episode_id must match the validated repository binding")
    if binding_identity["anchor_bead"] != receipt["anchor_bead"]:
        raise InputError("anchor_bead must match the validated repository binding")
    if binding_identity["repository"] != repository:
        raise InputError("repository must match the validated repository binding")
    if binding["backend"] != repository["vcs"]:
        raise InputError("repository binding backend must match repository.vcs")

    vcs_evidence = by_name["no_vcs_operation_or_conflict"]["evidence"]
    if (
        vcs_evidence["backend"] != repository["vcs"]
        or vcs_evidence["source"] != repository["vcs"]
    ):
        raise InputError("VCS evidence source/backend must match repository.vcs")
    if vcs_evidence["bound_root"] != repository["path"]:
        raise InputError("VCS evidence bound root must match repository.path")

    preservation_bindings = []
    for name in PRESERVATION_CHECKS:
        item = by_name[name]
        evidence = item["evidence"]
        preservation_bindings.append(
            (
                evidence["backend"],
                evidence["bound_root"],
                evidence["workspace"],
            )
        )
        if (
            item["outcome"] == "pass"
            and (
                evidence["reference"] != repository["head"]
                or evidence["resolved_head"] != repository["head"]
            )
        ):
            raise InputError(
                f"{name} preservation reference must match repository.head"
            )
    if len(set(preservation_bindings)) != 1:
        raise InputError(
            "both preservation checks must use the same bound workspace/backend"
        )
    preservation_backend, preservation_root, preservation_workspace = (
        preservation_bindings[0]
    )
    if preservation_backend != repository["vcs"]:
        raise InputError("preservation backend must match repository.vcs")
    if (
        preservation_root != repository["path"]
        or preservation_workspace != repository["path"]
    ):
        raise InputError("preservation workspace must match validated repository path")

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
        if (
            receipt["outcome"] == "completed"
            and by_name["bead_terminal"]["outcome"] == "pass"
            and by_name["close_condition_satisfied"]["outcome"] == "unknown"
        ):
            raise InputError(
                f"completed receipt unavailable until {ROSARY_VERIFY_MECHANISM} "
                "supplies command-bound ordered history"
            )
        raise InputError("receipt outcome does not match deterministic fold")
    if receipt["outcome"] == "parked":
        resume_evidence = by_name["resume_target_resolvable"]["evidence"]
        if (
            resume_evidence["source"] != repository["vcs"]
            or resume_evidence["backend"] != repository["vcs"]
        ):
            raise InputError("resume resolver must match repository.vcs")
        if resume_evidence["bound_root"] != repository["path"]:
            raise InputError("resume resolver root must match repository.path")
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


def _prior_receipt_source(candidate, index):
    if not isinstance(candidate, dict):
        raise InputError(f"prior_receipts[{index}] must be an object")
    wrapper_fields = {"receipt", "source_bytes", "comment_id"}
    if set(candidate) & wrapper_fields:
        _require_exact_keys(candidate, wrapper_fields, f"prior_receipts[{index}]")
        receipt = _require_object(
            candidate["receipt"], f"prior_receipts[{index}].receipt"
        )
        source_bytes = _nonempty_string(
            candidate["source_bytes"], f"prior_receipts[{index}].source_bytes"
        )
        comment_id = _nonempty_string(
            candidate["comment_id"], f"prior_receipts[{index}].comment_id"
        )
        try:
            decoded = json.loads(source_bytes)
        except json.JSONDecodeError as error:
            raise InputError(
                f"prior_receipts[{index}].source_bytes must be valid JSON"
            ) from error
        if decoded != receipt:
            raise InputError(
                f"prior_receipts[{index}].source_bytes must exactly encode receipt"
            )
        return receipt, {
            "comment_id": comment_id,
            "source_bytes": source_bytes,
        }
    return candidate, None


def _success_semantics(receipt):
    binding = next(
        item["evidence"]["binding"]
        for item in receipt["checks"]
        if item["name"] == "repository_resolved"
    )
    return {
        "episode_id": receipt["episode_id"],
        "intent_id": receipt["intent_id"],
        "anchor_bead": receipt["anchor_bead"],
        "pr_backed": receipt["pr_backed"],
        "bead": receipt["bead"],
        "repository": receipt["repository"],
        "binding": binding,
        "outcome": receipt["outcome"],
        "safe_to_close": receipt["safe_to_close"],
        "resume": receipt.get("resume"),
    }


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

    matching = []
    for index, candidate in enumerate(invocation["prior_receipts"]):
        prior_receipt, source = _prior_receipt_source(candidate, index)
        if prior_receipt.get("intent_id") != intent_id:
            continue
        validate_receipt(prior_receipt)
        matching.append(
            {
                "receipt": prior_receipt,
                "source": source,
                "semantics": _success_semantics(prior_receipt),
            }
        )

    if matching:
        semantics = {
            json.dumps(item["semantics"], sort_keys=True, separators=(",", ":"))
            for item in matching
        }
        if len(semantics) != 1:
            raise InputError("conflicting prior successes for stable intent")
        if any(
            item["receipt"]["episode_id"] != episode_id
            or item["receipt"]["anchor_bead"] != anchor
            for item in matching
        ):
            raise InputError("conflicting prior successes for stable identity")

        def prior_order(item):
            source = item["source"]
            if source is not None:
                return (
                    0,
                    source["comment_id"],
                    source["source_bytes"],
                )
            return (
                1,
                "",
                json.dumps(
                    item["receipt"], sort_keys=True, separators=(",", ":")
                ),
            )

        matching.sort(key=prior_order)
        result = {
            "ready": True,
            "action": "return_existing",
            "episode_id": episode_id,
            "intent_id": intent_id,
            "receipt": matching[0]["receipt"],
        }
        sources = sorted(
            (
                item["source"]
                for item in matching
                if item["source"] is not None
            ),
            key=lambda source: (source["comment_id"], source["source_bytes"]),
        )
        if sources:
            result["prior_sources"] = sources
        return result

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
        host = user_host.split("@", 1)[1].lower()
        normalized = f"{host}/{path}"
    else:
        parsed = urlparse(remote)
        if parsed.scheme in {"http", "https", "ssh", "git"} and parsed.hostname:
            try:
                port = parsed.port
            except ValueError as error:
                raise InputError("remote has an invalid port") from error
            default_ports = {"http": 80, "https": 443, "ssh": 22, "git": 9418}
            port_suffix = (
                f":{port}"
                if port is not None and port != default_ports[parsed.scheme]
                else ""
            )
            normalized = f"{parsed.hostname.lower()}{port_suffix}{parsed.path}"
        elif parsed.scheme == "file":
            normalized = os.path.normpath(parsed.path)
        elif os.path.isabs(remote):
            normalized = os.path.normpath(remote)
        else:
            raise InputError("remote must be an authoritative URL or absolute path")
    normalized = normalized.rstrip("/")
    return normalized[:-4] if normalized.endswith(".git") else normalized


def _validate_command_observation(observations, key, expected_command, label):
    observation = _require_object(observations.get(key), f"{label}.{key}")
    _require_exact_keys(observation, {"command", "stdout"}, f"{label}.{key}")
    if observation["command"] != expected_command:
        raise InputError(f"{label}.{key} must use the exact bound command")
    return _nonempty_string(observation["stdout"], f"{label}.{key}.stdout")


def _validate_repository_binding(binding, label="repository binding"):
    binding = _require_object(binding, label)
    common_fields = {
        "schema_version",
        "selector",
        "receipt_identity",
        "registration",
        "backend",
        "bound_root",
        "canonical_remote",
        "observations",
        "commands",
    }
    backend = binding.get("backend")
    required = set(common_fields)
    if backend == "git":
        required.update({"git_dir", "common_dir"})
    _require_exact_keys(binding, required, label)
    if binding["schema_version"] != 1:
        raise InputError(f"{label}.schema_version must be 1")

    identity = _require_object(binding["receipt_identity"], f"{label}.receipt_identity")
    _require_exact_keys(
        identity,
        {"episode_id", "anchor_bead", "repository"},
        f"{label}.receipt_identity",
    )
    _identifier(identity["episode_id"], "ep-", f"{label}.receipt_identity.episode_id")
    _nonempty_string(
        identity["anchor_bead"], f"{label}.receipt_identity.anchor_bead"
    )
    repository = _validate_repository(identity["repository"])
    if backend != repository["vcs"]:
        raise InputError(f"{label} backend must match receipt repository.vcs")

    selector = _require_object(binding["selector"], f"{label}.selector")
    _require_exact_keys(selector, {"kind", "value"}, f"{label}.selector")
    if selector["kind"] == "bead":
        if selector["value"] != identity["anchor_bead"]:
            raise InputError("bead selector must match receipt anchor")
    elif selector["kind"] == "episode":
        if selector["value"] != identity["episode_id"]:
            raise InputError("episode selector must match receipt episode")
    else:
        raise InputError(f"{label}.selector.kind must be bead or episode")

    root = _nonempty_string(binding["bound_root"], f"{label}.bound_root")
    if (
        not os.path.isabs(root)
        or os.path.normpath(root) != root
        or root != repository["path"]
    ):
        raise InputError("receipt path/root contradiction")
    observations = _require_object(binding["observations"], f"{label}.observations")

    if backend == "git":
        _require_exact_keys(
            observations, {"root", "git_dir", "common_dir", "remote"}, f"{label}.observations"
        )
        observed_root = _validate_command_observation(
            observations,
            "root",
            ["git", "-C", root, "rev-parse", "--show-toplevel"],
            f"{label}.observations",
        )
        git_dir = _validate_command_observation(
            observations,
            "git_dir",
            [
                "git",
                "-C",
                root,
                "rev-parse",
                "--path-format=absolute",
                "--git-dir",
            ],
            f"{label}.observations",
        )
        common_dir = _validate_command_observation(
            observations,
            "common_dir",
            [
                "git",
                "-C",
                root,
                "rev-parse",
                "--path-format=absolute",
                "--git-common-dir",
            ],
            f"{label}.observations",
        )
        observed_remote = _validate_command_observation(
            observations,
            "remote",
            ["git", "-C", root, "remote", "get-url", "origin"],
            f"{label}.observations",
        )
        for path_name, path in (("git_dir", git_dir), ("common_dir", common_dir)):
            if not os.path.isabs(path) or os.path.normpath(path) != path:
                raise InputError(f"{label}.{path_name} must be absolute and normalized")
        normal_git_dir = os.path.join(root, ".git")
        linked_prefix = common_dir + os.sep + "worktrees" + os.sep
        common_relationship = (
            git_dir == normal_git_dir and common_dir == normal_git_dir
        ) or (
            os.path.basename(common_dir) == ".git"
            and git_dir.startswith(linked_prefix)
        )
        if not common_relationship:
            raise InputError("Git common-dir relationship is not proven")
        if observed_root != root:
            raise InputError("receipt path/root contradiction")
        if binding["git_dir"] != git_dir or binding["common_dir"] != common_dir:
            raise InputError(f"{label} restates Git directory observations")
        commands = [
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
        ]
    elif backend == "jj":
        _require_exact_keys(observations, {"root", "remote"}, f"{label}.observations")
        observed_root = _validate_command_observation(
            observations,
            "root",
            ["jj", "--repository", root, "root"],
            f"{label}.observations",
        )
        observed_remote = _validate_command_observation(
            observations,
            "remote",
            ["jj", "--repository", root, "git", "remote", "list"],
            f"{label}.observations",
        )
        if observed_root != root:
            raise InputError("receipt path/root contradiction")
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
    else:
        raise InputError(f"{label}.backend must be git or jj")

    if binding["commands"] != commands:
        raise InputError(f"{label}.commands must be exact bound argv")
    canonical_remote = _normalize_remote(observed_remote)
    if binding["canonical_remote"] != canonical_remote:
        raise InputError(f"{label}.canonical_remote contradicts command observation")
    registration = _require_object(binding["registration"], f"{label}.registration")
    _require_exact_keys(
        registration,
        {"name", "url", "canonical_remote"},
        f"{label}.registration",
    )
    _nonempty_string(registration["name"], f"{label}.registration.name")
    if (
        _normalize_remote(registration["url"]) != canonical_remote
        or registration["canonical_remote"] != canonical_remote
    ):
        raise InputError(f"{label} registered repository remote contradiction")
    return binding


def bind_repository(payload):
    """Bind either resume selector to one registered origin and exact root."""

    payload = _require_object(payload, "binding")
    _require_exact_keys(
        payload,
        {"selector", "receipt_identity", "observations", "registrations"},
        "binding",
    )
    selector = _require_object(payload["selector"], "selector")
    _require_exact_keys(selector, {"kind", "value"}, "selector")
    if selector["kind"] not in {"bead", "episode"}:
        raise InputError("selector.kind must be bead or episode")
    identity = _require_object(payload["receipt_identity"], "receipt_identity")
    _require_exact_keys(
        identity, {"episode_id", "anchor_bead", "repository"}, "receipt_identity"
    )
    _identifier(identity["episode_id"], "ep-", "receipt_identity.episode_id")
    _nonempty_string(identity["anchor_bead"], "receipt_identity.anchor_bead")
    repository = _validate_repository(identity["repository"])
    if selector["kind"] == "episode":
        _identifier(selector["value"], "ep-", "selector.value")
        if selector["value"] != identity["episode_id"]:
            raise InputError("episode selector must match receipt episode")
    else:
        _nonempty_string(selector["value"], "selector.value")
        if selector["value"] != identity["anchor_bead"]:
            raise InputError("bead selector must match receipt anchor")
    root = repository["path"]
    observations = _require_object(payload["observations"], "observations")
    expected_observation_keys = (
        {"root", "git_dir", "common_dir", "remote"}
        if repository["vcs"] == "git"
        else {"root", "remote"}
    )
    if set(observations) != expected_observation_keys:
        raise InputError("receipt backend observations do not match repository.vcs")
    if repository["vcs"] == "git":
        _require_exact_keys(
            observations, {"root", "git_dir", "common_dir", "remote"}, "observations"
        )
        remote_value = _validate_command_observation(
            observations,
            "remote",
            ["git", "-C", root, "remote", "get-url", "origin"],
            "observations",
        )
    elif repository["vcs"] == "jj":
        _require_exact_keys(observations, {"root", "remote"}, "observations")
        remote_value = _validate_command_observation(
            observations,
            "remote",
            ["jj", "--repository", root, "git", "remote", "list"],
            "observations",
        )
    else:
        raise InputError("receipt backend observations are unsupported")
    remote = _normalize_remote(remote_value)
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
            matches.append(
                {
                    "name": registration["name"],
                    "url": registration["url"],
                    "canonical_remote": remote,
                }
            )
    if len(matches) != 1:
        raise InputError("exactly one registered repository must match origin")

    if repository["vcs"] == "git":
        git_dir = _validate_command_observation(
            observations,
            "git_dir",
            [
                "git",
                "-C",
                root,
                "rev-parse",
                "--path-format=absolute",
                "--git-dir",
            ],
            "observations",
        )
        common_dir = _validate_command_observation(
            observations,
            "common_dir",
            [
                "git",
                "-C",
                root,
                "rev-parse",
                "--path-format=absolute",
                "--git-common-dir",
            ],
            "observations",
        )
        commands = [
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
        ]
        extra = {"git_dir": git_dir, "common_dir": common_dir}
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
        extra = {}
    result = {
        "schema_version": 1,
        "selector": selector,
        "receipt_identity": identity,
        "registration": matches[0],
        "backend": repository["vcs"],
        "bound_root": root,
        "canonical_remote": remote,
        "observations": observations,
        "commands": commands,
        **extra,
    }
    return _validate_repository_binding(result)


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
