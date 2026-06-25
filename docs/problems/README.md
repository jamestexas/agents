# Problem decompositions

Working documents produced by the [`problem-decomposer`](../../skills/problem-decomposer/) skill.

Each file in this directory follows [TEMPLATE.md](../../skills/problem-decomposer/TEMPLATE.md):

- **Aspiration** at the top — a state-of-the-world we want to be true
- **5-Whys descent** for each branch — proves leaves are rooted, not orphan
- **Requirement lattice** — DAG of intermediate nodes (leaves can have multiple parents)
- **Dispatchable leaves** — bead-ready work items, each passing the [7 dispatchability properties](../../skills/problem-decomposer/DISPATCHABILITY.md)
- **Non-leaves queue** — honest exits for work that's real but not yet dispatchable
- **Mermaid lattice** rendering

## Conventions

- File name: `<aspiration-slug>.md` (e.g., `substrate-idl.md`)
- Status banner in header: `Draft | Reviewed | Locked`
- Refresh after: 3-month max staleness
- Cross-reference related prior-art entries (`../prior-art/*.md`) and ADRs in the consuming repo (e.g. `<consuming-repo>/docs/adr/`)

## What lives here vs. elsewhere

- **Here:** the decomposition itself — aspiration, lattice, leaves, non-leaves
- **In the consuming repo:** the actual ADRs that the leaves reference, the actual beads that get filed from the leaves, the actual code
- **In `prior-art/`:** the external-system comparisons that inform the decomposition (Smithy, Buf, SPIFFE, etc.)

The decomposition is a *plan document* that bridges aspiration → bead specs. Filing the beads, writing the ADRs, and shipping the code all happen elsewhere; this doc records the lattice that made the work coherent.

## How to file leaves into beads

After review, copy each leaf's spec section into a `rosary:note` invocation (or directly into `rsry_bead_create` with `--description` set to the leaf's full spec). The leaf's "Suggested target repo" tells you which `.beads/` to file into.
