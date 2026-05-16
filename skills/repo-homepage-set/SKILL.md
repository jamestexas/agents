---
name: repo-homepage-set
description: Audit and set the GitHub repository homepage URL — the link on the repo card's "About" panel and on every search result. Detects candidate URLs from docs sites, package registries, demos, and org homepages, then applies via gh repo edit after user approval. Modular sub-skill of repo-seo-curator.
allowed-tools: Read Glob Grep Bash(gh *) Bash(jq *) Bash(curl *)
argument-hint: <owner/repo> [<owner/repo> ...] [--dry-run] [--apply]
---

<!-- Author: jamestexas — drafted by claude-opus-4-7 (2026-05-16) -->

# /repo-homepage-set — GitHub Repo Homepage URL

Set the `homepageUrl` field on a GitHub repository. This is the small link icon on the repo card's "About" panel.

## Arguments

`$ARGUMENTS`

- **`<owner/repo>`** — one or more target repos. Defaults to the repo containing the current working directory.
- **`--dry-run`** *(default)* — propose only.
- **`--apply`** — present proposal, prompt for approval, then write via `gh repo edit`.

## What this solves

The homepage URL is the *one outbound link* GitHub gives a repository card. Setting it sends interested readers somewhere useful instead of nowhere. Surfaces:

- Repo's About panel (top right of the repo page)
- GitHub search results (shown below the description)
- Topic browser cards
- Some integrations (e.g. Slack unfurls)

Most of the user's public repos have **no homepage set**, which means a visitor who's interested has no obvious "next step."

## Candidate sources, by priority

For each repo, the homepage should be the *most useful* place a stranger could go after the README. In priority order:

1. **Dedicated docs site** — e.g. `docs.mache.dev`, `https://mache.io`
2. **Published package page** — `crates.io/crates/<name>`, `npmjs.com/package/<name>`, `pypi.org/project/<name>`
3. **Live demo / hosted app** — for things that have a runnable UI
4. **Org homepage** — for repos that are part of a named ecosystem (e.g. `agentic-research/*` → some `agentic-research.org` URL if one exists)
5. **Parent project page** — for sub-components, point at the parent's docs
6. **Leave unset** — when none of the above apply, an unset homepage is better than a guessed one

## Hard rules

- **Never point at the GitHub repo itself.** That's where the visitor already is. Setting `homepageUrl` to `https://github.com/owner/repo` is a no-op that wastes a click.
- **Never point at a 404 or a placeholder.** If the docs site is "coming soon," leave the field empty.
- **Prefer HTTPS.** Convert `http://` to `https://` if both work.
- **No trailing slashes** unless the URL canonically has one.
- **No query strings or anchors** — the homepage should be a stable landing surface.
- **No URL shorteners** — bare domains only. Tracking links here are user-hostile.

## Workflow

### Phase 1: Inventory

```bash
gh repo view <owner/repo> --json name,description,homepageUrl,visibility,isFork,isArchived,repositoryTopics
```

Skip with a printed reason if `isFork` or `isArchived`.

### Phase 2: Signal gathering

For each repo, look for candidates in this order:

1. **README** — first search for an obvious "Documentation:" or "Docs:" link near the top. Many READMEs already point at their docs site, you just need to detect it.
2. **Package manifests**:
   - `Cargo.toml` → `documentation = "..."` or `homepage = "..."` fields
   - `package.json` → `"homepage": "..."` field (note: npm uses this same field name)
   - `pyproject.toml` → `[project.urls]` table, look for `Documentation` or `Homepage`
3. **Probe registries** for published packages — for each detected package name:
   - Rust: `curl -fsI https://crates.io/crates/<name>` (200 = exists)
   - Node: `curl -fsI https://www.npmjs.com/package/<name>`
   - Python: `curl -fsI https://pypi.org/project/<name>/`
4. **Search the README for explicit URLs** — `https://*.dev`, `https://*.io`, `https://docs.*`
5. **Check the org `.github` repo** for an org-level homepage
6. **Check repositoryTopics for ecosystem hints** — `agentic-research`, `art-ecosystem` may map to an ecosystem page

### Phase 3: Verify candidates

For each candidate URL, run a quick health check:

```bash
curl -fsLI "<url>" -o /dev/null -w "%{http_code} %{url_effective}\n" --max-time 5
```

- **200** — usable
- **3xx ending at 200** — usable; record the final URL
- **4xx / 5xx / timeout** — discard

Never propose a URL that fails the health check.

### Phase 4: Proposal

```
## <owner/repo>

Current homepage: <url or "(not set)">

Candidates found:
  1. https://docs.mache.dev          [200 OK]                   ← recommended
  2. https://crates.io/crates/mache  [200 OK]
  3. https://github.com/agentic-research  [200 OK, org page]

Recommendation: https://docs.mache.dev
  Why: dedicated docs site, README references it as primary entry point.

Rejected:
  - https://mache-demo.dev — returned 404
  - https://github.com/agentic-research/mache — same as the repo itself
```

If no candidates pass health check, **propose leaving it unset** and report what was tried.

### Phase 5: Approval

- `--dry-run` (default): stop. Print hint to re-run with `--apply`.
- `--apply`: print "Apply N homepage changes? (yes/no)" and wait.

### Phase 6: Apply

```bash
gh repo edit "<owner>/<repo>" --homepage "<url>"
```

Verify by re-reading:

```bash
gh repo view "<owner>/<repo>" --json homepageUrl
```

### Phase 7: Report

```
Applied:
  agentic-research/mache           → https://docs.mache.dev
  agentic-research/cloister        → https://crates.io/crates/cloister
Skipped:
  agentic-research/cloister-fork   — fork, skipped
  agentic-research/x-ray           — no usable candidates, left unset
Failed:
  agentic-research/foo             — gh edit returned: <error>
```

## Examples

```
/repo-homepage-set agentic-research/mache
→ dry-run proposal

/repo-homepage-set agentic-research/{mache,rosary,ley-line-open} --apply
→ proposal for three, prompts, writes

/repo-homepage-set
→ uses current working directory's repo
```

## Important rules

- **Default to `--dry-run`.** The homepage is publicly visible immediately.
- **Verify before proposing.** Never propose a URL you haven't health-checked.
- **If unsure, leave it unset.** An unset homepage is honest. A wrong one is worse than nothing.
- **One field per pass.** Don't bundle with topic or description changes.
- **Don't touch forks or archived repos** unless explicitly named.
