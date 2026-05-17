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

| Axis | [Smithy](smithy.md) | [Buf](buf.md) | [SPIFFE](spiffe.md) `[planned]` | [Macaroons](macaroons.md) `[planned]` | [Nixpkgs](nixpkgs.md) `[planned]` | [SLSA](slsa.md) `[planned]` | [Backstage](backstage.md) `[planned]` | **Us** ([baseline](_baseline.md)) |
|---|---|---|---|---|---|---|---|---|
| 1. IDL shape | `.smithy` IDL, services + shapes | protobuf only; operates over `.proto` | n/a | n/a | nix expressions | n/a | YAML templates | capnp |
| 2. Annotation / trait model | **rich** — typed traits, custom-declarable, propagate through codegen | inherits protobuf custom options; no Buf trait library | n/a | caveats (bearer-side) | n/a | predicates in attestation | template parameters | informal capnp `$annotation` |
| 3. Versioning + breaking-change | `smithy diff` + projections | `buf breaking --against`; FILE/PACKAGE/WIRE tiers | versioned SVID specs | per-spec versioning | nixpkgs channels | versioned predicate types | template versions | per-dir, no automation |
| 4. Codegen targets + plugin model | plugin-driven; Java/Kotlin/TS/Python/OpenAPI | `buf.gen.yaml`; remote/local/builtin plugins | reference SDKs | n/a | n/a | n/a | scaffold-time only | single-target (zod), hardcoded |
| 5. Identity / capability model | out of scope (auth-as-trait descriptor) | out of scope | **canonical** — SVID, trust domain, workload attestation | **canonical** — bearer + caveats | n/a | n/a | n/a | interlace lease (macaroon-shaped) |
| 6. Supply-chain story | out of scope | content-addressed commits + lockfile digest only | out of scope | out of scope | **strong** — reproducible builds | **canonical** — provenance levels | n/a | none |
| 7. Adoption cost | M (patterns) / L (wholesale) | S (patterns) / L (wholesale: protobuf migration) | L (operationally) | S (just a lib) | L (paradigm) | M (CI wire-up) | M (Backstage runtime) | n/a — we're the baseline |

`[planned]` columns are populated as the agent runs.

## Decision summary

> Pulled from each entry's "Decision" section. The "Adopt" column reflects whether we should bring the *whole thing* in. Pattern-borrows are documented in the per-entry detail.

| System | Adopt? | Patterns to borrow | Reason for partial / skip |
|---|---|---|---|
| Smithy | No | Trait propagation, `operation { input, output, errors }`, `diff` subcommand, plugin codegen | Capnp already covers shapes; JVM toolchain not worth it |
| Buf | No | `buf breaking --against <ref>` shape; FILE/PACKAGE/WIRE rule tiers; `buf.gen.yaml` plugin config; content-addressed commit + lockfile digest | Capnp ≠ protobuf; BSR-as-a-service premature until ≥3 external consumers |
| SPIFFE / SPIRE | _pending_ | _pending_ | _pending_ |
| Macaroons | _pending_ | _pending_ | _pending_ |
| Nixpkgs | _pending_ | _pending_ | _pending_ |
| SLSA | _pending_ | _pending_ | _pending_ |
| Backstage | _pending_ | _pending_ | _pending_ |

## Triage queue

Systems mentioned but not yet evaluated. The agent should pick from this list in roughly the order shown (highest-signal first):

1. **SPIFFE / SPIRE** — closest to interlace + workload identity. We're already reimplementing this; alignment cost is asymmetric (cheap now, expensive later).
2. **Macaroons** — the 2014 Google paper. Tiny but load-bearing for confirming our lease shape is correct.
3. **Cap'n Proto annotations + RPC layer** — *not external, but worth re-evaluating against the rubric* since we use a strict subset today.
4. **Nixpkgs** — the gold standard for "many independent packages, one coordinated release." Aspirational.
5. **SLSA + Sigstore + in-toto** — the supply-chain triplet. Probably evaluate all three in one entry.
6. **Backstage software templates** — for the recipe / scaffolding side.
7. **WIT + WebAssembly Component Model** — future-bet; only if wasm becomes load-bearing.
8. **CUE / Pkl** — if schema-bridge ever needs to render configs (not just types).
9. **TypeSpec** (Microsoft) — adjacent to Smithy; lower-priority duplicate.

## Refresh discipline

- Every entry has a `Refresh after:` date in its header. Don't trust analysis older than that.
- When you refresh, bump the date and update what changed. The git diff is the audit trail.
- If an external project's design moves significantly, file a bead and re-run the agent against the new version.

## What this directory is NOT

- **Not a wiki of "what is X."** Per-entry pages assume the reader knows roughly what the system is; the value is the structured comparison against us.
- **Not a recommendation engine.** The decisions need a human to weigh. The agent produces evidence; you make the call.
- **Not exhaustive.** We pick systems whose decisions are likely to inform ours. "Cool projects" that don't intersect the 7 axes don't get entries.
