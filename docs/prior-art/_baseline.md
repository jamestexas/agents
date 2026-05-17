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
- **signet** — Go, identity and auth; consumer of @notme/contract conceptually.
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

- **Position:** **Interlace lease** — macaroon-shaped capability token. Cryptographically bound caveats. Vendor-neutral spec at `interlace-spec/0.1.0/`. Workload identity emerging (cloister identifies workloads via per-bundle keys + manifests; notme issues identity assertions).
- **Evidence:** `interlace-spec/0.1.0/` (spec); `cloister/src/routes/lease-middleware.ts` (verification); `cloister-spec/credential-isolation/v1/` (consumer).
- **Note:** Shape strongly resembles SPIFFE workload identity + Macaroons hybrid. Not consciously modeled after either; convergent evolution.

## Axis 6 — Supply-chain story

- **Position:** **None.** No signing, no SBOM, no SLSA provenance, no Sigstore, no Rekor. Releases are tagged git commits. Consumer trust is "you cloned the right repo."
- **Evidence:** Search of `cloister/.github/workflows/*.yml`, `cloister/Taskfile.yml` — no cosign / SLSA / SBOM generation steps.
- **Gap:** Everything. This is the most underdeveloped axis.

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
