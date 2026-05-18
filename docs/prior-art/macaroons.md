<!--
macaroons.md — prior-art entry for the 2014 Macaroons paper.
Drafted by prior-art-cartographer (claude-opus-4-7) on 2026-05-18 against
docs/prior-art/_baseline.md. Every factual claim about Macaroons is pinned
to a URL in "Sources cited", or marked [unverified].
-->

# Prior art — Macaroons

> **Canonical URL:** <https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/>
> **License + governance:** Academic paper (Birgisson, Politz, Erlingsson, Taly, Vrable, Lentczner — Google, 2014). No reference implementation governed by the authors; multiple open implementations exist (libmacaroons, pymacaroons, macaroons-go) `[unverified]`.
> **Evaluated:** 2026-05-18 by `prior-art-cartographer` (Opus 4.7)
> **Refresh after:** 2026-11-18

## TL;DR

The 2014 NDSS paper introducing macaroons — bearer credentials with cryptographically-bound caveats that attenuate authority. Best at: a small, deployable HMAC-chain construction for attenuated delegation, with a discharge protocol for third-party caveats. Not for: workload identity (SPIFFE owns that) or supply chain (SLSA/Sigstore own that). The paper is a 12-page idea, not a stack — implementations are downstream.

## Sources cited in this entry

- <https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/> — Google Research publication page (accessed 2026-05-18)
- <https://research.chalmers.se/publication/539211/file/539211_Fulltext.pdf> — full-text PDF mirror at Chalmers (accessed 2026-05-18; binary PDF, parsed by WebFetch)
- <https://www.ndss-symposium.org/ndss2014/ndss-2014-programme/macaroons-cookies-contextual-caveats-decentralized-authorization-cloud/> — NDSS 2014 programme entry with abstract (accessed 2026-05-18)

> **Citation rule:** every numeric, verbatim, or design-decision claim below traces to one of the URLs above. Where I couldn't confirm from a primary fetch this session, the claim is suffixed `[unverified]`. The PDF was parsed via WebFetch and returned summarized content rather than verbatim quotes — paraphrased claims below are marked when their exact wording was not recoverable.

---

## Axis 1 — IDL shape

- **Position:** **Not an IDL.** A macaroon is a *credential format*: a string of bytes carrying an identifier, a list of caveats, and a final HMAC-chained signature. There's no schema language; serialization is per-implementation (paper describes the construction, not the wire format).
- **Evidence:** Macaroons are described as "flexible authorization credentials" that "support efficient, widely-applicable forms of decentralized delegation" (NDSS abstract, accessed 2026-05-18).
- **Comparison to us:** Different layer. Our IDL is capnp (`_baseline.md` Axis 1); the interlace lease wire format is a capnp shape *inside* that IDL.
- **Adopt / Borrow / Skip:** **Skip** — macaroons are a construction, not a schema language.

## Axis 2 — Annotation / trait model

- **Position:** **Caveats are the annotation model.** Each caveat is a string predicate that attenuates the credential — e.g. `account = 3735928559`, `time < 2020-01-01`, `operation = read`. The construction is agnostic to caveat syntax; it just MACs over the caveat bytes. The trait vocabulary is application-defined.
- **Evidence:** Caveats "attenuate and contextually confine when, where, by who, and for what purpose a target service should authorize requests" (paper, paraphrased via WebFetch parse — exact wording not recoverable from PDF in this session, marked `[unverified]` on the literal phrasing but the construction is clear from the abstract).
- **Comparison to us:** Interlace leases carry capability scopes ("cred:proxy", "lease:bind", etc.) bound to the master key by signature — same shape as a macaroon's first-party caveat. We don't have a canonical caveat vocabulary; cloister `lease-middleware.ts` enforces them ad-hoc per route.
- **Adopt / Borrow / Skip:** **Borrow.** Formalize a canonical caveat vocabulary for interlace leases. Concrete pointer: declare a `caveats.capnp` shape (or annotation) in `interlace-spec/0.1.0/` with named caveats — `Expiry`, `Scope`, `Audience`, `Method`, `Account`, `Origin`. Today these are encoded as string predicates parsed at the boundary; named caveats are diffable and codegen-able.

## Axis 3 — Versioning + breaking-change detection

- **Position:** **Out of scope.** The paper defines a construction; versioning is implementation-defined. Most libraries embed a version byte in the binary serialization `[unverified]`.
- **Evidence:** No version negotiation mechanism described in the paper abstract or excerpted content (NDSS, Chalmers mirror, accessed 2026-05-18).
- **Comparison to us:** We version interlace per-directory (`interlace-spec/0.1.0/`). Different layer.
- **Adopt / Borrow / Skip:** **Skip** — out of scope.

## Axis 4 — Codegen targets + plugin model

- **Position:** **Out of scope.** Not a codegen system. Multiple library implementations exist (C, Python, Go) but they're independent — no canonical multi-target codegen pipeline.
- **Evidence:** No codegen discussion in the source material (paper abstract, NDSS programme entry, accessed 2026-05-18).
- **Comparison to us:** Different layer.
- **Adopt / Borrow / Skip:** **Skip**.

## Axis 5 — Identity / capability model

- **Position:** **Canonical capability-token construction.** A macaroon `M_0` starts with an identifier and a root key `K_0`; the initial signature is `HMAC(K_0, identifier)`. Each added caveat `c_i` produces a new signature `H_i = HMAC(H_{i-1}, c_i)` — the **HMAC chain**. The final `H_n` is the macaroon's MAC. Verification: walk the caveats forward, recompute `H_n` with `K_0`, and check each caveat predicate; only the issuing service needs `K_0`. Attenuation is monotonic — caveats only restrict, never widen.

  **Third-party caveats** introduce a discharge protocol: a caveat says "this is OK only if you also produce a discharge macaroon from authority A proving X." The client fetches the discharge macaroon from A, presents both at request time, and the service verifies both chains. This enables decentralized delegation across trust boundaries without centralized session state.
- **Evidence:** "Macaroons use nested chained HMACs (M₀, M₁, ...) where each caveat's verification code depends on the previous value, creating an 'efficient, easy to deploy, and widely applicable' chain structure" (paper, paraphrased via WebFetch parse of Chalmers PDF, accessed 2026-05-18). "For third-party caveats, clients must acquire discharge macaroons from the caveat's designated verifier, then present both the original macaroon and discharge proofs together to the target service" (same source, paraphrased — exact wording not recoverable from PDF parse, `[unverified]` on the literal phrasing). The abstract states macaroons offer "decentralized delegation between principals" that bearer cookies lack (NDSS, accessed 2026-05-18).
- **Comparison to us:**
  - **First-party-caveat equivalent — we have this.** signet's HTTP proofs implement the exact pattern: `master → ephemeral → request` is a three-link signature chain (`signet/README.md` §3 "Two-Step Verification: Validates master→ephemeral→request signature chain"). Each link signs over the previous + new caveat-equivalent data (purpose, expiry, nonce). Implementation: `pkg/crypto/epr/` (Ephemeral Proof Routines), `pkg/http/middleware/`. The interlace lease (`interlace-spec/0.1.0/`, used by `cloister/src/routes/lease-middleware.ts`) is the application-level macaroon-shaped capability token. Attenuation works: a lease can be re-issued narrower, never wider.
  - **Third-party caveats — we don't have this.** Discharge protocols are not implemented. Today, if cloister wants to verify "this lease holder is OK with billing service B," it has to call B synchronously — there's no offline "discharge macaroon from B" that the client can carry. This is the most concrete gap surfaced by the paper.
  - **HMAC chain vs cert chain.** The paper's HMAC construction uses symmetric MACs; signet uses asymmetric signatures (Ed25519, ML-DSA-44 via `pkg/crypto/algorithm/`). Functionally equivalent for the attenuation property — the verifier doesn't hold the root key but holds the master *public* key. Different threat model: pure-HMAC requires the verifier to hold `K_0` (so only the issuer can verify); asymmetric lets *anyone* with the master public key verify, which is what signet wants for decentralized HTTP middleware.
- **Adopt / Borrow / Skip:** **Borrow heavily — and confirm what we already have is on a solid theoretical foundation.** Specifically:
  1. **Formalize third-party caveats + discharge protocol in interlace.** Today we have the first-party-caveat pattern in production (`cloister/src/routes/lease-middleware.ts`); adding discharge would unlock cross-service delegation without synchronous calls. Concrete pointer: spec `interlace-spec/0.2.0/discharge.md` (caveat shape: `(third_party_url, caveat_id, root_key_ciphertext)`); implement client-side discharge fetch in cloister.
  2. **Document the asymmetric variant.** signet uses signatures rather than HMACs — this is correct for our threat model but should be documented as "macaroon-shaped, asymmetric-MAC variant" so anyone reaching for the paper to verify our construction can map the differences.
  3. **Canonical caveat vocabulary** (already on the Adopt list from Axis 2).

## Axis 6 — Supply-chain story

- **Position:** **Out of scope.** Macaroons are runtime capability credentials; the paper has no supply-chain concerns.
- **Evidence:** No mention of artifact signing, provenance, attestation, or SBOM in the paper's abstract or excerpted content (NDSS, Chalmers mirror, accessed 2026-05-18).
- **Comparison to us:** Different layer.
- **Adopt / Borrow / Skip:** **Skip**.

## Axis 7 — Adoption cost

- **Position:** **S.** The paper is 12 pages; reference libraries exist in most languages `[unverified]`; the HMAC-chain construction is ~50 lines of code. Hello-world is "import a library, issue a macaroon, add a caveat, verify."
- **Evidence:** Paper length and library ecosystem are common knowledge but not directly cited in the fetched source pages — `[unverified]` on specifics. The construction is described in the paper as "efficient, easy to deploy, and widely applicable" (paraphrased via WebFetch parse).
- **Comparison to us:** We've already paid the implementation cost for the first-party-caveat variant; interlace lease + signet HTTP proofs are running in production code paths (`cloister/src/routes/lease-middleware.ts`, `pkg/http/middleware/`). The marginal cost of adopting macaroon vocabulary in the spec and adding the discharge protocol is ~2-4 weeks.
- **Adopt / Borrow / Skip:** **Borrow** — low cost, high legibility win.

---

## Cross-cutting

| Field | Value |
|---|---|
| Adoption cost (S / M / L) | **S** for borrowing patterns (we already have most of the pattern in code); **N/A** for wholesale adoption since macaroons are a construction, not a system |
| Maintenance burden if adopted (patterns) | Low — caveat vocabulary is data; discharge protocol is a new wire format but the surface is small |
| Risk if we adopt patterns | Low — we'd be aligning our existing construction with established academic prior art, which strengthens our story |
| Risk if we do NOT adopt | Medium — without the discharge protocol, cross-service delegation in cloister requires synchronous calls; without canonical caveat names, every lease consumer reinvents the parser |
| Open questions | (1) Does the paper's "third-party caveat root key ciphertext" mechanism translate cleanly to asymmetric? Probably yes (encrypt to recipient's pubkey) but unverified against any published asymmetric-macaroon variant. (2) Does signet's COSE Sign1 wire format (`pkg/crypto/cose/`) need a separate envelope for discharge macaroons, or can the existing CBOR token carry them? `[unverified]`. (3) How do we name the asymmetric variant publicly — "asymmetric macaroon"? "signed lease"? Naming matters for external readability. |

## Decision

- **Adopt:** *(none — macaroons are a construction, not a system)*
- **Borrow:**
  - **The first-party-caveat construction.** Confirmed: signet's `master → ephemeral → request` chain (`pkg/crypto/epr/`, `pkg/http/middleware/`) and the interlace lease (`interlace-spec/0.1.0/`, `cloister/src/routes/lease-middleware.ts`) are this pattern with asymmetric signatures instead of HMACs. Action: document the equivalence in `interlace-spec/0.1.0/README.md` so anyone reading "is this a macaroon?" gets a yes-with-caveats answer.
  - **Third-party caveats + discharge protocol.** The biggest gap surfaced. Spec at `interlace-spec/0.2.0/discharge.md`; reference impl in cloister.
  - **Canonical caveat vocabulary.** Named caveats (`Expiry`, `Scope`, `Audience`, `Method`, `Account`, `Origin`) as a capnp annotation or struct in `interlace-spec/`; replace ad-hoc string predicates in `cloister/src/routes/lease-middleware.ts`.
- **Skip:**
  - **HMAC-with-shared-K_0 variant.** signet uses asymmetric signatures by design; reverting to symmetric MACs would lose the "any holder of master pubkey can verify" property we depend on.
  - **The paper's exact wire format.** Per-implementation; our COSE/CBOR is fine.

## Action items

- [ ] File bead (interlace-spec): "document the macaroon-shape equivalence in `interlace-spec/0.1.0/README.md`; cross-reference signet `pkg/crypto/epr/` and the paper." Owner: cloister/interlace. ~2 days.
- [ ] File bead (interlace-spec): "spec `interlace-spec/0.2.0/discharge.md` — third-party caveats and discharge protocol; asymmetric variant of paper construction." Owner: cloister/interlace. ~2 weeks for spec, +2 weeks for cloister-side impl.
- [ ] File bead (interlace-spec): "declare canonical caveat vocabulary as a capnp shape; refactor `cloister/src/routes/lease-middleware.ts` to consume it." Owner: cloister. ~1 week.
- [ ] File bead (research): "survey existing asymmetric-macaroon literature (Biscuit tokens, anonymous credentials)" — confirm our asymmetric construction has precedent we can cite. Deferred. `[unverified]` claim to resolve.

## Cross-references

- Related prior-art entries: [spiffe](spiffe.md) (the workload-identity layer macaroons sit on top of; SPIFFE answers "who is this workload," macaroons answer "what is this workload allowed to do"), [smithy](smithy.md) (Axis 2 trait propagation — caveat vocabulary is the same problem shape).
- Related beads (existing): cloister `cloister-1b59a2` (substrate-as-kernel framing); `interlace-spec/0.1.0/` design beads.
- Related ADRs: cloister ADR-0024 (credential-isolation/v1 — the first interlace consumer).
