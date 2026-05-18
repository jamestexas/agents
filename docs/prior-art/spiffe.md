<!--
spiffe.md — prior-art entry for SPIFFE / SPIRE.
Drafted by prior-art-cartographer (claude-opus-4-7) on 2026-05-18 against
docs/prior-art/_baseline.md. Every factual claim about SPIFFE/SPIRE is
pinned to a URL in "Sources cited", or marked [unverified].
-->

# Prior art — SPIFFE / SPIRE

> **Canonical URL:** <https://spiffe.io>
> **License + governance:** Apache-2.0; CNCF graduated project (governed by SPIFFE/SPIRE TSC)
> **Evaluated:** 2026-05-18 by `prior-art-cartographer` (Opus 4.7)
> **Refresh after:** 2026-11-18

## TL;DR

SPIFFE is the CNCF spec for workload identity; SPIRE is the reference implementation. Best at: a canonical name for "what is this workload" (`spiffe://<trust-domain>/<workload>`), a Workload API that issues X.509-SVIDs and JWT-SVIDs without bearer tokens, and node+workload attestation that bootstraps trust from platform signals. Not for: capability tokens, attenuation, supply-chain attestation — those are out of scope; SPIFFE only answers "who is this workload."

## Sources cited in this entry

- <https://spiffe.io/docs/latest/spiffe-about/overview/> — SPIFFE overview (accessed 2026-05-18)
- <https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/> — SPIFFE concepts: SPIFFE ID, SVID, trust domain, trust bundle (accessed 2026-05-18)
- <https://spiffe.io/docs/latest/spire-about/spire-concepts/> — SPIRE architecture: server, agent, node attestation, workload attestation (accessed 2026-05-18)
- <https://spiffe.io/docs/latest/deploying/svids/> — Workload API, X.509-SVID / JWT-SVID delivery (accessed 2026-05-18)
- <https://spiffe.io/docs/latest/spiffe-specs/spiffe_trust_domain_and_bundle/> — trust bundle JWK Set format, sequence number, refresh hint, key rotation (accessed 2026-05-18)

> **Citation rule:** every numeric, verbatim, or design-decision claim below traces to one of the URLs above. Where I couldn't confirm from a primary fetch this session, the claim is suffixed `[unverified]`.

---

## Axis 1 — IDL shape

- **Position:** SPIFFE is **not an IDL** — it's an identity standard. The "schema" it ships is the SPIFFE ID URI shape (`spiffe://<trust-domain>/<workload-path>`) and the SVID document formats (X.509-SVID, JWT-SVID). Trust bundles are RFC 7517 JWK Sets with SPIFFE-specific extensions.
- **Evidence:** "spiffe://_trust domain_/_workload identifier_" (concepts page, accessed 2026-05-18). Example given: `spiffe://acme.com/billing/payments`. Trust bundles are "RFC 7517-compliant JWK Sets" with `spiffe_sequence` (monotonic int), `spiffe_refresh_hint`, and `keys` array; each JWK declares `use: x509-svid` or `use: jwt-svid` (trust-domain-and-bundle spec).
- **Comparison to us:** Out of scope for SPIFFE. We have capnp (`_baseline.md` Axis 1); SPIFFE wouldn't replace it. Different layer of stack.
- **Adopt / Borrow / Skip:** **Skip** for IDL. But borrow the URI-as-stable-name pattern (see Axis 5).

## Axis 2 — Annotation / trait model

- **Position:** Out of scope. SPIFFE has no notion of decorating shapes; SVIDs are leaves, not extensible carriers. The SPIFFE ID path itself carries semantic structure by convention (`/billing/payments`) but there's no annotation grammar.
- **Evidence:** No mention of trait/annotation primitives on the concepts page (<https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/>) or the SPIRE concepts page (<https://spiffe.io/docs/latest/spire-about/spire-concepts/>), accessed 2026-05-18.
- **Comparison to us:** Different layer. We need a trait model for capnp shapes (Smithy-borrow, see `smithy.md` Axis 2); SPIFFE doesn't address it.
- **Adopt / Borrow / Skip:** **Skip** — out of scope.

## Axis 3 — Versioning + breaking-change detection

- **Position:** Versioning lives in two places: (a) SPIFFE spec versions (e.g. X.509-SVID v1.0 vs JWT-SVID v1.0 — separate docs at `/spiffe-specs/`) and (b) trust bundle rotation via `spiffe_sequence` monotonic counter. There's no "diff two SVID specs and flag breaks" tooling.
- **Evidence:** "spiffe_sequence ... a monotonically increasing integer" that changes whenever bundle contents are updated (trust-domain-and-bundle spec, accessed 2026-05-18). Bundle rotation works by "publishing the replacement certificate well ahead of the expiration of the original certificate" so both keys verify SVIDs during the window (same source).
- **Comparison to us:** The bundle-rotation sequence number is **exactly** the pattern signet implements today — `pkg/revocation/` uses "monotonic sequence numbers" for "rollback attack prevention" and `pkg/http/middleware/` consumes "SPIRE-model CA bundle rotation" with epoch-based invalidation (`signet/README.md` §3, `docs/design/006-revocation.md`).
- **Adopt / Borrow / Skip:** **Borrow vocabulary.** Signet's revocation epochs are the SPIRE rotation pattern with different names. Align names: `epoch` ↔ `spiffe_sequence`, `bundle_signing_public_key` ↔ trust bundle JWK. Cheap rename, big legibility win for anyone coming from CNCF.

## Axis 4 — Codegen targets + plugin model

- **Position:** SPIFFE ships reference SDKs (Go, Java, C++, Rust [unverified] — fetched concepts page didn't enumerate); the gRPC Workload API has stable protobuf definitions. SPIRE itself has a plugin model for node attestors (k8s_psat, aws_iid, gcp_iit, etc.) and workload attestors (unix, docker, k8s) — pluggable on the server/agent side, not the codegen side.
- **Evidence:** Workload API is "a gRPC service derived from protobuf specifications" (svids deployment doc, accessed 2026-05-18). SPIRE agent "exposes the SPIFFE Workload API to workloads on node and attests the identity of workloads" via pluggable attestors (SPIRE concepts page).
- **Comparison to us:** signet exposes a Go middleware (`pkg/http/middleware/`) and a Sigstore KMS plugin (`cmd/sigstore-kms-signet/`) — but the *attestor* plugin model (how do you bootstrap a workload's identity from platform signals?) is **not** something signet does today. signet identity bootstraps from OIDC (`signet authority`) or from an explicit master key, not from "look at the container's k8s service-account token / look at the GCP instance metadata."
- **Adopt / Borrow / Skip:** **Borrow** the attestor-plugin pattern for ambient-identity bootstrap. signet already does GHA-OIDC ambient (`auth.notme.bot/cert/gha`); generalize that surface into a `pkg/oidc/` provider registry (which already exists — `signet/CLAUDE.md` lists `pkg/oidc/` with "GitHub Actions, Cloudflare Access" providers). The pattern is right; the vocabulary is "workload attestor" if we want CNCF alignment.

## Axis 5 — Identity / capability model

- **Position:** **Canonical workload identity.** SVIDs are short-lived X.509 certs (or JWTs) bound to a SPIFFE ID. There is **no capability/caveat layer** — an SVID says "I am workload X," not "I am workload X with permission Y." Authorization is downstream.
- **Evidence:** "An SVID is the document with which a workload proves its identity to a resource or caller, and contains a single SPIFFE ID" (concepts page, accessed 2026-05-18). Workloads "use these identity documents when authenticating to other workloads, for example by establishing a TLS connection or by signing and verifying a JWT token" (overview page).
- **Comparison to us:** signet implements the SPIRE-shape identity layer concretely:
  - **Trust bundle / CA rotation** → `pkg/revocation/` + `pkg/http/middleware/` (SPIRE-model CA bundle rotation, epoch monotonic counter; `signet/README.md` §"Token Revocation System").
  - **X.509-SVID equivalent** → 5-minute ephemeral certs from `pkg/attest/x509/` LocalCA (Fulcio-shape, not strictly SPIFFE — no `spiffe://` URI; SANs and Subject CN, not `URI:spiffe://...`).
  - **JWT-SVID equivalent** → not present; signet's wire format is CBOR/COSE Sign1 (`pkg/crypto/cose/`, `pkg/signet/`), not JWT.
  - **Workload API** → no equivalent. Workloads don't fetch identity from a local agent over a Unix socket; they either hold a long-lived master key (`~/.signet/master.key`) or exchange an OIDC token at `auth.notme.bot/cert/gha`.
  - **Trust domain** → implicit. signet's "trust domain" is "whoever signed your master key" — there's no explicit `spiffe://example.com/` namespace.
  - **Capability layer** → the interlace lease (`interlace-spec/0.1.0/`, used by `cloister/src/routes/lease-middleware.ts`) — this is the macaroon-shaped layer on top of identity, which SPIFFE deliberately doesn't supply.
- **Adopt / Borrow / Skip:** **Borrow vocabulary and one missing primitive.** Specifically:
  1. Make trust-domain explicit. Add a `TrustDomain` field to signet's master key descriptor; embed `URI:spiffe://<trust-domain>/<workload-path>` SANs in ephemeral certs. Cost: ~1 week. Cloister and notme become legible to anyone holding an SVID-aware verifier.
  2. Adopt the `spiffe://` URI shape as the canonical name for "what is this workload." We already need names for cloister capabilities; this is the same problem.
  3. Don't replace signet's middleware with a SPIRE Agent. The SPIRE Agent / Workload API model (Unix-socket gRPC, kernel introspection for attestation) is correct for k8s/VM clusters but a poor fit for ephemeral CF Workers and developer laptops — signet's "OIDC bridge or local CA" model is the right shape for our deployment surface.

## Axis 6 — Supply-chain story

- **Position:** **Out of scope.** SPIFFE is about workload identity *at runtime*. It doesn't sign release artifacts, doesn't emit provenance, doesn't write to a transparency log. Sigstore + SLSA + in-toto own that axis (see `slsa-sigstore-in-toto.md`).
- **Evidence:** No mention of artifact signing, SBOM, provenance, or attestation framework on the SPIFFE overview (<https://spiffe.io/docs/latest/spiffe-about/overview/>) or concepts page (<https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/>), accessed 2026-05-18.
- **Comparison to us:** Same — different axis. We have plumbing for supply chain (signet's `cmd/sigstore-kms-signet/`, GHA OIDC bridge) but it's not wired into releases (`_baseline.md` Axis 6).
- **Adopt / Borrow / Skip:** **Skip** — different layer.

## Axis 7 — Adoption cost

- **Position:** **High operationally; low conceptually.** Running SPIRE = deploy a server, deploy agents on every node, configure attestors per platform, wire trust bundles, federate across trust domains. Conceptual hello-world (read the SPIFFE ID URI scheme and SVID format) is an afternoon; operational hello-world (real SPIRE deployment in k8s) is a sprint.
- **Evidence:** SPIRE server and agent each have multi-page configuration references (`/deploying/spire_server/`, `/deploying/spire_agent/` linked from search results, not fetched). Attestors are per-platform plugins — you need different setup for k8s vs AWS vs bare-metal.
- **Comparison to us:** signet's adoption cost is "build the binary and run it" (`signet/README.md` Installation) for a developer, "deploy `auth.notme.bot` as a CF Worker" for the OIDC bridge. signet skips the agent-per-node model — and our deployment surface (CF Workers + developer laptops + GHA runners) is where SPIRE's k8s-shaped model is the *wrong* fit.
- **Adopt / Borrow / Skip:** **Skip wholesale adoption.** SPIRE the implementation is k8s-cluster-shaped; signet covers our actual surface (edge workers, CI, dev machines) at lower operational cost. **Borrow** the conceptual model (SVID, trust domain, workload attestation, bundle rotation) as vocabulary.

---

## Cross-cutting

| Field | Value |
|---|---|
| Adoption cost (S / M / L) | **L** for wholesale SPIRE deployment; **S** for borrowing SPIFFE ID vocabulary into signet's certs |
| Maintenance burden if adopted (patterns) | Low — the SVID URI scheme and bundle-sequence pattern are passive shapes signet's already-built primitives can wrap |
| Risk if we adopt patterns | Low — vocabulary alignment, no protocol commitment |
| Risk if we do NOT adopt | Medium — signet's workload-identity story is SPIRE-shaped by convergent design but uses different names; an outsider reading our docs has to translate "epoch" → `spiffe_sequence`, "bridge cert" → SVID, "master key" → CA root, etc. Friction tax forever. |
| Open questions | (1) Does the `URI:spiffe://...` SAN extension play nicely with our existing X.509 verifier? Should map cleanly via `pkg/attest/x509/` but unverified. (2) Should signet expose a Workload-API-compatible gRPC endpoint for any consumer that prefers it? Cost-vs-benefit unclear until a real consumer asks. (3) Does interlace's "third-party caveat" model need SPIFFE federation to discharge across trust domains? Probably yes long-term; not blocking today. |

## Decision

- **Adopt:** *(none — SPIRE the implementation stays external; not our deployment surface)*
- **Borrow:**
  - **The SPIFFE ID URI scheme** (`spiffe://<trust-domain>/<workload>`) as a canonical name for a workload. Embed as a SAN in signet's ephemeral certs. Concrete pointer: extend `pkg/attest/x509/` cert template to accept a SPIFFE ID and emit it as `URI:spiffe://...`.
  - **The trust-domain abstraction as an explicit field.** Add `TrustDomain string` to the signet master-key descriptor (`pkg/signet/` token struct). Removes the implicit "whoever signed the master" hand-wave.
  - **Bundle rotation vocabulary.** signet's revocation epochs are SPIRE's `spiffe_sequence` with different names — align them. Concrete pointer: rename `Epoch` → `Sequence` (or document the equivalence) in `pkg/revocation/`.
  - **Workload attestor pattern for ambient identity.** signet's `pkg/oidc/` provider registry is already this shape (GHA, Cloudflare Access). Frame it as "workload attestors" in docs; spec a Kubernetes attestor when a real consumer needs one.
- **Skip:**
  - **SPIRE Server + Agent topology.** Wrong shape for our deployment surface (edge workers, dev laptops, CI).
  - **JWT-SVID format.** signet's wire format is CBOR/COSE; we don't need JWT compatibility today.
  - **SPIFFE Federation protocol.** Premature — we have one trust domain. Revisit when notme + cloister + a third-party operator have distinct trust roots.

## Action items

- [ ] File bead (signet): "embed `URI:spiffe://<trust-domain>/<workload>` SAN in ephemeral X.509 certs minted by `pkg/attest/x509/`." Owner: signet. ~1 week.
- [ ] File bead (signet): "add `TrustDomain` field to signet master-key descriptor; document the SPIRE-vocabulary mapping (`Epoch`↔`spiffe_sequence`, etc.) in `pkg/revocation/README.md`." Owner: signet. ~3 days.
- [ ] File bead (signet/docs): "doc page: 'signet for SPIRE users' — translate our vocabulary to CNCF terms with a side-by-side table." Owner: signet/docs. Low-priority; unblocks external readability.
- [ ] File bead (research): "evaluate whether `cmd/sigstore-kms-signet` should also export a SPIFFE Workload API endpoint for consumers that prefer it over the HTTP middleware." Deferred until a real consumer asks.

## Cross-references

- Related prior-art entries: [macaroons](macaroons.md) (the capability layer SPIFFE deliberately doesn't supply — interlace fills that gap), [slsa-sigstore-in-toto](slsa-sigstore-in-toto.md) (the supply-chain layer SPIFFE also doesn't supply).
- Related beads (existing): signet revocation work (`pkg/revocation/`, `docs/design/006-revocation.md`); `pkg/oidc/` provider registry beads.
- Related ADRs: signet ADR-011 (trust policy bundles); `signet/docs/design/006-revocation.md` (CA bundle rotation design); cloister ADR-0024 (credential-isolation/v1).
