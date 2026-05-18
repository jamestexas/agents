<!--
wit.md — prior-art entry for WIT + the WebAssembly Component Model.
Drafted by prior-art-cartographer (claude-opus-4-7) on 2026-05-18 against
docs/prior-art/_baseline.md. Every factual claim is pinned to a URL in
"Sources cited", or marked [unverified].
-->

# Prior art — WIT + WebAssembly Component Model

> **Canonical URL:** <https://component-model.bytecodealliance.org/>
> **License + governance:** Component Model specification housed in WebAssembly community (`WebAssembly/component-model`); tooling stewarded by the Bytecode Alliance. WASI 0.2.0 stable since 2024-01-25 — "Users can now pin to any stable release >= `v0.2.0`."
> **Evaluated:** 2026-05-18 by `prior-art-cartographer` (Opus 4.7)
> **Refresh after:** 2026-11-18

## TL;DR

WIT ("Wasm Interface Type") is the Bytecode Alliance's IDL for describing WebAssembly component interfaces and worlds. Best at: language-agnostic wasm-component interop with a Canonical ABI, semver-tagged packages, `@since`/`@unstable`/`@deprecated` feature gates, and a real multi-language guest-binding generator (`wit-bindgen` ships Rust, C/C++, C#, Go, MoonBit). Not for: identity/capability tokens, supply chain, host-side codegen (separate projects), and anything not-wasm — WIT is a *component-model* IDL, not a general-purpose schema language.

## Sources cited in this entry

- <https://component-model.bytecodealliance.org/> — Component Model overview (accessed 2026-05-18)
- <https://component-model.bytecodealliance.org/design/wit.html> — WIT reference: types, interfaces, worlds, packages (accessed 2026-05-18)
- <https://component-model.bytecodealliance.org/design/packages.html> — WIT package model (accessed 2026-05-18)
- <https://component-model.bytecodealliance.org/design/why-component-model.html> — problem framing (accessed 2026-05-18)
- <https://github.com/WebAssembly/component-model/blob/main/design/mvp/WIT.md> — WIT MVP spec: `@since`, `@unstable`, `@deprecated` gates (accessed 2026-05-18)
- <https://github.com/bytecodealliance/wit-bindgen/blob/main/README.md> — wit-bindgen guest-binding generator (accessed 2026-05-18)
- <https://github.com/bytecodealliance/wasm-tools> — wasm-tools (component compose/validate/wit extraction) (accessed 2026-05-18)

> **Citation rule:** every claim below traces to one of the URLs above or is marked `[unverified]`.

---

## Axis 1 — IDL shape

- **Position:** **Real IDL, scoped to wasm component interfaces.** Primitive types (`bool`, `s8`–`s64`, `u8`–`u64`, `f32`, `f64`, `char`, `string`); compound types `list<T>`, `option<T>`, `result<T, E>`, tuples; user-defined `record`, `variant`, `enum`, `resource` ("handle to some entity that exists outside of the component"), `flags`, type aliases (WIT reference, accessed 2026-05-18). Two abstraction levels: **interfaces** ("named set of types and functions, enclosed in braces") and **worlds** ("describes a set of imports and exports") (same source).
- **Evidence:** WIT reference page (accessed 2026-05-18) — quoted definitions above.
- **Comparison to us:** **Highly comparable to capnp.** Both have rich primitive + compound + user-defined types, both are language-agnostic, both compile to multi-language code. The standout difference: WIT's `world` abstraction is explicit about *imports + exports* — closer to Smithy's `service` abstraction (and what `_baseline.md` Axis 1 notes we *don't* have today). The `resource` type is also load-bearing: it models capability handles to host-side objects, which is exactly the shape interlace leases would take if expressed as WIT.
- **Adopt / Borrow / Skip:** **Borrow** the `world` abstraction concept as an annotated-capnp pattern. Concrete pointer: a `$World(imports = [...], exports = [...])` annotation on a capnp struct that names a capability surface; schema-bridge could emit world-shaped TypeScript modules. Don't migrate off capnp to WIT — WIT is wasm-scoped, capnp is universal.

## Axis 2 — Annotation / trait model

- **Position:** **Versioning gates, not free-form annotations.** WIT has three formal gates: `@since(version = X.Y.Z)`, `@unstable(feature = name)`, and `@deprecated(version = X.Y.Z)`. The MVP spec states: "A @deprecated gate is required to always be paired up with either a @since or @deprecated gate" (WIT.md, accessed 2026-05-18). These are *propagating semantic decorations* — they affect codegen behavior (a feature gated `@since(0.2.2)` is unavailable when targeting `0.2.1`). No free-form custom-annotation declaration system equivalent to Smithy traits or capnp `$annotation`.
- **Evidence:** WIT MVP spec (accessed 2026-05-18) — gate syntax + targeting semantics.
- **Comparison to us:** Different shape — WIT's gates are scoped to *API evolution* (when did this exist, when does it deprecate). Smithy traits and capnp `$annotation` are general-purpose. Our `_baseline.md` Axis 2 notes we have no canonical trait library. WIT doesn't give us one — but the `@since`/`@deprecated` pattern is exactly the breaking-change-as-decoration shape we'd benefit from for capnp.
- **Adopt / Borrow / Skip:** **Borrow.** Lift the `@since` / `@deprecated` gate pattern into capnp as canonical annotations: `$Since("0.1.0")`, `$Deprecated("0.2.0")`. schema-bridge can read these and (a) emit deprecation warnings in generated code, (b) drive a future `schema-bridge diff` (see smithy.md Axis 3 borrow).

## Axis 3 — Versioning + breaking-change detection

- **Position:** **Semver-tagged packages + feature gates, no diff tool.** Package names include semver: `foo:bar@1.0.0` (WIT.md). Tooling respects version semantics: "Once applied to an item, the item is not modified incompatibly going forward (according to general semantic versioning rules)" (same source). Semver-based deduplication: "By definition in WIT, it should always be possible to use larger versions, so older imports are automatically 'upgraded' to newer imports" `[unverified]` (claim from search-result summary; matches the WIT design intent in WIT.md, but exact phrasing not directly fetched).

  **No automated breaking-change detection tool.** The WIT MVP spec contains **no mention** of an automated tool — gates are manual compatibility markers, not a `wit diff` subcommand (WIT.md, accessed 2026-05-18). `wasm-tools` does ship `wasm-tools component wit` for extracting WIT from compiled components and `wit-parser` for parsing WIT files — primitives for a diff tool, but not a diff tool itself (wasm-tools README, accessed 2026-05-18).
- **Evidence:** WIT.md (versioning + gates); wasm-tools README (no `diff` subcommand listed).
- **Comparison to us:** **WIT is ahead of us on the gate pattern, behind Smithy/Buf on diff automation, comparable to us on raw versioning.** `_baseline.md` Axis 3: "Per-directory versioning … no automated breaking-change detection." WIT has *encoded* versioning (`@since`/`@deprecated` in the schema) which is strictly better than our per-directory `v1/` `v2/` pattern. WIT lacks `buf breaking --against` or `smithy diff`. Same gap we have.
- **Adopt / Borrow / Skip:** **Borrow the encoded-gate pattern.** Schema-bridge can read `$Since` / `$Deprecated` annotations on capnp shapes/fields and (a) emit deprecation warnings, (b) feed a future diff tool. Skip wasm-tools' WIT-extraction — different problem (we don't compile to wasm components).

## Axis 4 — Codegen targets + plugin model

- **Position:** **Real multi-language guest-binding generator.** `wit-bindgen` officially supports Rust, C/C++, C#, Go, MoonBit (wit-bindgen README, accessed 2026-05-18). Additional languages via separate projects: JavaScript (`componentize-js`), Python (`componentize-py`). The README explicitly scopes to **guest** ("compiled to WebAssembly"): "The `wit-bindgen` repository is currently focused on **guest** programs" (same source). Host-side codegen is in separate projects (Wasmtime for Rust hosts, `jco` for JS hosts).

  **Stability disclaimer:** the CLI is explicitly pre-stable: "This CLI **IS NOT** stable and may change, do not expect it to be or rely on it being stable" (wit-bindgen README, accessed 2026-05-18). Versioning at `0.X.Y`.
- **Evidence:** wit-bindgen README (language list + guest-focus + stability disclaimer); wasm-tools README (component-model subcommands).
- **Comparison to us:** **WIT is strictly ahead on number of targets, behind on stability commitment.** Our `_baseline.md` Axis 4: "One direction (capnp → zod TS), one consumer (cloister). Hand-written Rust transformer. No plugin system." wit-bindgen has the plugin shape we want — language generators as separate crates, registered with the CLI. But the project is honest about being pre-stable, which is its own kind of warning.
- **Adopt / Borrow / Skip:** **Borrow the plugin shape; don't adopt wit-bindgen itself.** Adopting wit-bindgen would require us to compile our schemas to wasm components, which is the wrong direction — wasm components are a *deployment target*, not a *schema substrate*. The architectural pattern (one parser, multiple language-generator crates) is the same recommendation from `smithy.md` Axis 4. WIT confirms the pattern.

## Axis 5 — Identity / capability model

- **Position:** **Out of scope.** Component Model focuses on type-safe cross-language interop: "components enable portability across different programming languages" (why-component-model.html, accessed 2026-05-18). It strengthens sandboxing by "preventing components from exporting memory" (same source). But it does not ship identity, capability tokens, or auth descriptors. The `resource` type carries opaque handles — *capability-shaped* in the object-capability sense (you can only do what the handle's interface lets you) but with no signing, attenuation, or delegation primitives.
- **Evidence:** why-component-model.html (sandboxing framing); WIT reference (`resource` type definition, accessed 2026-05-18).
- **Comparison to us:** Different layer. signet (workload identity, SPIRE-shape + Fulcio-shape) and interlace (capability tokens, macaroon-shape) sit *above* anything WIT models. **Interesting cross-pollination:** WIT `resource` types are object-capabilities in the language sense; if cloister ever exposes wasm components, the natural mapping is `wit-resource handle <-> interlace lease`. But that's a future bet, not a current adoption.
- **Adopt / Borrow / Skip:** **Skip** — different layer. Note for future: when cloister starts shipping wasm components (workerd is moving that way `[unverified]` — based on baseline doc's framing, not directly verified this session), the `resource` type is the bridge between WIT's object-capability layer and our interlace lease.

## Axis 6 — Supply-chain story

- **Position:** **Out of scope** for the WIT spec itself. Component Model is an interface description language; signing/provenance/SBOM are left to whatever ships the components. Some adjacent tooling exists (`wasm-tools validate` for binary integrity, `wasm-tools component wit` for round-trip extraction) but no first-party Sigstore/SLSA story (wasm-tools README, accessed 2026-05-18). `[unverified]` on whether the Bytecode Alliance has a separate component-signing initiative — not surfaced in this session's fetches.
- **Evidence:** No mention of cosign, SLSA, SBOM, Rekor, or in-toto on the Component Model docs landing or design pages fetched (accessed 2026-05-18).
- **Comparison to us:** Same layer as Smithy/WIT on this — out of scope. See `slsa-sigstore-in-toto.md` for the supply-chain analysis.
- **Adopt / Borrow / Skip:** **Skip** — not WIT's job.

## Axis 7 — Adoption cost

- **Position:** **L for wholesale (migrate capnp → WIT), M for complement (use WIT only when shipping wasm components), S for pattern-borrowing.** Hello-world for WIT alone is small: write a `.wit` file, run `wit-bindgen rust`, get bindings. Hello-world for *adopting* WIT as our substrate IDL is a quarter-of-work migration plus a lock-in: WIT is wasm-component-shaped, and outside-of-wasm consumers don't exist. Pattern-borrowing (`@since`/`@deprecated` gates, `world` abstraction concept, plugin codegen shape) is ~1-2 weeks per pattern.
- **Evidence:** wit-bindgen quickstart is a few CLI commands and a short `.wit` file `[unverified]` — based on README structure, not a specific hello-world quote. The wholesale-migration cost claim is derived from `_baseline.md` Axis 4 (single-target zod) and the lack of a non-zod codegen target today.
- **Comparison to us:** **WIT solves a different version of our problem and would lock us to wasm.** Today we have capnp + a one-direction schema-bridge. Migrating to WIT would (a) lose capnp's broader applicability, (b) tie our IDL to the wasm component model's evolution, (c) force us through wit-bindgen's pre-stable CLI. The win — getting a multi-language codegen story for free — is *not actually free* because the substrate would become wasm-component-coupled.
- **Adopt / Borrow / Skip:** **Borrow patterns, treat WIT as a future complement.** WIT becomes load-bearing when cloister (or anything downstream) ships wasm components. Until then: borrow the `world` and `@since`/`@deprecated` patterns into capnp; defer adoption.

---

## Cross-cutting

| Field | Value |
|---|---|
| Adoption cost (S / M / L) | **S** for pattern-borrowing (`@since`/`@deprecated` gates, `world` abstraction); **M** for complement (use WIT when shipping wasm components); **L** for wholesale (migrate capnp → WIT) |
| Maintenance burden if adopted (patterns) | Low — capnp annotations + schema-bridge plugin work; we already plan that arc |
| Risk if we adopt patterns | Low — borrowing concepts doesn't couple us to wit-bindgen's pre-stable status |
| Risk if we do NOT adopt | Low today, Medium when cloister starts shipping wasm components — at that point WIT is the lingua franca and we'd need a capnp↔WIT bridge anyway |
| Open questions | (1) Does workerd's component-model adoption have a stable timeline? `[unverified]` — baseline says "moving toward components" but exact ETA not researched this session. (2) Can `wit-parser` (Rust) be used as a sidecar by schema-bridge if we ever need to *consume* WIT files (e.g., to expose cloister capabilities as wasm-importable interfaces)? (3) Should we ship a `capnp-to-wit` translator now as future-proofing, or wait until a concrete consumer materializes? |

## Decision

- **Adopt:** *(none — WIT itself stays external)*
- **Borrow:**
  - **The `@since` / `@deprecated` / `@unstable` gate pattern.** Declare canonical capnp annotations `$Since("X.Y.Z")`, `$Deprecated("X.Y.Z")`, `$Unstable("feature-name")`. schema-bridge propagates them into zod metadata (emit `@deprecated` JSDoc, runtime warnings). Concrete pointer: extend `cloister/tools/schema-bridge/` to recognize these annotations.
  - **The `world` abstraction as a capnp pattern.** `$World(imports = [...], exports = [...])` annotation on a struct that names a capability surface. Combined with Smithy's `$Op` pattern (`smithy.md` Axis 1 borrow), this gives us a typed-handler-signature codegen story.
  - **The plugin-driven codegen shape.** wit-bindgen confirms what smithy.md Axis 4 already recommends: one parser + N language-generator crates registered at build time. Defer until second codegen target lands.
- **Skip:**
  - **WIT as our substrate IDL.** Capnp is broader; WIT is wasm-coupled.
  - **wit-bindgen as our codegen.** Pre-stable CLI; guest-only; wrong layer.
  - **Component Model resources for our capability tokens.** interlace lease is the substrate-level capability token; WIT `resource` is a *deployment-time* binding when cloister exposes wasm components. Map them when that day comes, don't conflate them now.

## Action items

- [ ] File bead (cloister/schema-bridge): "declare `$Since`, `$Deprecated`, `$Unstable` annotations in `substrate-traits.capnp`; propagate through schema-bridge into zod metadata." Depends on smithy.md's `substrate-traits.capnp` action item. ~1 week.
- [ ] File bead (cloister/schema-bridge): "spec `$World(imports, exports)` annotation as a capability-surface descriptor; align with Smithy's `$Op`." ~1 week spec, +2 weeks implementation.
- [ ] File bead (research): "track workerd's Component Model adoption timeline; revisit WIT as a complement when cloister ships its first wasm component. Quarterly check-in." `[unverified]` on workerd's current state. Recurring.
- [ ] **No** bead for capnp-to-WIT translator — premature, file when a real consumer surfaces.

## Cross-references

- Related prior-art entries: [smithy](smithy.md) (Axis 1's `operation` + Axis 2 trait propagation are the closest non-wasm analogs); [buf](buf.md) (codegen plugin model — `buf.gen.yaml` is the same shape as `wit-bindgen` per-language crates); [macaroons](macaroons.md) (Axis 5 — WIT `resource` is the object-capability layer interlace would express at deployment time when components ship).
- Related beads: `cloister-9f54d6` (annotation support gap — `$Since`/`$Deprecated` lands here), `cloister-aea8a7` (schema-bridge coverage), `cloister-1b59a2` (substrate-as-kernel framing).
- Related ADRs: cloister ADR-0022 (schema-bridge positioning) — the `$World` and `$Since` borrows extend this ADR's scope.
