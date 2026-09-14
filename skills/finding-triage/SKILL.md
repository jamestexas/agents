---
name: finding-triage
description: >
  Triage a list of candidate findings — from a PR review, a self-audit, an
  adversarial agent, a counterfactual or parity audit — and decide which ones
  deserve to be raised. Two bars, both required: TRUE (the code really behaves
  that way, mechanism verified at a named line) and MATTERS (practically
  actionable against this change). Use when you are holding a findings list and
  are about to hand it to a human. Read-only judgment: it decides what to raise,
  it does not post and does not patch.
allowed-tools: "Read,Grep,Glob,Bash(git log:*),Bash(git diff:*),Bash(git show:*)"
disallowed-tools: Write, Edit
argument-hint: "<path to a findings file, or the candidate findings inline>"
user-invocable: true
---

# finding-triage — the significance gate: TRUE **and** MATTERS

The spine, one question per candidate:

> **Would the author do something differently because I raised this?**

A finding must clear **two** bars, and clearing one is not a partial pass:

1. **TRUE** — the code really behaves the way the finding says, and you can name
   the line where the mechanism lives.
2. **MATTERS** — acting on it changes this change, for a consumer that exists.

Almost all review noise is findings that clear only the first bar. They are
accurate, they are checkable, and they are worthless: the reviewer spends
credibility, the author spends a reply, and the code ends where it started. A
producer of candidates — an adversarial agent, a grep pass, your own second
read — is *supposed* to over-generate. This skill is the gate that stands
between over-generation and a human's attention.

**This skill does not generate findings.** It consumes a list someone else
produced and returns a disposition per item. It does not post to GitHub (that is
`pr-review` / `pr-suggestion`), it does not edit code (that is the implementing
skill), and it never opens a new investigation front — a candidate nobody
proposed is out of scope, however tempting.

## Bar 1 — TRUE

A finding is TRUE when you have read the current code and can state the
mechanism at a named `file:line`. Not the smell, the mechanism: *"`parse()` at
`handler.go:88` runs before the signature check at `:104`"*, not *"validation
ordering looks suspicious here."*

Three things that masquerade as TRUE and are not:

- **A pattern match.** The shape resembles a known bug family. That is a reason
  to go look, not a finding. If the lookup did not happen, the candidate is
  unverified — say so, do not launder it into a claim.
- **A summary.** The PR description, a commit message, or another agent's
  confident paragraph is what is *claimed*. The file at HEAD is what is *true*.
  Read the artifact.
- **A stale read.** The finding was true at the commit the producer read. Check
  the current code before carrying it forward (see Already Addressed).

An unverified candidate is not automatically dropped — it is **revised** down to
what you actually hold, or dropped with "could not verify the mechanism" as the
reason. What it must never do is reach the author wearing a certainty you did
not earn.

## Bar 2 — MATTERS

### Blast radius

Weight by consequence, not by how clever the catch was. Four axes:

| Axis | Ask |
|---|---|
| Cardinality | One call site, or every caller of a shared helper? |
| Reachability | Is there a **live** consumer today, or only a future/internal/test one? |
| Frequency | Every request, or one unreached error branch? |
| Severity | Data loss, security, wrong answer — or a log line nobody reads? |

A correctness bug on a path with zero production callers and a style nit on the
hot path invert the ranking you would give them from the diff alone. Reachability
is the axis reviewers skip most: a defect in code that nothing calls yet is a
note, not a blocker.

### Actionable against THIS change

The author can act on the diff in front of them. Findings about code that does
not exist yet, a contract that has not merged, or a migration scheduled for next
quarter are speculative here — downgrade them to a note or drop them. "You will
need to handle X when Y lands" is a ticket, not a review comment, and filing it
as a review comment makes the PR the wrong place to track it.

### The status quo test

Before flagging a pattern, check whether the same pattern is already established
in the same file or module. If it is, this change did not introduce it — it
followed local convention. That is at most a separate cleanup, raised as such,
and only with the precedent cited (`same shape at other_file.go:40, :67`).

Blaming an author for the house style is the single fastest way to have a whole
review discounted, because it proves you reviewed the diff without reading the
file around it.

### Charitable reading

Test the finding against what the author **literally** claimed — in the PR body,
the doc comment, the commit message — not against your paraphrase of it. If a
description says "handles the common case," a missing edge case is not a
contradiction; it is the stated scope. Manufacturing a contradiction by
restating the claim more strongly than the author did is a drop, and reads as
bad faith even when the underlying observation is fine.

### The drop heuristic

> When you catch yourself writing **"technically true, but…"**, that is usually
> a drop.

The clause after *but* is the real verdict; the clause before it is you not
wanting to waste the work. Same for "worth noting that," "minor, but," and "not
blocking, however." If the honest framing needs an apology in front of it, the
finding did not clear bar 2.

## Dedup — work already done

Two checks, both against evidence, before anything is confirmed:

- **Already Raised** — another reviewer, a bot, or an earlier pass said it.
  Cite **who** and where. Repeating a live comment in your own words splits the
  thread and doubles the author's reply cost.
- **Already Addressed** — the author fixed it. Verify by **reading the current
  code at the cited line**, never by a commit timestamp or a commit message that
  sounds like the fix. A commit touching the file is not a commit fixing the
  concern, and a review thread stays visibly open long after the code is right.

## Output contract — the completion criterion

**Every input candidate gets exactly one disposition. Dropped ones are reported
with their reason, never silently omitted.**

This is the gate's own falsifiability. A triage that quietly returns a shorter
list is indistinguishable from a lazy one that read three items and stopped; the
dropped rows with reasons are the only evidence the gate actually ran. Count the
rows out against the input: `candidates in == rows out`, and say both numbers.

The five dispositions, one per candidate:

| Disposition | Means | Required with it |
|---|---|---|
| `confirmed` | Clears TRUE and MATTERS; raise it | mechanism at `file:line` + blast-radius one-liner |
| `dropped` | Fails a bar | one-line reason naming **which** bar and why |
| `already-raised` | Live elsewhere | who raised it, and where |
| `already-addressed` | Fixed at HEAD | one-line summary + the line you read to confirm |
| `revised` | Real but mis-stated | the severity/scope shift, and what it is now |

Report as one table, input order preserved:

```markdown
## Triage — N candidates in, N dispositions out

| # | Candidate (one line) | Disposition | Evidence / reason |
|---|---|---|---|
| 1 | parse before signature check | confirmed | `handler.go:88` vs `:104`; every inbound webhook |
| 2 | helper could be generic | dropped | fails MATTERS — no second caller exists |
| 3 | error swallowed in retry | already-raised | @reviewer, review thread on `retry.go:31` |
| 4 | missing nil guard | already-addressed | guard present at `store.go:52` (read at HEAD) |
| 5 | "unbounded" queue growth | revised | bounded at 1k by config; now a note, not a blocker |
| 6 | naming inconsistent with module | dropped | status quo — same shape at `:40`, `:67` |

**Confirmed: 1. Dropped: 2. Already raised: 1. Already addressed: 1. Revised: 1.**
```

Then the confirmed set alone, in blast-radius order, ready for whatever posts or
acts on it. Ordering is part of the output: an unordered confirmed list makes
the reader redo the weighting you were asked to do.

## Common mistakes

| Mistake | What it costs |
|---|---|
| Returning only the confirmed set | The gate is unauditable; a lazy pass looks identical |
| Confirming on a pattern match | A wrong claim at a named line burns the whole review's credibility |
| Trusting a commit message for Already Addressed | Thread reopened on code that was already correct — or worse, closed on code that was not |
| Flagging house convention as a defect | Author discounts every other finding in the batch |
| Keeping a "technically true, but…" | Author spends a reply, code does not change |
| Raising future-contract concerns on this PR | Real work gets tracked in a place nobody rereads |
| Adding a finding nobody proposed | Out of scope: this is a gate, not another producer |
