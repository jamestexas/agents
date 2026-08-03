---
name: park-work
description: >-
  Check whether the current human-agent work episode is mechanically safe to
  close, park incomplete work behind a verified durable checkpoint and receipt,
  or inspect a previously parked episode before a fail-closed resume gate.
allowed-tools: "Bash,Read,Grep,Glob,TaskList,mcp__rsry__*"
argument-hint: "[--episode-id ep-UUID --intent-id park-UUID] [<bead-id>] | --check [<bead-id>] | --resume [<episode-id>|<bead-id>]"
---

# Park Work

`park-work` evaluates one logical work episode. A provider-native Codex or
Claude session is evidence attached to that episode, not its identity. v1 is
per-session; it does not discover or close other provider sessions.

**MCP dependency:** rosary (`rsry_*`).

## Absolute boundaries

- Never close a bead.
- Never terminate a provider session.
- Never delete a worktree.
- Never discard, reset, stash, or rewrite user changes.
- Never silently select or mint an anchor bead.
- Never set or print `safe_to_close=true` until a schema-valid, durable-phase
  receipt has been written and read back by its stable `intent_id`.
- Never use model-authored prose as safety evidence.
- Never start an active resume without a verified atomic episode claim/lease.

Bulk discovery, provider termination, Canonical Hours projection, and the
Rosary mechanisms named below remain out of scope.

## Helper and failure behavior

Resolve this loaded file's absolute path from the skill loader, derive
`SKILL_DIR`, and require `$SKILL_DIR/scripts/fold.py`. Do not guess a checkout
path or rely on a caller's current directory.

The helper exposes:

```text
python3 "$SKILL_DIR/scripts/fold.py" prepare-attempt
python3 "$SKILL_DIR/scripts/fold.py" evaluate
python3 "$SKILL_DIR/scripts/fold.py" validate-receipt
python3 "$SKILL_DIR/scripts/fold.py" confirm-readback
python3 "$SKILL_DIR/scripts/fold.py" bind-repository
python3 "$SKILL_DIR/scripts/fold.py" resume-gate
```

Every command reads exactly one JSON object from standard input. Schema,
evidence, or correlation errors exit 2. Treat exit 2, malformed output, an
unavailable tool, authentication failure, and contradictory evidence as
`unsafe`. On `unsafe`, print the helper error or fold reasons and stop without
a checkpoint, receipt, comment, event, workspace, or handoff write.

## Invocation identity

Modes are:

```text
/park-work --episode-id ep-<UUID> --intent-id park-<UUID> [<bead-id>]
/park-work --check [<bead-id>]
/park-work --resume [<episode-id>|<bead-id>]
```

An explicit bead is the anchor. Otherwise propose exactly one anchor using,
in order, the current active dispatch, the current branch/bookmark, and the
most recently touched bead. Require human confirmation of a detected anchor.
Disagreement, no match, malformed results, or rejected confirmation is
`unsafe`; never mint an anchor.

Park mode requires caller-stable `--episode-id ep-<UUID>` and
`--intent-id park-<UUID>`. After resolving the anchor, pass both inputs and
the validated successful prior receipts to `prepare-attempt`.

If either stable ID is absent, `prepare-attempt` mints the missing ID and
returns `action=retry` with a command carrying both IDs. Print that retry
command and stop before evaluation, checkpointing, or writes. Do not continue
with an identity held only in process memory.

Before minting an evaluation attempt, read all anchor comments, parse only a
single fenced `work_episode_receipt/v1` JSON object per candidate, and validate
every matching-intent candidate. Pass each as `receipt` plus its exact
`source_bytes` and `comment_id` to `prepare-attempt`. The helper inspects all
matching successes before deciding: semantic disagreement in episode, anchor,
outcome, exact bead acceptance/PR contract, derived `pr_backed` applicability,
repository/binding, head, or resume data is `unsafe`, independent of comment
order. Semantically identical duplicates return
`action=return_existing` with their exact source metadata in deterministic
comment-ID order and no new transition. `action=evaluate` supplies a fresh
`attempt-<UUID>`; every retry invocation gets a fresh attempt while preserving
the episode and intent IDs. Malformed or identity-conflicting matching
receipts are `unsafe`.

`--check` is read-only and never needs a durable retry identity. It may report
that a checkpoint would be required, but it never creates one.

## Repository identity and command binding

Resolve exactly one registered repository before collecting VCS evidence.
Obtain the canonical current Git/jj root and its authoritative origin, call
`rsry_repo_list`, normalize SSH/HTTPS syntax and optional `.git`, and require
exactly one registered origin match. Nondefault ports remain part of canonical
remote identity. A basename is not repository identity.

For resume, both an explicit bead selector and an episode selector use this
same algorithm. Build the helper's `bind-repository` input from:

- selector kind/value;
- the selected receipt's complete episode ID, anchor, and strict repository
  object;
- exact command/stdout observations for canonical root, authoritative origin,
  and, for Git, absolute Git dir and common dir; and
- all registered repository names/URLs.

The selector must equal the receipt episode or anchor as applicable. The
selected receipt path must equal the canonical observed root. The exact
root-bound Git observations must prove either the normal `<root>/.git`
relationship or a linked-worktree `<common>/.git/worktrees/...` relationship.
The observed origin and exactly one Rosary registration must agree. Reject
selector, path/root, Git-dir/common-dir, backend, registration, or remote
contradictions before live checks, workspace selection, or creation.

After binding, use only the helper-returned `bound_root`. Every Git command is
an argv-style `git -C <bound-root> ...` command. Every jj command uses its
equivalent `jj --repository <bound-root> ...`. Never run an unbound VCS
command against the caller's ambient directory.

## Typed observation schema

An evaluation object has exactly:

```json
{
  "schema_version": 1,
  "protocol_phase": "preflight or durable",
  "pr_backed": false,
  "bead": {
    "acceptance_command": "the bead's declared command",
    "pr_url": null
  },
  "checks": []
}
```

Derive the required `pr_backed` boolean only from the selected Rosary bead's
structured PR URL field: it is true exactly when `bead.pr_url` is a valid
nonempty HTTP(S) URL. Never infer PR backing from prose, branch names, or
references.

Every check item has exactly `name`, `category`, `outcome`, `evidence`, and
`observed_at`. Outcome is exactly `pass`, `fail`, or `unknown`;
`observed_at` is a real timezone-bearing RFC3339 timestamp. Evidence is the
nonempty typed object required by the helper, never a truthy string/list or a
model summary.

The exact unique checks and fixed categories are:

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
  bead_terminal
  pr_merged                 # required only when pr_backed=true

resume:
  resume_target_resolvable  # required when bead_terminal mechanically fails
```

Missing, duplicate, unknown, mis-categorized, or inapplicable checks are schema
errors. A non-PR bead must omit `pr_merged`. A PR-backed bead must include it.
`resume_target_resolvable` is present only when `bead_terminal` mechanically
fails from an enumerated nonterminal status.

## Authoritative evidence mapping

### Identity and VCS state

`anchor_confirmed` names the explicit or confirmed anchor.
`repository_resolved` contains the successful registered-repository binding,
absolute root, and authoritative remote.

`no_active_dispatch` combines the current authoritative `rsry_active` and
active-only dispatch-history results. Empty authoritative results pass;
active records fail; unavailable, malformed, or contradictory reads are
unknown.

Run the bound VCS observations:

```text
git -C <bound-root> status --porcelain=v2 --branch
git -C <bound-root> diff --name-only --diff-filter=U
git -C <bound-root> rev-parse --show-toplevel
git -C <bound-root> rev-parse --path-format=absolute --git-dir
git -C <bound-root> rev-parse --path-format=absolute --git-common-dir
git -C <bound-root> remote get-url origin
git -C <bound-root> branch --show-current
git -C <bound-root> rev-parse HEAD
git -C <bound-root> rev-parse '@{upstream}'
git -C <bound-root> merge-base --is-ancestor HEAD '@{upstream}'

jj --repository <bound-root> status
jj --repository <bound-root> resolve --list
jj --repository <bound-root> log -r @ --no-graph -T 'change_id ++ "\n"'
jj --repository <bound-root> bookmark list
```

Any merge, rebase, cherry-pick, revert, unresolved path, or jj conflict makes
`no_vcs_operation_or_conflict=fail`. Unreadable operation state or malformed
output is unknown.

### Current-client child operation

`no_running_child_operation` must come from an authoritative current-client
query, not Rosary dispatch history:

- Codex adapter: query the current root thread's child/subagent tree through
  the exposed `collaboration.list_agents`/current-child operation capability.
  The typed evidence source is `codex.current_child_operations`; any
  running child makes the check fail.
- Claude adapter: query the current Claude session's exposed task/subagent
  registry (for example `TaskList` when it is the authoritative session
  registry). The typed evidence source is `claude.current_child_operations`;
  any running child makes the check fail.

The response must be explicitly authoritative for this current session and
contain a well-formed running-operation array. If the adapter is not exposed,
does not scope to the current session, errors, or returns a malformed shape,
the outcome is `unknown`. Empty Rosary dispatch history alone is never a pass.

### Completion

Read the structured bead record to obtain the exact declared acceptance
command, status, and PR URL.

The live `rsry_bead_history` response does not expose an exact command-bound,
authoritatively ordered verify history. Therefore
`close_condition_satisfied` must be `unknown` with typed unavailable evidence.
Never invent `command`, `kind`, `sequence`, `latest`, `authoritative`, or
`complete` fields from prose or array position. Completed receipt production
is unavailable until `rosary-a6166d` supplies the missing event identity,
declared-command correlation, complete ordering, and latest-verdict proof.

`bead_terminal` passes only for the structured Rosary status `closed` or
`done`; the enumerated nonterminal statuses `open`, `in_progress`, and
`blocked` fail. Missing status is unknown and any other status is a schema
error.

For a PR-backed bead, run exactly this read-only provider query (or a provider
adapter returning the identical typed fields):

```text
gh pr view <bead.pr_url> --json state,mergedAt,url
```

`pr_merged` passes only when `state` is `MERGED`, `url` exactly matches the
bead's structured PR URL, and `mergedAt` is a valid RFC3339 timestamp. `OPEN`
or `CLOSED` with no merge timestamp is fail. Authentication errors, command
errors, URL mismatch, missing fields, or malformed output are unknown. A
non-PR bead does not invent `pr_merged`.

In v1, `completed` is unavailable because the close condition cannot be
mechanically proven. A structured `open`, `in_progress`, or `blocked` status
is itself a decisive failure of `bead_terminal`; with all base evidence
durable, every other applicable completion check known, and the resume
resolver passing, it produces `parked` even though
`close_condition_satisfied=unknown`. This does not coerce or fabricate a
close-condition failure. `done` or `closed` with unavailable history remains
unsafe, never completed or parked. Unknown PR evidence, terminal mixed/unknown
completion, and malformed status remain unsafe.

## Checkpoint before any receipt

The helper's explicit `protocol_phase` distinguishes checkpoint authorization
from durable evidence:

- A checkpoint-needed observation uses `protocol_phase=preflight`. Both
  preservation checks must be passing typed `state=checkpointable` evidence
  for the exact bound workspace. The helper returns `eligible=false` and
  `action=checkpoint` only for a mechanically nonterminal parked candidate.
  A terminal bead without `rosary-a6166d` remains unsafe and does not authorize
  a receipt or checkpoint through this protocol.
- An already durable observation, or a fresh post-checkpoint observation,
  uses `protocol_phase=durable`. Both preservation checks must contain actual
  resolved `state=durable` references. Only this phase can return
  `eligible=true, action=write_receipt`.

A preflight object is never receipt-eligible and `validate-receipt` rejects it.
Only a nonterminal parked candidate can authorize checkpoint creation in v1.

For park mode only, when a valid preflight returns `action=checkpoint`, call
`rsry_workspace_checkpoint` for the exact anchor and bound root. Verify the
returned Git commit/change or jj change mechanically with bound commands.
Then replace both preservation observations—not merely their prose—with fresh
post-checkpoint durable evidence, set `protocol_phase=durable`, and rerun
`evaluate`. If either replacement is missing, mismatched, unresolved, or
unknown, stop unsafe before receipt construction.

`--check` prints the preflight result and stops before the checkpoint action.

## Durable receipt

Construct a receipt only from `eligible=true, action=write_receipt`. It
contains the observation fields plus:

- canonical `ep-<UUID>`, `park-<UUID>`, and `attempt-<UUID>`;
- a nonempty anchor;
- provider sessions as unique `{provider: codex|claude, id: nonempty-string}`
  objects;
- repository with normalized absolute path, VCS `git|jj`, nonempty string
  branch, and full immutable head/change ID;
- `outcome=completed|parked` and literal `safe_to_close=true`;
- references as nonempty strings; and
- for parked, a nonempty string `next_action` and exactly one nonempty string
  target: `checkpoint` or `branch`.

The parked target and its resolved immutable head must equal the target and
`repository.head` in the passing `resume_target_resolvable` evidence. Both
durable preservation references must also equal `repository.head`. The
receipt anchor must equal `anchor_confirmed`; its full repository object must
equal the embedded validated `repository_resolved` binding; and all VCS,
preservation, and resume evidence must use that same backend, bound root, and
workspace. Completed receipts omit `resume`.
Although the schema reserves `completed`, v1 cannot validate or write one
until `rosary-a6166d` exists.
Serialize once, run `validate-receipt` on those exact bytes, and stop on exit
2 or malformed output.

Fence the unchanged bytes as `work_episode_receipt/v1`, append them with
`rsry_bead_comment`, then read all comments back with
`rsry_bead_comment_list`. Pass the exact serialized receipt bytes and returned
comment IDs/bodies to `confirm-readback`; it accepts only an exact sole fence,
validates it again, and rejects missing or conflicting same-intent bytes.
Comment readback is mandatory durability proof.

When a provider session address exists, the same exact fence may also be sent
through `rsry_agent_session_message_record` and read through session events.
That is additional evidence only and never substitutes for bead-comment
readback. A write timeout is retried with the caller-stable IDs; search the
intent before writing again.

Only after validation and mandatory readback may the skill render a
human-readable `/tmp/park-<date>-<slug>.md` and print
`safe_to_close=true`. Never close the bead or provider session.

## Resume is inspection-only in v1

`--resume` may locate and validate the latest parked receipt and report drift,
but it must fail closed before workspace creation, a resumed observation, or
work.

First use the common registered-repository/origin algorithm and
`bind-repository` for either selector. Then perform read-only inspection:
validate the receipt, re-read its exact comment, verify the immutable
checkpoint/branch against `repository.head`, and query live Rosary, current
client, and bound VCS state. A missing checkpoint, moved branch, edited/deleted
receipt, reassignment, terminal bead, active holder, active child, conflict,
or schema/repository drift is unsafe.

After read-only inspection, call `resume-gate`. The required contract is an
atomic episode claim/lease with:

- a caller-stable claim ID;
- uniqueness on the episode;
- compare-and-set ownership against the current episode state;
- an owner identity and lease expiry;
- authoritative readback; and
- explicit release/terminal semantics.

That Rosary primitive does not yet exist and is tracked by `rosary-04faf5`.
Therefore the helper returns `authorized=false`, allows only
`read_only_inspection`, and blocks `workspace_creation`,
`resumed_observation`, and `work`. Stop there.

Comment search, read-before-write dedupe, a prior resumed comment, or an empty
active view cannot prove a single holder and must never impersonate the atomic
claim. When Rosary supplies the named primitive in a future version, the skill
and executable gate must be upgraded and reviewed before active resume is
enabled.

## Retry and independent results

An unsafe attempt writes no transition. The caller repeats the printed command
with the same episode/intent IDs; `prepare-attempt` mints a fresh attempt. A
prior durable success for those IDs is returned unchanged without another
transition.

Each invocation evaluates one independent episode. A controller may collect
results, but one unsafe episode never rolls back or weakens a completed or
parked result from another episode.
