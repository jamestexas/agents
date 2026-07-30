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
            "reasons": ["completion evidence conflicts"],
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
