# ADR-003: Handoff-at-the-Seam

**Date:** 2026-07-27
**Status:** Accepted
**Topic:** A rosary-anchored `handoff` skill that serves both a human skimmer and the next agent.

---

## 1. Problem

The current `handoff` skill (shared by a colleague) produces a well-scoped **human-facing** artifact: a `/tmp/handoff-<date>-<slug>.md` written from the outgoing session's memory. It is disciplined about scope (task-verb → deliverable), references-not-duplicates, and states acceptance criteria.

But it is a **dead artifact**:

1. **It reads from the conversation, not from state.** If the session was compacted, handoff quality degrades — the agent is reconstructing from a lossy window.
2. **It doesn't connect to the work graph.** A handoff is really an *edge*: "this work is in state S; next actor should do Y." That edge lands in `/tmp` and evaporates. Rosary already models the graph (beads, comments, threads, dispatch history, a mailbox) and never sees it.

A handoff has **two audiences** with different needs:

- The **human** — skim, grab, `/tmp` markdown. (The current skill nails this.)
- The **next agent** — dispatchable, linked to the graph, survives compaction, lands on the exact code state. (The current skill misses this entirely.)

**"Structured"** = serving both from one source of truth, without duplication.

## 2. Core concept: the seam

A handoff anchors to a **seam** — the joint where this session's work ends and the next's begins. The seam is a *concept*; in rosary it is *addressed* by an anchor bead, but the two are not identical. Reframing from "which bead?" to "where is the seam?" dissolves the multi-bead / no-bead problem: a session has exactly one seam even when it touches several beads or none.

## 3. Seam resolution ladder

The skill resolves the seam by fixed precedence. Each rung is the fallback for the previous rung's failure mode. **Detection proposes; the human confirms. The seam is never anchored silently** — mis-anchoring quietly poisons the next session.

1. **Explicit** — `/handoff <bead-id> "<what next>"`. The user named the seam. Use it, no magic.
2. **Detected spine** — no bead arg → infer the spine bead in order:
   a. the active dispatch (`rsry_dispatch_history` / `rsry_active`),
   b. the current jj bookmark / git branch,
   c. the most-recently-touched bead (`rsry_bead_history`).
   Show the resolved seam, get a one-tap confirm. This is the common (~80%) path.
3. **Minted** — no confident spine (exploratory session; touched many or none) → mint one `issue_type: research|design` bead to *be* the seam, and link the constellation via `discovered-from`. The seam gets a home instead of being jammed onto an unrelated bead.

In all three rungs the payload carries `related: [...]` for satellite beads, so the constellation survives regardless of which rung fired.

## 4. Write path — four artifacts, one source

The skill builds one structured **payload** (§6), then materializes it into four places:

```
handoff (write)
 ├─ mailbox:  rsry_agent_session_message_record(event_type=handoff_message, payload=<§6>)  ← machine truth
 ├─ trail:    rsry_bead_comment(id=<seam>, body=<rendered markdown>)                        ← human-skimmable, in-graph
 ├─ code:     rsry_workspace_checkpoint(bead_id=<seam>, message=...)                        ← resumable tree (only if code changed)
 └─ view:     /tmp/handoff-YYYY-MM-DD-<slug>.md  (same rendered markdown)                   ← for a human to grab
```

- **Mailbox** (`rsry_agent_session_message_record`) is rosary's own first-class handoff primitive — *"the Rosary-owned mailbox layer; provider-native delivery can consume the same event stream later."* `event_type` defaults to `handoff_message`. This is the durable, structured channel the next session drains. It requires a `bead_id` — that's *why* §3 exists.
- **Bead comment** is the human-skimmable trail, living in the graph next to the work (not `/tmp`).
- **Workspace checkpoint** is a jj commit + bookmark of the actual working tree — so the next agent lands on the *exact* code state, not a described one. Skipped when the session changed no code.
- **`/tmp` markdown** is preserved from the original skill — a human-named file to grab. It is a *rendered view* of the payload, not an independent source.

### 4a. Bootstrap-from-state (before summarizing)

Before asking the model to summarize, the skill **reconstructs from rosary** so the handoff survives compaction:

- `rsry_bead_history <seam>` — what changed on the bead this session.
- `rsry_dispatch_history` — which agents touched what.
- `rsry_agent_run_events` — prior events on the bead.

The conversation is then used only for the glue rosary can't see (the *why*, dead ends, the judgment). This inverts the current skill's dependency on an intact conversation window.

## 5. Read / resume path

One skill, two modes. `/handoff --resume [<bead-id>]`:

1. Drain the mailbox: `rsry_agent_run_events` filtered to `event_type=handoff_message` for the repo (and bead, if given); take the latest.
2. Read `payload`. If `state.checkpoint` is present, check out that jj change so the tree matches.
3. **Re-validate live state** — the mailbox entry is an *observation at handoff time*, not current truth. Run `rsry_status` + `rsry_expand_ref <seam>` (or `rsry_list_beads`) to confirm the bead hasn't moved (closed, reassigned, dependencies changed) since the seam was written. Report drift before acting.
4. Restate the one-sentence task and its deliverable class (§7), then begin.

*(Future, out of scope: a SessionStart hook that auto-drains the mailbox. YAGNI for v1 — explicit `--resume` first.)*

## 6. Payload schema

Single structured object; both the bead comment and the `/tmp` markdown render from it. Empty fields are omitted (no padding — inherited from the original skill).

```jsonc
{
  "schema_version": 1,
  "seam": {
    "anchor_bead": "agents-395c30",
    "resolution": "detected-spine",     // explicit | detected-spine | minted
    "related": ["agents-56509c"]         // satellite beads in play
  },
  "task": {
    "one_sentence": "Finish the eve.dev service spike and report findings.",
    "deliverable": "report"              // report | change  — derived from the task verb (§7)
  },
  "state": {
    "checkpoint": "<jj-change-id>",       // from workspace_checkpoint; omitted if no code changed
    "branch": "eve-spike",
    "uncommitted": false
  },
  "acceptance_criteria": ["..."],         // maps to rosary bead acceptance_criteria field
  "how_to_verify": "runnable command or steps",
  "do_not_touch": ["path or claim that must not change"],
  "out_of_scope": ["work the receiving agent must not start"],
  "references": ["path", "url", "PR#"],   // reference, don't duplicate
  "suggested_skills": ["skill-name"]      // only those strictly necessary
}
```

Notes:
- `acceptance_criteria` maps 1:1 to `rsry_bead_create`'s `acceptance_criteria` field. When the seam is **minted** (rung 3), the skill writes the criteria straight into the new bead, satisfying rosary's close-condition gate. `issue_type: research|design` is exempt from the runnable-command requirement, so a *report* handoff is legal.
- Secrets are redacted before the payload is written (inherited).

## 7. Scope discipline (preserved and made structural)

The original skill's best idea is kept and hardened:

- **Verb → deliverable.** "Find out / investigate / determine / check" → `deliverable: report` (no recommendation, no chosen fix, no plan). "Implement / fix / add / migrate" → `deliverable: change`.
- This is no longer only prose guidance — it is a **typed field** in the payload. The resume side restates it, so scope creep is caught at pickup, not just at write.
- **Proofread gate** retained: re-read every field against `task.one_sentence`; cut anything that doesn't serve exactly that task.

## 8. Invariants / guardrails

1. **Seam is confirmed, never silent** (except explicit rung, where the user already named it).
2. **Mailbox is a snapshot; resume re-validates live state** (observational-memory discipline — do not act on a stale bead).
3. **Reference, don't duplicate** — cite paths/URLs; never re-summarize what's already verbatim in the graph or repo.
4. **Redact secrets** before any artifact is written.
5. **`/tmp` name is human-legible** — 2–4 kebab words, no session/bead ids in the filename.
6. **No code changed → no checkpoint** — don't mint empty jj commits.

## 9. Skill surface (for the plan)

```yaml
name: handoff
description: Compact the session into a handoff anchored at the work seam — a rosary mailbox
  entry (machine truth) + bead comment (human trail) + jj checkpoint + /tmp markdown view.
  --resume drains the seam in the next session.
model: opus
argument-hint: "[<bead-id>] <what the next session is for>   |   --resume [<bead-id>]"
allowed-tools: "Bash,Read,Glob,Grep,mcp__rsry__*"
```

## 10. Non-goals (YAGNI)

- No SessionStart auto-drain hook in v1 (explicit `--resume` first).
- No new rosary primitive — compose the existing tools only.
- No thread/decade creation on every handoff (rung 3 mints a single bead, not a thread). Thread grouping stays a manual `rsry_thread_create` when a session genuinely spans a group.
- No cross-repo handoff addressing (`session_ref` provider-native delivery) in v1 — record the mailbox entry; delivery is a later concern.

## 11. Relationship to the colleague's skill

This is a **superset**, not a rewrite. Preserved verbatim in spirit: scope-from-verb, reference-don't-duplicate, acceptance-criteria + how-to-verify, do-not-touch / out-of-scope negative space, suggested-skills, proofread gate, human-legible `/tmp` name. **Added:** the seam anchor, bootstrap-from-state, the mailbox/comment/checkpoint write path, and the `--resume` read side.

## 12. Resolved decisions

1. **Mint threshold** — the skill mints a seam bead (rung 3) only when spine detection is *unconfident*: all three detectors (dispatch, branch, recent-touch) return nothing or mutually disagree. A single confident detector short-circuits to rung 2.
2. **Resume drift policy** — if the seam bead is already `closed` (or reassigned) at `--resume`, the skill **hard-stops** and prints the drift report. The human decides whether to reopen, re-anchor, or abandon. Never silently resume onto moved state.
3. **Rendered-markdown location** — the `/tmp` view stays in `/tmp` (ephemeral, human-grab, matches the original skill). The durable copy is the bead comment in the graph; `/tmp` is never the source of truth.
