<!--
_baseline.md — "us" filled into the same 7-axis shape as every prior-art
entry. The leading underscore makes it sort first in the directory.

This is the anchor every comparison runs against. Keep it up to date as
the substrate evolves; an entry written against a stale baseline produces
a stale recommendation.

Last refreshed: 2026-05-17.
-->

# Baseline — art-substrate (us)

> **Canonical URL:** internal — multi-repo ecosystem (see "Implementations" below)
> **License + governance:** mixed (Apache-2.0 / MIT) — solo-maintained as of 2026-05-17
> **Last refreshed:** 2026-05-17

## TL;DR

Annotated Cap'n Proto schemas, hand-rolled per-capability spec directories, a Rust-based capnp→zod compiler (`schema-bridge`), and an emerging "substrate IDL" framing that hasn't been formalized yet. Workload identity is interlace-lease (macaroon-shaped). Multi-repo with no release-coordination substrate.

## Implementations

- **cloister** — TS+Rust workerd-based hypervisor; primary host of capability specs (`cloister-spec/<cap>/v<n>/`).
- **notme** — Cap'n Proto schemas, CF Worker, ships `@notme/contract` shared TS vocabulary (SCOPES, ERROR_STATUS, etc.).
- **signet** — Go, layer-1 of a three-layer identity stack: *"do you have the key?"* PoP authentication. Ships SPIRE-model CA bundle rotation (HTTP middleware, `pkg/http/middleware`), Fulcio-style OIDC→X.509 cert minting (`auth.notme.bot`), macaroon-shaped HTTP request proofs (master→ephemeral→request chain), and a Sigstore KMS plugin (`cmd/sigstore-kms-signet`) so signet keys work natively with cosign/gitsign. Supports Ed25519 + ML-DSA-44 post-quantum, OpenSSL-compatible CMS/PKCS#7 via `go-cms`. Zero-secret GHA via ambient OIDC. Also contains `pkg/policy/` (trust policy bundles, called "sigpol" colloquially in signet CLAUDE.md — bundle/checker/compiler with 37 tests, the policy-language adjacent layer).
- **sigid** — Go, layer-2 of the identity stack: *"who are you, how did you get here?"* Identity Context Provider that extracts provenance/environment/boundary claims from signet tokens for capability-based authorization. Reserved CBOR fields 20-23 on signet tokens; 4-entity model (Owner/Machine/Actor/Identity); HMAC-SHA256 ppids (privacy-preserving pseudonymous identifiers). Pluggable `AttestationProvider` interface with planned SPIRE / TPM / Sigstore providers. Offline-first; legacy signet tokens still work via fallback. Performance budget: <10ms total per request. Capability protocol consumes its output.
- **mache** — Go code-intelligence; uses tree-sitter + capnp binding logs.
- **ley-line-open** — Rust data-plane primitives; includes capnp schemas.
- **schema-bridge** — Rust tool (lives in `cloister/tools/schema-bridge`); compiles capnp → zod.

---

## Axis 1 — IDL shape

- **Position:** Cap'n Proto schemas (`.capnp`). Mature, structurally typed, supports nested structs, unions, enums, generics, interfaces (RPC), top-level consts, and annotations. We currently use a subset.
- **Evidence:** `cloister/cluster.capnp`, `notme/packages/contract/*.capnp` (planned), `interlace-spec/0.1.0/`.
- **What we don't use:** generics, anyPointer, anonymous inline unions, $Json annotations, non-union groups. Schema-bridge errors out on these (intentional — fail-fast on unmapped constructs).

## Axis 2 — Annotation / trait model

- **Position:** Cap'n Proto supports `$annotation` declarations and `$Annot()` usage on fields/structs. We use a handful informally — no canonical trait library, no propagation through codegen.
- **Evidence:** Cap'n Proto `$annotation` is in the spec but our usage is *ad hoc* — not gathered, named, or documented as a "trait" framework.
- **Gap:** No shared trait vocabulary across capabilities. Decorations like "this field is sensitive," "this scope grants this capability," or "this struct is the wire envelope" are commented in markdown, not encoded in the schema.

## Axis 3 — Versioning + breaking-change detection

- **Position:** Per-directory versioning — `interlace-spec/0.1.0/`, `cloister-spec/credential-isolation/v1/`. Semver-shaped at the directory level. No automated breaking-change detection. No CI that diffs schema versions.
- **Evidence:** `cloister-spec/credential-isolation/v1/README.md` (Status: Draft). No `v2` exists yet for anything.
- **Gap:** Manual review for what counts as breaking. No tooling enforces "adding a required field is breaking" etc. If two consumers pin different versions, no automated compatibility test.

## Axis 4 — Codegen targets + plugin model

- **Position:** One direction (capnp → zod TS), one consumer (cloister). Hand-written Rust transformer. No plugin system; targets are wired in.
- **Evidence:** `cloister/tools/schema-bridge/README.md`. Beads `cloister-aea8a7` (extend coverage to more capnp files), `cloister-9ea507` (top-level const support gap), `cloister-9f54d6` (full coverage meta-bead).
- **Gap:** No Rust target, no Go target, no JSON Schema target, no OpenAPI target, no TOML config target. Const types, interface (RPC), generics, and annotations all unmapped today.

## Axis 5 — Identity / capability model

- **Position:** A **three-layer working stack**, deliberately layered (per `sigid/CLAUDE.md` architecture diagram), not just one big credential blob.

  | Layer | Question it answers | Where it lives |
  |---|---|---|
  | **1. Authentication** | *"Do you have the key?"* | `signet` — PoP auth, ephemeral X.509, SPIRE-model CA rotation, Fulcio-shape OIDC→cert bridge, macaroon-shape `master→ephemeral→request` HTTP proofs |
  | **2. Identity context** | *"Who are you, how did you get here?"* | `sigid` — extracts provenance (actor/delegator chains, ppids), environment (cluster/image/TPM attestations), boundary (VPC/region/domain) from signet tokens. CBOR fields 20-23. 4-entity model: Owner/Machine/Actor/Identity. Pluggable `AttestationProvider` with planned SPIRE / TPM / Sigstore providers. |
  | **3. Authorization / capabilities** | *"What can you do?"* | `cloister-spec/credential-isolation/v1/` + interlace lease — macaroon-shaped capability tokens with cryptographically bound caveats; vendor-neutral spec at `interlace-spec/0.1.0/`; enforced in `cloister/src/routes/lease-middleware.ts`. |

  Plus a **policy layer** alongside: `signet/pkg/policy/` — trust policy bundles with a bundle/checker/compiler (37 tests; the policy-language adjacent surface).

- **Evidence:** `sigid/CLAUDE.md` (architecture diagram); `sigid/context.go`, `sigid/identity.go`, `sigid/provider.go` (Context/Provenance/Environment/Boundary types + ContextProvider/AttestationProvider/BoundaryValidator interfaces); `signet/pkg/http/middleware/README.md`; `signet/cmd/signet/authority.go`; `signet/README.md` §3/§4/§6; `signet/pkg/policy/{bundle,checker,compiler,golden_path}_test.go`; `interlace-spec/0.1.0/`; `cloister/src/routes/lease-middleware.ts`.

- **Note:** signet is consciously SPIRE-shaped (CA rotation, eventual SPIRE attestation provider) and Fulcio-shaped (OIDC cert minting). sigid is the layer SPIRE doesn't really cover — *making identity claims structured and pluggable*, not just attested. The macaroon resemblance in interlace lease is convergent design. The four pieces interlock: signet establishes workload identity → sigid extracts context from that identity → sigpol policy decides if context permits the action → interlace lease + cloister enforce capability on the call.

- **Gap / planned:** sigid's environment + boundary providers are stubbed (`providers/basic/provider.go:108-128`); HMAC-SHA256 ppid derivation is TODO; SPIRE/TPM/Sigstore attestation providers are planned but not shipped.

## Axis 6 — Supply-chain story

- **Position:** Mixed — signing plumbing exists but isn't wired into releases yet.
  - **What works:** signet ships a `sigstore-kms-signet` plugin so Signet keys are usable from cosign/gitsign for blob/artifact signing today. The `cosign sign-blob --key signet://default ...` flow is the working surface (see `signet/docs/sigstore-integration.md`).
  - **What works:** GHA OIDC bridge cert minting at `auth.notme.bot/cert/gha` — repos can sign in CI without secrets, using ambient identity. Reusable workflow at `agentic-research/notme/.github/workflows/gha-identity.yml@main`.
  - **What's missing:** Nothing in the ART substrate releases is *currently* signed. No SBOMs (no CycloneDX or SPDX generation in any repo's CI). No SLSA provenance. No Rekor transparency-log entries (`tlog-upload=false` in signet's docs example — telling). No signed release manifests for the eventual `art-substrate` aggregator.
- **Evidence:** `signet/README.md` §6 (GHA OIDC), §Sigstore KMS Plugin; `signet/cmd/sigstore-kms-signet/`; grep of `.github/workflows/*.yml` across cloister/mache/rosary/notme — no cosign / SLSA / SBOM steps.
- **Gap:** The *connection*, not the primitives. Primitives (cosign-via-signet, OIDC-cert via notme) are sitting there unused. Wiring them into a release workflow + producing SLSA L1/L2 provenance + opting into Rekor would close most of the axis quickly.

## Axis 7 — Adoption cost (for an external consumer)

- **Position:** **High.** No published packages, no documented "how to depend on this," no schema registry, no installable tooling. A consumer wanting to use `interlace-spec/0.1.0` has to clone the cloister repo, copy the capnp files, and write their own codegen.
- **Evidence:** Absence of `package.json` publish steps; absence of crates.io publication for schema-bridge; absence of any "for external consumers" docs.
- **Note:** The `notme` repo *partially* publishes `@notme/contract` as TS — but its capnp side is byte-mirrored manually, not registered anywhere.

---

## Cross-cutting

| Field | Value |
|---|---|
| Adoption cost (for others) | **L** — everything is custom, undocumented, unpublished. |
| Maintenance burden (current) | **Medium** — hand-rolled tooling, but small surface area today. Will grow. |
| Risk if we do nothing | High — every new capability re-invents the spec layout; cross-repo coordination is manual. |
| Risk of premature standardization | Medium — locking in a custom IDL now without learning from giants. |
| Open questions | What's the right name for the substrate-IDL framing? What's the canonical home for the schemas (cloister? art-substrate? per-capability repo)? When do we publish for external consumers? |

## What we want from prior-art evaluation

For each external giant, answer:

1. Does it solve any of Axes 1–7 better than we do today?
2. Is there a concrete pattern (trait propagation, breaking-change detection rule, codegen plugin shape, attestation envelope, etc.) we can lift?
3. What does it solve that we hadn't realized was a problem?
4. What does it explicitly reject that we should reconsider?
5. Adoption cost: would lifting one pattern cost us a week? a quarter? a year? infinity?

## Cross-references

- ADR-0024 (cloister) — credential-isolation/v1 capability
- ADR-0022 (cloister) — schema-bridge positioning
- Beads: `cloister-ae587d`, `cloister-ae06f3`, `cloister-9ea507`, `cloister-9f54d6`, `cloister-1b59a2` (substrate-as-kernel framing)
