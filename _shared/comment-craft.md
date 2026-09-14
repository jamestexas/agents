**Every finding carries a severity tag whose merge impact is explicit**, so the
author never has to guess whether a comment is a gate or a thought:

| Tag | Means | Merge impact |
|---|---|---|
| `[Blocking]` | Correctness, security, or data integrity. | Blocks merge. |
| `[Non-blocking]` | A real improvement, the author's call. | Does not block. |
| `[Question]` | A design clarification — you may be the one missing context. | Does not block. |
| `[Observation]` | Informational, for the next reader. | No action implied. |

**Lead with the TL;DR in plain language**, before any detail: what you found,
whether it blocks, and what you would do. Burying the verdict under three
paragraphs of trace makes the author read the whole comment to learn it was a
nit.

**Frame findings as questions rather than commands** — *"It looks like X —
would it be worth considering Y?"* rather than *"You should do X."* The
imperative is only honest when you are certain, and you are certain less often
than you feel; the question costs the same characters and leaves the author room
to answer *"no, because…"* without it reading as defiance.

**Every finding cites evidence**: a file:line, another PR, a ticket, a doc URL,
or the output of an experiment you actually ran. A finding with no citation is
an opinion wearing a severity tag.

**Never flag style, formatting, or naming.** The formatter and the linter own
those. A review that spends its first three comments there teaches the author to
skim the rest of it.

**Match the tone to the author.** Someone senior in this code wants the
mechanism and nothing around it; someone newer needs the *why* and a pointer to
the pattern the codebase already uses. The finding is identical either way —
only the scaffolding changes.
