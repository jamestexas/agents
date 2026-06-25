---
name: readme-restructure
description: Restructure a README for both human skimmers and LLM ingestion. Diagnoses information architecture, identifies frontloaded internals, proposes a reordered structure that lands the value prop in the first 200 tokens, then generates a diff for review. Preserves content; changes order and disclosure. Modular sub-skill of repo-seo-curator.
allowed-tools: Read Edit Write Glob Grep Bash(git *) Bash(wc *) Bash(head *)
argument-hint: <path-to-README.md> [--dry-run] [--apply] [--target=human|llm|both]
---

<!-- Author: jamestexas — drafted by claude-opus-4-7 (2026-05-16) -->

# /readme-restructure — README Information Architecture

Restructure a README so the value prop and audience signal land before any internals. This skill **does not rewrite content** — it re-orders sections and pushes dense detail behind `<details>` or into separate docs.

## Arguments

`$ARGUMENTS`

- **`<path-to-README.md>`** — the file to restructure. Defaults to `README.md` in the current working directory.
- **`--dry-run`** *(default)* — produce a structure diff and a written restructure plan; do not write.
- **`--apply`** — after approval, rewrite the file in place. The original is preserved as `README.md.bak`.
- **`--target`** *(default: `both`)* — optimize for `human`, `llm`, or `both`. Affects ordering heuristics: humans skim, LLMs read top-down.

## What this solves

A README's job is to land three signals in the first 200 tokens:

1. **What is this?** (category noun + defining trait)
2. **Who is it for?** (audience)
3. **How do I try it in 30 seconds?** (quick-start or one-line install)

The user's `mache/README.md` is the motivating example. Its first 1000 chars are good — until paragraph 4:

> *"Seventeen MCP tools wrap the projected graph (sixteen read-surface plus `write_file`). Fourteen work standalone; three (`semantic_search`, `get_type_info`, `get_diagnostics`) require ley-line-open enrichment. `find_smells` covers nine structural code-smell rules (`dead_code`, `cyclomatic_complexity`, `god_file`, `fan_out_skew`, `untested_function`, …); four of those require a `.db` built by ley-line-open."*

That paragraph is **accurate and useful** — but it requires the reader to already know what an MCP tool is, what `ley-line-open` enrichment is, and what "structural code-smell rules" means. A first-time reader bounces. This skill moves that paragraph behind a `<details>` or into a `## Tools` section further down, **without deleting it**.

## Hard rules

- **Never delete content.** Every paragraph from the original must appear in the output. Re-order, fold into `<details>`, or move to a sub-page — but don't drop.
- **Never invent claims.** If the README says "stable on macOS" and you can't verify, leave that claim alone. Don't add caveats it didn't have, don't drop caveats it did.
- **Preserve all links.** A restructure that breaks an internal anchor link is worse than the original.
- **Preserve all code blocks verbatim.** No editing example commands, paths, or shell snippets.
- **Don't reorder ADRs, CHANGELOG, or LICENSE references** — those have conventional positions.

## Target structure

A well-shaped README converges to:

```
# <Project>

<One-sentence pitch. Category noun + defining trait. 120–200 chars.>

<Optional: tagline / pull-quote. 1 line.>

<Optional: screenshot or demo gif.>

## Quick start

<3–6 lines that get the reader from clone to first useful output.>

> For the full first-run flow, see [GETTING-STARTED.md](GETTING-STARTED.md).

## What it does

<2–4 short paragraphs. Plain language. No jargon-density.>

## How it works

<One diagram or 4–6 numbered steps. Conceptual, not exhaustive.>

## Status

<Table: capability → state (stable/beta/experimental/optional).>

<details>
<summary>Why this exists</summary>
<motivation, philosophy, design rationale>
</details>

<details>
<summary>Deeper internals</summary>
<the dense paragraphs that were frontloaded before>
</details>

## Install / deploy

<full install matrix>

## License
```

The principle: **everything dense or jargon-rich goes below the fold or into `<details>`**. The above-fold content is meant for a reader who knows nothing about the project.

## Workflow

### Phase 1: Read and section-map

Read the README and produce a section map:

```
Section: "# Mache" + tagline
  Lines: 1–8
  Density: low ✓
  Audience: any
  Verdict: keep front

Section: "## Quick start"
  Lines: 10–22
  Density: low ✓
  Audience: any
  Verdict: keep front

Section: "## What it gives an agent"
  Lines: 24–28
  Density: HIGH (paragraph names 17 tools, internal subsystem, optional deps)
  Audience: returning user / MCP-literate
  Verdict: MOVE BEHIND <details> or to "## Tools" section
...
```

For each section, score density by:
- Count of proper nouns / project-specific terms per 100 chars
- Count of inline code spans per 100 chars
- Whether it references concepts not yet introduced

### Phase 2: Diagnose

Print a one-page diagnosis:

```
## Diagnosis: mache/README.md (144 lines)

Score: 6/10
  ✓ Title + tagline lands fast (lines 1–4)
  ✓ Quick start present and short (lines 10–22)
  ✗ Paragraph at line 24 frontloads 17-tool inventory + ley-line-open coupling
    → first-time reader bounces here
  ✓ Mermaid diagram is well-placed
  ✗ "Status" table is good but appears after dense paragraph
  ✓ <details> for "Why this exists" — good pattern
  ✗ Missing: clear "audience" signal — who is this for?

Recommended moves:
  1. Move lines 24–28 ("What it gives an agent") to a new "## Tools" section after "How it works"
  2. Insert a one-line audience signal after the tagline: "Built for agents that need to navigate code, not grep it."
  3. Promote the "Status" table to right after "How it works" — readers want stability info early
```

### Phase 3: Restructure plan

Produce the explicit re-ordering plan as a list of moves:

```
Move:
  - lines 24–28 → after line 92 (new ## Tools heading)
  - lines 53–67 (Status table) → after line 33 (right after Quick start)

Wrap in <details>:
  - lines 130–140 (deployment matrix continued — too dense for above-fold)

Insert:
  - line 4 (after tagline): "Built for agents that need to navigate code, not grep it."
```

### Phase 4: Generate proposed README

In dry-run mode, produce the proposed README content in a separate file (`README.md.proposed`) without touching the original. Show a unified diff for review.

### Phase 5: Approval

- `--dry-run` (default): keep `README.md.proposed` and `README.md.diff` on disk; do not modify `README.md`.
- `--apply`: prompt "Apply this restructure? (yes/no)". On yes: copy `README.md` → `README.md.bak`, then replace with `README.md.proposed`.

### Phase 6: Verify

After apply, run:

```bash
# Sanity check: every line from original must appear somewhere in restructured
diff <(sort README.md.bak | uniq) <(sort README.md | uniq) | grep '^<'
```

Report any lines that were dropped (should be zero — they're a bug).

### Phase 7: Report

```
Applied: README.md restructured
  Before: 144 lines, value prop diluted by line 24
  After:  148 lines (3 inserts), value prop holds through line 50
  Original backed up to README.md.bak

Manual follow-ups suggested:
  - "Tools" section is now 18 lines — consider moving the full inventory to docs/TOOLS.md
  - The Status table could be a separate STATUS.md if it grows
```

## Important rules

- **Default to `--dry-run`.** A README is the first thing every visitor reads. Don't write live.
- **Preserve `README.md.bak` after `--apply`.** Easy rollback.
- **Show the diff, not the full file** in the dry-run output. The diff is the artifact; the proposed file is on disk for inspection.
- **One README per pass.** Don't batch multiple repos through this skill — each README needs its own diagnosis.
- **If the README scores 8+ in diagnosis, recommend skipping.** Marginal restructure on a working README is churn.

## Examples

```
/readme-restructure
→ dry-run on ./README.md

/readme-restructure <path-to-repo>/README.md
→ dry-run on that repo's README

/readme-restructure ./README.md --apply
→ dry-run, prompt, write

/readme-restructure ./README.md --target=llm
→ optimize ordering for an LLM ingesting top-down rather than a human skimming
```
