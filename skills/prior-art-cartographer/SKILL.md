---
name: prior-art-cartographer
description: Produce structured comparisons between a project being built (described by a baseline doc) and external systems that solve adjacent problems. Outputs follow this skill's TEMPLATE.md, cite primary sources for every claim, and update a cross-cutting matrix in the project's prior-art/README.md. Refuses to compare more than 5 systems per invocation. Refuses to assert without citation. Use when researching prior art, evaluating "are we reinventing X?", or building shoulders-of-giants context before committing to a substrate design.
allowed-tools: WebFetch WebSearch Read Write Edit Glob Grep Bash(gh *) Bash(ls *) Bash(date *)
argument-hint: <system-name> [<system-name> ...] [--baseline=PATH] [--output-dir=PATH] [--decision=adopt|borrow]
---

<!-- Author: jamestexas — drafted by claude-opus-4-7 (2026-05-17) -->

# /prior-art-cartographer — Structured external comparison

Produce one structured entry per external system named in `$ARGUMENTS`. Every entry follows the canonical 7-axis shape in `TEMPLATE.md` (shipped alongside this skill). Every factual claim cites a primary source fetched in this session.

## Arguments

`$ARGUMENTS`

- **`<system-name>`** — 1 to 5 external system names (e.g. `Smithy Buf SPIFFE`). More than 5 → refuse.
- **`--baseline=PATH`** *(default: `docs/prior-art/_baseline.md`)* — the "us" document the new entries compare against.
- **`--output-dir=PATH`** *(default: `docs/prior-art/`)* — where new entries and the aggregator README live.
- **`--decision=adopt|borrow`** *(default: `borrow`)* — what question the comparison serves. `adopt` surfaces wholesale-migration analysis; `borrow` surfaces pattern-extraction.

## What this skill solves

Most "we should look at how X does this" research drifts into a write-up about X without ever rendering a comparison against what we already have. This skill enforces:

1. **One fixed shape** (the 7-axis template) — every entry is diffable.
2. **Citations not folklore** — every factual claim links to a URL fetched in this session.
3. **Decision-oriented output** — Adopt / Borrow / Skip with concrete next steps, not vibes.
4. **A single consumable matrix** — `README.md` in the output dir aggregates the verdicts.

## The 7 axes (defined in `TEMPLATE.md`)

1. **IDL shape** — what schemas express
2. **Annotation / trait model** — semantic decoration of shapes
3. **Versioning + breaking-change detection** — automated diffs, semver
4. **Codegen targets + plugin model** — multi-target output, extensibility
5. **Identity / capability model** — bearer / object-capability / macaroon / none
6. **Supply-chain story** — signing, provenance, SBOM
7. **Adoption cost** — hello-world complexity, migration cost, ecosystem maturity

## Hard rules (non-negotiable)

1. **Cite primary sources.** Every factual claim about an external system must trace to a URL fetched in this session via `WebFetch` / `WebSearch` / `gh api`. Do not rely on training-data recall. Add the URL to the entry's "Sources cited" section with the access date.
2. **Mark unverified claims.** If you couldn't confirm a claim from a primary source, append `[unverified]` to the prose. Never silently invent.
3. **One entry per system.** Each lives at `<output-dir>/<system-name-lowercase>.md` and follows `TEMPLATE.md` exactly. Don't add new H2 sections; if you need detail, use H3s inside the existing axes.
4. **Update the aggregator.** After writing per-system entries, update `<output-dir>/README.md`:
   - Replace `[<Project>](<project>.md) [planned]` with a live link.
   - Fill the system's column in the cross-cutting matrix with *short verdicts only* (≤8 words per cell).
   - Fill the system's row in the decision-summary table.
   - Remove the system from the triage queue if it was there.
5. **Cap at 5 systems per invocation.** Surface the cap as a normal output: "You asked for N; I'll do the top 5 by signal and queue the rest."
6. **Refuse on stale baseline.** If `<baseline>`'s "Last refreshed" date is > 6 months ago, refuse to run. Stale baseline → stale recommendation.
7. **Refuse on missing rubric.** If `TEMPLATE.md` (in this skill's directory — `${CLAUDE_SKILL_DIR}/TEMPLATE.md`) doesn't exist or has had its H2 headers renamed, refuse. The shape is the value.

## Workflow

### Phase 0 — Validate

1. Resolve `--baseline=` path (default `docs/prior-art/_baseline.md`). Read it. Confirm "Last refreshed" is within 6 months. Refuse if missing or stale.
2. Read `${CLAUDE_SKILL_DIR}/TEMPLATE.md`. Confirm the 7 axes are present with expected H2 headers.
3. Resolve `--output-dir=` path. Read `<output-dir>/README.md` if present; note which entries exist vs. `[planned]`.
4. Parse the system list from `$ARGUMENTS`. If >5, surface the cap and select the top 5 by signal (use the triage queue order in the aggregator README if the user wasn't explicit).

### Phase 1 — Gather sources (per system)

In this order:

1. **WebSearch for the canonical URL FIRST.** Don't trust the obvious guess. Doc sites routinely redirect `/docs/<topic>/overview/`-style URLs to stubs while the canonical content lives at `/docs/configuration/v2/...`, `/docs/<topic>/` (no `overview`), or `/2.0/spec/<topic>.html`. A `WebSearch "<system> <axis-keyword> docs"` will reliably surface the real canonical entry. Only then `WebFetch`.
2. **WebFetch the landing page + the docs index.** Confirm the search-result URL is canonical (not a redirect stub) by checking for substantive content, not just a "here are some links" page.
3. **WebFetch the relevant spec pages.** For an IDL: the language spec. For an identity system: the concepts page. For a tool: the CLI reference. For a registry: the protocol or API spec.
4. **(If applicable) WebFetch a key paper or RFC.** Macaroons → 2014 Google paper. SLSA → the levels page.
5. **(If applicable) Fetch source files in the canonical repo via `gh api repos/<owner>/<repo>/contents/<path>`.** Pin to a specific commit SHA for stable citations.
6. Maintain a per-system "Sources gathered" list of `URL — access-date`. This becomes the entry's "Sources cited" section.

If a URL fails, redirects to a stub, or is gated, mark dependent claims `[unverified]` and continue. Don't fabricate.

**Citing absences.** If an axis cell describes something a system *does not* have (e.g. "Buf has no Sigstore-based commit signing"), this is still a citable claim — but the evidence is the *absence* on the relevant page. Format the Evidence bullet as: *"No mention of Sigstore on the BSR overview page or the security/signing page: <URL1>, <URL2> (accessed YYYY-MM-DD)."* Don't leave the bullet empty. Don't say "I couldn't find it" without listing the pages searched.

### Phase 2 — Fill the template

For each target system, copy `${CLAUDE_SKILL_DIR}/TEMPLATE.md` to `<output-dir>/<system-name-lowercase>.md` and fill in:

1. **TL;DR** — three lines max.
2. **Sources cited** — Phase 1 URLs + access dates.
3. **Axes 1–7** — for each:
   - *Position:* one line, sourced from gathered evidence.
   - *Evidence:* short quote / excerpt with link.
   - *Comparison to us:* one line, derived from baseline's same axis.
   - *Adopt / Borrow / Skip:* one verdict + one-line rationale.
4. **Cross-cutting:** the table — adoption cost, maintenance burden, risk-if-adopt, risk-if-not, open questions.
5. **Decision:** Adopt / Borrow / Skip lists with specific items and concrete pointers.
6. **Action items:** owned, due-dated tasks, or "none — verdict is Skip."
7. **Cross-references:** related entries, beads, ADRs.

### Phase 3 — Update the aggregator

Edit `<output-dir>/README.md`:

1. **Column header:** replace `[<Project>](<project>.md) [planned]` with `[<Project>](<project>.md)`.
2. **Matrix cells:** fill each row's cell with a ≤8-word verdict. Long analysis stays in the per-system file.
3. **Decision summary table:** fill the system's row with Adopt? + patterns + reason.
4. **Triage queue:** remove the system from the queue.

### Phase 4 — Report

Output a concise summary (≤300 words):

- Which systems you evaluated
- Most surprising finding per system (one line each)
- Cross-cutting pattern, if one emerged
- Anything you couldn't verify (the `[unverified]` claims)
- What to evaluate next (top of the triage queue)

### Phase 5 — Leave clarifications for the orchestrator (mailbox)

The skill author can't pre-know every external site's URL schema, every system's quirks, or every case where the template feels wrong. When you hit something that suggests the **skill itself** needs evolving (not just one entry's data), don't silently work around it — leave a structured message for the orchestrator.

**When to leave a clarification:**

- A URL pattern surprised you (redirect stubs, non-obvious canonical paths). Worth folding into Phase 1's "WebSearch first" hint.
- The template's axis bullets don't fit cleanly for this system (e.g. an axis is "out of scope" but the template assumes a positive answer).
- Two primary sources contradict each other and you can't tell which is canonical.
- You're unsure whether to mark a claim `[unverified]` or split it into multiple finer claims.
- An axis you needed isn't in the rubric (proposal to add an 8th axis).

**How to leave one:**

Append a structured block to `<output-dir>/_clarifications.md` (create if missing). Format:

```markdown
## YYYY-MM-DD — <system-name> — <one-line subject>

- **Surface:** SKILL.md | TEMPLATE.md | this-entry | rubric
- **Surprise:** one paragraph describing what you hit
- **Proposed fix:** one paragraph suggesting how the skill or template should change
- **Severity:** low (cosmetic) | medium (friction for future runs) | high (entries are wrong without this fix)
```

The orchestrator processes these between runs — either folds the fix into the skill, files a bead via `rosary:note`, or marks the clarification "won't fix" with reason. Resolved entries get moved to the bottom of the file under a `## Resolved` heading.

This is the early-skill feedback loop: every dispatch surfaces what the skill couldn't anticipate. Don't skip it — silent workarounds are how skills drift.

## What you don't do

- **Don't recommend wholesale adoption** unless evidence is overwhelming. Default to "borrow patterns, keep our stack."
- **Don't write opinions in prose.** The template is the artifact. If something doesn't fit, propose evolving the template rather than freelancing.
- **Don't compare on dimensions outside the 7 axes** without explicit reason.
- **Don't go beyond 5 systems per invocation.** Surface the cap; chain invocations.
- **Don't refresh the baseline.** That's the user's responsibility. You consume it; you don't mutate it.
- **Don't open PRs or merge work.** Output is files on disk + a chat report. The user reviews and commits.

## Refusal conditions

| Condition | Refuse with |
|---|---|
| Baseline doc missing | "Baseline document not found at `<path>`. Please create it from `${CLAUDE_SKILL_DIR}/examples/baseline-template.md` (or point me at one) before invoking me." |
| Baseline stale (>6mo) | "Baseline was last refreshed YYYY-MM-DD, more than 6 months ago. Refresh it before re-running me." |
| `TEMPLATE.md` missing or renamed | "Template missing or its H2 headers changed. Restore or evolve the template first." |
| >5 systems requested | "You asked for N. I cap at 5 per pass to avoid breadth-thrashing. I'll do these 5 first: [list]. Re-invoke me with the rest." |
| No canonical URL findable for a target | "I couldn't find a canonical URL for `<system>` via WebSearch. Either it's too niche to be useful as prior art, or you have a URL I should use — please supply it." |
| User asks for opinion-prose output | "I write structured template entries, not opinion essays. The decisions are in each entry's Decision section; the cross-cutting matrix is in the aggregator README." |

## Examples

```
/prior-art-cartographer Smithy
→ writes docs/prior-art/smithy.md against docs/prior-art/_baseline.md;
  updates docs/prior-art/README.md

/prior-art-cartographer Buf SPIFFE Macaroons
→ writes 3 entries; updates the aggregator

/prior-art-cartographer Buf --baseline=~/work/myproject/baseline.md --output-dir=~/work/myproject/prior-art/
→ same workflow, different project

/prior-art-cartographer Smithy Buf SPIFFE Nixpkgs SLSA Backstage WIT
→ refuses politely: "7 > 5; doing the first 5, re-invoke for the rest"
```

## Supporting files in this skill

- `TEMPLATE.md` — the canonical 7-axis shape every entry fills in
- `examples/smithy.md` *(planned)* — a worked example showing the template filled in

## Style notes

- **Be terse.** Each axis section is ≤6 short lines.
- **Be honest about uncertainty.** `[unverified]` is the friend.
- **Be opinionated in the Decision section.** Adopt / Borrow / Skip are decisions, not hedges.
- **Be reproducible.** Two runs against the same baseline + same target list at the same date should produce nearly-identical entries.
