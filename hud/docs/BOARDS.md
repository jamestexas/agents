# Boards — one status document, two projections

A **board** is a JSON file that says where a set of things stands and where
each statement came from. It lives in the content tree at
`projects/<project>/boards/<name>.json`, and the HUD shows it as a page at
`projects/<project>/boards/<name>`, rendered from the JSON each time the page
is opened: a mermaid graph of the rows and their edges, a table of the
columns, the notes, and the provenance of every cell that named a source.
Writing a valid file into the folder is all it takes to see it; nothing has to
be rendered first. A JSON that does not validate is shown as its list of
errors, so a broken producer reads as broken rather than as an old page.

The JSON is the **agent projection**: a session answers "where is X?" by
reading it, with the source attached, and never by scraping a page. The
markdown is the **human projection**, rendered from the JSON and nothing else.
Neither is hand-edited; the thing to edit is the producer that writes the
JSON. The HUD itself knows nothing about what a row is. A row may be a
writer, a ticket, a bead, a service, a person's queue; the shape is the same.

## The shape (`hud.board/1`)

```json
{
  "schema": "hud.board/1",
  "title": "Widgets vs the bar",
  "generated": "2026-01-02T03:04:05Z",
  "tags": ["widgets"],
  "sources": [{ "kind": "git", "ref": "example/main@abc1234", "at": "2026-01-02T03:00:00Z" }],
  "columns": [{ "id": "stage", "label": "Staging" }, { "id": "prod", "label": "Prod" }],
  "rows": [
    {
      "id": "w-one", "label": "Widget one", "sub": "owner: someone", "status": "In Progress",
      "url": "https://example.invalid/w-one",
      "cells": {
        "stage": { "value": "shadow", "chip": "shadow", "source": "env/a/main.tf:12", "url": "https://example.invalid/a.tf#L12" },
        "prod":  { "value": "legacy", "source": "not set in env/b (default)" }
      }
    },
    { "id": "EXT-1", "label": "A ticket outside this board", "external": true, "status": "Todo",
      "url": "https://example.invalid/EXT-1" }
  ],
  "edges": [
    { "from": "EXT-1", "to": "w-one", "kind": "inferred", "why": "the ticket's text names this writer as the thing it gates" }
  ],
  "notes": [{ "title": "Risks", "items": ["one sentence per risk"] }]
}
```

| Key | Required | What it is |
| --- | --- | --- |
| `schema` | yes | Always `hud.board/1`. |
| `title` | yes | The page title. |
| `generated` | yes | ISO-8601. When the producer ran; the page prints it and the history snapshot is named by it. |
| `tags` | no | Extra tags for the page's frontmatter; `board` is always added. |
| `layout` | no | `LR` (default) or `TD`: the direction of the rendered graph. Use `TD` when the graph fans out into many parallel branches. |
| `group_by` | no | A declared column id. The table is split into one table per run of equal values in that column, each under a subheading, in row order; sort the rows to group them. A row with no value for the column groups under `(none)`. |
| `sources` | no | Where the producer looked: `kind` (git, gh, linear, beads, tf, …), `ref`, optional `at`. Listed as a table under the title. |
| `columns` | no | The table's columns, in order: `id` (used by cells) and `label`. No columns, no table. |
| `rows` | yes | The things. `id` is unique and is what edges name; `label`, optional `sub`, free-text `status`, `external` (outside this board, drawn dashed), `url`, and `cells` keyed by column id. |
| `rows[].shape` | no | The node's shape in the graph: `group` (stadium, e.g. an initiative), `box` (rectangle, e.g. a project), `item` (rounded, e.g. an issue) or `gap` (hexagon, known work with no ticket). Anything else is refused; no shape draws the plain rectangle. When a board uses a shape or more than one status class, a legend sampling exactly those is drawn above the graph, in its own block. |
| `rows[].cells.<col>` | no | `value` (string, number, boolean or null), optional `chip` (a short class word shown in a code span), `source` (where the value came from), `url`. |
| `edges` | no | `from`/`to` are row ids. `kind` is `dep` (declared, solid) or `inferred` (dotted, with `why` on the edge). |
| `notes` | no | Sections after the table: `title` plus `items`, one bullet each. |

Unknown keys at any depth are errors, not noise: the page renders only what
the shape declares. `url` fields must be `http(s)`. `validate` reports every
problem, not the first.

## Rendering rules

- **Graph.** Every row is a node labelled `id`, `label`, `status`. The node's
  class is derived from `status` by word, not by a controlled vocabulary:
  `done`/`merged`/`closed` → done, `review`/`progress`/`started` → started,
  anything containing `block` → blocked, else open; `external: true` → external.
  A row with a `url` gets a `click` link (the HUD runs mermaid with
  `securityLevel: antiscript`, which allows links and nothing else). A board
  with one row and no edges draws no graph.
- **Table.** Rows by columns. A cell with a `chip` shows it in a code span
  before the value; a cell or row with a `url` becomes a link. Pipes are
  escaped. No sources in the table: they are below it.
- **Provenance.** One line per row listing `column: source` for every cell
  that said where it came from. This is what lets a number on the page be
  challenged without opening the JSON.
- **Frontmatter.** `type: board`, `date` from `generated`, `tags` with `board`
  first. The tree reader treats the file as a note under the project.

## History

The page needs no `render`, but the history does: `render` writes `projects/<project>/boards/.history/<name>/<generated>.json` (a dot-directory, so the tree reader lists the board once rather than once per snapshot).
Two generations whose content differs only in `generated` are the same
generation, and the second is not kept, so a producer run on unchanged inputs
adds nothing. The history is committed with the tree; it is the durable record
of what the board said on each day it changed.

## The verbs

```
hud board validate <file.json>
hud board render <project>/<name> [--from <file.json>] [--root <HUD_ROOT>]
hud board list [--root <HUD_ROOT>]
```

`render` reads `projects/<project>/boards/<name>.json` unless `--from` names
another file, in which case that file is copied into place first. It refuses
an invalid document before writing anything, then writes the history snapshot
and a `<name>.md` copy of the page for readers outside the HUD (the HUD itself
ignores that copy while the JSON is there and renders from the JSON).

## Writing a producer

A producer is whatever gathers the facts: a script in the project directory
that reads Terraform, asks `gh`, lists beads, pulls a tracker. It writes the
JSON, which is enough for the HUD, and calls `hud board render` when it wants
a history snapshot. Three rules keep boards honest:

1. **Every cell that is a fact carries a `source`.** A mode read from a file
   names the file and line. A state read from an API names the API and the
   object. A value typed by a human names the snapshot it came from and when.
2. **A snapshot is a source, not a fact.** When a producer cannot reach a
   system and reads a hand-kept file instead, the `sources` entry says so with
   its `at`, so staleness is visible on the page.
3. **Edges say why.** A declared dependency is `dep`. A relationship the
   producer concluded from text, timing or convention is `inferred` and
   carries the sentence that justifies it, which the graph draws on the edge.
