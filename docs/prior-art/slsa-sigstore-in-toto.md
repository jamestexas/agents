<!--
slsa-sigstore-in-toto.md — prior-art entry for the modern supply-chain
triplet (SLSA + Sigstore + in-toto). Treated as ONE entry because they
compose into the end-to-end answer to "sign, attest, log, verify."

Drafted by prior-art-cartographer (claude-opus-4-7) on 2026-05-18 against
docs/prior-art/_baseline.md. Every factual claim is pinned to a URL in
"Sources cited", or marked [unverified].
-->

# Prior art — SLSA + Sigstore + in-toto

> **Canonical URLs:**
> - SLSA: <https://slsa.dev>
> - Sigstore: <https://www.sigstore.dev>
> - in-toto: <https://in-toto.io>
> **License + governance:** SLSA is an OpenSSF project (Linux Foundation); Sigstore is an OpenSSF project (cosign, Fulcio, Rekor — Apache-2.0); in-toto is a CNCF graduated project. All open-source, OpenSSF-coordinated.
> **Evaluated:** 2026-05-18 by `prior-art-cartographer` (Opus 4.7)
> **Refresh after:** 2026-11-18

## TL;DR

The modern supply-chain stack treated as one entry because it only works composed: **in-toto** is the attestation envelope format, **SLSA** is the predicate vocabulary for build provenance with graduated levels, and **Sigstore** (cosign + Fulcio + Rekor) is the keyless-signing + transparency-log substrate that signs the attestations and witnesses the signing event. signet already ships the Fulcio-shape primitive (OIDC→X.509 cert minting at `auth.notme.bot`) and a cosign-compatible bridge (`cmd/sigstore-kms-signet`); the gap is the predicate layer above (SLSA provenance, in-toto Statements) and wiring it all into a release workflow.

## Sources cited in this entry

- <https://slsa.dev/> — SLSA landing page (accessed 2026-05-18)
- <https://slsa.dev/spec/v1.0/about> — SLSA v1.0 design philosophy, tracks, scope (accessed 2026-05-18)
- <https://slsa.dev/spec/v1.0/levels> — SLSA Build L1/L2/L3 requirements (accessed 2026-05-18)
- <https://slsa.dev/spec/v1.0/provenance> — SLSA provenance predicate format (accessed 2026-05-18)
- <https://docs.sigstore.dev/cosign/signing/overview/> — cosign keyless signing flow (accessed 2026-05-18)
- <https://docs.sigstore.dev/quickstart/quickstart-cosign/> — cosign quickstart commands (accessed 2026-05-18)
- <https://docs.sigstore.dev/certificate_authority/overview/> — Fulcio CA overview, 10-min cert lifetime (accessed 2026-05-18)
- <https://docs.sigstore.dev/logging/overview/> — Rekor transparency log overview (accessed 2026-05-18)
- <https://github.com/in-toto/attestation/blob/main/spec/README.md> — in-toto attestation framework: Predicate / Statement / Envelope / Bundle layers (accessed 2026-05-18)
- <https://in-toto.io/docs/specs/> — in-toto specifications index (accessed 2026-05-18)

> **Citation rule:** every claim below traces to one of the URLs above or to a fetched signet/cloister source file. Where the fetched docs page didn't enumerate a detail (e.g. exact Fulcio OIDC binding mechanism), the claim is suffixed `[unverified]` and listed in Open Questions.

---

## Axis 1 — IDL shape

- **Position:** **in-toto provides the attestation IDL.** A statement has four layers: **Predicate** (typed metadata, e.g. SLSA provenance), **Statement** (binds predicate to a subject artifact, declares `predicateType`), **Envelope** (DSSE — Dead Simple Signing Envelope, for authentication+serialization), **Bundle** (groups multiple attestations). SLSA defines one predicate type (`https://slsa.dev/provenance/v1`). Sigstore doesn't add to the IDL — it provides the signing infrastructure that produces signed DSSE envelopes.
- **Evidence:** in-toto's four layers: Predicate "Contains arbitrary metadata about a subject artifact, with a type-specific schema"; Statement "Binds the attestation to a particular subject and unambiguously identifies the types of the predicate"; Envelope "Manages authentication and how the attestation is serialized for transmission"; Bundle "Enables grouping multiple attestations together" (in-toto/attestation spec README, accessed 2026-05-18). SLSA "defines the following predicate type within the [in-toto attestation](https://github.com/in-toto/attestation) framework" with the predicate type `https://slsa.dev/provenance/v1` (slsa.dev/spec/v1.0/provenance, accessed 2026-05-18).
- **Comparison to us:** We have no attestation IDL. Capnp could host one — an `attestation.capnp` with `Statement`, `Predicate`, `Envelope` structs — but today there's nothing. The in-toto layers map cleanly onto capnp shapes; the predicate-type-as-URI pattern is a natural fit for our `interlace-spec/<version>/` naming.
- **Adopt / Borrow / Skip:** **Borrow.** Define a capnp shape for in-toto Statement + DSSE Envelope; let any of our tools (cloister, notme, mache) emit and verify them. Cosign/in-toto already use JSON DSSE — keeping wire-compat with that ecosystem means we don't need to invent. Cost: ~1 week for shapes + parsing.

## Axis 2 — Annotation / trait model

- **Position:** **Predicate types are the annotation vocabulary.** Each predicate type is a URI (`https://slsa.dev/provenance/v1`, `https://in-toto.io/Statement/v1`, custom org-specific types). The type identifies the schema; the predicate body is whatever JSON the schema allows. There's no inheritance / composition story — types are flat URIs.
- **Evidence:** "The exact predicate type string is `https://slsa.dev/provenance/v1`. Always use the above string for `predicateType` rather than what is in the URL bar" (slsa.dev/spec/v1.0/provenance, accessed 2026-05-18). The Statement layer "unambiguously identifies the types of the predicate" (in-toto/attestation spec README, accessed 2026-05-18).
- **Comparison to us:** Smithy's typed-trait propagation (`smithy.md` Axis 2) and Cap'n Proto annotations are both *richer* than the in-toto predicate-type URI — but in-toto's flat-URI model is *more interoperable* across ecosystems. We could borrow both: capnp annotations for in-repo schema metadata; predicate-type URIs for cross-ecosystem attestations we emit.
- **Adopt / Borrow / Skip:** **Borrow.** When we eventually emit attestations, use predicate-type URIs that match the established ecosystem (`https://slsa.dev/provenance/v1`) and reserve our own URI namespace for custom predicates (e.g. `https://notme.bot/predicates/agent-provenance/v1` — note signet already has APAS at `docs/apas/agent-provenance-standard.md` which is exactly this shape, `[unverified]` on it being formally registered as a predicate type).

## Axis 3 — Versioning + breaking-change detection

- **Position:** **Versioning is per-spec, semver-shaped, no automated diff.** SLSA versions its spec (v0.1 → v1.0 with track restructuring); in-toto versions attestation framework independently from in-toto spec (both at "Stable v1.0" today). Predicate types carry the version in the URI (`/v1`). There's no `slsa diff` tool or `in-toto-diff` — breaking changes are surfaced in release notes.
- **Evidence:** "in-toto Stable (v1.0)" and "in-toto Attestation Framework Stable (v1.0)" listed as separate specs (in-toto.io/docs/specs/, accessed 2026-05-18). SLSA v1.0 includes a "What's new in SLSA v1.0" page (linked from slsa.dev/spec/v1.0/, accessed 2026-05-18); v1.0 introduced "tracks" as a design restructure from v0.1 (slsa.dev/spec/v1.0/about, accessed 2026-05-18).
- **Comparison to us:** Same gap on both sides — we version per-directory, they version per-spec; neither has tooling. Buf's `--against` is still the model to borrow for *our* schemas (`buf.md` Axis 3); this triplet doesn't add a new pattern.
- **Adopt / Borrow / Skip:** **Skip** — this triplet doesn't add anything Buf's pattern doesn't already cover.

## Axis 4 — Codegen targets + plugin model

- **Position:** **Out of scope for the triplet itself; SLSA/in-toto attestation generators exist as build-system integrations.** GitHub Actions has a `slsa-github-generator` family of reusable workflows that emit SLSA provenance for various languages `[unverified]` (referenced in OpenSSF press release fetched via WebSearch result, not directly fetched). cosign is a single CLI binary, not a codegen tool.
- **Evidence:** No codegen / plugin discussion on the fetched canonical pages (slsa.dev landing, slsa.dev/spec/v1.0/about, sigstore docs cosign overview, in-toto spec README). Build-system integrations are downstream of the spec — they're build-platform features, not framework features.
- **Comparison to us:** Different layer. Codegen is a schema-bridge concern (`buf.md` Axis 4, `smithy.md` Axis 4).
- **Adopt / Borrow / Skip:** **Skip** for the triplet. Sigstore's "single CLI binary, hello-world is one command" *shape* is worth aspiring to for signet/cloister CLIs (see Axis 7).

## Axis 5 — Identity / capability model

- **Position:** **Sigstore IS a workload/human-identity model for signing.** Fulcio mints **10-minute X.509 certificates** bound to an OIDC identity (email address from Google/GitHub/Microsoft IDP). Cosign generates an ephemeral keypair, gets a Fulcio cert, signs the artifact, destroys the private key, and uploads the (signature, public key, artifact hash) tuple to Rekor — the transparency log "witnesses the signing event." Verifiers replay the same tuple against Rekor's inclusion proof + Fulcio's CT log. No long-lived private keys. **SLSA and in-toto are silent on identity** — they specify what to attest, not who signs.
- **Evidence:** "Fulcio is a free code signing Certificate Authority, built to make short-lived certificates available to anyone" and "Fulcio signs X.509 certificates valid for 10 minutes" (docs.sigstore.dev/certificate_authority/overview/, accessed 2026-05-18). cosign keyless flow: "An in-memory public/private keypair is generated temporarily. Users authenticate via OIDC providers (Google, GitHub, Microsoft), and Fulcio's certificate authority verifies the identity token, issuing a short-lived certificate that binds the ephemeral key to the user's identity. ... The private key is destroyed shortly after and the short-lived identity certificate expires" (docs.sigstore.dev/cosign/signing/overview/, accessed 2026-05-18). Rekor "provide[s] an immutable, tamper-resistant ledger of metadata generated within a software project's supply chain" with append-only structure and inclusion proofs (docs.sigstore.dev/logging/overview/, accessed 2026-05-18).
- **Comparison to us:** **This is exactly signet.**
  - **Fulcio equivalent — we have this.** signet's `signet authority` server (`cmd/signet/authority.go`) and the hosted `auth.notme.bot` mint short-lived X.509 certs from OIDC tokens (`signet/README.md` §4 "OIDC Identity Bridge"). Cert lifetime is 5 minutes (signet) vs 10 minutes (Fulcio); both bind OIDC identity to an ephemeral keypair.
  - **GHA OIDC ambient identity — we have this.** signet exchanges GHA OIDC tokens at `auth.notme.bot/cert/gha` for a bridge cert (`signet/README.md` §6 "GHA OIDC Signing (CI/CD)") — same pattern Sigstore uses for keyless CI signing.
  - **cosign compatibility — we have this.** `cmd/sigstore-kms-signet/` exposes signet keys via the cosign KMS protocol, so `cosign sign-blob --key signet://default` works today (`signet/docs/sigstore-integration.md`, referenced from `signet/README.md` §"Sigstore KMS Plugin").
  - **Rekor transparency log — we DON'T have this.** The signet docs example uses `--tlog-upload=false` (`signet/README.md` §"Sigstore KMS Plugin" example) — telling. signet has no equivalent of an immutable inclusion-proof log; nothing is "witnessed."
- **Adopt / Borrow / Skip:** **Borrow Rekor's role. Don't replicate Fulcio (we have it).** Specifically:
  1. **Use Sigstore's Rekor (the public-good instance) for signet-signed artifacts.** Set `--tlog-upload=true` on the documented cosign-via-signet flow. Cost: zero — Rekor is operated as a public good. This is the single cheapest move on this entry.
  2. **Recognize that signet IS the Fulcio-shape primitive for our ecosystem.** Document the equivalence explicitly so anyone coming from Sigstore can map: `auth.notme.bot` ↔ Fulcio; signet ephemeral cert ↔ Fulcio cert; GHA OIDC bridge ↔ Sigstore's keyless CI flow.

## Axis 6 — Supply-chain story

- **Position:** **This triplet IS the canonical supply-chain story.** SLSA defines what to attest (provenance: `buildDefinition` with `buildType` + `externalParameters`; `runDetails` with `builder` ID); in-toto wraps it in a Statement and a DSSE envelope; cosign signs the envelope and uploads to Rekor. SLSA Build L1 = "provenance exists, may be unsigned and easy to forge"; L2 = "build platform runs on dedicated infrastructure ... provenance is tied to that infrastructure through a digital signature"; L3 = "build platform implements strong controls to prevent runs from influencing one another ... prevent secret material used to sign the provenance from being accessible to the user-defined build steps."
- **Evidence:** SLSA L1: "Provenance exists describing how the artifact was built, including the build platform, build process, and top-level inputs." L2: "Build platform runs on dedicated infrastructure, not an individual's workstation, and the provenance is tied to that infrastructure through a digital signature." L3: "Build platform implements strong controls to prevent runs from influencing one another" and "prevent secret material used to sign the provenance from being accessible to the user-defined build steps" (slsa.dev/spec/v1.0/levels, accessed 2026-05-18). Provenance predicate fields: `buildDefinition` + `runDetails`; required `buildType`, `externalParameters`, `builder.id` (slsa.dev/spec/v1.0/provenance, accessed 2026-05-18).
- **Comparison to us:** Baseline Axis 6: "Mixed — signing plumbing exists but isn't wired into releases yet." Concretely:
  - **Primitives we have:** `cmd/sigstore-kms-signet/` (cosign bridge), `auth.notme.bot/cert/gha` (OIDC bridge for CI), Ed25519 + ML-DSA-44 algorithm registry (`pkg/crypto/algorithm/`), 5-minute ephemeral certs (`pkg/attest/x509/`).
  - **Missing wiring:** No GHA workflow in cloister/mache/rosary/notme calls `cosign sign-blob` on release artifacts. No SLSA provenance emitted (no `slsa-github-generator` or equivalent). No in-toto Statements written. No Rekor uploads. No SBOM (CycloneDX/SPDX).
  - **Gap is the connection, not the parts.** Per `_baseline.md` Axis 6: "Primitives ... are sitting there unused. Wiring them into a release workflow + producing SLSA L1/L2 provenance + opting into Rekor would close most of the axis quickly."
- **Adopt / Borrow / Skip:** **Adopt the SLSA predicate schema + in-toto Statement envelope wholesale; borrow Rekor for free; use signet (not Fulcio) as the signing identity.** Specifically:
  1. **Wire `cosign sign-blob --key signet://default --tlog-upload=true` into release workflows for cloister, mache, rosary, notme.** ~1 day per repo to add the GHA step.
  2. **Emit SLSA provenance v1 predicates** for releases. Use the existing `slsa-github-generator` reusable workflow `[unverified — referenced in OpenSSF announcement, not directly fetched]` or write a minimal generator that emits the predicate from GHA context. Reach Build L1 immediately; L2 follows from "the build is on GHA's infrastructure, signed via signet" — that's the L2 requirement met.
  3. **Wrap provenance in an in-toto Statement + DSSE envelope; sign with signet via cosign; upload to Rekor.** End-to-end "signed, attested, logged, verifiable" release flow.
  4. **L3 is deferred.** Requires hardened build isolation (prevent runs from influencing each other, isolate signing material from user-defined steps). GHA reusable workflows partly satisfy this; full L3 is a meaningful infrastructure investment.

## Axis 7 — Adoption cost

- **Position:** **S for hello-world; M for full L2 release wiring; L for L3.** cosign quickstart: `cosign sign-blob <file> --bundle artifact.sigstore.json` and `cosign verify-blob file.txt --bundle artifact.sigstore.json --certificate-identity=name@example.com --certificate-oidc-issuer=https://accounts.example.com` (docs.sigstore.dev/quickstart/quickstart-cosign/, accessed 2026-05-18). SLSA L1: just emit provenance, any format. L2: provenance signed by hosted builder — meeting this on GHA is "use a reusable workflow." L3: hardened isolation, weeks to months of infra work.
- **Evidence:** Quickstart commands above are the literal hello-world. SLSA "tampering resistance" descriptions: L1 "minimal," L2 "prevents tampering after the build through digital signatures," L3 "prevents tampering during the build" (slsa.dev/spec/v1.0/levels, accessed 2026-05-18).
- **Comparison to us:** Baseline Axis 6 — we're at zero. Reaching L1 + signed-blob + Rekor across our repos is "add one GHA step per repo." Reaching L2 is "use signet's existing GHA OIDC bridge to sign the provenance" — which we *already built*. Reaching L3 requires real infra investment we don't have today.
- **Adopt / Borrow / Skip:** **Adopt** — the cost-to-impact ratio is the best on the prior-art board. Most of the primitives are built and unused.

---

## Cross-cutting

| Field | Value |
|---|---|
| Adoption cost (S / M / L) | **S** for L1+sign+Rekor wiring (primitives exist); **M** for L2 (use signet's GHA OIDC bridge consistently); **L** for L3 (hardened builder isolation) |
| Maintenance burden if adopted (patterns) | Low — the heavy lifting is upstream (Sigstore operates Rekor + Fulcio; SLSA + in-toto specs are stable). Our burden is a GHA step per repo + a generator for SLSA predicates. |
| Risk if we adopt | Low — we'd be aligning with the de-facto ecosystem. The only meaningful risk is *Rekor* being public — any artifact we sign is publicly indexed by identity. Acceptable for open-source releases; bad for private artifacts. |
| Risk if we do NOT adopt | High — without provenance + signing, our releases are unauditable; any downstream consumer can't verify what they're consuming. signet's whole "Inspired by Sigstore" framing (`signet/README.md` Acknowledgments) loses credibility if we don't actually produce signed releases. |
| Open questions | (1) Does `slsa-github-generator` (the reusable workflow family) work with arbitrary KMS backends, or is it Fulcio-only? `[unverified]` — needs a test invocation with signet. (2) APAS (signet's "Agent Provenance Standard") — should it be registered as an in-toto predicate type at `https://notme.bot/predicates/apas/v1`? `[unverified]` on whether APAS is formally specified yet. (3) Should we run a *private* Rekor instance for non-public artifacts, or is the public Rekor sufficient for everything? Operational complexity vs. confidentiality tradeoff. |

## Decision

- **Adopt:**
  - **SLSA v1.0 Build Track L1 across all release-producing repos** (cloister, mache, rosary, notme, signet itself). Emit the SLSA provenance predicate (`https://slsa.dev/provenance/v1`) on every release artifact.
  - **in-toto Statement + DSSE envelope as the wrapper.** Don't reinvent — use the established JSON wire format so cosign/sigstore tooling can verify our attestations.
  - **Rekor (public) for transparency log.** Set `--tlog-upload=true` on cosign-via-signet (signet's documented example uses `false`; flip it for real releases).
- **Borrow:**
  - **The Sigstore identity model as documentation framing.** signet IS this model for our ecosystem; document the mapping explicitly (`auth.notme.bot` ↔ Fulcio; signet 5-min cert ↔ Fulcio 10-min cert; GHA OIDC bridge ↔ Sigstore keyless CI).
  - **Predicate-type-URI vocabulary.** When we emit custom attestations (e.g. lease issuance events, APAS records), use `https://notme.bot/predicates/<name>/v<n>` URIs as predicate types — interoperable with the in-toto framework.
  - **The "hello-world is one command" shape.** signet/cloister CLIs should aspire to cosign's two-line quickstart: one command to sign, one to verify, no config files for the basic case.
- **Skip:**
  - **Replacing signet with Fulcio.** We already have the OIDC→X.509 primitive at `auth.notme.bot`; Fulcio adds nothing we don't have, and switching loses signet's algorithm agility (Ed25519 + ML-DSA-44 post-quantum, which Fulcio doesn't support `[unverified]`).
  - **SLSA Build L3 in the near term.** Real cost; defer until we have actual high-value artifacts and a real threat model that requires it.
  - **Private Rekor instance.** Operational complexity not yet justified.

## Action items

- [ ] File bead (signet): "flip `--tlog-upload=true` in the documented `cosign sign-blob --key signet://default` example; document the implications." Owner: signet. ~1 day.
- [ ] File bead (cloister): "add `release.yml` GHA workflow: build, sign artifact via `cosign sign-blob --key signet://gha-bridge`, emit SLSA provenance predicate, upload to Rekor." Owner: cloister. ~1 day to write, ~3 days to validate end-to-end.
- [ ] File bead (mache, rosary, notme — one bead each): "adopt the cloister release-signing pattern." Owner: per-repo. ~1 day each.
- [ ] File bead (research): "evaluate `slsa-github-generator` reusable workflows with signet as the signing backend; if compatible, use it. If not, write a minimal `signet-slsa-generator` that emits the predicate from GHA context." Owner: signet. ~3-5 days research + decision.
- [ ] File bead (signet): "doc page: 'signet for Sigstore users' — side-by-side mapping table." Owner: signet/docs. ~2 days.
- [ ] File bead (notme/APAS): "evaluate registering APAS as an in-toto predicate type at `https://notme.bot/predicates/apas/v1`; coordinate with in-toto community-process if appropriate." Owner: notme. Deferred — depends on APAS being formally specified.
- [ ] File bead (research): "decide whether `cmd/sigstore-kms-signet` needs the ML-DSA-44 algorithm exposed to cosign; check if cosign verifies non-Ed25519 KMS-backed signatures." `[unverified]`. Owner: signet. ~2 days.

## Cross-references

- Related prior-art entries: [spiffe](spiffe.md) (the workload-identity layer this triplet sits on top of for service-to-service auth; signet covers both axes), [macaroons](macaroons.md) (interlace lease = runtime capability layer; orthogonal to release-artifact signing), [buf](buf.md) (Buf's content-addressed BSR commits are a smaller version of "sign + log + verify" for schemas).
- Related beads (existing): signet GHA OIDC bridge beads; signet `cmd/sigstore-kms-signet/` beads; cloister `cloister-1b59a2` (substrate-as-kernel framing).
- Related ADRs: signet ADR-011 (trust policy bundles); signet `docs/design/006-revocation.md`; cloister ADR-0022 (schema-bridge positioning), ADR-0024 (credential-isolation/v1).
- Related docs: `signet/docs/sigstore-integration.md`; `signet/docs/apas/agent-provenance-standard.md` (APAS — candidate in-toto predicate type).
