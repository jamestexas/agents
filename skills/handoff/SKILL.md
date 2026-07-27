---
name: handoff
description: >
  Compact the current session into a handoff anchored at the work SEAM — the joint
  where this session ends and the next begins. Writes a rosary mailbox entry (machine
  truth via rsry_agent_session_message_record), a bead comment (human-skimmable trail),
  a jj workspace checkpoint (resumable tree), and a /tmp markdown view (a human can grab).
  `--resume` drains the seam in the next session and re-validates live state before acting.
  Degrades to a plain /tmp markdown handoff when rosary is unavailable.
when_to_use: >
  At the end of a work session that another session — human or agent — must continue, or
  at the start of a session picking up prior work (`--resume`). Not for one-shot tasks that
  finish in place, and not a general session summary: a handoff is scoped to ONE task.
model: opus
allowed-tools: "Bash,Read,Glob,Grep,mcp__rsry__*"
argument-hint: "[<bead-id>] <what the next session is for>   |   --resume [<bead-id>]"
---

# Handoff

A handoff is a compact record of ONE task being handed over. It records what the next
actor must know to continue and complete the work — no more, no less.

It anchors at the **seam**: the joint where this session's work ends and the next's
begins. The seam is a concept; in rosary it is *addressed* by an anchor bead, but the two
are not identical — a session has exactly one seam even when it touches several beads or
none. Reframing from "which bead?" to "where is the seam?" is what lets this skill anchor
cleanly regardless of how messy the session was.

**MCP dependency:** rosary (`rsry_*`). Uses `rsry_agent_session_message_record`,
`rsry_bead_comment`, `rsry_workspace_checkpoint`, `rsry_bead_create`, `rsry_bead_history`,
`rsry_dispatch_history`, `rsry_agent_run_events`, `rsry_status`, `rsry_expand_ref`,
`rsry_list_beads`, `rsry_active`. If rosary is unavailable, fall back to WRITE step 5.4
only (the `/tmp` markdown) and tell the user the graph anchor was skipped.

The invocation argument (`$ARGUMENTS`) answers **"what will the next session be used
for?"** — it is the sole source of scope. Every field you write must trace back to it.

---

## 0. Resolve mode

If `$ARGUMENTS` begins with `--resume`, this is a pickup: go to **§6 RESUME**.
Otherwise this is a WRITE handoff: continue with §1.

---

## 1. Resolve the seam (WRITE)

The mailbox entry needs exactly one anchor bead. Resolve it by this precedence.
**Detection proposes; the human confirms — never anchor a handoff silently** (rung 1 is
already user-named, so it needs no confirm). Anchoring to the wrong bead quietly poisons
the next session.

1. **Explicit** — if `$ARGUMENTS` starts with a bead id (e.g. `agents-a40691`), that is
   the seam. Use it, no guessing.

2. **Detected spine** — otherwise infer the spine bead, trying in order:
   a. active dispatch — `rsry_active` / `rsry_dispatch_history`
   b. current jj bookmark / git branch — `jj bookmark list` or
      `git branch --show-current`, matched against open beads
   c. most-recently-touched bead — `rsry_bead_history`
   Present the resolved seam to the user and get a one-tap confirm before writing anything.
   This is the common (~80%) path.

3. **Minted** — only if all three detectors return nothing OR mutually disagree (i.e.
   detection is unconfident; a single confident detector short-circuits to rung 2): mint a
   seam to *be* the anchor rather than jamming the handoff onto an unrelated bead:
   ```
   rsry_bead_create(
     issue_type = research | design,        # exempt from the runnable close-condition gate
     title      = "handoff: <slug>",
     acceptance_criteria = <the one-sentence task from §3>)
   ```
   Then link the in-play beads to it via a `discovered-from` dependency (`rsry_bead_link`).

Record which rung fired as `seam.resolution` in the payload (§4). Collect every other
in-play bead into `seam.related` so the constellation survives no matter which rung won.

---

## 2. Bootstrap from state (WRITE)

Reconstruct what happened **from rosary before summarizing from the conversation** — so
the handoff survives a compacted context window:

- `rsry_bead_history <seam>` — what changed on the bead this session.
- `rsry_dispatch_history` — which agents touched what.
- `rsry_agent_run_events` — prior events on the bead.

Use the conversation only for the glue rosary cannot see: the *why*, the dead ends you
ruled out, the judgment calls. Rosary is the skeleton; the conversation is the marrow.

---

## 3. Derive scope from the task verb (WRITE)

Restate the task in ONE sentence taken from `$ARGUMENTS` — **not** from where the session
currently sits. Then classify the deliverable by the verb:

- "find out / investigate / determine / check whether" → `task.deliverable = "report"`.
  Do NOT include a recommendation, a decision, a chosen fix, or an implementation/next-step
  plan. The deliverable is the finding.
- "implement / fix / add / migrate" → `task.deliverable = "change"`. The deliverable is
  the change itself.

`deliverable` is a typed field in the payload, and §6 restates it at pickup — so scope
creep is caught when the next session *starts*, not just when this one ends.

**Proofread gate:** before writing, re-read every field you intend to emit against the one
sentence, and cut anything that does not help the receiving agent do exactly that task.
Padding is as much a failure as omission.

---

## 4. Build the payload

Build ONE structured object. Both the bead comment (§5.2) and the `/tmp` view (§5.4)
render from it — one source, two views. Omit empty fields; do not pad. Redact secrets
(API keys, passwords, PII) before writing anything.

```jsonc
{
  "schema_version": 1,
  "seam": {
    "anchor_bead": "agents-395c30",
    "resolution": "detected-spine",      // explicit | detected-spine | minted
    "related": ["agents-56509c"]          // satellite beads in play
  },
  "task": {
    "one_sentence": "Finish the eve.dev service spike and report findings.",
    "deliverable": "report"               // report | change — derived from the verb (§3)
  },
  "state": {
    "checkpoint": "<jj-change-id>",        // from §5.3; omit if no code changed
    "branch": "eve-spike",
    "uncommitted": false
  },
  "acceptance_criteria": ["..."],          // maps to the rosary bead acceptance_criteria field
  "how_to_verify": "runnable command or steps",
  "do_not_touch": ["path or claim that must not change"],
  "out_of_scope": ["work the receiving agent must not start"],
  "references": ["path", "url", "PR#"],    // reference, do not duplicate
  "suggested_skills": ["skill-name"]       // only those strictly necessary
}
```

---

## 5. Materialize (WRITE)

Write these four artifacts, in this order:

1. **Mailbox — machine truth.**
   ```
   rsry_agent_session_message_record(
     repo       = <repo>,
     bead_id    = <seam>,
     event_type = "handoff_message",
     message    = <task.one_sentence>,
     payload    = <the §4 object>)
   ```
   This is rosary's own handoff primitive; the next session drains it via
   `rsry_agent_run_events`. Do NOT attempt provider-native `session_ref` delivery — record
   the event only; addressed delivery is out of scope.

2. **Bead comment — human trail.** `rsry_bead_comment(id=<seam>, body=<rendered markdown>)`.
   Render the markdown from the payload using the schema in **§8**. This lives in the graph
   next to the work, where a human scanning the bead will find it.

3. **Workspace checkpoint — resumable tree.** ONLY if code changed this session:
   `rsry_workspace_checkpoint(bead_id=<seam>, repo_path=<repo>, message="handoff: <slug>")`.
   Store the returned jj change id as `state.checkpoint`. If no code changed, SKIP — do not
   mint empty commits.

4. **/tmp view — human grab.** Write the same rendered markdown (§8) to
   `/tmp/handoff-<YYYY-MM-DD>-<slug>.md`. `<slug>` is 2–4 kebab words, human-legible, with
   NO session/bead ids in the filename.

When done, print **only** the `/tmp` path. No summary, no extra commentary.

---

## 6. RESUME  (`--resume [<bead-id>]`)

1. **Drain.** `rsry_agent_run_events` filtered to `event_type == "handoff_message"` for the
   repo (and the bead, if an id was passed). Take the latest entry; read its `payload`.

2. **Land on the tree.** If `payload.state.checkpoint` is set, check out that jj change so
   the working tree matches the state the handoff was written against.

3. **Re-validate live state.** The mailbox entry is an OBSERVATION at handoff time, not
   current truth. Run `rsry_status` + `rsry_expand_ref <seam>` (or `rsry_list_beads`). If
   the seam bead is `closed` or reassigned, **HARD-STOP**: print a drift report (what the
   handoff assumed vs what is true now) and let the human decide — reopen, re-anchor, or
   abandon. Never silently resume onto moved state.

4. **Restate & begin.** Restate `payload.task.one_sentence` and `payload.task.deliverable`,
   and honor the deliverable class: a `report` handoff must not start making changes. Load
   any `payload.suggested_skills`, then begin the work.

---

## 7. Invariants

- **Seam is confirmed, never silent** — except the explicit rung, where the user named it.
- **Mailbox is a snapshot; RESUME re-validates** — never act on a stale bead.
- **Reference, don't duplicate** — cite paths/URLs; never re-summarize what is already
  verbatim in the graph or the repo.
- **Redact secrets** before any artifact is written.
- **Human-legible /tmp name** — 2–4 kebab words, no ids.
- **No code changed → no checkpoint** — do not mint empty jj commits.
- **Scope from the task, not the conversation** — the one sentence is the only source of
  scope; match the deliverable to its verb.

---

## 8. Rendered-markdown schema (bead comment + /tmp view)

Both the §5.2 bead comment and the §5.4 `/tmp` file use this shape. Empty sections are
omitted — do not pad.

```markdown
# Handoff

Short summary of what the parent session has been generally about.

## Task

<the one-sentence task, then the compact detail the next actor needs>

## Do Not Touch

<what cannot be changed / touched>

## Out of scope

<work the receiving agent must not start>

## Acceptance Criteria

<what needs to happen to call it done>

## How to verify

<how to verify the outcome is as desired — a runnable command if possible>

## References

<paths/URLs only: relevant docs, PR/issues, the seam bead + related beads>

## Skills

<suggested skills to load — only those strictly necessary>
```
