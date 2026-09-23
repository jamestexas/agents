# HUD.md — schema and conventions for this tree

This file is the whole contract. Any agent told "load `$HUD_ROOT/HUD.md`" can
read and write this tree correctly with no other context.

Generated from `_hud/hud-contract.mjs`. Do not hand-edit it — it will be
rewritten, and the declaration is where an edit actually belongs.

## The six kinds

| kind | destination | date prefix |
| --- | --- | --- |
| `note` | `projects/<project>/notes/<date>-<slug>.md` | yes |
| `inbox` | `inbox/<date>-<slug>.md` | yes |
| `playbook` | `playbooks/<slug>.md` | no |
| `context` | `projects/<project>/CONTEXT.md` | no |
| `peer` | `peers/<handle>.md` | no |
| `raw` | `projects/<project>/raw/<date>-<slug>.<ext>` | yes |

A slug is the title, lowercased, reduced to `a-z0-9-`, with `a`, `an`, `the` dropped and the result bounded at 60 characters on a word boundary. The dropped article is not a liberty — it is what SKILL.md's own worked example does.

## Frontmatter

Every field is optional. A bare markdown file with no frontmatter is a valid
entry — filename and directory supply defaults.

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

Two of those columns are different questions and it is worth not confusing
them: **"reader assumes when absent"** is what the HUD substitutes when the key
is not in the file, which is not the same as a value the file carries. An entry
with no `status` reads as `active` and says nothing.

What each kind actually writes:

| kind | written for you | `--set` may add | refused |
| --- | --- | --- | --- |
| `note` | `title`, `date`, `type` | `status`, `tags`, `repos`, `tickets` | `title`, `date`, `type` (derived) |
| `inbox` | `title`, `date`, `type` | `status`, `tags`, `repos`, `tickets` | `title`, `date`, `type` (derived) |
| `playbook` | `title`, `type`, `last_verified` | `status`, `tags`, `repos`, `tickets`, `applies_to`, `last_verified` | `title`, `type` (derived) |
| `context` | `title` (if given), `status` | `status`, `repos`, `tickets`, `links` | `title`, `type` (derived) |
| `peer` | `gh` | `gh`, `repos` | `type` (derived) |
| `raw` | — | — (nothing) | everything |

- **Dates are normalized on READ**, not on write: `YYYY-MM-DD` and `ISO-8601 timestamp` are both accepted and both become `YYYY-MM-DD`. A writer-side convention would depend on a per-machine setting that is not committed; a reader that accepts both depends on nothing.
- **Empty collections are omitted**, never emitted as `[]`. YAML has no block spelling of an empty sequence, so `[]` is the one form with a second representation to drift into — and a key whose value you do not know is a key you were told not to write.
- Lists are **block sequences**, indent is **2 spaces**, scalars are quoted only where bare would be misread, and there are **no comments** inside the block.
- **Key order is not significant** and neither is formatting. Read keys and values; anything that depends on their arrangement is depending on something no serializer preserves.

## Sections, groups and containers

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

**Groups** exist only inside `projects`: the subdirectory *is* the group, and
its `CONTEXT.md` is the brief.

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

## After any write: the catalog

| file | semantics | line |
| --- | --- | --- |
| `index.md` | catalog | `- [{title}]({path}) — {summary}` |
| `log.md` | append-only | `- {date}: added {kind} {path}` |

A link plus a one-line summary. One line per path; a path already listed is kept, not listed twice. Append-only history of what happened. A second ingest of the same path is a second line, by design.

## The rule

**Never write a standalone note file outside `$HUD_ROOT`.** If you are about
to create a scratch markdown file somewhere else to capture a decision, a
transcript, or a note-to-self — put it here instead, under the closest matching
path above, or `inbox/` if unsure. This is the consolidation rule; it is the
entire point of this tree existing.

## Writing one

`hud new <kind>` derives all of the above from an intent and makes both
bookkeeping appends. It refuses rather than guesses: a frontmatter key not
legal for the kind, a project it cannot resolve, a destination that already
exists.

|  | Means |
| --- | --- |
| `created` | the file was written and both bookkeeping lines appended |
| `planned` | `--dry-run`: the whole plan, and none of it done |
| `refused` | it could have written and should not. **The only non-zero exit.** |

## Generated vs. authored

`$HUD_ROOT/.generated/` is machine-written only — snapshots, the service log,
the mache index. Never hand-edit it; it is gitignored. `_hud` is a symlink to
the machinery repository: public code, versioned elsewhere, and not content
either. Everything else in this tree is authored content and gets committed.

## The HUD app

`hud start` serves this tree; `hud status` says what it is actually wired to.
The server locates the tree by `HUD_ROOT`, never by where its own file sits.

`hud.toml`'s `[sources.*]` tables are the switchboard: a source present enables
its panel, absent removes it, no code change either way. Every key, what
enables it, and what each panel does when its source is absent:
`_hud/docs/SOURCES.md`.

**Watch-only invariant:** the HUD renders and links out, it never acts on a PR,
a ticket, or a session. Every "do" happens in the tool the human is already in.
