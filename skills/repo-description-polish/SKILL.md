---
name: repo-description-polish
description: Audit and polish the GitHub repository description — the one-sentence pitch shown in search results, link previews, and embeds. Proposes a stronger description from README + signals, applies via gh repo edit after user approval. Modular sub-skill of repo-seo-curator.
allowed-tools: Read Glob Grep Bash(gh *) Bash(jq *) Bash(git *)
argument-hint: <owner/repo> [<owner/repo> ...] [--dry-run] [--apply]
---

<!-- Author: jamestexas — drafted by claude-opus-4-7 (2026-05-16) -->

# /repo-description-polish — GitHub Repo Description

Audit the GitHub repository `description` field and propose a polished replacement.

## Arguments

`$ARGUMENTS`

- **`<owner/repo>`** — one or more target repos. Defaults to the repo containing the current working directory.
- **`--dry-run`** *(default)* — propose only.
- **`--apply`** — present proposal, prompt for approval, then write via `gh repo edit`.

## What this solves

The description is the *single sentence* that decides whether a stranger clicks. It shows in:

- GitHub search results
- GitHub repo cards and "related repos"
- Hacker News, Slack, Discord link previews (OpenGraph)
- Package registries when the repo is linked from a package
- LLM-driven "what tools exist for X" recall

Bad descriptions are very common in the user's repos:

```
PRIVATE moat             🏰 M.O.A.T: Mixture of Adaptive Tokenizers
PRIVATE bread            🥖
PRIVATE smoge            🐉🤖
PRIVATE sushi            🍣
PUBLIC  gh-weekly        <no description>
PUBLIC  papers           <no description>
PUBLIC  x-ray            <no description>
```

Emoji-only and empty descriptions kill discoverability for both humans and LLMs.

## What a good description looks like

```
✅ "Workerd-based hypervisor with a declarative Cap'n Proto manifest. Substrate-level
    identity, audit, and per-bundle credential scoping. Today's primary application:
    hosting MCP servers behind one HTTP face." (cloister)

✅ "Open-source data plane primitives: arena storage, schema contracts, filesystem
    projection, tree-sitter AST, LSP integration." (ley-line-open)
```

Pattern:
1. **Category noun first** — what *kind* of thing is this? (`hypervisor`, `library`, `protocol`, `CLI`)
2. **Defining trait** — what distinguishes it from peers in that category?
3. *(Optional)* **Primary use case** — what does someone actually do with it?

Length target: 120–250 chars. GitHub truncates around 350 in some surfaces.

## Hard rules

- **No emoji-only descriptions.** They convey nothing in search results.
- **No starting emoji decoration** unless the project has a strong logo association already. If unsure, drop it.
- **No promotional adjectives**: `blazing fast`, `next-gen`, `revolutionary`, `cutting-edge`. Search engines deprioritize, humans skip, LLMs ignore.
- **No initialisms without expansion** in the first sentence. "BREAD" alone is opaque; "BREAD (Bidirectional Recurrent Encoder for Anchored Diffusion)" is searchable.
- **Lead with the category noun, not the project name.** GitHub already shows the name; you don't need to repeat it.

## Workflow

### Phase 1: Inventory

```bash
gh repo view <owner/repo> --json name,description,repositoryTopics,visibility,isFork,isArchived,homepageUrl,primaryLanguage
```

Skip with a printed reason if `isFork` or `isArchived`. Continue on private repos only if explicitly named (private repo descriptions still affect search inside an org).

### Phase 2: Signal gathering

Read in this priority order:

1. **README first 1000 chars** — the value prop is almost always there if it exists anywhere
2. **`<h1>` or first heading + first paragraph** — often a usable seed
3. **Tagline near top of CLAUDE.md / ARCHITECTURE.md** if present
4. **Package manifest `description` fields** — `package.json`, `Cargo.toml`, `pyproject.toml`
5. **The repo name itself** — what does the name suggest the project is?

### Phase 3: Diagnose the current description

Classify the existing description into one of:

| Class | Example | Action |
| ----- | ------- | ------ |
| `empty` | `<no description>` | Generate from scratch |
| `emoji-only` | `🥖` | Replace |
| `vague` | `Some experiments` | Replace with category noun + trait |
| `marketing` | `Blazing-fast revolutionary...` | Rewrite, strip adjectives |
| `acronym-only` | `BREAD` | Expand and contextualize |
| `working` | `Workerd-based hypervisor...` | Leave alone |
| `working but stale` | references removed features | Update narrowly |

For class `working`, **skip the repo and report**. Don't rewrite working content.

### Phase 4: Proposal

Produce one proposal per repo:

```
## <owner/repo>

Current:  <description or "(empty)">
Class:    <empty|emoji-only|vague|marketing|acronym-only|working|working-but-stale>

Proposed: <new description>
Length:   <N> chars

Rationale:
  - <why this category noun>
  - <what trait makes it distinct>
  - <what was wrong with the old one>

Rejected alternatives:
  - "<other phrasing>" — too vague / too marketing / etc.
```

### Phase 5: Approval

Print all proposals as one document. Then:

- `--dry-run` (default): stop. Print a hint to re-run with `--apply`.
- `--apply`: print "Apply these N description changes? (yes/no)" and wait. Only proceed on explicit affirmative.

### Phase 6: Apply

```bash
gh repo edit "<owner>/<repo>" --description "<new text>"
```

Notes:
- Escape inner double quotes if any (rare — descriptions shouldn't have them).
- Verify by re-reading with `gh repo view <owner/repo> --json description`.

### Phase 7: Report

```
Applied:
  agentic-research/mache           — was: "🗂️ The Universal..."
                                     now: "Graph-native code intelligence..."
  jamestexas/bread                 — was: "🥖"
                                     now: "BREAD (Bidirectional Recurrent..."
Skipped:
  agentic-research/cloister        — description already strong
  jamestexas/papers                — no README signal, needs human input
```

## Examples

```
/repo-description-polish agentic-research/mache
→ dry-run proposal for mache

/repo-description-polish jamestexas/bread jamestexas/moat --apply
→ proposal for both, prompts for approval, writes via gh

/repo-description-polish
→ uses current working directory's repo
```

## Important rules

- **Default to `--dry-run`.** Descriptions are visible to anyone, including the org page.
- **One field per pass.** Do not bundle description changes with topic or homepage changes — that's the parent `repo-seo-curator`'s job to sequence.
- **If a description is already strong, skip the repo.** Churn hurts SEO.
- **Don't touch forks or archived repos** unless explicitly named.
- **For private repos, ask before writing.** Even private descriptions are visible to org members in some surfaces; the user may want different copy than for public.
