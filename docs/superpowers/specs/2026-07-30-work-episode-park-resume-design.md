# Work-Episode Park and Resume

**Date:** 2026-07-30
**Status:** Approved for a skill-first implementation; revised after final
fail-closed review
**Tracking bead:** `agents-f50f06`

## Goal

Let a human determine whether one current Codex or Claude work episode is safe
to close without losing work or confusing open work with actively held work.
The first delivery is a portable per-session skill. It does not discover other
human sessions, terminate providers, project a work board, or implement new
Rosary state primitives.

A human closes the provider UI only after the skill returns a validated,
durably read-back `safe_to_close=true` receipt.

## Terms and ownership

- A **provider session** is a Codex or Claude conversation reference.
- A **work episode** is a bounded period of task responsibility and has stable
  `ep-<UUID>` identity across process retries.
- An **anchor bead** is the Rosary work-graph item for the episode; it is not
  the episode itself.
- A **park intent** is one caller-stable `park-<UUID>` request.
- An **evaluation attempt** is a fresh `attempt-<UUID>` observation under that
  intent.
- A **preflight** proves that checkpointing is safe to attempt.
- **Durable evidence** proves that state is already reachable or that a
  created checkpoint actually resolves.
- A **receipt** is the validated durable evidence and folded terminal result.

Rosary is the eventual authority for episode events, provider-session
addresses, workspace checkpoints, and idempotent transitions. The skill is an
orchestration and compatibility layer. It must expose missing Rosary
mechanisms, not simulate them with comments or model judgment.

## Scope and boundaries

The skill lives at `skills/park-work/SKILL.md` and supports:

```text
/park-work --episode-id ep-<UUID> --intent-id park-<UUID> [<bead-id>]
/park-work --check [<bead-id>]
/park-work --resume [<episode-id>|<bead-id>]
```

- Park mode evaluates and may write one completed or parked receipt.
- Check mode is read-only, including when it reports that a checkpoint would
  be needed.
- Resume mode may perform read-only receipt, repository, checkpoint, and live
  state inspection. It cannot create a workspace, append a resumed
  observation, or begin work until Rosary supplies an atomic episode claim.

The skill never closes a bead, terminates a provider session, deletes a
worktree, discards/resets/stashes/rewrites changes, or silently selects or
mints an anchor. These are absolute boundaries, including on failures.

v1 remains per-session. Bulk discovery, provider termination, Canonical Hours
projection, and provider-neutral Rosary mechanism implementation are outside
scope.

## Caller-stable identity and retries

Park mode requires explicit stable episode and intent inputs. If either is
absent after anchor resolution, the pure helper mints the missing ID, prints a
retry command carrying both, and stops before evaluation, checkpointing, or
writes. It never proceeds with identity that exists only in process memory.

Before a new attempt, the caller reads and validates prior successful receipts
for the intent:

- every matching-intent success is inspected before returning;
- semantically identical duplicates are returned with their exact source
  bytes/comment IDs in deterministic order;
- any disagreement in episode, anchor, outcome, repository/binding, head, or
  resume semantics is unsafe independent of input order; and
- otherwise a fresh attempt ID is minted.

An unsafe evaluation writes no transition. A process-separated retry reuses
the episode and intent IDs and receives a fresh attempt ID. A write timeout is
recovered by searching the stable intent before another write.

Comment fallback cannot enforce concurrent uniqueness, but duplicate successful
park comments are semantically harmless because the skill performs no
irreversible terminal action. Comment dedupe is not sufficient for active
resume ownership.

## Anchor and repository identity

An explicit bead wins. Otherwise the skill may propose one anchor using active
dispatch, current branch/bookmark, then most recently touched work. A detected
anchor requires human confirmation. No match, disagreement, malformed data,
or rejected confirmation is unsafe.

Every repository operation is bound to exactly one registered repository:

1. Resolve the canonical current Git/jj root and authoritative origin.
2. Normalize SSH/HTTPS syntax and optional `.git` while retaining nondefault
   ports.
3. Require exactly one Rosary registration with that origin.
4. Require the selector to equal the receipt episode or anchor as applicable,
   and require the selected receipt path/backend to equal the canonical root
   and observed backend.
5. Retain exact root-bound command/stdout observations for root, origin, and
   Git dir/common dir.
6. Accept only normal `<root>/.git` or mechanically observed linked-worktree
   `<common>/.git/worktrees/...` relationships.
7. Reject selector/path/root/backend/Git-dir/common-dir/remote contradictions
   before live checks or workspace creation.

Both bead and episode resume selectors use this same algorithm. Git commands
are always argv-style `git -C <bound-root> ...`; jj commands always use the
equivalent explicit repository argument.

## Typed protocol schema

The pure helper accepts an exact observation shape:

```jsonc
{
  "schema_version": 1,
  "protocol_phase": "preflight | durable",
  "pr_backed": false,
  "bead": {
    "acceptance_command": "task check",
    "pr_url": null
  },
  "checks": []
}
```

`pr_backed` is required and must equal whether the structured Rosary
`bead.pr_url` field contains a valid HTTP(S) URL.

Every check has exactly `name`, `category`, `outcome`, structured `evidence`,
and a real timezone-bearing RFC3339 `observed_at`. Outcome is exactly `pass`,
`fail`, or `unknown`. The helper rejects missing, duplicate, unknown,
mis-categorized, and inapplicable checks, malformed truthy objects/lists, and
unrecognized fields.

The exact fixed checks are:

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
  pr_merged                 # exactly when pr_backed=true

resume:
  resume_target_resolvable  # exactly when all completion checks fail
```

Schema and evidence errors fail closed with helper CLI exit 2.

## Authoritative evidence

### Quiescence

`no_active_dispatch` combines current authoritative Rosary active and dispatch
history reads. Active records fail; unavailable, malformed, or contradictory
results are unknown.

`no_running_child_operation` is independent. It passes only from an
authoritative current-client query:

- Codex uses the current root thread's child/subagent tree exposed by the
  client (`collaboration.list_agents` or the corresponding current-child
  capability).
- Claude uses the current session's authoritative task/subagent registry when
  exposed.

A running non-Rosary child fails. An unavailable/malformed/unscoped client
query is unknown. Empty Rosary dispatch history alone is never a pass.

Git/jj observations prove no merge, rebase, cherry-pick, revert, conflicted
change, or unresolved file. Missing commands, unreadable operation markers,
or malformed output are unknown.

### Completion

The selected structured bead record supplies its acceptance command, status,
and PR URL.

`close_condition_satisfied` receives the complete authoritative Rosary verify
history with exact IDs, commands, verdicts, timestamps, and unique ascending
sequence values. The helper derives the latest verdict for the exact declared
acceptance command; it never trusts a caller-authored `latest` assertion.
Absence derives unknown. Mismatch, reversed/tied ordering, stale summary
claims, malformed/incomplete history, or unavailable history cannot authorize
a receipt.

`bead_terminal` passes only for structured Rosary status `closed` or `done`;
enumerated `open`, `in_progress`, and `blocked` statuses fail. Unknown status
values are schema errors; unavailable status remains unknown.

For PR-backed work, the provider read is exactly:

```text
gh pr view <bead.pr_url> --json state,mergedAt,url
```

or a provider-equivalent response with those fields. `pr_merged` passes only
for matching URL, `MERGED` state, and real RFC3339 `mergedAt`. Known open or
closed-unmerged state fails. Auth/error/malformed/mismatched data is unknown.
Non-PR work omits this check.

Open work can park only when every applicable completion check is mechanically
fail. Mixed or unknown completion evidence is unsafe; nonterminal work is not
guessed from prose or status alone.

## Preflight and durable phases

A checkpointable preflight is not preservation:

```text
protocol_phase=preflight
both preservation checks = pass with typed state=checkpointable
all other required checks fold to completed or parked
    => eligible=false, action=checkpoint
```

This authorizes only checkpoint creation. It never authorizes a receipt and
cannot validate as safe. The rule applies to both logically completed and
parked candidates.

After checkpoint creation, the caller must verify the returned immutable Git
commit/change or jj change against the captured workspace, replace both
preservation observations with fresh `state=durable` resolver evidence, set
`protocol_phase=durable`, and refold.

Already reachable state may begin directly in durable phase. Only:

```text
protocol_phase=durable
all identity/quiescence/preservation checks pass
all completion checks pass
    => candidate=completed, eligible=true, action=write_receipt

protocol_phase=durable
all identity/quiescence/preservation checks pass
all completion checks fail
resume_target_resolvable passes
    => candidate=parked, eligible=true, action=write_receipt

otherwise
    => unsafe
```

No receipt is constructed before the durable refold succeeds.

## Receipt schema and durability

A successful receipt extends the durable observation with:

- canonical episode, intent, and attempt UUID IDs;
- nonempty anchor;
- unique provider session objects with provider enum and nonempty ID;
- normalized absolute repository path, `git|jj`, string branch, and immutable
  nonempty full head/change ID;
- `completed|parked`, literal `safe_to_close=true`;
- string references; and
- for parked, string `next_action` plus exactly one string checkpoint or
  branch target.

The parked resume target and resolved immutable head must exactly equal the
target and `repository.head` in the passing resolver evidence. Both durable
preservation references also equal `repository.head`. The receipt anchor
equals the confirmed anchor; its repository equals the complete validated
repository binding; and VCS, preservation, and resume evidence all use that
same backend, bound root, workspace, and immutable head. Completed receipts
omit resume data. Receipt outcome must equal the deterministic fold. Receipt
validation accepts only durable-phase evidence.

The caller serializes once, validates those exact bytes, writes one fenced
`work_episode_receipt/v1` anchor comment, reads comments back, validates again,
and compares the exact bytes and identity/outcome/head/resume fields. Only
successful bead-comment readback proves durability. Provider-session event
write/readback is optional additional evidence and never a substitute.

`safe_to_close=true` is printed only after mandatory receipt readback.

## Resume gate

A parked receipt is historical evidence, not current ownership permission.
Resume may read and report:

- receipt validity and exact comment bytes;
- registered repository binding;
- immutable checkpoint/branch resolution and drift;
- current Rosary state;
- current-client child state; and
- bound VCS quiescence.

Missing/drifted checkpoints, moved branches, edited/deleted receipts,
reassignment, terminal state, active holders/children, conflicts, or malformed
evidence stop inspection as unsafe.

Before any workspace creation, resumed observation, or work, resume requires a
Rosary atomic episode claim/lease with caller-stable claim ID, episode
uniqueness, compare-and-set ownership, owner/expiry, authoritative readback,
and release/terminal semantics. The required mechanism is tracked by
`rosary-04faf5`.

That primitive does not exist in v1. Therefore active resume always fails
closed after optional read-only inspection. Comment dedupe and active-view
checks cannot prove a single holder.

## Verification fixtures

Executable regressions cover:

1. durable non-PR and PR-backed completed work;
2. durable parked work;
3. checkpoint-required completed and parked preflights;
4. active Rosary dispatch;
5. active and unavailable current-client child queries;
6. VCS conflict and dirty/unpreserved work;
7. missing, duplicate, unknown, and wrong-category checks;
8. conditional PR checks and exact provider response correlation;
9. malformed IDs, timestamps, repository, sessions, references, and resume
   fields;
10. receipt/fold outcome mismatch and missing/malformed exact comment readback;
11. process-separated unsafe retry then success with stable identity and fresh
    attempts;
12. order-independent duplicate/conflicting prior durable successes with exact
    source metadata preservation;
13. bead and episode repository binding plus selector/path/backend/Git-dir/
    common-dir/remote/port contradictions;
14. authoritative ordered Rosary verify-history folding and enumerated terminal
    statuses;
15. receipt anchor/repository/backend/workspace/head correlation;
16. missing/drifted checkpoint resolver evidence; and
17. atomic resume gating before every resume mutation.

Token checks of skill prose are supplemental only. Safety claims depend on the
executable helper tests and targeted CLI probes.

## Tracked mechanism work

- `agents-1259a5` — align handoff with the live session mailbox contract.
- `rosary-04faf5` — provider-neutral episode state and atomic claim/lease.
- `rosary-b64523` — distinguish actively held from forgotten open work.
- `canonical-hours-fd6926` — project start/interim/end observations.
- `vigil-8870d4` — typed observation/evidence capsules.
- `vigil-8888fd` — define the Vespers observation boundary.

The skill does not implement these mechanisms in other repositories.
