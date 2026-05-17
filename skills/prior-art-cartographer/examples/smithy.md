<!--
smithy.md — worked example of the prior-art template in use.

Drafted by hand (not by the prior-art-cartographer agent) as the seed
entry so the agent has a reference to match. Some claims are
[unverified] and will be refined when the agent reruns this entry with
live web fetches. The shape is what's load-bearing here, not the precise
fact-checking.
-->

# Prior art — Smithy

> **Canonical URL:** <https://smithy.io>
> **License + governance:** Apache-2.0, AWS-led (open contributions accepted)
> **Evaluated:** 2026-05-17 by hand (seed entry — will be refreshed by prior-art-cartographer)
> **Refresh after:** 2026-11-17

## TL;DR

Smithy is AWS's IDL for describing services and shapes. Best at: rigorous trait-based decoration that propagates through codegen to many languages + OpenAPI. Not for: identity, supply-chain, or capability tokens — it's an interface description language, not a substrate.

## Sources cited in this entry

- <https://smithy.io/2.0/spec/idl.html> — IDL spec (accessed 2026-05-17) `[unverified]`
- <https://smithy.io/2.0/spec/model.html> — model + traits spec `[unverified]`
- <https://smithy.io/2.0/guides/converting-to-openapi.html> — OpenAPI codegen `[unverified]`
- <https://github.com/smithy-lang/smithy> — reference impl `[unverified]`

> Marked `[unverified]` because this seed entry was drafted from prior knowledge, not live fetches. The agent's first refresh pass should replace these with confirmed citations.

---

## Axis 1 — IDL shape

- **Position:** `.smithy` IDL, structurally typed. Shapes: `structure`, `list`, `map`, `union`, `enum`, primitive types, plus higher-order `service`, `resource`, `operation`. Two abstraction levels: shapes (data) and services (interfaces).
- **Evidence:** "Smithy is a language for defining services and SDKs." — smithy.io landing page `[unverified]`.
- **Comparison to us:** We have capnp shapes (rich enough). What we don't have is Smithy's *operation* abstraction — explicit `operation { input: I, output: O, errors: [E1, E2] }` shapes. Cloister currently describes wire envelopes in markdown.
- **Adopt / Borrow / Skip:** **Borrow.** Steal the `operation { input, output, errors }` triple as an annotated capnp pattern: `$Op(input = ..., output = ..., errors = [...])`.

## Axis 2 — Annotation / trait model

- **Position:** **The standout feature.** Every shape and member can carry typed *traits* — `@http(method: "POST", uri: "/x")`, `@auth(["sigv4"])`, `@deprecated`, `@required`. Custom traits are declared in the model and propagate through codegen. Traits compose (a shape can have many) and are first-class data.
- **Evidence:** "Traits are model components that can be attached to shapes to associate metadata to the shape." — smithy spec, model section `[unverified]`.
- **Comparison to us:** Capnp has `$annotation` declarations but our usage is informal and not catalogued. We don't have a propagation story — annotations in source schemas don't appear in zod output today.
- **Adopt / Borrow / Skip:** **Borrow heavily.** This is the single most-load-bearing pattern. Action: declare a canonical `art-traits.capnp` (or `substrate-traits.capnp`) with named annotations (`$Sensitive`, `$Scope`, `$WireEnvelope`, etc.) and extend schema-bridge to propagate them into zod's `.describe()` / `meta()` / refinement layer.

## Axis 3 — Versioning + breaking-change detection

- **Position:** Smithy itself doesn't enforce versioning strategy at the IDL level — that's pushed to *Smithy projections* (filtered views of the model). The build tool emits errors when breaking changes are detected against a baseline model. `@deprecated` is a trait, not a separate concept.
- **Evidence:** "smithy diff" command exists `[unverified]`.
- **Comparison to us:** We have per-directory versioning (`v1/`, `0.1.0/`) but no automated diff. Smithy's "compare model against previous release, fail build if breaking" pattern is exactly what we lack.
- **Adopt / Borrow / Skip:** **Borrow.** Add a `schema-bridge diff <old> <new>` subcommand that walks two capnp schemas and reports added/removed/renamed/retyped fields. Wire to CI.

## Axis 4 — Codegen targets + plugin model

- **Position:** Plugin-driven via `smithy-build.json`. Targets: Java/Kotlin SDKs (AWS-native), TypeScript, Python, Go (experimental?), OpenAPI 3.x, JSON Schema. Anyone can write a Smithy build plugin.
- **Evidence:** smithy-build plugin list in docs `[unverified]`.
- **Comparison to us:** schema-bridge is single-target (zod) and not plugin-architected. Adding a Rust target today means editing schema-bridge core.
- **Adopt / Borrow / Skip:** **Borrow** the plugin architecture pattern. Don't adopt Smithy itself — but refactor schema-bridge so codegen targets are plugins (trait, dyn dispatch, or wasm components).

## Axis 5 — Identity / capability model

- **Position:** **Out of scope** for Smithy itself. Smithy has an `@auth` trait that *names* authentication schemes (`sigv4`, `httpBearer`, `httpBasic`), but the schemes themselves are external. No bearer-token vs capability semantics; that's the consumer's job.
- **Evidence:** Smithy `@auth` and `@httpApiKeyAuth` traits exist; they're descriptors, not implementations `[unverified]`.
- **Comparison to us:** We have a real identity model (interlace lease) and explicit capability scopes. Smithy doesn't compete here.
- **Adopt / Borrow / Skip:** **Skip** — different layer. But: borrow the *trait-as-descriptor-for-auth-scheme* pattern. Our equivalent would be `$Capability(scope = "cred:proxy", scheme = "interlace-lease")` on operations that require capability tokens.

## Axis 6 — Supply-chain story

- **Position:** **Out of scope.** Smithy models are normal artifacts; signing/provenance is left to whatever ships them. AWS internally uses standard supply-chain tooling around its Smithy models; that's not a Smithy feature.
- **Evidence:** No mention of cosign, SLSA, SBOM in core Smithy docs `[unverified]`.
- **Comparison to us:** We're also at zero. No relative gain or loss from Smithy here.
- **Adopt / Borrow / Skip:** **Skip** (not Smithy's job). See SLSA / Sigstore / in-toto entries for this axis.

## Axis 7 — Adoption cost

- **Position:** **Medium-high.** Smithy is mature, well-documented, but requires Java toolchain (the build CLI is JVM-based). Hello-world is "write a model file, add smithy-build.json, run `smithy build`" — call it 30 minutes if you know Java tooling, 2-3 hours if you don't.
- **Evidence:** smithy.io quickstart shows a 20-line model + build config `[unverified]`.
- **Comparison to us:** Migrating *off* capnp would be ~quarter-of-work for the schemas we already have, plus refactoring schema-bridge. *Borrowing the trait model* into capnp is ~2 weeks (define traits, extend schema-bridge).
- **Adopt / Borrow / Skip:** **Borrow patterns** at ~2-week cost. **Don't adopt Smithy itself** — migration cost ≫ the gain when we already have capnp.

---

## Cross-cutting

| Field | Value |
|---|---|
| Adoption cost (S / M / L) | **M** for pattern-borrowing, **L** for wholesale adoption |
| Maintenance burden if adopted (patterns) | Low — once trait library exists, it's data |
| Risk if we adopt patterns | Low — capnp annotations already support the shape |
| Risk if we do NOT adopt | Medium — without trait propagation, every codegen target re-derives semantic meaning from naming conventions; brittle |
| Open questions | Does Smithy's "selector" syntax (for finding shapes by trait combinations) have a useful capnp analog? Does Smithy's projection system map to anything we'd want for cross-repo capability filtering? |

## Decision

- **Adopt:** *(none — Smithy itself stays external)*
- **Borrow:**
  - The trait/annotation propagation model. Declare `substrate-traits.capnp` (or co-locate inside `cloister-spec/_traits.capnp`) with named annotations. Extend schema-bridge to propagate annotations into zod metadata.
  - The `operation { input, output, errors }` shape for wire envelopes. Add `$Op` annotation; codegen emits typed handler signatures.
  - The "diff two model versions, fail build on breaking change" pattern. Add `schema-bridge diff` subcommand + CI gate.
  - The plugin-driven codegen architecture. Refactor schema-bridge so targets register as plugins.
- **Skip:**
  - Smithy IDL itself (we have capnp).
  - Smithy's identity/auth descriptors (we have interlace).
  - Smithy's JVM toolchain.

## Action items

- [ ] File bead: "declare substrate-traits.capnp with canonical annotations" — depends on cloister-9f54d6 (annotation support gap).
- [ ] File bead: "schema-bridge: $Op annotation → typed handler signatures in zod target."
- [ ] File bead: "schema-bridge diff subcommand + CI gate on breaking changes."
- [ ] File bead: "refactor schema-bridge codegen to plugin architecture (defer until 2nd target lands)."

## Cross-references

- Related prior-art entries: `[buf](buf.md)` (when written — Buf is the same shape with protobuf), `[wit](wit.md)` (when written)
- Related beads: `cloister-9f54d6` (schema-bridge construct gaps), `cloister-aea8a7` (extend coverage), `cloister-9ea507` (const support)
- Related ADRs: cloister ADR-0022 (schema-bridge positioning), ADR-0024 (credential-isolation/v1)
