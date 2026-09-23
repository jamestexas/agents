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

| Intent | Kind | Target |
|---|---|---|
| capture a note | `note` | `$HUD_ROOT/projects/<project>/notes/YYYY-MM-DD-<slug>.md` (or `$HUD_ROOT/inbox/YYYY-MM-DD-<slug>.md` if `<project>` is unclear) |
| capture an unfiled note | `inbox` | `$HUD_ROOT/inbox/YYYY-MM-DD-<slug>.md` |
| capture a playbook | `playbook` | `$HUD_ROOT/playbooks/<slug>.md` |
| update project context | `context` | `$HUD_ROOT/projects/<project>/CONTEXT.md` |
| add a peer | `peer` | `$HUD_ROOT/peers/<handle>.md` |
| drop raw material in | `raw` | `$HUD_ROOT/projects/<project>/raw/YYYY-MM-DD-<slug>.<ext>` |
| `lint` argument | — | run the lint workflow (§8), no file writes without approval |

Infer `<project>` from the current working directory's repo name, the
conversation's stated project, or an existing `$HUD_ROOT/projects/<x>/`
directory that matches. If none of those resolve it confidently, don't
guess — file under `inbox/` instead. A note in the wrong project is worse
than a note that's unsorted; `inbox/` is designed for exactly this.

`<slug>` is a short kebab-case summary of the title, e.g. a note titled
"debugging the flaky retry test" becomes `2026-09-10-debugging-flaky-retry-test.md`.

## 2a. Write it with `hud new`, not by hand

Everything in §2 above — and the date prefix, the slug, the frontmatter keys
legal for each kind, and the two bookkeeping appends in §7 — is derived for
you by one call:

```bash
hud new note --project widget-service --title "debugging the flaky retry test"
hud new inbox --title "a thought with no home"
hud new playbook --title "Rotating the signing key" --set applies_to=widget-service
hud new context --project widget-service
hud new peer --handle octo-cat
hud new raw --project widget-service --title "session transcript" --ext txt --body-file -
```

Add `--set KEY=VALUE` (repeatable) for the optional frontmatter in §3–§6,
`--summary` for the `index.md` line, `--body`/`--body-file` for the content
(`-` reads stdin), `--date` to backdate, `--dry-run` to see the whole plan
without writing, and `--json` for one machine-readable document — emitted for
refusals as well as successes.

**Prefer it over writing the files yourself.** Not for convenience: it
*refuses* the mistakes this file can only warn about. A frontmatter key that is
not legal for the kind is refused rather than written; a project it cannot
resolve routes a note to `inbox/` rather than guessing at one; a destination
that already exists is refused rather than overwritten. A refusal is the only
non-zero exit, and nothing is written when one happens.

`hud new` is the *mechanism*; §3–§6 below remain the *contract* it implements,
and are what you need when you are reading an existing entry, editing one in
place, or writing into a tree whose `HUD.md` (§1) overrides something here.

## 3. Capture a note

`hud new note --project <project> --title "<title>"` — or the `inbox/`
fallback, which it takes itself when no project resolves. It writes
`$HUD_ROOT/projects/<project>/notes/YYYY-MM-DD-<slug>.md` with this
frontmatter, deriving `title`, `date` and `type`; `tags`/`repos`/`tickets`
come from `--set`:

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

`hud new playbook --title "<title>"` writes `$HUD_ROOT/playbooks/<slug>.md`,
deriving `title`, `type` and `last_verified`:

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

Edit `$HUD_ROOT/projects/<project>/CONTEXT.md` in place. If it doesn't exist
yet, `hud new context --project <project>` creates it from exactly the
template below rather than a shape you invented — and refuses if the file is
already there, because updating the brief is an edit, not a second file.

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

`hud new peer --handle <handle>` writes `$HUD_ROOT/peers/<handle>.md`,
deriving `gh` from the handle:

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

**`hud new` (§2a) makes both appends for you**, which is most of why it is
worth using: two follow-up edits after every single write is exactly the kind
of discipline that gets dropped when the write itself felt done. `--summary`
supplies the one-line summary; without it the catalog line still names the
kind, which is true but not worth much to read back. The two files are treated
differently on purpose — `index.md` is a catalog, so a path already listed is
left alone rather than listed twice, while `log.md` is append-only history and
always records the write.

You still make both appends by hand when you edited a file in place (a
`CONTEXT.md` update, §5) or wrote one some other way — the rule is about every
write, not about every invocation of the verb.

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
