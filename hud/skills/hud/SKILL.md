---
name: hud
description: >
  Capture a note, playbook, peer, or project-context update into the user's
  personal work HUD — a local markdown tree at $HUD_ROOT. Triggers on "jot
  this down", "remember this for <project>", "add a playbook for X", "note
  this peer/colleague", "update the context for <project>", or "lint the
  hud". The consolidation rule: this is the only place standalone notes go —
  never write a note file anywhere else.
user-invocable: true
argument-hint: "[lint] | [note title / playbook slug / peer handle]"
---

# hud — authoring skill for the personal work HUD

The HUD is a folder of markdown at `$HUD_ROOT` (env var, default `~/hud`).
It is not a tool you call — it is a place you write files, in a shape a
small local server can render. This skill is the shape.

## 0. Resolve the root

Use `$HUD_ROOT` if set, else `~/hud`. If that directory does not exist,
**stop and say so** — do not create it. The HUD root is scaffolded once by
its own setup step; a skill invocation is never the place that happens.

## 1. Load the schema file first

Before writing anything, check for `$HUD_ROOT/HUD.md`. If it exists, read
it — it is the schema file, co-owned by the user and every agent that
writes here, and **it wins over this skill on any conflict** (a path,
frontmatter field, or convention it states supersedes what's written
below). If it doesn't exist, proceed on the conventions in this file.

## 2. Figure out what's being asked for

| Intent | Target |
|---|---|
| capture a note | `$HUD_ROOT/projects/<project>/notes/YYYY-MM-DD-<slug>.md` (or `$HUD_ROOT/inbox/YYYY-MM-DD-<slug>.md` if `<project>` is unclear) |
| capture a playbook | `$HUD_ROOT/playbooks/<slug>.md` |
| update project context | `$HUD_ROOT/projects/<project>/CONTEXT.md` |
| add a peer | `$HUD_ROOT/peers/<handle>.md` |
| `lint` argument | run the lint workflow (§7), no file writes without approval |

Infer `<project>` from the current working directory's repo name, the
conversation's stated project, or an existing `$HUD_ROOT/projects/<x>/`
directory that matches. If none of those resolve it confidently, don't
guess — file under `inbox/` instead. A note in the wrong project is worse
than a note that's unsorted; `inbox/` is designed for exactly this.

`<slug>` is a short kebab-case summary of the title, e.g. a note titled
"debugging the flaky retry test" becomes `2026-09-10-debugging-flaky-retry-test.md`.

## 3. Capture a note

Write `$HUD_ROOT/projects/<project>/notes/YYYY-MM-DD-<slug>.md` (or the
`inbox/` fallback) with frontmatter:

```yaml
---
title: <short title>
date: YYYY-MM-DD
type: note
tags: []       # optional
repos: []      # optional, owner/name — lights up PR panels for this entry
tickets: []    # optional, e.g. ABC-123
---
```

Every field past `title`/`date`/`type` is optional by schema — include
`tags`/`repos`/`tickets` only when you actually know them. Body is
free-form markdown; write what you'd want to read back in three months,
not a transcript.

## 4. Capture a playbook

Write `$HUD_ROOT/playbooks/<slug>.md`:

```yaml
---
title: <short title>
type: playbook
applies_to: []       # e.g. repos or situations this playbook is for
last_verified: YYYY-MM-DD
---
```

Body: the reusable process itself — steps, gotchas, verification. A
playbook earns its place by being something you'd otherwise re-derive
next time; if it's a one-off, it's a note, not a playbook.

## 5. Update project context

Edit `$HUD_ROOT/projects/<project>/CONTEXT.md`. If it doesn't exist yet,
create it from this minimal template rather than inventing a different
shape:

```yaml
---
status: active
repos: []
tickets: []
---

## Goal

<what this project is trying to achieve>

## State

<where things stand right now>

## Key paths

<files/dirs worth knowing about>

## Decisions

<decisions made and why, so they aren't re-litigated>
```

Edit the relevant section in place — don't append a duplicate "## State"
block; keep the file as the single current brief for the project, not a
log. (Notes are the log; CONTEXT.md is the summary.)

## 6. Add a peer

Write `$HUD_ROOT/peers/<handle>.md`:

```yaml
---
gh: <handle>       # drives the dynamic peer panel — required for the panel to light up
repos: []          # optional
---
```

Body: free-form notes about working with this person — context, not a
transcript of every interaction.

## 7. After any write: update the catalog

Every write in §3–§6 is followed by exactly two more edits, no exceptions:

1. Append one line to `$HUD_ROOT/index.md` — a link plus a one-line
   summary of what was just written.
2. Append one dated line to `$HUD_ROOT/log.md` — what happened (e.g.
   `2026-09-10: added note projects/<project>/notes/2026-09-10-foo.md`).

These two files are the bookkeeping that makes the HUD navigable without
re-reading the whole tree; skipping them is how the HUD rots into the
scattered-files problem it replaced.

## THE RULE

**Never write a standalone note file outside `$HUD_ROOT`.** If a task
elsewhere says "jot this down somewhere" or "make a note of this" with no
other destination specified — this is the somewhere. Don't create a
scratch file next to unrelated code, in a home-directory scratch folder,
or as a loose file in the current repo. Route it through §2–§3 instead,
even (especially) when the fastest-looking option is to just drop a file
where you already are.

## 8. `lint` argument

When invoked with `lint`, do not write anything yet. Walk `$HUD_ROOT` and
report:

- **Stale actives** — any entry with `status: active` in its frontmatter
  (typically `CONTEXT.md` files) with no note under its project's
  `notes/` dated within the last 30 days.
- **Contradictions** — a `CONTEXT.md`'s "State" section that looks out of
  date against what its project's most recent notes actually say.
- **Orphans** — files under `$HUD_ROOT` that have no corresponding line
  in `index.md`.
- **Index drift** — lines in `index.md` that point at files that no
  longer exist.

Present the report first. Only make fixes (updating `index.md`, flagging
`CONTEXT.md`, archiving stale entries) if the user approves them after
seeing the report — this mirrors the review-then-write posture of every
other write path in this skill, just applied to cleanup instead of
capture.
