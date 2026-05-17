<!--
buf.md — prior-art entry for Buf (buf.build).
Drafted by prior-art-cartographer (claude-opus-4-7) on 2026-05-17 against
docs/prior-art/_baseline.md. Every factual claim is pinned to a URL
listed in "Sources cited" below, or marked [unverified].
-->

# Prior art — Buf

> **Canonical URL:** <https://buf.build>
> **License + governance:** Apache-2.0 (`buf` CLI is open source); BSR is a commercial managed service operated by Buf Technologies. `[unverified]` (license not confirmed from a primary fetch this session)
> **Evaluated:** 2026-05-17 by `prior-art-cartographer` (Opus 4.7)
> **Refresh after:** 2026-11-17

## TL;DR

Buf is the productised form of "schema-bridge as a service" for Protocol Buffers. Best at: opinionated CLI workflow (`buf build / lint / breaking / generate`), a hosted Schema Registry with content-addressed commits and mutable labels, and a remote-plugin codegen marketplace. Not for: identity, capability tokens, or supply-chain signing — those axes are out of scope.

## Sources cited in this entry

- <https://buf.build> — landing page / product overview (accessed 2026-05-17)
- <https://buf.build/docs/cli/> — buf CLI subcommand reference (accessed 2026-05-17)
- <https://buf.build/docs/cli/quickstart/> — CLI quickstart with minimal `buf.yaml` / `buf.gen.yaml` (accessed 2026-05-17)
- <https://buf.build/docs/configuration/v2/buf-gen-yaml/> — `buf.gen.yaml` v2 reference (accessed 2026-05-17)
- <https://buf.build/docs/bsr/> — BSR overview (accessed 2026-05-17)
- <https://buf.build/docs/bsr/repositories/> — BSR repositories / modules (accessed 2026-05-17)
- <https://buf.build/docs/bsr/commits-labels/> — commits and labels in BSR (accessed 2026-05-17)
- <https://buf.build/docs/bsr/module/publish/> — `buf push` and labels (accessed 2026-05-17)
- <https://buf.build/docs/breaking/> — breaking-change detection overview (accessed 2026-05-17)
- <https://buf.build/docs/breaking/quickstart/> — breaking CLI examples (accessed 2026-05-17)

> **Citation rule:** every numeric, verbatim, or design-decision claim below traces back to one of the URLs above. Where I couldn't confirm from a primary fetch this session, the claim is suffixed `[unverified]`.

---

## Axis 1 — IDL shape

- **Position:** Protobuf, full stop. Buf does not invent an IDL — it operates over `.proto` files and presents itself as the "one-stop shop for local Protobuf development" (buf.build landing page). Inputs to the CLI are `.proto` files, `buf.yaml` workspace config, or prebuilt Buf images / `FileDescriptorSet`s (`buf.build/docs/cli/`).
- **Evidence:** "`buf build` — Compile `.proto` files into a Buf image or a plain `FileDescriptorSet`." — `buf.build/docs/cli/`. Supported inputs include "local directories, Git repos, tarballs, zip files, prebuilt images" (same).
- **Comparison to us:** We use Cap'n Proto schemas (`_baseline.md` Axis 1); Buf operates on the protobuf side of the IDL split. Both languages have similar shape primitives (structs, enums, unions, services); Buf does not extend protobuf's grammar.
- **Adopt / Borrow / Skip:** **Skip** the IDL itself (we're capnp, not protobuf). **Borrow** the "Buf image" idea — a single content-addressed `FileDescriptorSet` artifact that a downstream tool can consume without reparsing source. That's a natural fit for `schema-bridge` as a portable capnp-image format.

## Axis 2 — Annotation / trait model

- **Position:** Buf relies on protobuf's native `options` mechanism (custom message/field/file options) rather than inventing its own trait layer. Buf itself adds *opinions about how to lint and break-check* protobuf schemas, but the semantic decoration of shapes is whatever options the user (or a plugin) defines.
- **Evidence:** Protobuf custom options are a language-level extension mechanism for annotating files/messages/fields (general protobuf knowledge, surfaced in WebSearch results — `protobuf.dev/programming-guides/proto3/` referenced but not fetched this session) `[unverified]`. Buf's docs page on `buf.gen.yaml` (`buf.build/docs/configuration/v2/buf-gen-yaml/`) treats options as plugin-side concerns, not a Buf-managed trait library.
- **Comparison to us:** We have Cap'n Proto `$annotation` declarations available but use them informally with no canonical library (_baseline.md Axis 2). Buf's situation rhymes: it inherits protobuf's options but doesn't ship a canonical trait vocabulary either. Smithy's typed-trait propagation (see `smithy.md` Axis 2) is the comparable feature Buf does *not* claim.
- **Adopt / Borrow / Skip:** **Skip.** Buf doesn't solve this better than we do; if anything, Smithy is the model to borrow from for Axis 2.

## Axis 3 — Versioning + breaking-change detection

- **Position:** **Buf's load-bearing feature.** `buf breaking` compares a current schema against a baseline and reports incompatibilities. Rule categories are layered from strictest to most lenient: `FILE`, `PACKAGE`, `WIRE_JSON`, `WIRE` — "schemas that pass FILE also pass PACKAGE, WIRE_JSON, and WIRE" (WebSearch summary of `buf.build/docs/breaking/`).
- **Evidence:** "`buf breaking` — Compare a schema against a previous version and flag incompatible changes" with "50+ breaking-change rules" (`buf.build/docs/cli/`). Baselines accepted include local Git checkouts, BSR modules, and remote Git: e.g. `buf breaking --against '../../../.git#subdir=...'`, `buf breaking --against buf.build/tutorials/breaking`, `buf breaking --against 'https://github.com/bufbuild/buf-examples.git#branch=main,...'` (`buf.build/docs/breaking/quickstart/`). BSR also enforces breaking-change checks server-side on `buf push` (`buf.build/docs/breaking/`).
- **Comparison to us:** Baseline Axis 3 admits "no automated breaking-change detection. No CI that diffs schema versions." This is exactly the gap Buf fills, and the API surface (baseline = git ref OR registry label) is the right shape.
- **Adopt / Borrow / Skip:** **Borrow heavily.** The `--against <baseline>` interface with Git-grammar inputs (`#branch=…`, `#tag=…`, `#ref=…`, `#subdir=…`) and the layered FILE/PACKAGE/WIRE_JSON/WIRE rule categories are both directly transplantable into `schema-bridge diff` (see `smithy.md` Decision section — already on the borrow list).

## Axis 4 — Codegen targets + plugin model

- **Position:** Plugin-driven via `buf.gen.yaml`. Three plugin types are first-class: **remote** plugins hosted on BSR (`buf.build/<owner>/<plugin>:<version>`), **local** binaries on `$PATH`, and **protoc_builtin** generators (`cpp`, `java`, `python`, `go`, etc.) reached via a configured `protoc_path` (`buf.build/docs/configuration/v2/buf-gen-yaml/`).
- **Evidence:** Minimal `buf.gen.yaml` from the quickstart (`buf.build/docs/cli/quickstart/`):
  ```yaml
  version: v2
  managed:
    enabled: true
  plugins:
    - remote: buf.build/protocolbuffers/go
      out: gen
    - remote: buf.build/connectrpc/gosimple
      out: gen
  ```
  And from the v2 config reference: each plugin entry carries `out`, optional `opt`, and one of `remote` / `local` / `protoc_builtin`. Invocation strategy is configurable (`directory` parallelises by directory; `all` is a single invocation) (`buf.build/docs/configuration/v2/buf-gen-yaml/`).
- **Comparison to us:** Baseline Axis 4: "single-target (zod), hand-written Rust transformer. No plugin system." Buf's plugin model is exactly the architecture `schema-bridge` lacks. The remote-plugin idea (BSR hosts the binary; consumer just names it) is a step beyond the local-only plugin world.
- **Adopt / Borrow / Skip:** **Borrow.** Two patterns are worth lifting:
  1. **The `buf.gen.yaml` shape itself** — a small YAML listing `(target, plugin-ref, opts, out)` tuples. Map this onto `schema-bridge.gen.yaml` or equivalent.
  2. **Three-tier plugin source** — local-binary / remote-fetched / built-in. Cap'n Proto's `capnp` compiler already has the "built-in" tier; we'd add "local" (any executable that reads a capnp schema on stdin) and eventually "remote" (a registry-hosted wasm component or container).

## Axis 5 — Identity / capability model

- **Position:** **Out of scope.** Buf does not ship a workload-identity or capability-token model. Authentication to the BSR is whatever standard "log in to the registry, get a token, use it for CLI calls" protocol the docs describe (not fetched directly this session) `[unverified]`. There's no concept of a Buf-issued capability token bound to a service.
- **Evidence:** None of the fetched pages (`buf.build`, `buf.build/docs/cli/`, `buf.build/docs/bsr/`, `buf.build/docs/bsr/module/publish/`) describe a workload-identity or capability-token primitive. `buf push` accepts labels but no signing / identity flag (`buf.build/docs/bsr/module/publish/`).
- **Comparison to us:** Baseline Axis 5: we have interlace-lease (macaroon-shaped capability tokens). Buf doesn't compete here — the layer is different.
- **Adopt / Borrow / Skip:** **Skip.** Different layer; nothing to lift. (For this axis, evaluate SPIFFE and Macaroons from the triage queue instead.)

## Axis 6 — Supply-chain story

- **Position:** **Minimal, by current docs.** BSR commits are **content-addressed by a cryptographic manifest digest** computed over schema files, markdown docs, the dependency manifest, the Buf config, and an optional VCS backlink URL (`buf.build/docs/bsr/commits-labels/`). `buf.lock` records that digest alongside every dependency, giving consumers a verifiable pin. Beyond that, the fetched docs do not mention Sigstore, SLSA provenance, in-toto attestation, SBOM emission, or signing of pushed modules (`buf.build/docs/bsr/`, `buf.build/docs/bsr/module/publish/`).
- **Evidence:** "A digest of those contents is computed and stored alongside the commit ID" — `buf.build/docs/bsr/commits-labels/`. The `buf push` reference page does not mention any signing / attestation step (`buf.build/docs/bsr/module/publish/`). The product landing page mentions "Policy checks" for breaking changes but does not extend that language to artefact signing (`buf.build`).
- **Comparison to us:** Baseline Axis 6: "**None.** No signing, no SBOM, no SLSA provenance." Buf gives us **content-addressed commits + lockfile digests**, which is more than zero but still short of attestation / signing. So Buf is one rung higher than us on this axis but doesn't reach Sigstore/SLSA territory.
- **Adopt / Borrow / Skip:** **Borrow** the content-addressed-commit + lockfile-digest pattern. Concretely: when `schema-bridge` (or whatever we elevate to "substrate registry") publishes a schema bundle, emit a manifest digest over `(schema files, traits, README, deps)` and record it in a lockfile consumers can pin. Don't wait for full Sigstore integration to get the deterministic-pin benefit. Full signing/provenance is the SLSA entry's problem.

## Axis 7 — Adoption cost

- **Position:** **Low for new protobuf projects; medium-to-high for borrowing the patterns into our capnp world.** From the quickstart, hello-world is two YAML files (`buf.yaml` and `buf.gen.yaml`, ~10 lines each) plus `buf generate` (`buf.build/docs/cli/quickstart/`). The CLI is a single binary; no JVM required (in contrast to Smithy — see `smithy.md` Axis 7).
- **Evidence:** Quickstart shows a `buf.yaml` of seven lines and a `buf.gen.yaml` of six lines as a working starting point (`buf.build/docs/cli/quickstart/`). The CLI is a Go binary distributed via standard package managers `[unverified]` (not fetched).
- **Comparison to us:** Baseline Axis 7: adoption cost for external consumers of *our* substrate is "high — everything is custom, undocumented, unpublished." Buf demonstrates what the other end of that spectrum looks like: 13 lines of YAML to publish + generate.
- **Adopt / Borrow / Skip:** **Borrow** the *shape* of the hello-world (≤ 20 lines of config, one CLI command, no toolchain bring-up). If `schema-bridge` ever ships as a binary, the quickstart should be 13 lines of YAML + one command. Aim for parity.

---

## Cross-cutting

| Field | Value |
|---|---|
| Adoption cost (S / M / L) | **S** for pattern-borrowing into schema-bridge; **L** for wholesale adoption (would require migrating from capnp to protobuf — far too expensive) |
| Maintenance burden if adopted (patterns) | Low — `buf.gen.yaml`-shape config and `--against <baseline>` diff are both small, well-shaped surfaces |
| Risk if we adopt patterns | Low — these are shape-level idioms, not protocol commitments |
| Risk if we do NOT adopt | Medium — without a breaking-change diff and a plugin-shaped codegen config, every new schema-bridge target is a hand-coded refactor; every schema rev is reviewed by eyeball |
| Open questions | (1) Does Buf sign BSR commits (Sigstore / cosign) anywhere we haven't found in docs? `[unverified]` — none of the fetched pages address this. (2) Does `buf breaking` walk transitive imports across modules, or only the local workspace? `[unverified]`. (3) What's the BSR's authentication model (PAT, OIDC, machine identity)? `[unverified]` — not fetched this session. |

## Decision

- **Adopt:** *(none — Buf the product stays external; we're not migrating to protobuf)*
- **Borrow:**
  - **`buf breaking --against <ref>` interface shape.** Implement `schema-bridge diff --against <git-ref-or-lockfile>` with Git-grammar input parsing (`#branch=`, `#tag=`, `#ref=`, `#subdir=`). See `smithy.md` Decision (this is already on the borrow list from the Smithy entry; Buf confirms the API shape).
  - **Layered FILE / PACKAGE / WIRE_JSON / WIRE rule categories.** Cap'n Proto has a wire format too — the same layering (source-level vs package-level vs wire-level break) applies. Encode the rule set explicitly so a consumer can pick how strict they want CI to be.
  - **`buf.gen.yaml`-shape codegen config.** Define `schema-bridge.gen.yaml` (or fold into `cloister/tools/schema-bridge/`) listing `(target, plugin-ref, opts, out)` tuples; refactor schema-bridge to register codegen targets as plugins. Pairs with the Smithy borrow (`smithy.md` Decision Axis 4).
  - **Content-addressed commit + lockfile digest.** When we publish a substrate schema bundle, emit a manifest digest over (schemas, traits, README, deps) and record it in a consumer-side lockfile. Pre-cursor to a SLSA story without waiting on Sigstore.
  - **Three-tier plugin source model** (local binary / remote / built-in). Cap'n Proto built-in already exists; we add local-binary now and remote-fetched later.
- **Skip:**
  - Buf the IDL (we're capnp).
  - BSR-as-a-service for us (premature — we don't have multiple external consumers yet; revisit when ≥ 3 external repos consume our schemas).
  - ConnectRPC (different stack; not a substrate-IDL concern).
  - Identity / supply-chain claims — Buf is out-of-scope on those axes; evaluate SPIFFE / Macaroons / SLSA for those.

## Action items

- [ ] File bead: "schema-bridge: `diff --against <ref>` subcommand with Git-grammar input parsing." Depends on the corresponding Smithy-derived bead (deduplicate before filing).
- [ ] File bead: "schema-bridge: declare FILE / PACKAGE / WIRE break-rule categories for capnp schemas; default to FILE."
- [ ] File bead: "schema-bridge: introduce `schema-bridge.gen.yaml` with plugin entries; refactor existing zod codegen to register as the first plugin."
- [ ] File bead: "substrate registry: emit content-addressed manifest digest on publish; record in a lockfile consumers can pin." Lower priority — wait until we have ≥ 2 external consumers.
- [ ] File bead (research): "confirm Buf supply-chain story" — verify whether BSR signs commits via Sigstore / cosign; refresh this entry's Axis 6 with the answer. Resolves Open Question 1.

## Cross-references

- Related prior-art entries: [smithy](smithy.md) (Axis 2 trait propagation is what Buf does *not* have; Axis 3/4 borrows from Buf reinforce Smithy's Axis 3/4 borrows)
- Related beads (existing): `cloister-aea8a7` (extend schema-bridge coverage), `cloister-9ea507` (const support gap), `cloister-9f54d6` (schema-bridge construct gaps), `cloister-1b59a2` (substrate-as-kernel framing)
- Related ADRs: cloister ADR-0022 (schema-bridge positioning), cloister ADR-0024 (credential-isolation/v1)
