# Prior art — comparison matrix

Where we put structured comparisons between art-substrate (our stack) and external systems that solve adjacent problems. Every entry follows [TEMPLATE.md](TEMPLATE.md) so the matrix below can be read at a glance.

The agent that produces entries is [`prior-art-cartographer`](../../agents/prior-art-cartographer.md). It refuses to write claims without citing primary sources, and refuses to compare more than 5 systems in one pass.

## How to read this directory

| File | Purpose |
|---|---|
| `TEMPLATE.md` | Blank shape every entry fills in. Edit only to evolve the rubric. |
| `_baseline.md` | "Us" — art-substrate's current state in the same shape. Refresh as substrate evolves. |
| `<project-name>.md` | One filled-in comparison per external project. |
| `README.md` (this file) | Aggregator. Don't edit by hand — regenerated when entries land. |

## What we're comparing on

Seven axes (full definitions in [TEMPLATE.md](TEMPLATE.md)):

1. **IDL shape** — what schemas express
2. **Annotation / trait model** — semantic decoration of shapes
3. **Versioning + breaking-change detection** — automated diffs, semver
4. **Codegen targets + plugin model** — multi-target output, extensibility
5. **Identity / capability model** — bearer / object-cap / macaroon / none
6. **Supply-chain story** — signing, provenance, SBOM
7. **Adoption cost** — hello-world complexity, migration cost, ecosystem maturity

## Cross-cutting matrix

> One row per axis. One column per entry + a final "Us" column. Each cell is a *short verdict*, not analysis. Click through to the entry's page for evidence and rationale.

| Axis | [Smithy](smithy.md) | [Buf](buf.md) | [SPIFFE](spiffe.md) | [Macaroons](macaroons.md) | [Nixpkgs](nixpkgs.md) `[planned]` | [SLSA+Sigstore+in-toto](slsa-sigstore-in-toto.md) | [Backstage](backstage.md) `[planned]` | **Us** ([baseline](_baseline.md)) |
|---|---|---|---|---|---|---|---|---|
| 1. IDL shape | `.smithy` IDL, services + shapes | protobuf only; operates over `.proto` | SPIFFE ID URI + SVID formats | credential format, not IDL | nix expressions | in-toto Statement + DSSE envelope | YAML templates | capnp |
| 2. Annotation / trait model | **rich** — typed traits, custom-declarable, propagate through codegen | inherits protobuf custom options; no Buf trait library | none — SVIDs are leaves | caveats as application-defined predicates | n/a | predicate-type URIs (flat, interoperable) | template parameters | informal capnp `$annotation` |
| 3. Versioning + breaking-change | `smithy diff` + projections | `buf breaking --against`; FILE/PACKAGE/WIRE tiers | bundle `spiffe_sequence` rotation | n/a | nixpkgs channels | per-spec semver, no diff tool | template versions | per-dir, no automation |
| 4. Codegen targets + plugin model | plugin-driven; Java/Kotlin/TS/Python/OpenAPI | `buf.gen.yaml`; remote/local/builtin plugins | reference SDKs + attestor plugins (SPIRE) | n/a | n/a | out of scope (build-system integrations) | scaffold-time only | single-target (zod), hardcoded |
| 5. Identity / capability model | out of scope (auth-as-trait descriptor) | out of scope | **canonical workload identity** — SVID + trust domain | **canonical capability tokens** — HMAC chain, attenuation, discharge | n/a | Fulcio OIDC→X.509 + Rekor witness (signet already implements) | n/a | interlace lease (macaroon-shaped) + signet (SPIRE/Fulcio-shaped) |
| 6. Supply-chain story | out of scope | content-addressed commits + lockfile digest only | out of scope | out of scope | **strong** — reproducible builds | **canonical** — SLSA L1/L2/L3 + signed in-toto attestations + Rekor log | n/a | primitives exist (signet+cosign bridge), nothing wired into releases |
| 7. Adoption cost | M (patterns) / L (wholesale) | S (patterns) / L (wholesale: protobuf migration) | L (SPIRE deploy) / S (vocabulary) | S (we mostly have it) | L (paradigm) | S (L1+sign+Rekor) / L (L3) | M (Backstage runtime) | n/a — we're the baseline |

`[planned]` columns are populated as the agent runs.

## Decision summary

> Pulled from each entry's "Decision" section. The "Adopt" column reflects whether we should bring the *whole thing* in. Pattern-borrows are documented in the per-entry detail.

| System | Adopt? | Patterns to borrow | Reason for partial / skip |
|---|---|---|---|
| Smithy | No | Trait propagation, `operation { input, output, errors }`, `diff` subcommand, plugin codegen | Capnp already covers shapes; JVM toolchain not worth it |
| Buf | No | `buf breaking --against <ref>` shape; FILE/PACKAGE/WIRE rule tiers; `buf.gen.yaml` plugin config; content-addressed commit + lockfile digest | Capnp ≠ protobuf; BSR-as-a-service premature until ≥3 external consumers |
| SPIFFE / SPIRE | No | SPIFFE ID URI scheme as canonical workload-name shape; explicit trust-domain field; bundle-rotation vocabulary (`epoch` ↔ `spiffe_sequence`); workload-attestor pattern for ambient identity | signet already implements SPIRE-shape primitives (CA bundle rotation, OIDC→X.509, ephemeral certs); SPIRE Server+Agent topology is the wrong shape for our edge/CI/dev surface |
| Macaroons | No | Third-party caveats + discharge protocol (the gap); canonical caveat vocabulary; document the asymmetric-signature variant we already ship | We already have the first-party-caveat construction in production (signet `pkg/crypto/epr/` + interlace lease in cloister); macaroons are a construction, not a system to adopt |
| SLSA + Sigstore + in-toto | **Yes** (the predicate + envelope + log; not Fulcio — we have signet) | Adopt SLSA Build L1 across all release-producing repos; in-toto Statement + DSSE envelope; Rekor (public) via existing cosign-via-signet flow; predicate-type-URI vocabulary for custom attestations (APAS) | signet already IS the Fulcio-shape primitive; switching to Fulcio loses signet's algorithm agility (ML-DSA-44 post-quantum); SLSA L3 deferred — requires hardened builder isolation |
| Nixpkgs | _pending_ | _pending_ | _pending_ |
| Backstage | _pending_ | _pending_ | _pending_ |

## Triage queue

Systems mentioned but not yet evaluated. The agent should pick from this list in roughly the order shown (highest-signal first):

1. **Cap'n Proto annotations + RPC layer** — *not external, but worth re-evaluating against the rubric* since we use a strict subset today.
2. **Nixpkgs** — the gold standard for "many independent packages, one coordinated release." Aspirational.
3. **Backstage software templates** — for the recipe / scaffolding side.
4. **WIT + WebAssembly Component Model** — future-bet; only if wasm becomes load-bearing.
5. **CUE / Pkl** — if schema-bridge ever needs to render configs (not just types).
6. **TypeSpec** (Microsoft) — adjacent to Smithy; lower-priority duplicate.
7. **Biscuit tokens** — asymmetric-signature macaroon variant; surfaced as a follow-up by the Macaroons entry (signet's construction may already align with Biscuit). `[unverified]` until a session evaluates it.

## Refresh discipline

- Every entry has a `Refresh after:` date in its header. Don't trust analysis older than that.
- When you refresh, bump the date and update what changed. The git diff is the audit trail.
- If an external project's design moves significantly, file a bead and re-run the agent against the new version.

## What this directory is NOT

- **Not a wiki of "what is X."** Per-entry pages assume the reader knows roughly what the system is; the value is the structured comparison against us.
- **Not a recommendation engine.** The decisions need a human to weigh. The agent produces evidence; you make the call.
- **Not exhaustive.** We pick systems whose decisions are likely to inform ours. "Cool projects" that don't intersect the 7 axes don't get entries.
