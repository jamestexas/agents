# Licensing — AGPL-3.0-only here, Apache-2.0 everywhere else

The one-way boundary between the two, why it runs that direction, and how it
gets crossed by accident. The load-bearing fact is also stated in
[the README](../README.md) so nobody has to reach this file to learn which
license governs code they are about to copy.

## The statement

**`hud/` is AGPL-3.0-only.** Full text in [`hud/LICENSE`](../LICENSE); SPDX
identifier `AGPL-3.0-only`. The rest of the repository is Apache-2.0
([`../LICENSE`](../../LICENSE)), and that root file does **not** cover this
directory — a reader who assumes it does, or who trusts GitHub's repository
label (the detector reads only the root file and reports "Apache-2.0"), will
get this directory wrong.

Why the asymmetry: everything else in this repository is text you copy into
your own `~/.claude/`, where permissive is the whole point. The HUD is a served
web application. Run it where others can reach it and the AGPL's section 13
network clause is exactly the obligation that fits the artifact — users of the
running instance can get its source. `-only`, not `-or-later`: version 3 of the
AGPL and no other.

The published container image carries the same identifier, so a recipient of
the bits learns the obligation from the metadata rather than from this file:
`org.opencontainers.image.licenses: AGPL-3.0-only` in
[`apko.yaml`](../apko.yaml), and `copyright: [license: AGPL-3.0-only]` in
[`melange.yaml`](../melange.yaml), which is what reaches the APK metadata and
the generated SBOM.

## One-way compatibility (invariant)

> Apache-2.0 code from this repository may be used **inside** `hud/`.
> Code from `hud/` may **not** be copied **out** into the Apache-2.0 part.

That direction is not a style preference; it is what the two licenses permit.
Apache-2.0 is one-way compatible with the AGPL — permissive code can be
absorbed into a copyleft work, and the result is AGPL. The reverse launders
AGPL code into an Apache-2.0 notice, mislicensing it for everyone downstream
who trusts that notice, and no tool in this repository will tell you it
happened.

**The property being preserved:** `hud/` imports nothing from outside itself —
only Node builtins (`node:fs`, `node:http`, …) and its own modules. The
vendored `hud/ui/` bundles are MIT third-party code, not repository code. That
self-containment is what makes the boundary checkable by looking at it.

**How it gets violated by accident**, which is the only way it will be:

- Lifting a helper out of `hud/server.mjs` or `hud/hud-index.mjs` into a shared
  `scripts/` module because two places now want it. The copy in `scripts/` is
  AGPL code under an Apache-2.0 notice.
- Adding an `import` in `hud/` that reaches above `hud/`. This one is legal
  license-wise (Apache flows in) but it dissolves the self-containment that
  makes the first violation easy to spot, so treat it as a boundary change and
  say so in the commit.
- Copying a `hud/ui/index.html` snippet into a skill or agent file elsewhere in
  the repository.

If code genuinely needs to be shared across the boundary, move it **into** the
Apache-2.0 part first and have `hud/` import it from there. Direction matters;
the destination license does not change under you.

## Vendored third-party code

`hud/ui/marked.min.js` and `hud/ui/mermaid.min.js` are vendored bundles, both
MIT. MIT is AGPL-compatible, but attribution is mandatory: see
[`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) for each bundle's version
and full notice. Both files carry the notice in their own header too. If you
bump a bundle, keep the header and update the version in that file.
