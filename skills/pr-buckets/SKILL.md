---
name: pr-buckets
description: Group a body of in-progress work (a diff, a branch, a set of changes) into small, individually-reviewable PR buckets sized to a LoC threshold — one concern per bucket, in dependency order. The input to jj-stack. Use when one dev branch has grown past a review-friendly size and needs slicing into small PRs. Distinct from problem-decomposer, which decomposes an aspiration into dispatchable beads BEFORE code exists; pr-buckets slices code that already exists.
allowed-tools: "Read, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(jj diff:*), Bash(jj log:*), Bash(wc:*), Bash(cloc:*)"
argument-hint: <branch-or-revset> [--threshold=150] [--base=main]
---

<!-- Author: jamestexas -->

# /pr-buckets — slice one branch into small, reviewable PR buckets

You have one dev branch you reasoned about linearly. Reviewers want small PRs.
This skill decides the **bucket boundaries** — the logical PR-sized slices — so
`jj-stack` can mechanically produce them. It decides *what* the PRs are; it does
not touch git/jj.

## The bar

A bucket is **one concern a reviewer can hold in their head in one sitting**.
Default threshold: **~150 LoC of implementation** (see the counting rule — tests
don't count the same). Treat it as a strong default, not a hard gate:

- Under threshold, single concern → ship as its own bucket.
- Over threshold because of **cohesive impl** (a parser + its dispatcher) → try
  to split by sub-concern; if it genuinely can't split without leaving a
  half-built thing, keep it whole and **say so in the bucket note** ("187 LoC —
  the dispatcher is atomic; splitting would ship an unwired handler").
- Over threshold because of **tests** → not a violation. Tests inflate line
  count but are cheap to review. Count impl and test separately (below).

## Counting rule (impl vs test)

Report each bucket as `impl / test` LoC, not one number. The threshold applies
to **impl**. A 357-line bucket that is 133 impl + 224 table-test is a *small*
PR wearing a big number — flag it, don't split it. Get the split with:

```
git show --stat <commit>        # per-file line counts
jj diff -r <rev> --stat
```
Sum the non-`_test.go` / non-`*_test.*` files for impl; the rest is test.

## Where the boundaries are (in priority order)

1. **By layer / module** — a change that spans `core/` + `server/` + `cmd/` is
   usually 2–3 buckets (the dispatcher, the wiring, the entrypoint), not one.
2. **By concern** — a new capability + a test-harness change that enables
   testing it are two buckets (the feature, and the seam). "My test is separate"
   is a first-class boundary.
3. **By file disjointness** — buckets whose file sets don't overlap split
   cleanly in jj (`jj split <paths>` is non-interactive when slices are
   file-disjoint). Prefer boundaries that fall on file lines when you can.
4. **By blast radius** — a shared-signature change (a constructor that gains an
   arg) and its call-site updates must land together or the intermediate commit
   won't build; that forces a bucket boundary (they're one bucket) or a
   back-compat wrapper (they're two).

## Dependency order

Buckets have a build order: a mapper before the code that calls it, wiring before
the entrypoint that wires it. Emit them **bottom-up** (base first), because
jj-stack builds the stack in that order and each PR bases on the previous. If a
bucket doesn't depend on the rest (a test-harness seam, a pure util), mark it
**off-stack** — it can base directly on the feature branch, reviewed in parallel.

## Output

A short bucket manifest (write it to the project's notes tree, e.g. `$HUD_ROOT`
if present, else print it). One row per bucket:

```markdown
| # | bucket | impl / test | files | depends-on | note |
|---|--------|-------------|-------|------------|------|
| 1 | client wrapper        | 255 / 0   | clients.go (+test)        | base     | cohesive, atomic |
| 2 | mapper                | 133 / 224 | mapping.go (+test)        | 1        | test-heavy, small PR |
| 3a| dispatcher            | 149 / 38  | core/x.go, x_deleg_test.go | 2       | |
| 3b| server wiring         | 17 / 72   | server/x.go, wiring_test   | 3a      | |
| 3c| parity test flip      | 0 / 40    | parity_test.go            | 3b       | test-only |
| T | test harness (seam)   | 162 / 14  | dtest/*.go                | off-stack| separate track |
```

Then hand off: **"buckets ready → run /jj-stack to produce the stacked PRs."**

## Anti-patterns

- Don't split a shared-signature change from its call sites (breaks the build).
- Don't count tests against the impl threshold (you'll over-split).
- Don't make a bucket that leaves a half-wired feature (unwired handler, exported
  fn with no caller *and* no test) — that's a worse review than a slightly-big
  cohesive one.
- Don't invent buckets to hit a number. Three honest concerns beat six artificial
  slices.
