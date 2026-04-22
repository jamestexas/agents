---
name: self-audit
description: >
  Pre-review self-audit of a PR branch. Use after addressing review feedback,
  before tagging a human reviewer, or after a significant self-directed
  refactor. Runs a structured pass looking for the stuff a careful human
  reviewer will catch but a compiler won't — dead struct fields, rotting
  comments, duplicate types, test-only exports, scope drift — then dispatches
  an adversarial agent on the diff for deeper design flaws.
allowed-tools: "Bash,Read,Grep,Glob,Agent"
argument-hint: "[base-branch, defaults to main]"
---

# self-audit — Pre-review quality pass

Check your own PR like a grumpy reviewer would, before one sees it.

The compiler and `golangci-lint` catch the easy stuff. This skill catches the
grown-up stuff that slips past both of them.

## When to use

- After addressing review feedback, before asking a reviewer to look again.
- After a significant self-directed refactor, before creating the PR.
- Any time you feel "done" but want a second opinion that isn't a human.

## Arguments

`$ARGUMENTS` — optional base branch name. Defaults to `main`.

---

## Step 1 — Scope sanity

```bash
git diff --stat <base>...HEAD
```

Read the list. For every file, ask: *did I intend to change this?* If anything
looks surprising — generated files, unrelated packages, formatter drift — stop
and investigate before continuing. The rest of this audit is wasted effort if
scope is wrong.

## Step 2 — Dead struct fields

A struct field that is written but never read is dead code. `golangci-lint
unused` does **not** catch this — as long as the field appears on either side
of an `=`, it counts as used.

For every struct field you added, confirm there is a read site outside the
place it is written. If the only references are:

- the extractor/constructor that populates it, and
- a test that asserts "this field is non-empty",

...that is circular — the test verifies the field exists, and nothing else cares.
Delete the field, its extractor, and that test.

```bash
# Rough heuristic — greps for every .FieldName use:
rg '\.FieldName\b' --stats
```

A real non-test, non-self reader is required.

## Step 3 — Comments that rot

Comments die when they reference context that fades. Scan for patterns that
will be meaningless in six months:

```bash
rg -n '@\w+|comment #|round \d+|per the review|commit [0-9a-f]{7,}|\.go:\d+|renamed from|formerly|was previously|intentionally|rather than' <changed-files>
```

For each hit ask: *will this comment make sense to someone who never saw the
PR thread?* If no, rewrite. State what the code does, not how it got this way.

Worst offenders, in order of how badly they age:

- **Reviewer names** in comments ("added per X's suggestion"). People rotate;
  comments survive.
- **Cross-file line numbers** ("covers foo.go:123"). Rot the moment anything
  moves.
- **Historical framings** ("renamed from X", "formerly Y", "not Z anymore").
  Description by negation tells a future reader about a past they don't have.
- **"Intentionally" / "deliberately"** as defensive filler. If the reason is
  worth saying, say the reason without the hedge.
- **"X rather than Y"** where Y never existed in the repo. Compare to
  alternatives that were actually considered, not to everything you didn't do.

## Step 4 — Duplicate or parallel types

```bash
# Types with identical field sets:
rg -U 'type \w+ struct \{[^}]+\}' <pkg> | sort | uniq -c | awk '$1 > 1'
```

Weaker heuristic that catches more: any time you have an exported and an
unexported type with the same shape in the same package, ask *"what does
exporting buy me that an accessor method wouldn't?"* If the answer is nothing,
merge them.

## Step 5 — Test-only exports

Exported API that only has test callers is either dead or wishful.

For each exported function/method/type added:

```bash
# Callers outside test files AND outside the defining file:
rg -l '\bFunctionName\b' | rg -v '_test\.go$' | rg -v '<defining-file>'
```

Zero results → it's exported for future use that may never come. Make it
unexported unless the future use is imminent.

## Step 6 — Project convention check

Most repos state conventions *outside* the linter config — `CLAUDE.md`,
`AGENTS.md`, `CONTRIBUTING.md`, `.cursorrules`, team memory files. Generic
linters catch what's universal; these files catch what's local. Read them
and check your diff against them.

```bash
# Skim project conventions before checking:
head -200 CLAUDE.md AGENTS.md CONTRIBUTING.md .cursorrules 2>/dev/null
```

Classes of convention that generic linters miss:

- **Test idioms** tied to the Go/language version (e.g. `t.Context()` over
  `context.Background()` in Go 1.24+ repos).
- **Error wrapping conventions** (`%w` vs `%v`; when to wrap).
- **Log framework preferences** (project-specific choice of slog / zerolog
  / internal logger).
- **Import-grouping rules** beyond what `goimports` enforces.
- **Private-type + exported-interface return patterns**.
- **Subtests vs table-driven** test preferences.

If your org runs a policy bot in CI that checks project-specific rules,
the CLAUDE.md / convention docs are the local source of truth the bot is
mirroring. A hit here saves a CI round-trip.

## Step 7 — Adversarial agent pass

This is the highest-leverage step and the one you will most want to skip.
**Don't skip it.**

Dispatch an adversarial agent on the diff. A prompt that works:

> Here is the diff for branch `<branch>` against `<base>`. Find the fatal
> disconnect between what the commits claim and what the code actually does.
> Be mean. Do not give me a sandwich review. If you find nothing, say "clean"
> — do not manufacture concerns.

Agents worth using for this:

- `paradigm-assessor` — pure adversarial greybeard. Best default.
- `production-readiness-reviewer` — framed around ship-blockers.
- A general-purpose subagent with the prompt above.

The agent will either:

- Find something you missed → fix it.
- Say clean → push with confidence.
- Raise something wrong → defend your position clearly in writing. That
  rehearsal is worth more than the finding itself, because you will use it
  verbatim when the real reviewer asks the same question.

## Outputs

This skill produces no artifacts. Findings go straight into commits that fix
them, or are explicitly waived (with reasoning) before pushing. Do not write
a "self-audit report" file — the commits are the report.

## Anti-patterns to avoid

- **Running the audit, finding nothing, and declaring victory.** If the
  adversarial agent in step 7 also says clean, that's fine. If you skipped
  step 7 because steps 1-6 looked good, you have not actually audited.
- **Amending previous commits** to fold findings in. The stack should still
  be readable as a sequence of decisions. New commit per finding.
- **Hiding the audit in a side branch** and squashing away the evidence.
  The fact that you caught and fixed something is information for the next
  person (including future you).

## Project-specific extensions (optional)

The steps above are deliberately generic so this skill works in any repo.
For invocations tied to a specific work environment — internal style
bots, generated-code verifiers, API-compatibility checkers, policy gates
— keep them out of this `SKILL.md` and in a private extension file.

### Convention

If `~/.claude/skills/self-audit/extensions.md` exists, read and follow it
at the start of **Step 6** (project convention check). The extensions
file layers environment-specific checks on top of the generic convention
review.

Why this path:

- Lives in the user's personal Claude config, not in any git repo.
- Never at risk of being committed to a public skills repo.
- Survives re-clones and migrations of the agents repo.
- Mirrors the `skills/<name>/` structure so multiple skills can each have
  their own extensions file without collision.

If the extensions file is absent, step 6 is just the generic convention
review — the skill degrades gracefully.

### Example extension hooks worth adding

- A local runner for a CI-side policy bot (so you catch issues before push).
- A diff-vs-memory comparison (check your diff against rules stated in
  repo-level `CLAUDE.md` or team memory files).
- Repo-specific dead-code detectors (e.g. proto field usage scanners,
  Terraform variable reachability checks).
- Credential/secret sweeps specific to the org's token shapes.
