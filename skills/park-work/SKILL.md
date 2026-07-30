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

**MCP dependency:** rosary (`rsry_*`). Use `rsry_active`,
`rsry_dispatch_history`, `rsry_bead_history`, `rsry_list_beads`,
`rsry_expand_ref`, `rsry_bead_comment`, `rsry_agent_session_addresses`,
`rsry_agent_session_message_record`, and `rsry_workspace_checkpoint`.

## Absolute boundaries

- Never close a bead.
- Never terminate a provider session.
- Never delete a worktree.
- Never discard, reset, stash, or rewrite user changes.
- Never silently select or mint an anchor bead.
- Never set or print `safe_to_close=true` until a schema-valid receipt has
  been written; read the receipt back by its stable `intent_id` first.
- Never use model-authored prose as safety evidence.

## 1. Resolve the mode and anchor

Parse `$ARGUMENTS` before collecting evidence:

- `--check [<bead-id>]` selects **check** mode.
- `--resume [<episode-id>|<bead-id>]` selects **resume** mode. Resume
  materialization and drift/retry behavior are defined separately; this mode
  must not park or mutate state in this workflow.
- Any other invocation, optionally beginning with `<bead-id>`, selects
  **park** mode.

An explicit bead ID is the anchor and needs no confirmation. Otherwise, propose
exactly one detected anchor in this order: active dispatch
(`rsry_active`/`rsry_dispatch_history`), the current branch or bookmark matched
to an open bead, then the most recently touched bead (`rsry_bead_history` and
`rsry_list_beads`). Ask the human to confirm a detected anchor before any write.
If detectors disagree or no anchor exists, return `unsafe`; do not mint a bead.

Reuse a nonterminal `episode_id` and a successful receipt found on the anchor.
Otherwise mint `ep-<uuid>`, `park-<uuid>`, and `attempt-<uuid>` respectively for
the episode, stable intent, and attempt.

Before evaluating or writing, search the anchor's events and comments for the
stable `intent_id`. If a schema-valid successful receipt already exists, read
it back and return it; do not append a second semantic transition.

## 2. Collect mechanical evidence

Collect live state from Rosary and the repository, not narrative summaries.
Append every observation to one JSON `checks` array. Each item has `name`,
`category`, `outcome`, compact `evidence`, and RFC3339 `observed_at` fields.

Required checks are:

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

For Git, record evidence from each of these commands:

```bash
git status --porcelain=v2 --branch
git diff --name-only --diff-filter=U
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git rev-parse HEAD
git rev-parse '@{upstream}'
```

For jj, record evidence from each of these commands:

```bash
jj status
jj resolve --list
jj log -r @ --no-graph -T 'change_id ++ "\n"'
jj bookmark list
```

An unavailable command, authentication failure, malformed response, active
operation, or contradictory source becomes `unknown` or `fail` according to
the tool's actual result; it is never coerced to `pass`.

## 3. Fold the candidate

Create a temporary checks file with `mktemp`, serialize the one checks object
to it, then run `scripts/fold.py evaluate` exactly through the skill directory:

```bash
CHECKS_FILE="$(mktemp)"
python3 "$SKILL_DIR/scripts/fold.py" evaluate < "$CHECKS_FILE"
```

Treat `eligible=false` as `unsafe`, print the exact `reasons`, perform no
transition, and leave all repositories and workspaces unchanged. In `--check`
mode, print the candidate and its evidence, then stop before checkpoint or
receipt writes.

## 4. Materialize a parked receipt

For an eligible `parked` candidate, use this exact order:

1. Call `rsry_workspace_checkpoint` only when the current tree is not already
   durably reachable.
2. Re-run preservation checks against the returned checkpoint/change ID.
3. Construct a schema-v1 receipt with the candidate `outcome` and
   `safe_to_close=true`.
4. Run `scripts/fold.py validate-receipt` with the receipt:

   ```bash
   python3 "$SKILL_DIR/scripts/fold.py" validate-receipt < "$RECEIPT_FILE"
   ```

5. Write the receipt to the anchor bead as a fenced
   `work_episode_receipt/v1` JSON comment using `rsry_bead_comment`.
6. Read the bead history/comments back and find the exact `intent_id`.
7. Compare `episode_id`, `outcome`, and checkpoint/branch fields byte-for-byte.
8. When `rsry_agent_session_addresses` returns an address, also write the same
   payload through `rsry_agent_session_message_record` using a stable event ID.
9. Render `/tmp/park-<date>-<slug>.md` from the same receipt.
10. Print the receipt and `safe_to_close=true` only after steps 4–8 succeed.

The receipt must contain the schema-v1 fields consumed by the fold helper:
`schema_version`, `episode_id`, `intent_id`, `attempt_id`, `anchor_bead`, a
`repository` object (`path`, `vcs`, `branch`, `head`), `checks`, `outcome`,
`safe_to_close`, `resume` for a parked outcome (with `checkpoint` or `branch`
and `next_action`), and `references`.

If a write times out, the next attempt searches by `intent_id` before writing.
If read-back cannot prove durability, return `unsafe` and do not tell the human
to close the provider session.

## 5. Completed and unsafe results

For an eligible `completed` candidate, validate and durably read back the same
schema-v1 receipt gate before printing any `safe_to_close` result; do not close
the bead or terminate a session. For `unsafe`, print the collected evidence and
reasons only. Do not checkpoint, write a receipt, or change any repository or
workspace state.
