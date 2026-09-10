---
name: design-doc-review
description: >
  Review a design doc for the decision it asks you to ratify — not the prose.
  Catches the expensive-to-reverse mistakes while they are still words: a
  problem stated as a solution, alternatives that were never really considered,
  a one-way door taken without noticing it is one, invariants that hold only on
  the happy path, a contract the design cannot actually keep, and success
  criteria you could never falsify. Weights scrutiny by reversibility × blast
  radius and hunts the highest-value target of all — the load-bearing question
  the doc never asks. Use before a design review meeting, before you +1 an RFC,
  or when a doc reads well but you can't say why you trust it.
allowed-tools: "Read,Bash,Grep,Glob,WebFetch,Agent"
argument-hint: "[design doc: a Google Doc URL, a file path, an RFC/ADR, or pasted text]"
---

# design-doc-review — review the decision, while it is still cheap to change

The spine, one question:

> **What decision am I being asked to ratify, how expensive is it to unmake,
> and what is the most load-bearing thing this doc does not say?**

A design doc is the last point where a mistake costs *words* instead of
*quarters*. Code review asks *is this built right*; design review asks *is this
the right thing to build, and will this shape survive contact with reality* —
while the answer is still a paragraph, not a schema, a wire format, a public
API, or an org dependency. Your job is to find the expensive-to-reverse errors
before they calcify. A doc can be beautifully written and still be the wrong
call; fluency is not soundness.

This skill audits **whether the decision holds**. It is not a copy-edit, not a
"do I like this" reaction, and not a code review of the eventual
implementation. A good design-review comment is not "this sentence is unclear" —
it is *"what would have to be true for the rejected alternative to win?"* or
*"this locks in a data model we can't migrate — is that intentional?"*

## When to use

- Before a design-review meeting or before you approve/+1 an RFC/ADR/one-pager.
- When a doc reads well but you can't articulate why you trust (or distrust) it.
- When you are the author and want to pre-empt the review — run it on your own
  doc and answer the unasked question before someone else asks it.
- Upstream of `problem-decomposer` / `work-scope`: review the decision before you
  break it into shippable units, not after.

## The weighting rule (this is also the calibration)

**Match scrutiny to reversibility × blast radius.** Spend your review budget on
the *one-way doors* — the choices that are expensive or impossible to undo
(persisted data models, published wire formats and APIs, a vendor or framework
lock-in, an org/ownership boundary, anything a customer will depend on). Skim
the *two-way doors* — choices a later PR can reverse cheaply. Most weak reviews
spend their energy inversely: bikeshedding the reversible, waving through the
irreversible. The severity ladder below is this rule made mechanical.

## The hunting catalog — the lenses to run

Run each lens as a question, not a checklist tick. Most docs trip a few; a
strong doc trips almost none and that is a valid verdict.

### L1 — Problem legitimacy
*Is the problem stated as a **need**, with evidence — or is a solution smuggled
into the problem statement?* Who has it, how often, what does not-solving-it
cost? A problem section that already names the mechanism ("we need a Kafka
queue") has skipped the step where the problem could have had a cheaper answer.
→ Restate the problem with the solution stripped out; does the doc's proposal
still obviously follow?

### L2 — The decision and its alternatives
*What decision am I actually being asked to ratify, and why not the
alternatives?* A design doc with no rejected-alternatives section — or with
strawman alternatives that exist only to lose — is advocacy, not design. →
Name the strongest alternative the doc did **not** consider, and ask: *what
would you have to believe for it to win?* If the answer is "nothing, really,"
the decision is under-argued.

### L3 — Reversibility and blast radius
*One-way door or two-way door? What does this lock in?* Enumerate what becomes
expensive to change once this ships: a schema, a serialized format, a public
API surface, a default that callers will depend on, a data migration, a trust
boundary, a team that now owns something. → For each one-way door, is the doc
*aware* it is one-way, and does it justify paying that price now vs. deferring
it behind a reversible seam?

### L4 — Invariants and failure modes
*What must always be true, and what happens when it isn't?* For each stated (and
unstated) invariant, walk the violation: the dependency is down, the input is
hostile, the scale is 100×, two of these run concurrently, the clock skews, the
process dies mid-operation. → Where does the design *degrade* vs. where does it
*fall over*? A design that only describes the happy path has not been designed
yet. (For deep adversarial passes, dispatch the specialist agents — see
Procedure step 3.)

### L5 — Contract honesty
*Does the guarantee the doc **promises** match what the mechanism can actually
**deliver**?* Find the boundary this exposes to other people and read the
promise on it (latency, consistency, durability, ordering, "exactly once",
"never returns X"). Then check the mechanism can keep it. → A promise the design
cannot back is worse than a weaker honest one, because consumers will build on
the promise. Also: who consumes this boundary, and is there a migration/compat
story for them?

### L6 — Cost and second-order effects
*What does this cost to build, run, and — the part docs skip — **operate**?* Who
is on-call for it? What new failure surface, cognitive load, or coupling does it
add? What does it make *harder later*? → The tail (ops burden, lock-in, the
capability it forecloses) is where the real cost hides; a doc that only counts
build cost has counted the cheapest part.

### L7 — Success and falsifiability
*How will we know it worked — measurably — and what signal would tell us it was
the **wrong** call?* "Improves reliability" is not a success criterion; a number
with a date is. → Is there a bar we could actually fail? If nothing could
falsify "this succeeded," the doc has no success criteria, only hopes — and
nobody will notice if it quietly didn't work.

### The meta-move — the unasked question
The single highest-value thing a design reviewer does is surface the assumption
so load-bearing that nobody wrote it down. Everything *in* the doc is defended;
the danger is always in what it does not raise. → After the seven lenses, ask:
*what is the one question that, if the answer is bad, sinks this — and the doc is
silent on it?* That question is your headline comment.

The seven lenses are one spine pointed at seven places: L1 — is the problem
real; L2 — is the decision argued; L3 — how hard to unmake; L4 — does it hold
off the happy path; L5 — can it keep its promise; L6 — what does it truly cost;
L7 — how would we know. The meta-move is the spine pointed at the gaps between
them.

## Procedure

### 1. Load and pin the intent
Load the doc (Google Doc URL → Drive tool or WebFetch; a path → `Read`; pasted
text → use directly). Then pin the intent in one sentence: **the decision this
ratifies, and what makes it a success vs. a failure** — outcome, not mechanism.

- If a human is driving, ask them for it. From the **author** (self-review) it
  forces the outcome the draft was built toward to be stated, not left implied
  by the assembled parts. From the **reviewer** it states the bar up front,
  instead of reviewing against an unstated assumption.
- If you are dispatched and cannot ask, write the intent you infer from the doc
  and mark it **UNCONFIRMED** — and make "confirm this is what you meant" the
  first thing the output asks for.

Then check three things agree: what the **author meant**, what the **reviewer is
testing for**, and what the **doc actually does**. A gap between the stated
intent and the doc's mechanism — or between the author's and the reviewer's
intent — is **finding #1**, ahead of any lens. A doc can be internally rigorous
and still aim at the wrong outcome; this step is what catches it.

### 2. Frame
In one sentence each: the **decision**, its **blast radius** (who/what depends on
the outcome), and its **reversibility** (one-way or two-way, and where the
one-way doors are). This decides where the rest of your budget goes.

### 3. Run the seven lenses
Walk L1–L7 against the doc. For each, either file a finding or record that the
lens is satisfied (crediting a strong doc is part of the job — see Calibration).
Anchor every finding to a specific claim, section, or *absence* in the doc.

### 4. Adversarial depth on the one-way doors (dispatch)
For the high-blast-radius / irreversible parts, dispatch the specialist lenses
in parallel rather than reasoning shallowly across all of them:
- **security / trust boundaries** → `security-auditor`, `trust-root-adversary`.
- **invariant strength (L4/L5)** → `type-driven-correctness` (is the invariant
  carried by the strongest mechanism, or demoted to prose the design relies on?).
- **resource exhaustion / fairness** → `dos-resilience-auditor`.
- **silent-failure / observability** → `observability-gap-auditor`.
- **"is this actually novel or reinventing X?"** → `prior-art-cartographer` skill.
- **greybeard "does the theory match what will be built?"** → `paradigm-assessor`.

Verify every agent claim against the doc yourself before relaying it — agent
confidence is not evidence.

### 5. Find the unasked question
Name the one thing the doc leaves unsaid that most threatens the decision.

## Output

A review, not a bare list. Structure:

1. **Stated intent** — the one-sentence decision + what success vs. failure
   looks like, marked **confirmed** (a human gave it) or **UNCONFIRMED** (you
   inferred it — flag it for the author's sign-off). If you can't restate the
   decision at all, that clarity gap is finding #1; if the stated intent and the
   doc's mechanism aim at different outcomes, that mismatch is finding #1.
2. **Frame** — blast radius + the one-way doors you found (from step 2).
3. **Findings**, each: the lens, the specific claim-or-absence, why it matters
   *given reversibility*, and the cheapest thing that would resolve it (an added
   alternative, a measurable criterion, a reversible seam, a stated failure
   mode). Severity:
   - **BLOCKER** — a one-way door taken without justification, an unsound
     invariant on a real input, or a promised contract the mechanism cannot
     keep. Something expensive-to-reverse that is wrong or unargued.
   - **COMMENT** — a reversible gap worth closing before or shortly after ship
     (a missing measurable criterion, an alternative not addressed, an
     unstated-but-benign assumption).
   - **NOTE** — an argued, disclosed scope cut or accepted trade-off, recorded
     so the author's reasoning is on the record.
4. **The unasked question** — your headline: the load-bearing silence.
5. **What's already right** — the decisions that are well-argued, the one-way
   doors correctly identified and justified, the measurable criteria, the
   honestly-disclosed trade-offs. A review that only flags is miscalibrated and
   trains the author to route around you.

## Calibration

The failure mode is **reviewing the prose instead of the decision** — nitpicking
wording, demanding exhaustive alternatives for a two-way door, treating an
author's disclosed trade-off as an oversight. That is noise; it buries the one
finding that mattered and teaches the author to discount you. The opposite
failure is **fluency capture** — approving a well-written doc whose central
decision is unargued because it *reads* authoritative.

Hold the line at the spine question and the weighting rule: scrutinize the
one-way doors hard, skim the two-way doors, and always name the unasked
question. **"This decision holds, and here is why" is a valid, respectable
verdict** — reaching it *with the one-way doors identified and stress-tested* is
the point, not the finding count.

## Project-specific extensions (optional)

If `~/.claude/skills/design-doc-review/extensions.md` exists, read it during
step 1. It maps these generic lenses onto your org's actual design-doc template
sections (so each lens lands on the section that carries it), and can add
house-specific one-way doors (the schemas, wire formats, and boundaries your
org treats as irreversible). Absent it, the review is the generic version and
degrades gracefully.

## Cross-references
- **Dispatchable form:** `design-doc-reviewer` (agent) applies this exact
  discipline and returns a structured verdict — use it to review a doc in a
  clean context, or to run this over a doc while you do something else.
- **Downstream:** once the decision holds, `problem-decomposer` and `work-scope`
  break it into dispatchable/shippable units.
- **Reviewer-of-record habits:** `pr-review-kit` (its "design intent" phase is
  this skill applied after the code exists; the verification rules — cite
  sources, verify the artifact not the summary — apply here too).
- **Adversarial specialists:** `type-driven-correctness`, `security-auditor`,
  `trust-root-adversary`, `dos-resilience-auditor`, `observability-gap-auditor`,
  `paradigm-assessor`; `prior-art-cartographer` skill for reinvention checks.
