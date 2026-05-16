---
name: repo-topic-tagger
description: Audit and apply GitHub topic tags (repository topics) on a target repo for discoverability — proposes tags from code signals, deduplicates against current tags, and applies via gh api after explicit user approval. Modular sub-skill of repo-seo-curator.
allowed-tools: Read Glob Grep Bash(gh *) Bash(jq *) Bash(git *) Bash(cat *) Bash(find *) Bash(ls *)
argument-hint: <owner/repo> [<owner/repo> ...] [--dry-run] [--apply] [--max=N]
---

<!-- Author: jamestexas — drafted by claude-opus-4-7 (2026-05-16) -->


# /repo-topic-tagger — GitHub Topic Curation

Apply a curated, discoverability-optimized set of GitHub topics to one or more repositories.

## Arguments

`$ARGUMENTS`

- **`<owner/repo>`** — one or more target repos (e.g. `agentic-research/mache`). If omitted, defaults to the repo containing the current working directory.
- **`--dry-run`** *(default)* — propose changes but do not apply. Always the default. The user must explicitly pass `--apply` to write.
- **`--apply`** — after presenting the proposal, prompt for approval and call `gh api` to write the new topic set.
- **`--max=N`** — cap proposed tag count at N (default 12; GitHub allows 20 max).

## What this solves

Many of the user's public repos ship with **zero topics**. This kills discoverability:

- They never surface in GitHub's topic browser (`github.com/topics/<x>`)
- They never appear in "related repositories" cards
- LLM-based repo discovery tools weight topic metadata heavily
- Human searchers filtering by topic on GitHub never see them

Topics are cheap to set, never break anything, and compound over time as GitHub's index picks them up.

## Reference: a good topic set

`agentic-research/cloister` is the canonical good example:

```
capnproto, cloudflare-workers, durable-objects, gateway,
hypervisor, mcp, model-context-protocol, rust, typescript, workerd
```

Why it works:
- **Language(s):** `rust`, `typescript`
- **Framework / runtime:** `cloudflare-workers`, `workerd`, `durable-objects`
- **Substrate / protocol:** `capnproto`, `mcp`, `model-context-protocol`
- **Problem-space label:** `hypervisor`, `gateway`

Ten tags, every one of them is something a real searcher would type.

## GitHub topic rules (hard constraints)

The GitHub API will reject violations. Validate before submitting:

- Lowercase only
- Alphanumerics, hyphens, `+`, `.` allowed; **no underscores, no spaces**
- Each topic ≤ 50 chars
- ≤ 20 topics per repo
- Convention: prefer hyphens (`code-intelligence`, not `codeintelligence`)

## Workflow

### Phase 1: Inventory

For each target repo:

```bash
gh repo view <owner/repo> --json name,description,repositoryTopics,visibility,isFork,isArchived,homepageUrl,primaryLanguage,languages
```

Skip with a printed reason if:
- `visibility != PUBLIC` (unless user explicitly overrides)
- `isFork == true`
- `isArchived == true`

### Phase 2: Signal gathering

For each remaining repo, collect signals from the codebase (use `gh` for remote; if a local clone is available, prefer reading files directly):

1. **Language metadata** — `primaryLanguage` and the `languages` map. The top 1–3 languages are almost always topics.
2. **Package manifests** — detect framework signals:
   - `Cargo.toml` → `rust`, plus notable deps (`tokio`, `axum`, `serde`, `tree-sitter`, `wasmtime`, …)
   - `package.json` → `typescript` or `nodejs`, plus framework deps (`next`, `react`, `hono`, `workerd`, `vite`, …)
   - `go.mod` → `go`, plus deps (`cobra`, `bubbletea`, `cgo`, `tree-sitter`, …)
   - `pyproject.toml` / `requirements.txt` → `python`, plus deps (`fastapi`, `pytorch`, `transformers`, …)
   - `flake.nix` / `shell.nix` → `nix`
   - `Dockerfile` / `docker-compose.yml` → `docker`
   - `apko.yaml` / `melange.yaml` → `apko`, `chainguard`
   - `.github/workflows/*` → CI signals (usually not topic-worthy alone)
3. **README + description** — extract domain nouns. Look specifically for:
   - Protocol names (`mcp`, `lsp`, `oauth`, `webauthn`, `cms`, `pkcs7`)
   - System category (`cli`, `tui`, `library`, `framework`, `daemon`, `mcp-server`)
   - Problem-space (`observability`, `vulnerability-scanning`, `code-intelligence`, `identity`, `signing`, `knowledge-graph`)
4. **Project family / org context** — the user's ecosystems. If repo is in `agentic-research`, propose `agentic-research` *and* `art-ecosystem`. If in `jamestexas` and references rosary/mache/ley-line, propose `art-ecosystem`.
5. **Existing topics** — keep, don't fight. Only remove if actively misleading.

### Phase 3: Proposal

Produce a structured proposal per repo:

```
## <owner/repo>

Description: <current description>
Current topics: <list or "(none)">

Proposed topics (N total):
  Language:   rust, typescript
  Framework:  cloudflare-workers, workerd, durable-objects
  Protocol:   capnproto, mcp, model-context-protocol
  Domain:     hypervisor, gateway
  Ecosystem:  agentic-research, art-ecosystem

Add:    [list]
Remove: [list, or "(none)"]
Keep:   [list]

Rationale: <1–2 sentences>
```

Rationale rules:
- **Add ≤ `--max` (default 12).** Quality beats quantity.
- **Prefer canonical names** — `model-context-protocol` over `mcp-protocol`, `cloudflare-workers` over `cf-workers`. Check `https://github.com/topics/<x>` exists if uncertain.
- **Avoid singletons that only describe this one repo.** Topics are for finding kin.
- **Avoid promotional adjectives** — no `fast`, `modern`, `lightweight` unless they're an established topic (`high-performance` is borderline; usually skip).

### Phase 4: Approval

Print the full proposal across all in-scope repos. Then:

- If `--dry-run` (default): stop. Output a hint that the user can re-run with `--apply` to write.
- If `--apply`: print "Apply these N topic changes? (yes/no)" and wait. Only proceed on explicit affirmative.

### Phase 5: Apply

For each approved repo:

```bash
gh api -X PUT "repos/<owner>/<repo>/topics" \
  -H "Accept: application/vnd.github.mercy-preview+json" \
  --input - <<EOF
{"names": ["tag1", "tag2", "..."]}
EOF
```

Or equivalently with field args:

```bash
gh api -X PUT "repos/<owner>/<repo>/topics" \
  -f "names[]=tag1" -f "names[]=tag2" ...
```

After each call:
- Re-read with `gh repo view <owner/repo> --json repositoryTopics` to confirm
- Report success or failure with the exact diff that landed

### Phase 6: Report

End with a compact summary:

```
Applied:
  agentic-research/mache       — +8 topics, -0
  agentic-research/rosary      — +9 topics, -0
  jamestexas/agents            — +5 topics, -0
Skipped:
  agentic-research/x-ray       — empty repo, no signals to tag
  agentic-research/.github     — meta-repo, not user-facing
Deferred (no signals / needs human input):
  jamestexas/papers            — unclear scope
```

## Important rules

- **Default to `--dry-run`.** The user must explicitly opt in to writes. Topics are public and indexed by third parties.
- **One PR-equivalent per repo per pass.** Don't bundle topic changes with description or README rewrites — those are separate skills.
- **Do not touch private repos** unless the user explicitly names them. They get no discoverability benefit.
- **Do not touch forks or archived repos** unless explicitly named.
- **If a repo has a working topic set (≥ 5 tags spanning ≥ 3 categories), leave it alone** unless the user asked to revise it.
- **No emoji in topics.** GitHub strips them silently and they're not searchable.

## Examples

```
/repo-topic-tagger agentic-research/mache
→ dry-run proposal for mache only

/repo-topic-tagger agentic-research/mache agentic-research/rosary --apply
→ proposal for both, then prompts for approval, then writes

/repo-topic-tagger
→ uses current working directory's GitHub remote (derived via `gh repo view`)
```

## Bulk mode (orgs)

For a whole-org sweep:

```bash
gh repo list <owner> --limit 100 --json name,visibility,isFork,isArchived,repositoryTopics \
  | jq -r '.[] | select(.visibility=="PUBLIC" and .isFork==false and .isArchived==false) | .name'
```

Iterate, but **produce all proposals first**, present them as a single document, and only apply after a single batched approval. Do not stream-apply.
