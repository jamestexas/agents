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

The table below is **generated** from `_hud/hud-contract.mjs`, the one file
that declares what an entry is. Don't hand-edit it — `hud docgen --check`
fails when it drifts, and the unit suite runs that check.

<!-- @generated-begin: intent-table -->
| Intent | Kind | Target |
| --- | --- | --- |
| capture a note | `note` | `$HUD_ROOT/projects/<project>/notes/<date>-<slug>.md` |
| capture an unfiled note | `inbox` | `$HUD_ROOT/inbox/<date>-<slug>.md` |
| capture a playbook | `playbook` | `$HUD_ROOT/playbooks/<slug>.md` |
| create a project brief | `context` | `$HUD_ROOT/projects/<project>/CONTEXT.md` |
| add a peer | `peer` | `$HUD_ROOT/peers/<handle>.md` |
| drop raw material in | `raw` | `$HUD_ROOT/projects/<project>/raw/<date>-<slug>.<ext>` |
<!-- @generated-end: intent-table -->

Invoked with `lint`, run the lint workflow (§8) instead — no file writes
without approval.

Infer `<project>` from the current working directory's repo name, the
conversation's stated project, or an existing `$HUD_ROOT/projects/<x>/`
directory that matches. If none of those resolve it confidently, don't
guess — file under `inbox/` instead. A note in the wrong project is worse
than a note that's unsorted; `inbox/` is designed for exactly this.

<!-- @generated-begin: slug-rule -->
A slug is the title, lowercased, reduced to `a-z0-9-`, with `a`, `an`, `the` dropped and the result bounded at 60 characters on a word boundary. The dropped article is not a liberty — it is what SKILL.md's own worked example does.
<!-- @generated-end: slug-rule -->

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

`hud new` is the *mechanism*; §3 below is the *contract* it implements, and is
what you need when you are reading an existing entry, editing one in place, or
writing into a tree whose `HUD.md` (§1) overrides something here.

## 3. The frontmatter contract

Every field is optional; a bare markdown file is a valid entry. These tables
are **generated** — the schema is declared in `_hud/hud-contract.mjs` and
nothing here is a second copy of it.

<!-- @generated-begin: fields-table -->
| key | type | reader assumes when absent | what it is |
| --- | --- | --- | --- |
| `title` | scalar | — | The entry's name. The reader falls back to the first heading, then the filename. |
| `date` | date | — | The day the entry is about. The reader falls back to the filename prefix, then mtime. |
| `type` | scalar | — | What kind of entry this is. The reader infers it from the path when absent. |
| `status` | scalar | `active` | Lifecycle. On a project brief it drives group rank and fold state; elsewhere it means what the author meant. |
| `tags` | list | — | Free-form labels. |
| `repos` | list | — | owner/name — lights up the PR panels for this entry. |
| `tickets` | list | — | Ticket ids, rendered as links through hud.toml's ticket_url_template. |
| `gh` | scalar | — | A GitHub handle. Drives the peers panel's PR lookup. |
| `applies_to` | list | — | What a playbook is for — repos, or situations. |
| `last_verified` | date | — | When a playbook was last known to still work. |
| `links` | list | — | Related material. |
<!-- @generated-end: fields-table -->

The third column is what the **reader substitutes when the key is absent** —
not a value the file carries. An entry with no `status` reads as `active` and
says nothing. What each kind actually writes:

<!-- @generated-begin: frontmatter-table -->
| kind | written for you | `--set` may add | refused |
| --- | --- | --- | --- |
| `note` | `title`, `date`, `type` | `status`, `tags`, `repos`, `tickets` | `title`, `date`, `type` (derived) |
| `inbox` | `title`, `date`, `type` | `status`, `tags`, `repos`, `tickets` | `title`, `date`, `type` (derived) |
| `playbook` | `title`, `type`, `last_verified` | `status`, `tags`, `repos`, `tickets`, `applies_to`, `last_verified` | `title`, `type` (derived) |
| `context` | `title` (if given), `status` | `status`, `repos`, `tickets`, `links` | `title`, `type` (derived) |
| `peer` | `gh` | `gh`, `repos` | `type` (derived) |
| `raw` | — | — (nothing) | everything |
<!-- @generated-end: frontmatter-table -->

<!-- @generated-begin: serialization-rules -->
- **Dates are normalized on READ**, not on write: `YYYY-MM-DD` and `ISO-8601 timestamp` are both accepted and both become `YYYY-MM-DD`. A writer-side convention would depend on a per-machine setting that is not committed; a reader that accepts both depends on nothing.
- **Empty collections are omitted**, never emitted as `[]`. YAML has no block spelling of an empty sequence, so `[]` is the one form with a second representation to drift into — and a key whose value you do not know is a key you were told not to write.
- Lists are **block sequences**, indent is **2 spaces**, scalars are quoted only where bare would be misread, and there are **no comments** inside the block.
- **Key order is not significant** and neither is formatting. Read keys and values; anything that depends on their arrangement is depending on something no serializer preserves.
<!-- @generated-end: serialization-rules -->

## 4. What goes in the body

The frontmatter is derived; the body is the part only you can write.

- **note** — what you'd want to read back in three months, not a transcript.
- **playbook** — the reusable process: steps, gotchas, verification. A playbook
  earns its place by being something you'd otherwise re-derive next time; if
  it's a one-off, it's a note.
- **peer** — how it goes working with this person. Context, not a log of every
  interaction.
- **raw** — nothing of yours. It *is* the artifact: a transcript, an export, a
  patch. Read it, never rewrite it.

## 5. Update project context

Edit `$HUD_ROOT/projects/<project>/CONTEXT.md` **in place**. If it doesn't
exist yet, `hud new context --project <project>` creates it with the Goal /
State / Key paths / Decisions skeleton rather than a shape you invented — and
refuses if the file is already there, because updating the brief is an edit,
not a second file.

Edit the relevant section in place — don't append a duplicate "## State"
block; keep the file as the single current brief for the project, not a
log. (Notes are the log; CONTEXT.md is the summary.)

## 6. Sections, groups and containers

<!-- @generated-begin: sections-table -->
| section | what it is |
| --- | --- |
| `projects` | Live work — one directory per project, its CONTEXT.md the brief, notes beneath it. |
| `playbooks` | Procedures worth not re-deriving: how a thing is done, written down once. |
| `peers` | One file per colleague, naming the GitHub handle whose PRs light up the peers panel. |
| `inbox` | Unfiled capture — notes taken before there was a project to put them in. |
| `archive` | Finished or parked work, kept for reference. Nothing here needs you. |

Sections are an **open set**: the five above fix the left-column order, and any
other top-level directory becomes a section too, appended alphabetically with a
fallback sentence. Kinds are the opposite — closed, and there are exactly 6.
<!-- @generated-end: sections-table -->

<!-- @generated-begin: containers-table -->
| directory | within | known to the reader? | matched at | what it means |
| --- | --- | --- | --- | --- |
| `notes/` | `projects` | **no — never heard of it** | exactly its declared depth | Where dated project entries go. Writer-side only: `projects/p/notes/x.md` and `projects/p/x.md` are the same entry to the reader. |
| `raw/` | `projects` | yes, and renders differently | any depth | Immutable drops — transcripts, exports, patches. Listed and never opened; the meta slot shows a size instead of a date. |

Those two columns are not the same claim. `notes/` means nothing to the
reader because the reader has **never heard of it** — the name appears
nowhere in `server.mjs`, so an entry inside it and one beside it are
indistinguishable. `raw/` is the opposite: the reader knows it, matches it
at any depth, and changes how its entries display. One is an accident and
one is a decision, and a table that called both "inert" would hide that.

A path deeper than its kind's declared shape is currently **absorb**ed — and that is the known-wrong answer: the
intermediate directories vanish into the group, so the tree looks like you did
nothing. It is named here rather than left implicit so that changing it is a
declaration edit.
<!-- @generated-end: containers-table -->

One asymmetry worth carrying: the HUD renders a `warn` chip for frontmatter it
cannot read, and **nothing at all** for a path that has moved. The path decides
an entry's type, section, group and date, so relocating a file silently
re-types it and renaming one silently changes its date.

## 7. After any write: update the catalog

Every write above is followed by exactly two more edits, no exceptions:

<!-- @generated-begin: bookkeeping-table -->
| file | semantics | line |
| --- | --- | --- |
| `index.md` | catalog | `- [{title}]({path}) — {summary}` |
| `log.md` | append-only | `- {date}: added {kind} {path}` |

A link plus a one-line summary. One line per path; a path already listed is kept, not listed twice. Append-only history of what happened. A second ingest of the same path is a second line, by design.
<!-- @generated-end: bookkeeping-table -->

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
