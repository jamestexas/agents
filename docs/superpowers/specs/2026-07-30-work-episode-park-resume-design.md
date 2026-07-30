# Work-Episode Park and Resume

**Date:** 2026-07-30
**Status:** Approved for a skill-first implementation
**Tracking bead:** `agents-f50f06`

## Goal

Let a human safely end several open Codex or Claude sessions without losing
resumable work or confusing open pull requests with work that an agent is
actively holding.

The first delivery is a portable skill in this repository. It evaluates and
parks the work episode associated with the session in which it runs. It does
not attempt provider-specific session termination. A human closes or archives
the provider UI only after the skill returns a durable `safe_to_close` receipt.

Human-originated sessions are not yet uniformly discoverable through Rosary,
so v1 is deliberately per-session. Bulk discovery and provider termination are
later adapters, not behavior simulated by the skill.

## Terms

- **Provider session:** a Codex or Claude conversation identified by the
  provider's native session reference.
- **Work episode:** one bounded period during which a human and one or more
  agent sessions hold responsibility for a task. This is the durable identity.
  It may survive provider changes and session restarts.
- **Anchor bead:** the Rosary bead that addresses the episode in today's work
  graph. A bead and an episode are not the same object; a bead may have several
  episodes over time.
- **Park intent:** a stable request to make an incomplete episode dormant.
- **Evaluation attempt:** one observation of the live repository, bead, PR,
  dispatch, and checkpoint state under a park intent.
- **Receipt:** the structured evidence and folded outcome proving whether the
  provider session is safe to close.

## Ownership

Rosary is the eventual authority for work-episode events, provider-session
addresses, workspace checkpoints, and idempotent transitions.

The `park-work` skill is an orchestration and compatibility layer. It gathers
evidence using existing tools, applies the deterministic fold in this document,
and writes a transitional receipt to the anchor bead. It must not hide a
missing mechanism behind model judgment.

Canonical Hours and Vespers may project Rosary episode observations into a
work board. They do not author or own episode state.

Vigil becomes relevant only for asynchronous `unsafe -> wait -> re-evaluate`
behavior. A user-invoked park attempt does not require a scheduled watcher.

0day-api remains unchanged. Its static dependency topology is not live
session truth and is unnecessary for v1 discovery.

The existing `handoff` skill transfers responsibility to another actor.
`park-work` establishes whether responsibility can safely become dormant.
They may eventually share renderers and receipt types, but their operations
remain distinct.

## Skill Interface

The new skill lives at `skills/park-work/SKILL.md` and exposes three modes:

```text
/park-work [<bead-id>]
/park-work --check [<bead-id>]
/park-work --resume [<episode-id>|<bead-id>]
```

- Default mode evaluates the current episode and writes a terminal
  `completed` or `parked` receipt only when every required check passes.
- `--check` performs the same live evaluation without writing a receipt or
  checkpoint.
- `--resume` loads the latest matching parked receipt, revalidates live state,
  restores or locates its checkpoint, and records the transition back to
  active before work continues.

The explicit bead ID wins. Otherwise the skill may propose an anchor using the
same precedence as `handoff`: active dispatch, current branch/bookmark, then
most recently touched bead. A detected anchor requires human confirmation.
The skill never silently mints a bead or attaches an episode to an uncertain
anchor.

## Lifecycle

```text
active
  | park intent
  v
evaluating -- failed/unknown evidence --> unsafe (no transition)
  | terminal work proven
  +-------------------------------> completed
  | resumability proven
  +-------------------------------> parked

parked -- live revalidation + checkpoint restoration --> active
```

`unsafe` is an evaluation result, not durable episode state. It performs no
transition and does not authorize closing the provider session.

`completed` and `parked` are both safe-to-close projections:

- `completed` means the episode has no remaining responsibility.
- `parked` means responsibility remains, but its state and next entry point are
  durably recoverable.

Resuming completed work creates a new episode; it does not reopen the completed
episode implicitly.

## Idempotency and Retries

A park intent has a stable `intent_id`. Every live evaluation has a distinct
`attempt_id`. Retrying may observe new evidence under the same intent, but the
episode can acquire at most one semantic `parked` or `completed` transition for
that intent.

The skill uses the stable intent ID when the Rosary event surface accepts a
caller-supplied event ID. Before writing, it reads existing events/comments for
that intent; after writing, it reads the receipt back. Replaying a successful
intent returns the existing receipt.

The transitional bead-comment fallback cannot provide a database uniqueness
constraint, so concurrent duplicate comments remain possible in v1. They are
semantically harmless because the skill does not terminate sessions, delete
workspaces, close beads, or perform another irreversible action. Strict
compare-and-append uniqueness belongs in Rosary's first-class episode event
primitive and is covered by the durable routing/state-machine work.

A batch is a collection of independent episode results. Eight successful
episodes remain successful when two are unsafe. Retrying the whole collection
is safe; callers do not need to reconstruct a partial rollback.

## Deterministic Checks

Every check returns `pass`, `fail`, or `unknown`. Required `unknown` results
fail closed. Evidence includes the command/tool result and observation time,
not a model-authored conclusion.

### Identity

1. Resolve and confirm exactly one anchor bead.
2. Resolve the canonical repository path and VCS identity.
3. Resolve the episode ID from an existing nonterminal receipt or mint it once
   for this episode.
4. Record provider session references when available. Their absence is
   reported but does not replace the work-episode identity.

### Quiescence

1. Rosary reports no active dispatch for the anchor bead.
2. The current client reports no running child/subagent operation when that
   capability is available.
3. Git or jj reports no merge, rebase, cherry-pick, conflicted change, or
   unresolved file.

An unavailable active-operation check is `unknown`, not an assumed pass.

### Preservation

1. The working tree is clean, or a workspace checkpoint succeeds.
2. Relevant local commits are remotely reachable, or the checkpoint can be
   resolved after creation.
3. The receipt is appended to the anchor bead and read back by its stable
   intent ID.
4. For `parked`, the receipt names a concrete next action and a resumable tree
   location: checkpoint, pushed branch, or another mechanically resolvable
   reference.

The skill never cleans or deletes a worktree. Workspace cleanup is outside the
park operation.

### Completion

1. The bead's structured close condition is satisfied.
2. A PR-backed bead's linked PR is actually merged, not merely closed,
   approved, or merge-ready.
3. Rosary reports the bead terminal after applying containment and child
   gating.
4. The repository contains no unpreserved session work.

Non-PR research or design work may complete through its structured resolution
condition; it is not forced through a fictitious PR check.

## Outcome Fold

```text
terminal completion evidence
AND quiescent
AND preserved
AND receipt read back
    => outcome=completed, safe_to_close=true

not terminal
AND quiescent
AND checkpoint/resume target verified
AND receipt read back
    => outcome=parked, safe_to_close=true

otherwise
    => outcome=unsafe, safe_to_close=false
```

Model-authored prose never participates in this fold. Summaries, dead ends,
and next-step wording are resume context only.

## Receipt Schema

```jsonc
{
  "schema_version": 1,
  "episode_id": "ep-<uuid>",
  "intent_id": "park-<uuid>",
  "attempt_id": "attempt-<uuid>",
  "anchor_bead": "agents-f50f06",
  "provider_sessions": [
    { "provider": "codex", "id": "<native-session-id>" }
  ],
  "repository": {
    "path": "/absolute/repository/path",
    "vcs": "git",
    "branch": "feature/example",
    "head": "<commit-or-change-id>"
  },
  "checks": [
    {
      "name": "no_active_dispatch",
      "outcome": "pass",
      "evidence": "<compact tool result or durable reference>",
      "observed_at": "2026-07-30T18:00:00Z"
    }
  ],
  "outcome": "parked",
  "safe_to_close": true,
  "resume": {
    "checkpoint": "<change-id>",
    "next_action": "Run the named verification and continue the bead."
  },
  "references": ["<paths, PR URLs, or event IDs>"]
}
```

Empty optional fields are omitted. Secrets, credentials, private prompts, and
unnecessary transcript content are never included.

## Materialization

For a successful v1 transition:

1. Build the receipt from fresh evidence.
2. If incomplete work needs preservation, create and verify the checkpoint
   before setting `safe_to_close`.
3. Write the structured receipt as a machine-readable anchor-bead comment.
4. Read the comment back and verify `intent_id`, `episode_id`, outcome, and
   checkpoint reference.
5. When a provider-native session address is available, also record the same
   payload through Rosary's agent-session event surface.
6. Render a human-readable `/tmp/park-<date>-<slug>.md` view from the receipt.
7. Return the outcome and path. The human may close the provider UI only when
   `safe_to_close=true`.

If a write times out after possibly succeeding, the retry searches by
`intent_id` before writing again. If read-back cannot prove durability, the
result is `unsafe` even when the repository itself appears clean.

## Resume

Resume finds the latest parked receipt by explicit episode ID or confirmed
anchor bead, then:

1. Re-read Rosary and repository state.
2. Stop on reassignment, completed/abandoned work, missing checkpoint, VCS
   conflict, or another active holder.
3. Restore or locate the recorded tree without deleting another workspace.
4. Restate the bounded task and next action.
5. Record a resumed observation using the same episode ID.
6. Begin work only after the resumed observation is durable.

The receipt is a historical observation, never permission to ignore live
drift.

## Failure Semantics

- One episode failure never rolls back another episode's successful receipt.
- Tool/auth/schema failures are errors or `unknown`, never "not yet."
- Conflicting evidence fails closed and includes both references.
- A missing provider address prevents provider-mailbox delivery but does not
  prevent bead-anchored preservation.
- A missing or unconfirmed bead prevents parking.
- No failure path closes a bead, kills a provider session, deletes a worktree,
  or rewrites user changes.

## Verification

The skill must be tested against these fixtures:

1. Clean repository, satisfied close condition, merged PR -> `completed`.
2. Incomplete bead, clean pushed branch, durable resume target -> `parked`.
3. Dirty repository, successful checkpoint and read-back -> `parked`.
4. Dirty repository with failed checkpoint -> `unsafe`.
5. Active Rosary dispatch -> `unsafe`.
6. Merge/rebase/unresolved conflict -> `unsafe`.
7. PR closed without merge -> not `completed`.
8. Receipt write succeeds but read-back fails -> `unsafe`.
9. Duplicate invocation with one intent -> same semantic receipt.
10. First evaluation unsafe, later evidence changes, retry succeeds.
11. Mixed collection of completed, parked, and unsafe episodes preserves each
    independent result.
12. Resume against a missing or drifted checkpoint stops before work begins.

At least one end-to-end test must use a disposable real repository, real Rosary
bead, real checkpoint or pushed branch, and receipt read-back. Mock-only proof
is insufficient for the safety claim.

## Mechanism Work

The skill is intentionally a probe for missing mechanisms. Relevant work is
tracked rather than reimplemented here:

- `agents-1259a5` — align the existing handoff skill with the live
  `session_ref` mailbox contract.
- `rosary-04faf5` — durable provider-neutral start/send/resume/handoff/cancel/
  terminal state machine, including duplicate delivery.
- `rosary-b64523` — distinguish actively held work from forgotten open work.
- `canonical-hours-fd6926` — give observations start/interim/end episode
  framing.
- `vigil-8870d4` — typed observation/evidence capsules.
- `vigil-8888fd` — define the Vespers observation boundary.

No 0day-api implementation bead is warranted by this design. No Vigil
implementation is warranted until a real asynchronous wait-until-parkable use
case is chosen.

## Delivery Sequence

1. Implement and exercise `park-work` using current Rosary tools and the
   bead-comment receipt fallback.
2. Fix or replace the address-required mailbox call exposed by
   `agents-1259a5`.
3. Use observed skill friction to refine Rosary's first-class work-episode
   event and transition surface.
4. Add a Canonical Hours projection only after real episode events exist.
5. Add controller-level bulk discovery and provider termination only after
   human-originated sessions are uniformly addressable.
