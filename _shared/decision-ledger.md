**The decision ledger — what you asked, not just what you concluded.**

The matrix records claims that survived. The dimension sweep records coverage.
Neither records the *path*: which questions the review actually turned on,
which were settled, and which were abandoned. That path is what makes a wrong
review diagnosable — a reader who disagrees with the verdict can find the
question that was mis-answered instead of re-deriving the whole review.

```markdown
## Decision ledger

| # | Question | Settled by | Decision |
|---|---|---|---|
| 1 | Does the new guard run before the signature check? | call order at `handler.go:88` vs `:104` | No — `parse()` is first. → finding 1 |
| 2 | Is the migration safe for a rolling deploy? | does old code read the new column as NULL | **Unresolved** — deploy order not visible from the diff |
| 3 | Is the retry budget bounded? | `config.go` default + caller override | Yes, 1k via config. Dropped as a candidate. |
```

**The middle column is the whole mechanism, and it is written before the
answer exists.** A question-and-decision log composed after the reasoning is
narration: a plausible question gets invented for a conclusion already
reached, and it reads exactly like the real thing. Naming what *would settle*
the question first is a pre-commitment — the same discipline as citing primary
sources, lifted one level up from findings to the questions that produce them.
If you cannot say what would settle a question, you are not ready to ask it.

**Three rules make this a gate rather than a diary:**

1. **Every finding traces to at least one question.** A finding with no
   question behind it arrived by pattern-match, which is the thing
   `finding-triage` exists to catch.
2. **Every question terminates** in a decision or an explicit `Unresolved`. A
   question left hanging is a defect in the review, the same way a blank
   dimension row is.
3. **Count it out.** State both numbers: *questions asked* and *decisions +
   unresolved*. They must be equal. Arithmetic is checkable by a reader who
   did not watch the work; prose assurance is not.

**Scope it to decisions that could have gone the other way.** Anything that
changed what you looked at next, and anything you dropped. A question at every
trivial step drowns the signal, and the rows that matter most are usually the
`Unresolved` ones — they are the review telling a future reader exactly where
it stopped seeing.

**This lives in the artifact, never in the posted comment.** The author wants
the tag, the claim, and the file and line; `comment-craft`'s lead-with-the-verdict
rule already settles that. The reasoning path costs a local file nothing, and
the posted review gets *shorter* once the reasoning has somewhere else to live.
