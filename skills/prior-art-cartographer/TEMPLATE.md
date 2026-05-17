<!--
TEMPLATE.md — the canonical shape for a prior-art comparison entry.

Copy this file to <project-name>.md, fill in every section. Don't add new
top-level sections; add new H3s inside the 7 axes if you need to. Every
factual claim about the project being evaluated must cite a primary source
(docs URL, source-code path, paper PDF). No recalled folklore.

The shape is fixed so all entries are diff-able and the aggregator
README.md can render the cross-cutting matrix without per-entry parsing.
-->

# Prior art — `<project-name>`

> **Canonical URL:** <https://...>
> **License + governance:** <e.g. Apache-2.0, governed by Bytecode Alliance>
> **Evaluated:** YYYY-MM-DD by `prior-art-cartographer` (Opus 4.7)
> **Refresh after:** YYYY-MM-DD (≤ 6 months from eval)

## TL;DR

Three lines max. What is it. What it's best at. What it's not.

## Sources cited in this entry

- <https://...> — primary docs landing page (accessed YYYY-MM-DD)
- <https://...> — relevant spec / RFC / paper (accessed YYYY-MM-DD)
- <https://github.com/...> — code reference (commit `abcdef0`)

> **Citation rule:** every numeric, verbatim, or design-decision claim in
> this entry must trace back to one of the URLs above. If you can't cite,
> mark the claim `[unverified]` in the prose so a future refresh can fill
> the gap. Never silently invent.
>
> **Citing absences:** if an axis describes something the system *doesn't*
> have (e.g. "no built-in signing"), the Evidence bullet should still cite
> the pages you searched: *"No mention on <URL1> or <URL2> (accessed
> YYYY-MM-DD)."* Treat absence-claims with the same rigor as presence-claims;
> they're a real signal, not a punt.

---

## Axis 1 — IDL shape

**What can a schema express?**

- *Position:* one line summarizing the schema language (e.g. ".smithy IDL, structurally typed, traits-as-decorators").
- *Evidence:* short quote or excerpt from primary source, with link.
- *Comparison to us:* one line. What's the same? Different?
- *Adopt / Borrow / Skip:* one of three, with one-line rationale.

## Axis 2 — Annotation / trait model

**Can shapes be decorated with semantic metadata? How does that propagate through codegen?**

- *Position:*
- *Evidence:*
- *Comparison to us:*
- *Adopt / Borrow / Skip:*

## Axis 3 — Versioning + breaking-change detection

**How are versions named? Is breaking-change detection automated? Can two versions coexist in the same consumer?**

- *Position:*
- *Evidence:*
- *Comparison to us:*
- *Adopt / Borrow / Skip:*

## Axis 4 — Codegen targets + plugin model

**Which languages/formats? Built-in or plugin-driven? Extensibility story?**

- *Position:*
- *Evidence:*
- *Comparison to us:*
- *Adopt / Borrow / Skip:*

## Axis 5 — Identity / capability model

**Does it ship one? Bearer-token? Object-capability? Macaroon? Workload identity? None / out of scope?**

- *Position:* (if "out of scope," still say so explicitly — that's a comparable position)
- *Evidence:*
- *Comparison to us:*
- *Adopt / Borrow / Skip:*

## Axis 6 — Supply-chain story

**Signing? Provenance? SBOM? Reproducibility? Or none?**

- *Position:*
- *Evidence:*
- *Comparison to us:*
- *Adopt / Borrow / Skip:*

## Axis 7 — Adoption cost

**Hello-world complexity. Migration cost from what we have. Ecosystem maturity. Steward risk.**

- *Position:*
- *Evidence:* (e.g. "their quickstart is 18 lines of YAML + 1 CLI install")
- *Comparison to us:*
- *Adopt / Borrow / Skip:*

---

## Cross-cutting

| Field | Value |
|---|---|
| Adoption cost (S / M / L) | <S/M/L> + one-line rationale |
| Maintenance burden if adopted | <low / med / high> + reason |
| Risk if we adopt | One line |
| Risk if we do NOT adopt | One line |
| Open questions (couldn't answer from public docs) | bulleted list |

## Decision

- **Adopt:** *(list of specific things to take wholesale, with file/section pointers)*
- **Borrow:** *(list of patterns to copy/adapt, with concrete next steps)*
- **Skip:** *(list of things we explicitly are NOT taking, with reason)*

If the overall verdict is "skip," still list what you considered taking and why you rejected it. Future-you needs to know the analysis happened.

## Action items

- [ ] Concrete, owned, due-dated next steps (or "none — verdict is Skip").

## Cross-references

- Related prior-art entries: `[smithy](smithy.md)`, `[buf](buf.md)`, …
- Related beads: `cloister-XXXXXX`, `art-XXXXXX`
- Related ADRs: `cloister/docs/adr/00XX-*.md`

---

<!-- End of template. The aggregator README.md uses the H2 headers
("Axis N — …") to pull one-line summaries for the matrix. Don't rename
the H2s; if you need to add detail, use H3s inside them. -->
