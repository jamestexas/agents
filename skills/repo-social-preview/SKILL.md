---
name: repo-social-preview
description: Audit the GitHub OpenGraph social preview image — the card shown when a repo URL is posted on HN, Twitter, Slack, or Discord. Detects whether one is set, evaluates the existing image's clarity at small sizes, suggests sources for missing ones (existing logo, generated card), and reports the manual upload steps. Modular sub-skill of repo-seo-curator.
allowed-tools: Read Glob Grep Bash(gh *) Bash(jq *) Bash(curl *) Bash(file *)
argument-hint: <owner/repo> [<owner/repo> ...] [--audit-only]
---

<!-- Author: jamestexas — drafted by claude-opus-4-7 (2026-05-16) -->

# /repo-social-preview — GitHub Social Preview (OpenGraph)

Audit a GitHub repository's social preview image — the 1280×640 card shown when the repo URL is unfurled on HN, Twitter, Slack, Discord, or any OpenGraph-aware surface.

## Arguments

`$ARGUMENTS`

- **`<owner/repo>`** — one or more target repos. Defaults to the repo containing the current working directory.
- **`--audit-only`** *(default)* — report state and recommendations; no writes.

## Why this skill is audit-only

GitHub's API **does not support uploading social preview images via REST**. The image must be uploaded through the web UI:

> *Settings → General → Social preview → Edit → Upload an image*

This skill therefore **does not apply changes**. It produces:

1. An inventory of which repos are missing previews (or have a stale auto-generated one).
2. Concrete recommendations for what image to upload.
3. The manual upload URL for each repo, so you can click through quickly.

## What this solves

When someone posts your repo link to HN, Slack, or Twitter, the recipient sees one of three things:

1. **Custom social preview** (good) — a designed card that reinforces what the project is.
2. **GitHub's auto-generated card** (mediocre) — the repo name + description on a grey background. Better than nothing, but every repo on GitHub looks the same.
3. **No preview** (bad) — happens for some surfaces when the OpenGraph fetch fails. Just a bare link.

Custom previews dramatically improve link click-through on social. They're also the most often-forgotten SEO surface because the upload is buried in repo settings.

## What a good social preview looks like

- **1280×640 pixels** (GitHub's recommendation; 2:1 ratio).
- **The repo's identity legible at thumbnail size** — Twitter/Slack often display these at 600×300 or smaller.
- **The project name in large text** if there's no recognizable logo yet.
- **A one-line tagline below the name** — the same one that's in the GitHub description, ideally.
- **Strong contrast** — these are seen on light and dark backgrounds across surfaces.
- **Avoid screenshots of code** — they don't survive being scaled down.
- **Avoid emoji as the primary visual element** — they render inconsistently across platforms.

## Workflow

### Phase 1: Detect current state

GitHub's REST API doesn't expose `social_preview` directly, but the image is accessible at a predictable URL pattern. Probe it:

```bash
# The repo's OG image URL — GitHub serves either the custom upload or the auto-generated card
curl -fsLI "https://opengraph.githubassets.com/<random-hex>/<owner>/<repo>" \
  -o /dev/null -w "%{http_code} %{content_type}\n"
```

The `<random-hex>` is a cache-busting nonce; any 40-char hex works (e.g., `0` * 40). The response indicates:

- **200 + image/png** with `Content-Length` ≥ 100KB → likely a **custom upload**
- **200 + image/png** with `Content-Length` ≈ 20–40KB → likely the **auto-generated** card
- **404** → no image (rare; usually GitHub auto-generates)

This heuristic isn't perfect (the auto-generated cards have variable size), but it's a reasonable first-pass signal. Confirm by viewing the repo's Settings page when you click through.

Better signal: the GraphQL API exposes `usesCustomOpenGraphImage`:

```bash
gh api graphql -f query='
  query { repository(owner: "<owner>", name: "<repo>") {
    usesCustomOpenGraphImage
    openGraphImageUrl
  } }'
```

`usesCustomOpenGraphImage: false` → using auto-generated card.
`usesCustomOpenGraphImage: true` → custom upload in place.

### Phase 2: Inventory

```
| Repo | Custom OG? | OG URL |
|------|------------|--------|
| agentic-research/mache       | ❌ auto-generated | https://opengraph.../mache |
| agentic-research/cloister    | ✅ custom         | https://opengraph.../cloister |
| jamestexas/agents            | ❌ auto-generated | https://opengraph.../agents |
```

Skip private repos, forks, and archived repos unless explicitly named.

### Phase 3: Recommend an image source

For each repo missing a custom preview, propose what to use:

1. **Existing logo / banner**:
   - Look in the repo for `assets/`, `docs/images/`, `.github/`, `logo.{png,svg}`, `banner.{png,svg}`
   - If found and ≥800px wide, **recommend cropping/padding to 1280×640**

2. **README banner image**:
   - Grep README for `![.*](.*\.(png|jpg|svg))` near the top
   - Check the dimensions of any found image

3. **Sibling-repo template**:
   - If the org has other repos with custom previews (e.g., `agentic-research/cloister` has one), recommend using the same template/style for visual consistency across the family

4. **Generated card** (last resort):
   - If nothing usable exists, recommend generating one
   - Suggest tools: `socialify.git.ci`, `og-image.vercel.app`, custom design
   - For ecosystems (`agentic-research/*`), prefer a single shared template with the repo name swapped

### Phase 4: Produce the upload checklist

For each repo, emit a copy-pasteable instruction:

```
## agentic-research/mache

Current: auto-generated GitHub card (no custom upload)

Recommended source:
  - assets/logo.png exists (640×640) — needs padding to 1280×640 with project name
  - Or: use socialify.git.ci with theme="dark" + pattern="circuit-board"

Upload here:
  https://github.com/agentic-research/mache/settings#social-preview

Steps:
  1. Open the URL above
  2. Scroll to "Social preview"
  3. Click "Edit" → "Upload an image..."
  4. Select your 1280×640 PNG
  5. Save
```

### Phase 5: Verify after the user uploads

Provide a verification one-liner for each repo:

```bash
gh api graphql -f query='query { repository(owner: "agentic-research", name: "mache") { usesCustomOpenGraphImage } }'
```

Or check by posting the repo URL to a sandbox channel and looking at the unfurl.

## Important rules

- **This skill never writes.** GitHub has no API for upload, so all changes are manual through the UI.
- **The audit output is the artifact.** A markdown table + a per-repo upload URL is what gets delivered.
- **Don't recommend a generic template** as the only option. Recommend a *specific* image source the user already has (logo file, README banner) if one exists.
- **For ecosystems**, recommend a consistent visual identity across the family. Cloister, mache, rosary, ley-line-open should look like siblings, not strangers.
- **Skip working previews.** If `usesCustomOpenGraphImage: true`, leave it alone unless the user explicitly wants to update.

## Examples

```
/repo-social-preview agentic-research/mache
→ audit one repo, output upload checklist

/repo-social-preview agentic-research/{mache,rosary,ley-line-open}
→ audit three, recommend family-consistent visual identity

/repo-social-preview
→ audit current working directory's repo

/repo-social-preview --audit-only
→ same as default; flag is documented for clarity
```

## Future: when this stops being audit-only

GitHub has experimented with API-based social preview uploads in the past; if/when they ship one, update this skill to add an `--apply` mode that uploads the image directly. For now, the manual click-through is the cost of getting it right.
