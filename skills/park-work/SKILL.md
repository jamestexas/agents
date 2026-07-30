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

## 0. Establish the helper before any receipt read

The absolute path from which the harness/agent loaded this `SKILL.md` is a
required observed input. Bind the path reported by that loader exactly once;
if it is unavailable, return `unsafe` before any write:

```bash
return_unsafe() {
  printf 'unsafe: %s\n' "$1"
  exit 1
}
LOADED_SKILL_FILE='<absolute SKILL.md path reported by the loader>'
case "$LOADED_SKILL_FILE" in /*/park-work/SKILL.md) ;; *) return_unsafe "loader path is not park-work/SKILL.md" ;; esac
[ -f "$LOADED_SKILL_FILE" ] || return_unsafe "loader path does not exist"
SKILL_DIR="$(CDPATH= cd -- "$(dirname -- "$LOADED_SKILL_FILE")" && pwd -P)"
[ "$SKILL_DIR/SKILL.md" = "$LOADED_SKILL_FILE" ] || return_unsafe "loader path does not match derived directory"
FOLD_HELPER="$SKILL_DIR/scripts/fold.py"
[ -f "$FOLD_HELPER" ] || return_unsafe "fold helper is missing"
CHECKS_FILE="$(mktemp)"
CANDIDATE_RECEIPT_FILE="$(mktemp)"
RECEIPT_FILE="$(mktemp)"
```

`return_unsafe` means stop before checkpoint, receipt, comment, event, or
handoff write and print only the observed failure. Do not assume a runtime
`SKILL_FILE` variable.

Rosary calls use the following exact arguments. `<repo>` is the repository
path for comment calls and the Rosary repository name for event calls; resolve
both from the selected anchor before continuing. Call
`rsry_expand_ref(hash=<returned-demoted-ref-hash>)` only when a Rosary response
contains a returned demoted reference; do not use it speculatively.

```text
rsry_active()
rsry_dispatch_history(active_only=true, bead_id=<anchor>)
rsry_dispatch_history(bead_id=<anchor>)
rsry_bead_history(id=<anchor>, repo_path=<repo>)
rsry_list_beads(repo=<repo-name>)
rsry_bead_comment_list(id=<anchor>, repo_path=<repo>)
rsry_agent_run_events(repo=<repo>, bead_id=<anchor>)
rsry_agent_session_addresses(repo=<repo>, bead_id=<anchor>)
rsry_workspace_checkpoint(bead_id=<anchor>, repo_path=<repo>)
rsry_bead_comment(id=<anchor>, repo_path=<repo>, body=<RECEIPT_FENCE>)
rsry_agent_session_message_record(repo=<repo>, bead_id=<anchor>, session_ref=<address>, id=<event-id>, event_type="work_episode_receipt", message=<RECEIPT_FENCE>, payload={"receipt": <RECEIPT_FENCE>})
```

## 1. Resolve mode, anchor, and prior durable receipt

Parse `$ARGUMENTS` before collecting evidence:

- `--check [<bead-id>]` selects **check** mode.
- `--resume [<episode-id>|<bead-id>]` selects **resume** mode. Resume
  materialization and drift/retry behavior are defined separately; this mode
  must not park or mutate state in this workflow.
- Any other invocation, optionally beginning with `<bead-id>`, selects
  **park** mode.

An explicit bead ID is the anchor and needs no confirmation. Otherwise, propose
exactly one detected anchor in this order: `rsry_active` and
`rsry_dispatch_history`, current Git branch or jj bookmark matched against
`rsry_list_beads`, then the most recently touched anchor from
`rsry_bead_history`. Ask the human to confirm a detected anchor before any
write. If detectors disagree or no anchor exists, return `unsafe`; do not mint
a bead.

Reuse a nonterminal `episode_id` and a successful receipt found on the anchor.
Otherwise mint `ep-<uuid>`, `park-<uuid>`, and `attempt-<uuid>` for the
episode, stable intent, and attempt.

Before evaluating or writing, search the anchor's events and comments for the
stable `intent_id`. If a schema-valid successful receipt already exists, read
it back and return it; do not append a second semantic transition. The helper
and candidate receipt file from §0 are already initialized.

Use `rsry_bead_comment_list(id=<anchor>, repo_path=<repo>)` to read every live
comment, and `rsry_agent_run_events(repo=<repo>, bead_id=<anchor>)` to read
append-only session events. For either source, parse only fenced `work_episode_receipt/v1` JSON:
the complete body between a matching opening
````text
```work_episode_receipt/v1
<JSON>
```
````
and closing fence. Reject prose, an untagged JSON object, malformed JSON,
multiple receipt fences in one field, and candidates with a different
`intent_id`; set `CANDIDATE_RECEIPT_BYTES` to the exact JSON bytes within that
one fence, then validate each candidate mechanically:

```bash
printf '%s' "$CANDIDATE_RECEIPT_BYTES" > "$CANDIDATE_RECEIPT_FILE"
CANDIDATE_VALIDATION="$(python3 "$FOLD_HELPER" validate-receipt < "$CANDIDATE_RECEIPT_FILE")"
CANDIDATE_STATUS=$?
```

If `CANDIDATE_STATUS` is nonzero or its output is malformed, reject that
candidate. A successful candidate has `outcome` `completed` or `parked` and
`safe_to_close=true`.

Only `rsry_bead_comment_list` proves durable receipt readback. A matching event
from `rsry_agent_run_events` is additional evidence only; it never substitutes
for a matching, validated comment. If comments and events contain distinct
successful bytes for the same intent, return `unsafe`. If the matching valid
receipt is found in comments, return its exact parsed receipt and do not write.

## 2. Collect evidence mechanically

Append every observation to one JSON `checks` array. Each item has `name`,
`category`, `outcome`, compact raw `evidence`, and RFC3339 `observed_at`. Use
the timestamp returned by the observed system (or the command completion time)
and include the relevant raw status, identifiers, and hashes. Do not summarize
or infer a `pass` from model-authored prose.

For Git, collect every command below. The direct Git-dir path checks are
allowed only after `git rev-parse --git-dir` succeeds.

```bash
git status --porcelain=v2 --branch
git diff --name-only --diff-filter=U
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git rev-parse HEAD
git rev-parse '@{upstream}'
git merge-base --is-ancestor HEAD '@{upstream}'
```

For jj, collect every command below:

```bash
jj status
jj resolve --list
jj log -r @ --no-graph -T 'change_id ++ "\n"'
jj bookmark list
```

### Source-to-check decision table

| Check | Mechanical source | `pass` | `fail` | `unknown` |
|---|---|---|---|---|
| `anchor_confirmed` | Explicit `<anchor>` resolved by `rsry_list_beads`, or the recorded human confirmation of the single detector result | Exact bead ID exists and is explicit, or the user confirmed it | No such bead, rejected confirmation, or detectors disagree | Read failure, malformed result, or required demoted ref cannot expand |
| `repository_resolved` | `git rev-parse --git-dir`, `git rev-parse --git-common-dir`, `git branch --show-current`, or `jj status` and `jj bookmark list` | Commands exit 0 and identify the selected repository/workspace | Command identifies a different repository/workspace | Command unavailable, nonzero without an authoritative absence, or malformed output |
| `no_active_dispatch` | `rsry_active()` plus `rsry_dispatch_history(active_only=true, bead_id=<anchor>)` | Both authoritative results contain no active dispatch/session/pipeline record for the anchor | Either result names an active record for the anchor | Either read unavailable, malformed, or contradictory |
| `no_running_child_operation` | Same `rsry_active()` result and active-only dispatch history | No live child operation, session, or active dispatch is returned for the anchor | Any live child operation/session/dispatch is returned for the anchor | The active-state shape is unavailable or ambiguous |
| `no_vcs_operation_or_conflict` | Git porcelain-v2, unmerged-name list, Git-dir operation markers (`MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge`, `rebase-apply`), or `jj status` and `jj resolve --list` | No unmerged record/name, operation marker, or jj conflict | Any unmerged record/name, marker, or jj conflict | Required command/path unreadable or output malformed |
| `tree_preserved` | Pre/post `git status --porcelain=v2 --branch` or `jj status` snapshots; resolved workspace/anchor and checkpoint availability | **Already durable:** snapshots agree. **Checkpointable:** label the evidence `pre-materialization capability`; the resolved workspace/anchor matches, quiescence passes, and exact current HEAD/tree/status (or jj change/status) is captured before the available checkpoint operation | A deletion, reset, conflict, mismatched workspace/anchor, or unavailable checkpoint operation | Missing/contradictory snapshot or unresolved workspace/anchor |
| `commits_reachable_or_checkpoint_resolvable` | Git `HEAD`, upstream, `merge-base`, captured `HEAD^{tree}`; jj `jj log`, bookmark, and available checkpoint operation | **Already durable:** Git `HEAD` is an ancestor of upstream, or a recorded jj checkpoint resolves. **Checkpointable:** label the evidence `pre-materialization capability`; the same resolved workspace/anchor, captured exact tree/change identity, quiescence, and available checkpoint operation prove a checkpoint-needed tree can be materialized | The durable branch is disproven and checkpointability is disproven | VCS/auth/network failure, malformed result, or contradiction |
| `close_condition_satisfied` | Authoritative `rsry_bead_history` verdict and anchor acceptance-condition result returned by Rosary | Rosary records the anchor's acceptance condition as satisfied | Rosary records it unsatisfied/failed | Missing, unavailable, or non-authoritative result |
| `pr_merged` (PR-backed only) | Rosary's resolved anchor/PR state, expanding a returned demoted ref only if present | Resolved PR state is exactly merged | Resolved PR state is open, closed-unmerged, or failed | No resolvable authoritative PR state |
| `bead_terminal` | Selected bead record from `rsry_list_beads` | Status is Rosary-terminal (`closed` or `done`) | Status is nonterminal | Missing/malformed bead record |
| `resume_target_resolvable` (only when all completion checks fail) | Returned checkpoint/change ID or recorded branch resolved by the VCS commands above | Checkpoint/change ID or branch resolves exactly | Neither recorded checkpoint nor branch resolves | Resolver unavailable or malformed |

Before the first fold, the two preservation checks may be `pass` only through
one of those table branches. The `checkpointable` branch is explicitly a
pre-materialization capability, not completed durability: it records
`checkpointable=true`, the resolved Rosary workspace/anchor, no VCS
conflict/operation, exact current Git `HEAD`, `HEAD^{tree}`, and status (or jj
change/status), plus an available `rsry_workspace_checkpoint`. Unknown or
contradictory capability is `unknown` or `fail`, never `pass`.

An unavailable command, authentication failure, malformed response, active
operation, or contradictory source becomes `unknown` or `fail` according to
the table; it is never coerced to `pass`.

## 3. Build files and fold the candidate

Serialize the exact observation object once as `CHECKS_JSON` (with
`schema_version: 1` and the complete `checks` array), then write it without
adding or removing bytes:

```bash
printf '%s' "$CHECKS_JSON" > "$CHECKS_FILE"
FOLD_RESULT="$(python3 "$FOLD_HELPER" evaluate < "$CHECKS_FILE")"
FOLD_STATUS=$?
```

If `FOLD_STATUS` is nonzero, or `FOLD_RESULT` is malformed, return `unsafe`.
Treat `eligible=false` as `unsafe`, print the exact `reasons`, perform no transition,
and leave all repositories and workspaces unchanged. In `--check`
mode, print the candidate and its evidence, then stop before checkpoint or receipt writes:
do not write a checkpoint, receipt, comment, event, or handoff.

The fold is run over those preconditions. Its `parked` candidate is eligible
only when every base category, including the mechanically labelled
pre-materialization capability if needed, is `pass` and the completion/resume
rows meet `fold.py`'s deterministic rules.

## 4. Materialize a parked receipt

For an eligible `parked` candidate, use this exact order:

1. The already-durable branch skips checkpointing; only an eligible `parked` candidate on the `checkpointable` branch may call
   `rsry_workspace_checkpoint`; an ineligible, unknown, or contradictory state
   returns `unsafe` without a checkpoint.
2. After the returned checkpoint/change ID, replace both preservation evidence items with fresh post-checkpoint observations and rerun the fold. For Git,
   `git cat-file -e <sha>^{commit}` must resolve the returned checkpoint SHA;
   the checkpoint MCP result must represent the captured HEAD/tree/status, and
   a stable branch/checkpoint resume reference must be recorded. For jj,
   `jj log -r <id>` must resolve the returned change ID and it must be
   recorded as the resume reference. Any failed lookup, mismatch, or missing
   reference is `unsafe` and no receipt is written. The post-checkpoint fold
   must be eligible before constructing a receipt.

   ```bash
   git cat-file -e "$CHECKPOINT_SHA^{commit}"
   jj log -r "$CHECKPOINT_CHANGE_ID"
   ```
3. Construct the schema-v1 receipt from the candidate and mechanical evidence.
   Serialize it once as `RECEIPT_JSON`, then write and validate those exact
   bytes:

   ```bash
   printf '%s' "$RECEIPT_JSON" > "$RECEIPT_FILE"
   RECEIPT_VALIDATION="$(python3 "$FOLD_HELPER" validate-receipt < "$RECEIPT_FILE")"
   RECEIPT_STATUS=$?
   RECEIPT_BYTES="$(cat "$RECEIPT_FILE")"
   RECEIPT_FENCE="$(printf '```work_episode_receipt/v1\n%s\n```' "$RECEIPT_BYTES")"
   ```

   If `RECEIPT_STATUS` is nonzero or validation output is malformed, return
   `unsafe` without writing. Build `RECEIPT_FENCE` from the same
   `RECEIPT_BYTES`; never reserialize or edit it:

   ````text
   ```work_episode_receipt/v1
   <RECEIPT_BYTES>
   ```
   ````

4. Write `RECEIPT_FENCE` with
   `rsry_bead_comment(id=<anchor>, repo_path=<repo>, body=<RECEIPT_FENCE>)`.
5. Read comments back with
   `rsry_bead_comment_list(id=<anchor>, repo_path=<repo>)`; parse only its
   fenced receipt JSON, validate it, find the exact `intent_id`, and compare
   `episode_id`, `outcome`, and checkpoint/branch fields byte-for-byte with
   `RECEIPT_BYTES`. This comment-list readback is mandatory durability proof.
6. If `rsry_agent_session_addresses` returns an address, write the same
   `RECEIPT_FENCE` and same `RECEIPT_BYTES` through
   `rsry_agent_session_message_record` using stable `event_id =
   "receipt-" + intent_id`. Then read
   `rsry_agent_run_events(repo=<repo>, bead_id=<anchor>)` and compare the
   matching event fence byte-for-byte. This optional event read is additional
   evidence, never a substitute for step 5.
7. Render `/tmp/park-<date>-<slug>.md` from the same `RECEIPT_BYTES`.
8. Print the receipt and `safe_to_close=true` only after steps 3–6 succeed.

The receipt contains `schema_version`, `episode_id`, `intent_id`, `attempt_id`,
`anchor_bead`, `repository` (`path`, `vcs`, `branch`, `head`), `checks`,
`outcome`, `safe_to_close`, `resume` for `parked` (a `checkpoint` or `branch`
and `next_action`), and `references`.

If a write times out, the next attempt searches by `intent_id` before writing.
If readback cannot prove durability, return `unsafe` and do not tell the human
to close the provider session.

## 5. Completed and unsafe results

For an eligible `completed` candidate, use the same exact receipt validation,
comment write, mandatory comment-list readback, and optional event evidence
before printing `safe_to_close`; do not close the bead or terminate a session.
For `unsafe`, print only raw evidence and reasons. Do not write a checkpoint,
receipt, comment, event, or handoff; do not change repository or workspace
state.
