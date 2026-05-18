<!--
nixpkgs.md — prior-art entry for Nixpkgs + Nix flakes.
Drafted by prior-art-cartographer (claude-opus-4-7) on 2026-05-18 against
docs/prior-art/_baseline.md. Every factual claim is pinned to a URL in
"Sources cited", or marked [unverified].
-->

# Prior art — Nixpkgs / Nix flakes

> **Canonical URL:** <https://nixos.org/manual/nixpkgs/stable/>
> **License + governance:** MIT (Nixpkgs collection itself); stewarded by the NixOS Foundation + the wider Nix community. Flakes specified in RFC 0049 (tweag/NixOS RFC process).
> **Evaluated:** 2026-05-18 by `prior-art-cartographer` (Opus 4.7)
> **Refresh after:** 2026-11-18

## TL;DR

Nixpkgs is "a set of thousands of packages" (~80,000 in practice) released as periodic channels (`nixos-25.11`, `nixos-25.05`, …) — every six months, in May and November, after a tested snapshot passes Hydra CI. Flakes (RFC 0049) add a `flake.nix` + `flake.lock` pair: declarative inputs, content-addressed pins (`narHash`), reproducible-evaluation envelope. Best at: "many independent packages, one coordinated release," reproducibility-by-default, content-addressed pinning. Not for: IDL design, capability tokens, breaking-change detection on schemas.

## Sources cited in this entry

- <https://nixos.org/manual/nixpkgs/stable/> — Nixpkgs Reference Manual (accessed 2026-05-18)
- <https://wiki.nixos.org/wiki/Channel_branches> — channel branches + release cadence + Hydra gating (accessed 2026-05-18)
- <https://github.com/tweag/rfcs/blob/flakes/rfcs/0049-flakes.md> — RFC 0049 Flakes (accessed 2026-05-18)
- <https://nix.dev/concepts/flakes.html> — Flakes concepts (accessed 2026-05-18)
- <https://wiki.nixos.org/wiki/Binary_Cache> — Nix binary cache + trusted-public-keys (accessed 2026-05-18)
- <https://github.com/nikstur/bombon> — Nix→CycloneDX SBOM tool (third-party, accessed 2026-05-18)
- <https://github.com/tiiuae/sbomnix> — Nix→CycloneDX/SPDX SBOM tool (third-party, accessed 2026-05-18)

> **Citation rule:** every numeric, verbatim, or design-decision claim below traces to one of the URLs above. Claims I couldn't confirm in this session are suffixed `[unverified]`.

---

## Axis 1 — IDL shape

- **Position:** **Not an IDL.** Nixpkgs is a *package collection* expressed in the Nix language — "thousands of packages for the Nix package manager, released under a permissive MIT license" (Nixpkgs manual, accessed 2026-05-18). A flake's `outputs` are an attribute set of arbitrary values; RFC 0049 explicitly notes outputs are "untyped" with only conventions (e.g. "`packages` should be an attribute set of derivations") (RFC 0049, accessed 2026-05-18).
- **Evidence:** RFC 0049's "Outputs" section establishes the convention-not-schema model: there is no formal type system across flakes — interpretation of outputs is consumer-side.
- **Comparison to us:** Different layer. Our IDL is capnp; Nix is a build/composition language. The analogy isn't "Nix's IDL vs ours" — it's "Nix as the substrate that *carries* our IDL artifacts."
- **Adopt / Borrow / Skip:** **Skip** — Nix is not a schema language.

## Axis 2 — Annotation / trait model

- **Position:** **Out of scope.** Nix derivations carry `meta` attributes (description, license, platforms, maintainers) but this is not a propagating trait system — it's metadata read by tooling like `nix search`. No equivalent of Smithy's trait propagation through codegen.
- **Evidence:** No mention of trait propagation in the Nixpkgs manual sections fetched (accessed 2026-05-18). `meta` attributes are documented but are consumer-read, not codegen-driving `[unverified]` on the specifics of meta-attribute coverage — only the absence-of-trait-propagation claim is from the fetched manual.
- **Comparison to us:** Different concern. Capnp `$annotation` is the closer analog to Smithy traits.
- **Adopt / Borrow / Skip:** **Skip** — wrong layer.

## Axis 3 — Versioning + breaking-change detection

- **Position:** **Coordinated release channels are the model.** "New stable channels launch every six months" with `nixos-25.11`-style names indicating "May and November release cycles" (Channel branches wiki, accessed 2026-05-18). A channel branch is "a curated, tested snapshot of Nixpkgs" that advances only after specific Hydra jobs succeed: "Particular jobset evaluation needs to be completely built" and "Particular jobset evaluation's tested/unstable job needs to be built succesfully" (same source). Stable channels receive "only conservative updates for fixing bugs and security vulnerabilities" — no major updates post-release.

  **Flake-level locking:** `flake.lock` contains "a graph structure isomorphic to the graph of dependencies of the root flake" with each locked node carrying a `narHash, specifying the expected contents of the tree in the Nix store` (RFC 0049, accessed 2026-05-18). The Lockable HTTP Tarball Protocol lets channels themselves be flake inputs: `inputs.nixpkgs.url = "https://channels.nixos.org/nixos-25.05/nixexprs.tar.xz"`.

  No automated breaking-change *detection* for the API surface of individual packages — channel discipline + Hydra is the mechanism, not a diff tool.
- **Evidence:** Channel branches wiki (release schedule, Hydra gating); RFC 0049 (lockfile structure, narHash).
- **Comparison to us:** **This is the gap the substrate-IDL track wants closed.** `_baseline.md` Axis 3 says "Per-directory versioning … no automated breaking-change detection. No CI that diffs schema versions." Nixpkgs gives us a working model of "art-2026.05.0 = these versions of these components, tested together as a unit." The closest analog in our stack today is the hand-rolled byte-mirror between cloister and notme — no shared lockfile, no shared release.
- **Adopt / Borrow / Skip:** **Borrow heavily.** Three concrete patterns: (1) **content-addressed pinning** — `narHash`-equivalent for capnp schemas (a `schemaHash` per `<cap>/v<n>/` directory, anchored in ley-line's content-addressing); (2) **bi-annual coordinated release channels** — `art-2026.05.0` = "these versions of cloister, notme, signet, mache, ley-line, schema-bridge, tested together"; (3) **a `art.lock` manifest** at the substrate root pinning every component to a content hash + tag, regeneratable but tracked.

## Axis 4 — Codegen targets + plugin model

- **Position:** **Out of scope as IDL codegen; in scope as build orchestration.** Nix derivations are the "codegen target" in the sense that every package produces a build output; Nixpkgs ships derivations for ~80,000 packages and builds for `x86_64-linux`, `aarch64-linux`, `x86_64-darwin`, `aarch64-darwin` (Nixpkgs manual, accessed 2026-05-18). Hydra distributes binaries via a binary cache. But this is not "IDL → multiple language SDKs" — it's "build recipe → multi-platform binaries."
- **Evidence:** Nixpkgs manual on Hydra and supported platforms (accessed 2026-05-18).
- **Comparison to us:** Different concern. schema-bridge is a code generator (capnp → zod); Nix is a package builder. The intersection would be: if `art-substrate` ever ships *as a Nix flake providing schemas + generated code as outputs*, we'd inherit Nix's reproducibility envelope for free.
- **Adopt / Borrow / Skip:** **Skip wholesale; consider as packaging envelope.** Action: when schema-bridge gets a second codegen target (Rust or Go), ship a `flake.nix` in `cloister/tools/schema-bridge/` so consumers can `nix run` the generator with a pinned version. Cost: ~1 day per repo. Wait until we have ≥2 external consumers.

## Axis 5 — Identity / capability model

- **Position:** **Out of scope** for the package layer. Binary cache trust is established via signed substituters: "any non-content-addressed path added or copied to the Nix store must have a valid signature, that is, be signed using one of the keys listed in trusted-public-keys or secret-key-files" (NixOS Binary Cache wiki, accessed 2026-05-18). Signing keys are static, per-cache; no workload identity, no capability attenuation.
- **Evidence:** Binary Cache wiki (substituter trust model, accessed 2026-05-18).
- **Comparison to us:** Different layer entirely. signet (SPIRE-shape + Fulcio-shape) is the workload-identity story; interlace lease is capability-token. Nix's substituter signing is the equivalent of "the artifact came from a trusted source," analogous to cosign blob signing rather than to interlace.
- **Adopt / Borrow / Skip:** **Skip** — different problem. The closest interesting note: Nix's `trusted-public-keys` is a static key-bundle pattern, exactly the SPIRE-anti-pattern that signet's rotating-bundle middleware exists to *replace*. Worth keeping in mind that Nix would benefit from SPIFFE-shape trust — but that's a Nix problem, not ours.

## Axis 6 — Supply-chain story

- **Position:** **Reproducible-by-default is the strongest single feature.** Flakes "default to running in pure mode" promoting "a style of writing programs more likely to make them reproducible," though a footnote acknowledges "Even in pure mode, reproducibility is not actually guaranteed" (nix.dev flakes, accessed 2026-05-18). Content-addressed derivations (`__contentAddressed`) provide stronger reproducibility guarantees (Nixpkgs manual, accessed 2026-05-18).

  **SBOM:** First-party CycloneDX support exists in Nixpkgs in some form (referenced as an "Interoperability Standards" chapter in the manual TOC `[unverified]` on whether this is first-party or third-party). Mature third-party tooling: `bombon` ("generates CycloneDX v1.5 SBOMs which aim to be compliant with the German Technical Guideline TR-03183 v2.0.0") and `sbomnix` ("a suite of utilities to help with software supply chain challenges on nix targets") cover the gap (bombon README, sbomnix README, accessed 2026-05-18).

  **Signing:** Per-binary-cache static keys (`trusted-public-keys`), not workflow-level provenance signing (Binary Cache wiki, accessed 2026-05-18). No SLSA-level provenance for Nixpkgs itself `[unverified]` — the manual's TOC was the source-of-evidence; not deeply inspected this session.
- **Evidence:** nix.dev (reproducibility framing); Binary Cache wiki (signing model); bombon + sbomnix READMEs (CycloneDX/SPDX generation).
- **Comparison to us:** **Nix beats us on reproducibility-by-construction and SBOM generation; we beat Nix on signing identity** (signet's SPIRE-shape + Fulcio-shape vs. Nix's static `trusted-public-keys`). The combination — Nix's reproducibility envelope around signet's signing — is the natural fit. Today we have neither.
- **Adopt / Borrow / Skip:** **Borrow.** Two patterns: (1) **content-addressed everything** — every substrate artifact (schema, generated code, lockfile entry) gets a content hash anchored in ley-line; (2) **CycloneDX SBOM generation per release** — borrow `bombon`/`sbomnix`'s shape (Nix runtime closure → SBOM) and adapt to our Cargo/npm/Go release graphs. Don't adopt Nix wholesale as the build substrate — that's a quarter-of-work minimum and locks us to the Nix evaluator.

## Axis 7 — Adoption cost

- **Position:** **L** for wholesale adoption (every developer learns Nix, every repo gets a `flake.nix`, every CI pipeline gets Nix tooling — paradigm shift, ~quarter of work for our team). **M** for partial adoption (ship `flake.nix` files in selected repos for reproducible dev shells + binary caching, ~1-2 weeks). **S** for pattern-borrowing (lift the lockfile + channel concepts into our own `art-substrate.capnp` manifest format, ~2-3 weeks for spec + tooling).
- **Evidence:** Hello-world is `flake.nix` + `nix build` — small surface. The cost is the language: Nix expressions, derivations, attribute sets, fixed-point semantics. Documented at length in nix.dev and the Nixpkgs manual; learning curve is real `[unverified]` on specific time-to-fluency estimates.
- **Comparison to us:** Our `_baseline.md` Axis 7 says "**High** — No published packages, no documented 'how to depend on this'." Nix solves the *external-consumer* problem brilliantly (one `nix flake init` + `inputs.art.url = "github:..."` and you're depending on us). The cost is that we'd need a Nix expert on the team to maintain it. Nobody on the team is one today `[unverified]` — based on absence of `flake.nix` files in any of our repos, confirmed by `ls cloister/flake.nix notme/flake.nix signet/flake.nix` returning none.
- **Adopt / Borrow / Skip:** **Borrow the concepts, defer adoption.** Adopting Nix wholesale before we have ≥3 external consumers is premature. Borrowing the lockfile + channel + content-addressed-pin concepts into a `art-substrate.capnp` manifest format is the right move — own the substrate ourselves, learn from Nix's design.

---

## Cross-cutting

| Field | Value |
|---|---|
| Adoption cost (S / M / L) | **S** for pattern-borrowing (lockfile + channel concepts into our own manifest); **M** for partial (flakes per repo); **L** for wholesale (Nix as build substrate) |
| Maintenance burden if adopted (patterns) | Low — a `art.lock` + channel manifest is data, regeneratable from the source repos. High for wholesale — Nix expertise required, every repo touches Nix expressions |
| Risk if we adopt patterns | Low — our manifest format is in our control; we're just borrowing the *idea* of "lockfile + channel + content-hash" which is well-validated |
| Risk if we do NOT adopt | Medium-High — without a coordinated-release substrate, every cross-repo capability change requires manual byte-mirroring (the cloister↔notme pattern) which doesn't scale past 2-3 repos. The substrate-IDL track is blocked on this |
| Open questions | (1) Should `art.lock` live in `art-substrate/` (a new repo) or in each consumer? (2) Should the content-hash anchor be ley-line's CID scheme or a Nix-style `narHash`? (3) Does the channel concept require a separate "tested-together" CI job, or can we derive it from per-repo CI? (4) When do we publish `art-2026.05.0` as a real artifact? Q3 2026? Q4? |

## Decision

- **Adopt:** *(none — Nix itself stays external)*
- **Borrow:**
  - **The lockfile pattern.** Design `art.lock` as a Cap'n Proto manifest pinning each substrate component (cloister, notme, signet, mache, ley-line, schema-bridge) to a git SHA + content hash + tag. Regeneratable, but committed.
  - **The channel concept.** Define `art-YYYY.MM.X` semantic-version tags (bi-annual, May/November aligned with Nixpkgs cadence for legibility). A channel is "these versions of these components, tested together via a substrate-level CI job."
  - **Content-addressed pinning.** Anchor every schema/spec directory in ley-line's CID scheme so consumers can verify they have the *exact* schema bytes the channel pinned.
  - **Reproducible-build framing as supply-chain anchor.** When SLSA L1+ is wired up (see `slsa-sigstore-in-toto.md` Adopt list), include a "reproducible-build" attestation predicate borrowing from Nix's content-addressed-derivation story.
- **Skip:**
  - **Nix as the build substrate.** Quarter-of-work paradigm shift, no Nix expertise on the team, premature without ≥3 external consumers.
  - **Nix's substituter trust model.** Static `trusted-public-keys` is the SPIRE-anti-pattern signet exists to replace.
  - **Nix's untyped outputs.** Our IDL is capnp; we don't want to give up types at the substrate manifest layer.

## Action items

- [ ] File bead (art-substrate): "spec `art.lock` manifest format — Cap'n Proto schema pinning component versions + content hashes. Borrow `flake.lock` shape." Owner: cloister/art-substrate. ~1 week for spec, +1 week for generator.
- [ ] File bead (art-substrate): "define channel taxonomy — `art-2026.05.0` etc. — and the substrate-level CI job that gates channel promotion. Borrow Hydra gating shape, adapted to GHA reusable workflow." Owner: art-substrate. ~2 weeks.
- [ ] File bead (ley-line): "confirm CID scheme is the right anchor for content-addressed schema pinning; document the `narHash`-equivalent semantics." Owner: ley-line. ~3 days.
- [ ] File bead (research): "evaluate per-repo `flake.nix` for dev-shell reproducibility — does it justify Nix expertise overhead?" Deferred — revisit when ≥1 external developer joins. ~Deferred.

## Cross-references

- Related prior-art entries: [smithy](smithy.md) (codegen plugin architecture, different layer), [slsa-sigstore-in-toto](slsa-sigstore-in-toto.md) (supply-chain — Nix's reproducibility complements SLSA's attestation framing).
- Related beads: `cloister-1b59a2` (substrate-as-kernel framing — `art.lock` is the kernel's manifest).
- Related ADRs: none yet — `art.lock` and channel taxonomy will be the first art-substrate ADRs.
